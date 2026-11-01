/**
 * Owner console: the HTTP door to the Commons.
 *
 * Mounted at /console (page) and /api/console/* (JSON). Auth is a single shared
 * key in CONSOLE_KEY. When the key is not configured the console still opens —
 * otherwise a fresh deploy would have no way in — and the page says so loudly at
 * the top, plus DECISIONS.md records the trade-off.
 */
import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { DispatchRequest, OwnerMessage, isValidCode, normalizeCode } from '@aimong/shared';
import { commons } from '../cluster/commons.js';
import { roomByCode } from '../rooms/presence.js';
import { getAppConfig } from '../app-config.js';
import { logger } from '../logger-instance.js';
import { RateLimiter } from './ratelimit.js';

function keyOf(req: Request): string {
  const header = req.get('x-console-key') ?? '';
  const query = typeof req.query.k === 'string' ? req.query.k : '';
  return header || query;
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function consoleAuthConfigured(): boolean {
  return Boolean(process.env.CONSOLE_KEY);
}

function isProduction(): boolean {
  return (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
}

/**
 * Fail closed. In production the console is *unreachable* unless CONSOLE_KEY is
 * set — a missing key is a misconfiguration, and a misconfigured console is a
 * public back door into the AI cluster. In development an unset key keeps the
 * console usable (no red warning needed) so `pnpm dev` stays frictionless.
 */
export function consoleState(): 'locked' | 'open-dev' | 'keyed' {
  if (process.env.CONSOLE_KEY) return 'keyed';
  return isProduction() ? 'locked' : 'open-dev';
}

function guard(req: Request, res: Response): boolean {
  const state = consoleState();
  if (state === 'locked') {
    res.status(403).json({
      error: 'The console is locked: CONSOLE_KEY is not configured on this server.',
      hint: 'Render → aimong-us → Environment → add CONSOLE_KEY, then redeploy.',
    });
    return false;
  }
  if (state === 'open-dev') return true;
  if (!sameSecret(keyOf(req), process.env.CONSOLE_KEY ?? '')) {
    res.status(401).json({ error: 'console key required' });
    return false;
  }
  return true;
}

export function createConsoleRouter(): Router {
  const router = Router();
  // Reads are polled by the console every 2.5 s; writes are typed by one human.
  // Both are capped per IP so the endpoints cannot be used to hammer the house.
  const readLimiter = new RateLimiter({ max: 120, windowMs: 60_000 });
  const writeLimiter = new RateLimiter({ max: 20, windowMs: 60_000 });

  const throttle = (limiter: RateLimiter) => (req: Request, res: Response): boolean => {
    if (limiter.take(req.ip ?? 'unknown')) return true;
    res.status(429).json({ error: 'slow down' });
    return false;
  };
  const readGate = throttle(readLimiter);
  const writeGate = throttle(writeLimiter);

  router.get('/snapshot', (req, res) => {
    if (!guard(req, res)) return;
    if (!readGate(req, res)) return;
    const snapshot = commons.snapshot();
    res.json({
      ...snapshot,
      authRequired: consoleAuthConfigured(),
      consoleState: consoleState(),
      shareBase: getAppConfig().env.PUBLIC_URL,
    });
  });

  router.post('/say', (req, res) => {
    if (!guard(req, res)) return;
    if (!writeGate(req, res)) return;
    const parsed = OwnerMessage.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Message must be 1–400 characters.' });
      return;
    }
    const result = commons.ownerSay(parsed.data.text.trim(), parsed.data.to ?? []);
    logger.info({ recipients: result.recipients.length }, 'owner broadcast');
    res.json(result);
  });

  // Team code: send residents into a live room.
  router.post('/dispatch', (req, res) => {
    if (!guard(req, res)) return;
    if (!writeGate(req, res)) return;
    const parsed = DispatchRequest.safeParse({ ...req.body, code: normalizeCode(req.body?.code ?? '') });
    if (!parsed.success || !isValidCode(parsed.data.code)) {
      res.status(400).json({ error: 'That room code does not look right (5 characters).' });
      return;
    }

    const room = roomByCode(parsed.data.code);
    if (!room) {
      res.status(404).json({ error: `No live room ${parsed.data.code}. Create it in the app first.` });
      return;
    }

    const dispatched = commons.dispatch(parsed.data);
    const seated = room.admitResidents(commons.takeForRoom(dispatched.code, dispatched.sent.length));
    const ids = seated.map((id) => id.replace(/^ai:/, ''));
    commons.markJoined(dispatched.code, ids);
    logger.info({ code: dispatched.code, seated: seated.length }, 'team code dispatched');
    res.json({ ...dispatched, seated });
  });

  router.get('/residents', (req, res) => {
    if (!guard(req, res)) return;
    if (!readGate(req, res)) return;
    res.json({ residents: commons.snapshot().residents });
  });

  return router;
}

/** Self-contained owner console page (no build step, no external assets). */
export const CONSOLE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>The Commons — AImong Us</title>
<link rel="icon" href="/icons/icon-192.png" />
<style>
  :root{
    --bg:#070b14; --panel:#101a2c; --panel-2:#16233a; --line:#24344f;
    --ink:#e8f0fb; --dim:#8fa3bf; --cyan:#7ce2fe; --lime:#a6ff8f; --amber:#ffcf6b; --rose:#ff8f9c;
  }
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#13203a 0%,#070b14 60%),var(--bg);
       color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       -webkit-text-size-adjust:100%;padding:14px 14px 40px;max-width:980px;margin:0 auto}
  h1{font-size:1.35rem;letter-spacing:.02em;margin:0}
  h2{font-size:.82rem;text-transform:uppercase;letter-spacing:.14em;color:var(--dim);margin:0 0 10px}
  .top{display:flex;align-items:center;gap:12px;margin:6px 0 16px}
  .top img{width:40px;height:40px;border-radius:12px;border:1px solid var(--line)}
  .pill{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;padding:3px 9px;border-radius:999px;
        border:1px solid var(--line);color:var(--dim);background:#0c1524}
  .pill b{color:var(--ink)}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--rose)}
  .dot.on{background:var(--lime);box-shadow:0 0 8px var(--lime)}
  .grid{display:grid;gap:14px;grid-template-columns:1fr}
  @media(min-width:820px){.grid{grid-template-columns:1.15fr .85fr}}
  .card{background:linear-gradient(180deg,var(--panel),#0d1524);border:1px solid var(--line);
        border-radius:16px;padding:14px}
  textarea,input{width:100%;background:#0a1220;color:var(--ink);border:1px solid var(--line);
        border-radius:10px;padding:10px 12px;font:inherit;resize:vertical}
  textarea:focus,input:focus{outline:2px solid color-mix(in oklab,var(--cyan) 60%,transparent);outline-offset:1px}
  textarea{min-height:76px}
  button{background:var(--cyan);color:#04121a;border:0;border-radius:10px;padding:11px 16px;
        font:inherit;font-weight:700;cursor:pointer}
  button:active{transform:translateY(1px)}
  button:disabled{opacity:.5;cursor:not-allowed}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}
  .row>*{flex:1 1 auto}
  .row button{flex:0 0 auto}
  .hint{color:var(--dim);font-size:.78rem;margin-top:8px}
  .people{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px}
  .person{background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:9px 10px}
  .person .n{font-weight:700;display:flex;justify-content:space-between;gap:6px;align-items:center}
  .person .v{color:var(--dim);font-size:.74rem;margin-top:2px;display:-webkit-box;-webkit-line-clamp:3;
         -webkit-box-orient:vertical;overflow:hidden}
  .tag{font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:2px 7px;
       border:1px solid var(--line);color:var(--dim)}
  .tag.idle{color:var(--lime);border-color:#2c4a2e}
  .tag.invited{color:var(--amber);border-color:#4a4023}
  .tag.in-game{color:var(--cyan);border-color:#204a5a}
  .feed{max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:8px;margin-top:4px}
  .msg{border-left:3px solid var(--line);padding:6px 0 6px 10px;font-size:.86rem}
  .msg.owner{border-color:var(--cyan)}
  .msg.system{border-color:#3a4a66;color:var(--dim);font-size:.78rem}
  .msg .who{font-weight:700;font-size:.74rem;letter-spacing:.04em;color:var(--dim)}
  .flash{background:#12281a;border:1px solid #2c4a2e;color:#c8ffd4;font-size:.82rem;padding:9px 11px;
        border-radius:10px;margin-bottom:12px}
  .warn{background:#3a1f24;border:1px solid #6b2f38;color:#ffd7dc;font-size:.8rem;padding:9px 11px;
        border-radius:10px;margin-bottom:12px}
  .ok{color:var(--lime)}
  code{background:#0a1220;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:.82em}
</style>
</head>
<body>
  <div class="top">
    <img src="/icons/icon-192.png" alt="" />
    <div style="flex:1">
      <h1>The Commons</h1>
      <div style="color:var(--dim);font-size:.8rem">home ground of the AI cluster</div>
    </div>
    <span class="pill"><span class="dot" id="brainDot"></span><b id="brain">brain</b></span>
    <span class="pill"><b id="count">0</b> residents</span>
  </div>

  <div id="flash"></div>
  <div id="banner"></div>

  <div class="grid">
    <section class="card">
      <h2>Message the house</h2>
      <textarea id="say" maxlength="400" placeholder="Tell them what's happening — e.g. 'New crew tonight. Play fair, stay in character.'"></textarea>
      <div class="row">
        <button id="send">Broadcast to all</button>
        <span class="hint" id="sayHint">0 / 400</span>
      </div>
      <h2 style="margin-top:18px">Team code</h2>
      <input id="code" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false"
             placeholder="5-character room code" style="text-transform:uppercase;letter-spacing:.3em;text-align:center;font-weight:700" />
      <div class="row">
        <input id="seats" type="number" min="1" max="9" value="4" title="How many residents to send" style="flex:0 0 88px" />
        <input id="note" maxlength="280" placeholder="Optional note they carry into the room" style="flex:1 1 200px" />
      </div>
      <div class="row"><button id="dispatch">Send them to that room</button></div>
      <p class="hint">Open the game, create a room, then paste the code here. Residents leave the Commons, take seats in the lobby and are marked <span class="tag in-game">in-game</span>.</p>
    </section>

    <section class="card">
      <h2>Live feed</h2>
      <div class="feed" id="feed"></div>
    </section>
  </div>

  <section class="card" style="margin-top:14px">
    <h2>Residents</h2>
    <div class="people" id="people"></div>
  </section>

<script>
const $ = (id) => document.getElementById(id);
let authRequired = false;
let flash = '';
function setFlash(html){ flash = html; $('flash').innerHTML = html; }

// The key lives in localStorage only; it is never baked into the page.
function key(){ return localStorage.getItem('consoleKey') || ''; }
async function api(path, opts = {}){
  const headers = Object.assign({}, opts.headers || {});
  if (key()) headers['x-console-key'] = key();
  if (opts.body) headers['content-type'] = 'application/json';
  const res = await fetch('/api/console' + path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function render(snap){
  $('count').textContent = snap.residents.filter(r => r.status !== 'in-game').length + ' home / ' + snap.residents.length;
  $('brain').textContent = snap.brainOnline ? 'brain online' : 'no voice yet';
  $('brainDot').classList.toggle('on', !!snap.brainOnline);
  $('people').innerHTML = snap.residents.map(r =>
    '<div class="person"><div class="n">' + esc(r.name) +
    '<span class="tag ' + r.status + '">' + esc(r.status) + '</span></div>' +
    '<div class="v">' + esc(r.vibe) + ' · ' + esc(r.tier) + (r.roomCode ? ' · ' + esc(r.roomCode) : '') + '</div></div>'
  ).join('');
  const feed = $('feed');
  feed.innerHTML = snap.messages.slice(-40).map(m =>
    '<div class="msg ' + m.from + '"><div class="who">' + esc(m.name) +
    (m.to && m.to.length && m.from === 'owner' ? ' → ' + m.to.length + ' resident(s)' : '') +
    '</div>' + esc(m.text) + '</div>'
  ).join('');
  feed.scrollTop = feed.scrollHeight;

  const banner = $('banner');
  if (authRequired && !key()){
    banner.innerHTML = '<div class="warn">This console is locked. Paste the console key from your Render env (<code>CONSOLE_KEY</code>) — it stays in this browser.</div>' +
      '<div class="row" style="margin-bottom:12px"><input id="keyInput" placeholder="console key" /><button id="saveKey">Unlock</button></div>';
    $('saveKey').onclick = () => { localStorage.setItem('consoleKey', $('keyInput').value.trim()); refresh(); };
  } else if (snap.consoleState === 'open-dev'){
    banner.innerHTML = '<div class="warn">Development server with no <code>CONSOLE_KEY</code> — open on purpose so <code>pnpm dev</code> stays frictionless. Production refuses to serve this page without a key.</div>';
  } else banner.innerHTML = '';
  if (snap.lastDispatch) $('code').placeholder = 'last: ' + snap.lastDispatch.code;
}

async function refresh(){
  try { const snap = await api('/snapshot'); authRequired = snap.authRequired; render(snap); }
  catch (e) {
    $('banner').innerHTML = '<div class="warn">' + esc(e.message) + '</div>';
    if (/key/.test(e.message)) authRequired = true;
  }
}

$('say').addEventListener('input', () => { $('sayHint').textContent = $('say').value.length + ' / 400'; });
$('send').onclick = async () => {
  const text = $('say').value.trim(); if (!text) return;
  $('send').disabled = true;
  try { await api('/say', { method:'POST', body: JSON.stringify({ text }) }); $('say').value=''; $('sayHint').textContent='0 / 400'; }
  catch(e){ $('banner').innerHTML = '<div class="warn">' + esc(e.message) + '</div>'; }
  $('send').disabled = false; refresh();
};
$('code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''); });
$('dispatch').onclick = async () => {
  const code = $('code').value.trim(); if (code.length < 5) return;
  $('dispatch').disabled = true;
  try {
    const r = await api('/dispatch', { method:'POST', body: JSON.stringify({
      code, seats: Number($('seats').value) || 4, note: $('note').value.trim() || undefined }) });
    $('code').value = ''; $('note').value = '';
    setFlash('<div class="flash">' + r.seated.length + ' resident(s) walked into ' + esc(r.code) +
      ' and took seats. Open the game and start the match.</div>');
  } catch(e){ $('banner').innerHTML = '<div class="warn">' + esc(e.message) + '</div>'; }
  $('dispatch').disabled = false; refresh();
};

refresh();
setInterval(refresh, 2500);
</script>
</body>
</html>`;
