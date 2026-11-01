/**
 * End-to-end lobby smoke test against a running server (M1 acceptance).
 *
 *   pnpm --filter @aimong/server dev      # in one shell
 *   node --import tsx apps/server/scripts/smoke.ts
 *
 * Exercises: create room -> 5-letter code -> resolve code over HTTP -> second
 * client joins by roomId -> state converges, chat + settings + start notice.
 */
import { Client } from '@colyseus/sdk';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:2567';
const WS = BASE.replace(/^http/, 'ws');

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function players(
  room: { state: any },
): Array<{ name: string; isHost: boolean; color: string; isAi: boolean }> {
  const map = room.state.players;
  const out: Array<{ name: string; isHost: boolean; color: string; isAi: boolean }> = [];
  map.forEach((p: any) =>
    out.push({ name: p.name, isHost: p.isHost, color: p.color, isAi: p.isAi }),
  );
  return out;
}

async function main(): Promise<void> {
  const checks: string[] = [];
  const health = await fetch(`${BASE}/healthz`).then((r) => r.json());
  if (!health.ok) throw new Error('healthz not ok');
  checks.push(`healthz ok (rooms=${health.rooms})`);

  const owner = new Client(WS);
  const room1 = await owner.create('game', { name: 'Owner' });
  await wait(150);
  const code = room1.state.code as string;
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) throw new Error(`bad code: ${code}`);
  checks.push(`created room with code ${code}`);

  const notices1: string[] = [];
  room1.onMessage('notice', (n: { text: string }) => notices1.push(n.text));

  const lookup = await fetch(`${BASE}/api/rooms/${code}`).then((r) => r.json());
  if (!lookup.roomId) throw new Error('code lookup failed');
  checks.push(`code ${code} -> roomId ${lookup.roomId.slice(0, 8)}…`);

  const friend = new Client(WS);
  const room2 = await friend.joinById(lookup.roomId, { name: 'Owner' }); // duplicate name on purpose
  await waitFor(() => players(room1).length === 2, 'second player visible in room1');
  const names = players(room1).map((p) => p.name);
  if (!names.includes('Owner2')) throw new Error(`duplicate name was not suffixed: ${names.join(',')}`);
  checks.push(`second phone joined; names=${names.join(' + ')}`);

  const host = players(room1).find((p) => p.isHost);
  if (host?.name !== 'Owner') throw new Error('first player is not host');
  checks.push('host is the creator');

  room2.send('chat', { text: 'hi from the other phone' });
  await waitFor(
    () => [...room1.state.chat].some((c: any) => c.text === 'hi from the other phone' && !c.system),
    'chat message synced',
  );
  checks.push('chat synced between clients');

  room1.send('settings', { patch: { aiSeats: 4, discussionSec: 45 } });
  await waitFor(() => room1.state.settings.discussionSec === 45, 'settings applied');
  checks.push(`host settings applied (aiSeats=${room1.state.settings.aiSeats}, discussion=${room1.state.settings.discussionSec}s)`);

  room2.send('settings', { patch: { discussionSec: 999 } }); // non-host: rejected + clamped
  await wait(300);
  if (room1.state.settings.discussionSec !== 45) throw new Error('non-host changed settings');
  checks.push('non-host settings change rejected');

  room1.send('start', {});
  await waitFor(() => notices1.some((t) => t.includes('M2')), 'start notice');
  checks.push('start explains M1 has no simulation yet (no fake start)');

  const finalLookup = await fetch(`${BASE}/api/rooms/${code}`).then((r) => r.json());
  if (finalLookup.players !== 2) throw new Error('registry player count stale');
  checks.push('registry/health player count in sync');

  await room2.leave();
  await room1.leave();
  await wait(400);
  const gone = await fetch(`${BASE}/api/rooms/${code}`).then((r) => r.status);
  if (gone !== 404) throw new Error(`room should be gone, got ${gone}`);
  checks.push('room disposed when empty, code freed');

  // ---------------------------------------------------- AI cluster (Commons)
  const snap = await fetch(`${BASE}/api/console/snapshot`).then((r) => r.json());
  if (!Array.isArray(snap.residents) || snap.residents.length < 6)
    throw new Error('commons returned no residents');
  if (snap.brainOnline !== false) throw new Error('brain should report offline without keys');
  checks.push(`commons home with ${snap.residents.length} residents (no fake brain)`);

  const said = await fetch(`${BASE}/api/console/say`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'smoke: everyone behaves tonight' }),
  }).then((r) => r.json());
  if (!said.message || said.recipients.length < 6) throw new Error('broadcast did not reach the house');
  const afterSay = await fetch(`${BASE}/api/console/snapshot`).then((r) => r.json());
  if (!afterSay.messages.some((m: any) => m.from === 'owner' && m.text.includes('smoke:')))
    throw new Error('owner message missing from the feed');
  checks.push('owner broadcast reaches all residents and lands in the feed');

  // Team code: residents walk into a real room and take seats.
  const host3 = new Client(WS);
  const room3 = await host3.create('game', { name: 'ClusterHost' });
  await waitFor(() => typeof room3.state?.code === 'string' && room3.state.code.length === 5, 'room code synced');
  const teamCode: string = room3.state.code;
  const dead = await fetch(`${BASE}/api/console/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'ZZZZZ', seats: 2 }),
  }).then((r) => r.status);
  if (dead !== 404) throw new Error(`dispatch to a missing room should 404, got ${dead}`);
  checks.push('team code rejected when no such room exists');

  const dispatch = await fetch(`${BASE}/api/console/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: teamCode.toLowerCase(), seats: 3, note: 'be nice to the humans' }),
  }).then((r) => r.json());
  if (dispatch.seated.length !== 3) throw new Error(`expected 3 ai seats, got ${dispatch.seated?.length}`);
  await waitFor(() => room3.state.players.size === 4, 'residents seated');
  const aiSeated = players(room3).filter((p) => p.isAi).length;
  if (aiSeated !== 3) throw new Error(`lobby shows ${aiSeated} AI seats`);
  checks.push(`team code ${teamCode}: 3 residents seated as AI players in the lobby`);

  const roomsSnap = await fetch(`${BASE}/api/console/snapshot`).then((r) => r.json());
  if (!roomsSnap.residents.some((r: any) => r.status === 'in-game'))
    throw new Error('residents not marked in-game');
  checks.push('commons marks those residents in-game while they play');

  await room3.leave();
  await host3.close?.();
  await wait(500);
  const home = await fetch(`${BASE}/api/console/snapshot`).then((r) => r.json());
  if (home.residents.some((r: any) => r.status === 'in-game'))
    throw new Error('residents did not come home after the room closed');
  checks.push('residents return home when the room closes');

  for (const c of checks) console.log(`  ✓ ${c}`);
  console.log(`\nSMOKE PASS (${checks.length} checks)`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nSMOKE FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
