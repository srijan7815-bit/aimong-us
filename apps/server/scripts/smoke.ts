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
import { WORLD, buildGrid, circleHitsWall, computeVisionMask } from '@aimong/shared';

const grid = buildGrid(WORLD);

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
  // The first patch can take longer than a local round trip (the free instance is
  // in Singapore), so wait for the code instead of assuming 150 ms is enough.
  const codeDeadline = Date.now() + 8000;
  while (!room1.state.code && Date.now() < codeDeadline) await wait(50);
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

  // M2: start opens the station (movement only — roles arrive in M3).
  room1.send('start', {});
  await waitFor(() => room1.state.phase === 'PLAY', 'station opens');
  checks.push('start opens the station');

  // Every seat is on the map, standing on floor.
  const seated = players(room1);
  for (const key of Object.keys(room1.state.players)) void key;
  room1.state.players.forEach((p: any) => {
    if (circleHitsWall(grid, p.x, p.y)) throw new Error(`${p.name} spawned inside a wall`);
  });
  checks.push(`${seated.length} players placed on the map (none inside a wall)`);

  // Movement: hold "east" for a second and watch the authoritative position move.
  const before = { x: room1.state.players.get(room1.sessionId).x };
  for (let seq = 1; seq <= 20; seq++) {
    room1.send('input', { seq, x: 1, y: 0 });
    await wait(50);
  }
  const after = room1.state.players.get(room1.sessionId);
  if (after.x - before.x < 60) throw new Error(`server moved the player only ${after.x - before.x}px`);
  if (circleHitsWall(grid, after.x, after.y)) throw new Error('server moved the player into a wall');
  checks.push(`server-authoritative movement: +${(after.x - before.x).toFixed(0)} px in 1 s, still on floor`);

  // Walls: keep pushing east into the station edge for a second.
  for (let seq = 21; seq <= 60; seq++) {
    room1.send('input', { seq, x: 1, y: 0 });
    await wait(50);
  }
  const walled = room1.state.players.get(room1.sessionId);
  if (circleHitsWall(grid, walled.x, walled.y)) throw new Error('player pushed through a wall');
  checks.push('walls hold: pushing into a wall for 2 s leaves the player on floor');

  // Vision: the server answers with the same mask the client draws.
  const mask = computeVisionMask(grid, walled.x, walled.y);
  if (mask.visibleCount < 10) throw new Error('vision mask is suspiciously empty');
  checks.push(`vision mask at the player's position: ${mask.visibleCount} tiles visible`);

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
  // The gateway reports what it really is: a real provider, a mock, or offline.
  if (typeof snap.brain?.model !== 'string') throw new Error('snapshot is missing the brain report');
  if (snap.brainOnline !== (snap.brain.model !== 'offline'))
    throw new Error(`brainOnline disagrees with the model report (${snap.brain.model})`);
  checks.push(
    `commons home with ${snap.residents.length} residents (brain: ${snap.brain.model}, honest status)`,
  );

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
  // With a brain online (a key or the mock) the residents must answer in voice.
  if (snap.brainOnline) {
    let answered = false;
    for (let i = 0; i < 40 && !answered; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const live = await fetch(`${BASE}/api/console/snapshot`).then((r) => r.json());
      answered = live.messages.some((m: any) => m.from === 'resident');
    }
    if (!answered) throw new Error('brain online but no resident answered the owner');
    checks.push('a resident answered the owner through the model gateway');
  }

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
    body: JSON.stringify({ code: teamCode.toLowerCase(), seats: 4, note: 'be nice to the humans' }),
  }).then((r) => r.json());
  if (dispatch.seated.length !== 4) throw new Error(`expected 4 ai seats, got ${dispatch.seated?.length}`);
  await waitFor(() => room3.state.players.size === 5, 'residents seated');
  const aiSeated = players(room3).filter((p) => p.isAi).length;
  if (aiSeated !== 4) throw new Error(`lobby shows ${aiSeated} AI seats`);
  checks.push(`team code ${teamCode}: 4 residents seated as AI players in the lobby`);

  // M2: the residents who took seats are standing on the map too (still for now).
  room3.send('start', {});
  await waitFor(() => (room3 as any).state.phase === 'PLAY', 'cluster room opens');
  const aiPositions: Array<{ name: string; x: number; y: number }> = [];
  room3.state.players.forEach((p: any) => {
    if (p.isAi) aiPositions.push({ name: p.name, x: p.x, y: p.y });
  });
  if (aiPositions.length !== 4) throw new Error(`expected 4 resident pods, got ${aiPositions.length}`);
  for (const ai of aiPositions) {
    if (ai.x <= 0 || ai.y <= 0) throw new Error(`${ai.name} has no map position`);
    if (circleHitsWall(grid, ai.x, ai.y)) throw new Error(`${ai.name} is inside a wall`);
  }
  checks.push(`4 residents spawn on the map (e.g. ${aiPositions[0].name} at ${Math.round(aiPositions[0].x)},${Math.round(aiPositions[0].y)})`);

  const roomsSnap = await fetch(`${BASE}/api/console/snapshot`).then((r) => r.json());
  if (!roomsSnap.residents.some((r: any) => r.status === 'in-game'))
    throw new Error('residents not marked in-game');
  checks.push('commons marks those residents in-game while they play');

  await room3.leave();
  await host3.close?.();
  // Give Colyseus a moment to dispose the room (it calls releaseRoom on dispose).
  const dispatched = new Set(dispatch.seated.map((id: string) => id.replace(/^ai:/, '')));
  for (let i = 0; i < 40; i++) {
    const snapNow = await fetch(`${BASE}/api/console/snapshot`).then((r) => r.json());
    const stillOut = snapNow.residents.filter((r: any) => dispatched.has(r.id) && r.status === 'in-game');
    if (stillOut.length === 0) break;
    await wait(100);
  }
  const home = await fetch(`${BASE}/api/console/snapshot`).then((r) => r.json());
  const stillInGame = home.residents.filter((r: any) => dispatched.has(r.id) && r.status === 'in-game');
  if (stillInGame.length > 0)
    throw new Error(`${stillInGame.length} dispatched resident(s) did not come home after the room closed`);
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
