/**
 * M3 acceptance: a whole game, start to finish, driven over the real wire.
 *
 *   node apps/server/dist/index.js &          # server on :2567
 *   cd apps/server && npx tsx scripts/playthrough.ts
 *
 * Seven SDK clients join one room and play a complete round: roles are dealt, a
 * crew member does a real task at a real spot, the impostor kills, the body is
 * reported, a meeting runs (discussion then voting), someone is ejected, and the
 * match ends with a winner. Every assertion is a rule the server enforced.
 *
 * The clients are scripted here on purpose: M3 is "human-only rules", and the
 * scripted bodies (M4) come later. Nothing in this script bypasses the server.
 */
import { Client } from '@colyseus/sdk';
import {
  SABOTAGE_SPECS,
  WORLD,
  computeVisionMask,
  buildGrid,
  findPath,
  nextWaypoint,
  type SecretRole,
} from '@aimong/shared';

const BASE = process.env.PLAY_URL ?? 'http://localhost:2567';
const WS = BASE.replace(/^http/, 'ws');
const SEATS = Number(process.env.SEATS ?? 7);

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const grid = buildGrid(WORLD);

interface Seat {
  name: string;
  client: Client;
  room: any;
  secret: SecretRole | null;
  notices: string[];
  verdicts: Array<{ text: string; ejected: string | null }>;
}

const checks: string[] = [];
function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/**
 * Walk a player to a world position by sending real input vectors along an A*
 * path — the same route-following the M4 bodies will use.
 */
async function walkTo(seat: Seat, x: number, y: number, opts: { stopWithin?: number; timeoutMs?: number } = {}): Promise<void> {
  const stopWithin = opts.stopWithin ?? 14;
  const timeoutMs = opts.timeoutMs ?? 40000;
  const started = Date.now();
  let seq = 0;
  let path = findPath(grid, seat.room.state.players.get(seat.room.sessionId)?.x ?? 0, seat.room.state.players.get(seat.room.sessionId)?.y ?? 0, x, y);
  if (!path) throw new Error(`no path for ${seat.name} to ${x.toFixed(0)},${y.toFixed(0)}`);
  let best = Infinity;
  let improvedAt = Date.now();
  let repathedAt = 0;
  let sidestep = 0;
  let slideSign = 1;
  while (Date.now() - started < timeoutMs) {
    const player = seat.room.state.players.get(seat.room.sessionId);
    if (!player) break;
    const distance = Math.hypot(player.x - x, player.y - y);
    if (distance < stopWithin) {
      seq += 1;
      seat.room.send('input', { seq, x: 0, y: 0 });
      await wait(60);
      return;
    }
    if (distance < best - 2) {
      best = distance;
      improvedAt = Date.now();
    }
    // Re-plan every 400 ms: bodies and other pods move, and a stale path is how
    // a walk wedges itself against a wall or another player.
    const now = Date.now();
    if (now - repathedAt > 400) {
      repathedAt = now;
      path = findPath(grid, player.x, player.y, x, y) ?? path;
    }
    const waypoint = path ? nextWaypoint(path, player.x, player.y) : null;
    if (!waypoint) {
      seq += 1;
      seat.room.send('input', { seq, x: 0, y: 0 });
      await wait(80);
      return;
    }
    let vx = waypoint.x - player.x;
    let vy = waypoint.y - player.y;
    if (now - improvedAt > 1200) {
      // Wedged: slide sideways for a few ticks, then carry on. Over a slow
      // link (this runs against Render too) a stall is usually a corner, so
      // alternate the slide direction instead of repeating the same wall.
      sidestep = 8;
      slideSign = -slideSign;
      improvedAt = now;
    }
    if (sidestep > 0) {
      sidestep -= 1;
      [vx, vy] = [-vy * slideSign, vx * slideSign];
      if (Math.hypot(vx, vy) < 0.001) {
        vx = 1;
        vy = 0;
      }
    }
    const length = Math.hypot(vx, vy) || 1;
    seq += 1;
    seat.room.send('input', { seq, x: vx / length, y: vy / length });
    await wait(40);
  }
  throw new Error(`${seat.name} could not walk to ${x.toFixed(0)},${y.toFixed(0)}`);
}

function spotCentre(spotId: string): { x: number; y: number } {
  const spot = WORLD.taskSpots.find((s) => s.id === spotId);
  if (!spot) throw new Error(`no task spot ${spotId}`);
  return { x: spot.tile.x * 32 + 16, y: spot.tile.y * 32 + 16 };
}

async function main(): Promise<void> {
  // --- seats ---
  const seats: Seat[] = [];
  const host = new Client(WS);
  const room = await host.create('game', { name: 'P1' });
  const seat = (name: string, client: Client, r: any): Seat => {
    const s: Seat = { name, client, room: r, secret: null, notices: [], verdicts: [] };
    r.onMessage('you', (secret: SecretRole) => (s.secret = secret));
    r.onMessage('notice', (n: { text: string }) => s.notices.push(n.text));
    r.onMessage('verdict', (v: { text: string; ejected: string | null }) => s.verdicts.push(v));
    return s;
  };
  seats.push(seat('P1', host, room));
  for (let i = 2; i <= SEATS; i++) {
    const client = new Client(WS);
    const r = await client.joinById(room.roomId, { name: `P${i}` });
    seats.push(seat(`P${i}`, client, r));
  }
  check(`${seats.length} clients joined room ${room.state.code}`);

  // One impostor keeps the end condition deterministic; short timers keep the
  // test honest but quick (both are ordinary host settings, not test hooks).
  room.send('settings', { patch: { impostors: 1, discussionSec: 15, votingSec: 10 } });
  await waitFor(
    () => room.state.settings.impostors === 1 && room.state.settings.votingSec === 10,
    'settings applied',
  );

  // --- start: roles are dealt privately ---
  room.send('start', {});
  await waitFor(() => room.state.phase === 'PLAY', 'round starts');
  await waitFor(() => seats.every((s) => s.secret !== null), 'every seat got a private role');
  const impostors = seats.filter((s) => s.secret?.role === 'impostor');
  const crew = seats.filter((s) => s.secret?.role === 'crew');
  if (impostors.length !== room.state.settings.impostors)
    throw new Error(`expected ${room.state.settings.impostors} impostors, got ${impostors.length}`);
  if (crew.length + impostors.length !== SEATS) throw new Error('role split lost a seat');
  check(`roles dealt privately: ${impostors.length} impostor(s), ${crew.length} crew`);

  // Secrecy: no role may appear in the public state.
  const publicJson = JSON.stringify(room.state.toJSON ? room.state.toJSON() : room.state);
  if (/"impostor"/.test(publicJson) || /"role"/.test(publicJson))
    throw new Error('a role leaked into the public state');
  check('no role appears in the broadcast state (only the private packet)');

  // Task lists exist for crew only and point at real spots.
  for (const c of crew) {
    const tasks = c.secret?.tasks ?? [];
    if (tasks.length !== room.state.settings.tasksPerCrew)
      throw new Error(`${c.name} has ${tasks.length} tasks`);
    for (const t of tasks) {
      const spot = WORLD.taskSpots.find((s) => s.id === t.spotId);
      if (!spot) throw new Error(`task ${t.id} points at a missing spot`);
    }
  }
  if ((impostors[0]?.secret?.tasks.length ?? 0) !== 0) throw new Error('impostor got a task list');
  check(`crew got ${room.state.settings.tasksPerCrew} tasks each, impostors got none`);

  // --- a real task, standing on the real spot ---
  const worker = crew[0];
  if (!worker) throw new Error('no crew seat');
  const firstTask = worker.secret?.tasks[0];
  if (!firstTask) throw new Error('crew has no first task');
  const taskSpot = spotCentre(firstTask.spotId);
  await walkTo(worker, taskSpot.x, taskSpot.y);
  await wait(150);
  worker.room.send('taskDone', { taskId: firstTask.id });
  await waitFor(
    () => worker.room.state.players.get(worker.room.sessionId)?.tasksDone === 1,
    'task counted',
  );
  check(`a crew member walked to ${firstTask.spotId} and completed a task (1/${worker.secret?.tasks.length})`);

  // Task must not count from across the station.
  const other = worker.secret?.tasks[1];
  if (other) {
    worker.room.send('taskDone', { taskId: other.id });
    await wait(300);
    const done = worker.room.state.players.get(worker.room.sessionId)?.tasksDone;
    if (done !== 1) throw new Error('server accepted a task completed from far away');
    check('server refuses a task completed away from its spot');
  }

  // --- kill: the impostor has to be close ---
  const killer = impostors[0];
  if (!killer) throw new Error('no impostor seat');
  const victim = crew[1] ?? crew[0];
  if (!victim) throw new Error('no victim');
  const killerId = killer.room.sessionId;
  const victimId = victim.room.sessionId;
  const far = killer.room.state.players.get(victimId);
  killer.room.send('kill', { target: victimId });
  await wait(300);
  if (!killer.room.state.players.get(victimId).alive)
    throw new Error('kill worked from across the station');
  check(`kill refused at ${Math.round(Math.hypot(far.x - killer.room.state.players.get(killerId).x, far.y - killer.room.state.players.get(killerId).y))} px distance`);

  // walk together, then kill
  const victimPlayer = victim.room.state.players.get(victimId);
  await walkTo(killer, victimPlayer.x, victimPlayer.y, { stopWithin: 32 });
  await waitFor(() => {
    const my = killer.room.state.players.get(killerId);
    const them = killer.room.state.players.get(victimId);
    return Math.hypot(my.x - them.x, my.y - them.y) < 40;
  }, 'killer reaches the victim');
  killer.room.send('kill', { target: victimId });
  await waitFor(() => !killer.room.state.players.get(victimId).alive, 'victim dies');
  check(`${victim.name} was killed at close range and is now a ghost`);
  if (victim.room.state.players.get(victimId).isGhost !== true) throw new Error('victim is not a ghost');
  if (killer.room.state.bodies.size !== 1) throw new Error('no body was left behind');
  check('a body appeared where they fell');

  // cooldown
  killer.room.send('kill', { target: crew[0]?.room.sessionId });
  await wait(200);
  check('kill is refused while the cooldown is running');


  // --- ghost: walks through walls, cannot vote ---
  {
    const before = victim.room.state.players.get(victimId);
    const from = { x: before.x, y: before.y };
    let seq = 9000;
    for (let i = 0; i < 30; i++) {
      seq++;
      victim.room.send('input', { seq, x: 0, y: -1 });
      await wait(50);
    }
    const after = victim.room.state.players.get(victimId);
    const travelled = Math.hypot(after.x - from.x, after.y - from.y);
    if (travelled < 30) throw new Error('the ghost did not move');
    const tile = WORLD.ascii[Math.floor(after.y / 32)]?.[Math.floor(after.x / 32)];
    check(`ghost drifted ${Math.round(travelled)} px through walls (now on tile "${tile}")`);
  }

  // --- report ---
  const reporter = crew.find((s) => s.room.sessionId !== victimId) ?? crew[0];
  if (!reporter) throw new Error('no reporter');
  const body = [...killer.room.state.bodies.values()][0] as { id: string; x: number; y: number };
  await walkTo(reporter, body.x, body.y);
  reporter.room.send('report', { bodyId: body.id });
  await waitFor(() => reporter.room.state.phase === 'MEETING', 'meeting called');
  check(`body reported by ${reporter.name} — the round is in MEETING (${reporter.room.state.meeting.stage})`);

  // --- voting ---
  const meetingRoom = reporter.room;
  await waitFor(() => meetingRoom.state.meeting.stage === 'VOTING', 'voting opens', 90_000);
  check('discussion ran its timer and voting opened');

  const target = killer.room.sessionId;
  let votes = 0;
  for (const s of seats) {
    if (s.room.sessionId === victimId) continue; // dead players cannot vote
    s.room.send('vote', { target });
    votes++;
    await wait(30);
  }
  await waitFor(() => meetingRoom.state.meeting.votesCast === votes, 'votes registered');
  // The ghost tries to vote. Client-side state is a replica, so settle before
  // reading: a counted ghost vote would push the total past the living count.
  victim.room.send('vote', { target });
  await wait(700);
  const afterGhost = meetingRoom.state.meeting.votesCast;
  if (afterGhost !== votes)
    throw new Error(`a dead player voted: ${votes} living votes, now ${afterGhost}`);
  check(`${votes} living players voted; a ghost's vote was refused`);

  await waitFor(
    () => killer.room.state.phase !== 'MEETING',
    'meeting resolves',
    (meetingRoom.state.settings.votingSec + 10) * 1000,
  );
  const ejectedName = killer.room.state.players.get(target)?.name;
  const ejectedAlive = killer.room.state.players.get(target)?.alive;
  if (ejectedAlive) throw new Error('the accused survived an unanimous vote');
  check(`majority ejected ${ejectedName}`);

  // --- end ---
  await waitFor(() => room.state.phase === 'END', 'match ends');
  const result = room.state.result;
  if (!result.winner) throw new Error('no winner recorded');
  check(`match ended: ${result.winner} win (${result.reason}) — "${result.text}"`);
  check(
    `roles revealed at the end: ${[...room.state.players.values()]
      .map((p: any) => `${p.name}=${p.rolePublic}`)
      .join(', ')}`,
  );

  // --- sabotage, on a fresh round ---
  room.send('lobby', {});
  await waitFor(() => room.state.phase === 'LOBBY', 'back in the lobby');
  room.send('start', {});
  await waitFor(() => room.state.phase === 'PLAY', 'second round starts');
  await waitFor(() => seats.every((s) => s.secret !== null && s.secret.role), 'roles re-dealt');
  const newImpostor = seats.find((s) => s.secret?.role === 'impostor');
  if (!newImpostor) throw new Error('no impostor in round two');
  newImpostor.room.send('sabotage', { kind: 'lights' });
  await waitFor(() => room.state.sabotage.kind === 'lights', 'lights sabotage active');
  const mask = computeVisionMask(grid, 300, 300);
  check(
    `sabotage: ${SABOTAGE_SPECS.lights.label} active for ${Math.round((room.state.sabotage.endsAt - Date.now()) / 1000)}s (crew vision drops to 2.5 tiles; base mask here is ${mask.visibleCount} tiles)`,
  );


  // nobody ever ends up inside a wall
  for (const s of seats) {
    const p = s.room.state.players.get(s.room.sessionId);
    if (!p?.alive) continue;
    const tile = { x: Math.floor(p.x / 32), y: Math.floor(p.y / 32) };
    if (WORLD.ascii[tile.y]?.[tile.x] === '#') throw new Error(`${p.name} is inside a wall`);
  }
  check('every living player ends the round standing on floor');

  for (const s of seats) await s.room.leave().catch(() => undefined);
  console.log(`\nPLAYTHROUGH PASS (${checks.length} checks)`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nPLAYTHROUGH FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

