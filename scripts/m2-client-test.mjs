/**
 * M2 client acceptance test: three clients (two desktop, one phone on emulated
 * mobile data) walk the station, hit walls, and their fog is compared with the
 * server's own visibility calculation.
 *
 *   pnpm -r build && node apps/server/dist/index.js      # in one shell
 *   npm i playwright && npx playwright install chromium  # once
 *   node scripts/m2-client-test.mjs                      # BASE_URL=http://localhost:2567
 *
 * Screenshots land in docs/shots/. Exits non-zero on the first failed check.
 */
import { chromium, devices } from 'playwright';
import { WORLD, buildGrid, circleHitsWall, computeVisionMask } from '../packages/shared/dist/index.js';

const BASE = process.env.BASE_URL || 'http://localhost:2567';
const grid = buildGrid(WORLD);
const hashOf = (mask) => {
  let h = 0;
  for (let row = mask.fromRow; row < mask.toRow; row++)
    for (let col = mask.fromCol; col < mask.toCol; col++) {
      if (mask.tiles[(row - mask.fromRow) * mask.width + (col - mask.fromCol)] !== 1) continue;
      h = (h * 31 + row * 131 + col) % 1_000_000_007;
    }
  return String(h);
};
const ok = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One browser per device: separate instances keep every page foreground, so
 *  requestAnimationFrame is not throttled (background tabs would fake a stall). */
async function launchBrowser() {
  // Headless Chromium throttles requestAnimationFrame in windows it thinks are
  // backgrounded; that would fake a "not moving" result rather than test the game.
  return chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });
}

async function openGame(ctx, name, label) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  ! ${label} pageerror: ${e.message}`));
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input.input[placeholder="Your name"]', { timeout: 90000 });
  await page.fill('input.input[placeholder="Your name"]', name);
  await page.screenshot({ path: `/tmp/pw/${label}-home.png` });
  return page;
}

// --- three clients: two desktops, one phone on emulated mobile data ----------
const bA = await launchBrowser();
const bB = await launchBrowser();
const bC = await launchBrowser();
const deskA = await bA.newContext({ viewport: { width: 1180, height: 720 } });
const deskB = await bB.newContext({ viewport: { width: 1180, height: 720 } });
const phone = await bC.newContext({ ...devices['Pixel 7 landscape'] });
const pageA = await openGame(deskA, 'Ava');
const pageB = await openGame(deskB, 'Bilal');
const pageC = await openGame(phone, 'Chen');

// throttled mobile data for the phone
const cdp = await phone.newCDPSession(pageC);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 120, downloadThroughput: (1.2 * 1024 * 1024) / 8, uploadThroughput: (600 * 1024) / 8,
});
ok.push('phone client limited to ~1.2/0.6 Mbps with 120 ms latency (emulated mobile data)');

await pageA.getByRole('button', { name: 'Create room' }).click();
await pageA.waitForSelector('.code-display', { timeout: 60000 });
const code = (await pageA.textContent('.code-display')).trim().replace(/\s/g, '');
for (const page of [pageB, pageC]) {
  await page.locator('.code-box').first().click();
  await page.keyboard.type(code, { delay: 40 });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Join with code/i }).click();
  await page.waitForSelector('.code-display', { timeout: 60000 });
}
ok.push(`3 clients in room ${code}`);

// --- host starts the station ------------------------------------------------
const startBtn = pageA.getByRole('button', { name: /Start|Launch/i }).first();
if (await startBtn.count()) await startBtn.click();
else await pageA.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((n) => /start|launch/i.test(n.textContent || ''));
  b?.click();
});
for (const p of [pageA, pageB, pageC]) await p.waitForSelector('.play-canvas canvas', { timeout: 60000 });
ok.push('all three reached the station (Phaser canvas mounted)');

await wait(1500);

// --- drive input ------------------------------------------------------------
const samples = { A: [], B: [], C: [] };
async function sample(page, key) {
  // Timestamp inside the page: the node-side clock compresses when two
  // evaluates resolve together, which would fake an impossible speed.
  const s = await page.evaluate(() => {
    const pods = window.__station?.pods?.() ?? [];
    const me = pods.find((p) => p.self);
    return me ? { t: performance.now(), x: me.x, y: me.y } : null;
  });
  if (s) samples[key].push(s);
}
const sampler = setInterval(async () => {
  await Promise.all([sample(pageA, 'A'), sample(pageB, 'B'), sample(pageC, 'C')]);
}, 100);

// A and B use the keyboard; C uses the on-screen joystick (touch controls).
await pageA.keyboard.down('d');
await pageB.keyboard.down('s');
const box = await pageC.locator('.joy-zone').boundingBox();
await pageC.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
await pageC.mouse.down();
await pageC.mouse.move(box.x + box.width * 0.5 + 50, box.y + box.height * 0.6 - 25, { steps: 4 });
await wait(5000);
await pageA.keyboard.up('d');
await pageB.keyboard.up('s');
await pageC.mouse.up();
await wait(600);
clearInterval(sampler);

// Smoothness is judged by SPEED, not by distance-per-sample: the sampler's own
// interval varies (each sample is a round trip), so distance alone would lie.
const SPEED = 132;
for (const [page, key] of [[pageA, 'A'], [pageB, 'B'], [pageC, 'C']]) {
  const probe = await page.evaluate(() => ({
    fps: window.__station?.fps?.() ?? -1,
    pred: window.__station?.predicted?.(),
    pod: (window.__station?.pods?.() ?? []).find((p) => p.self),
  }));
  console.log(`  · ${key} fps=${probe.fps} predicted=${probe.pred?.x?.toFixed(0)},${probe.pred?.y?.toFixed(0)} rendered=${probe.pod?.x},${probe.pod?.y}`);
}

const travel = (list) => {
  let gross = 0, maxSpeed = 0, worstOvershoot = 0;
  for (let i = 1; i < list.length; i++) {
    const dt = (list[i].t - list[i - 1].t) / 1000;
    if (dt <= 0) continue;
    const d = Math.hypot(list[i].x - list[i - 1].x, list[i].y - list[i - 1].y);
    gross += d;
    const speed = d / dt;
    maxSpeed = Math.max(maxSpeed, speed);
    worstOvershoot = Math.max(worstOvershoot, speed - SPEED);
  }
  const net = list.length > 1 ? Math.hypot(list.at(-1).x - list[0].x, list.at(-1).y - list[0].y) : 0;
  return { gross, net, maxSpeed, worstOvershoot, samples: list.length };
};
if (process.env.DEBUG_SAMPLES) {
  for (const key of ['A', 'B', 'C']) {
    console.log(`  · ${key} samples: ${samples[key].map((s) => `${s.t.toFixed(0)}:${s.x.toFixed(0)},${s.y.toFixed(0)}`).join(' ')}`);
  }
}
for (const key of ['A', 'B', 'C']) {
  const t = travel(samples[key]);
  // A correction decays over ~45 ms, so a brief 1.5-2x speed blip is expected and
  // invisible; a real rubber-band is 5-10x. 2x is the "would I notice this" line.
  const ceiling = SPEED * 2;
  if (t.gross < 200) throw new Error(`${key} barely moved (${t.gross.toFixed(0)} px)`);
  if (t.maxSpeed > ceiling)
    throw new Error(`${key} hit ${t.maxSpeed.toFixed(0)} px/s (ceiling ${ceiling.toFixed(0)}) — that is rubber-banding`);
  ok.push(`${key}: ${t.gross.toFixed(0)} px walked, peak ${t.maxSpeed.toFixed(0)} px/s (walk speed ${SPEED}), ${t.samples} samples`);
}

// --- walls actually block ---------------------------------------------------
await pageA.keyboard.down('a');
await wait(2500);
await pageA.keyboard.up('a');
await wait(400);
const wallRun = await pageA.evaluate(() => window.__station.predicted());
if (circleHitsWall(grid, wallRun.x, wallRun.y)) throw new Error('client ended up inside a wall');
ok.push(`walked into a wall for 2.5 s, ended at ${wallRun.x.toFixed(0)},${wallRun.y.toFixed(0)} — still on the floor`);

// --- fog matches the shared (server) calculation ----------------------------
for (const [page, key] of [[pageA, 'A'], [pageB, 'B'], [pageC, 'C']]) {
  const clientMask = await page.evaluate(() => window.__station.mask());
  if (!clientMask) throw new Error(`${key} painted no fog`);
  const expected = hashOf(computeVisionMask(grid, clientMask.x, clientMask.y));
  if (expected !== clientMask.hash)
    throw new Error(`${key} fog hash ${clientMask.hash} != server ${expected} at ${clientMask.x},${clientMask.y}`);
  ok.push(`${key}: fog mask matches the server calculation (${clientMask.visible} tiles)`);
}

// --- authoritative positions agree with what players see --------------------
const roomInfo = await fetch(`${BASE}/api/rooms/${code}`).then((r) => r.json());
ok.push(`server reports ${roomInfo.players} players in ${roomInfo.code}`);
for (const [page, key] of [[pageA, 'A'], [pageB, 'B'], [pageC, 'C']]) {
  const fps = await page.evaluate(() => window.__station?.fps?.() ?? -1);
  const pred = await page.evaluate(() => window.__station?.predicted?.());
  ok.push(`${key}: render loop ${fps} fps, prediction at ${pred.x.toFixed(0)},${pred.y.toFixed(0)}`);
}
await pageA.screenshot({ path: '/home/user/aimong-us/docs/shots/13-station-client-a.png' });
await pageC.screenshot({ path: '/home/user/aimong-us/docs/shots/14-station-phone.png' });

for (const line of ok) console.log('  ✓ ' + line);
console.log(`\nM2 CLIENT TEST PASS (${ok.length} checks)`);
await Promise.all([bA.close(), bB.close(), bC.close()]);
