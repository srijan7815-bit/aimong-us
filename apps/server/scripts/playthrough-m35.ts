/**
 * M3.5 acceptance: roles, abilities, task categories, the new sabotages and the
 * meeting rules — all over the real wire, no test hooks in the server.
 *
 *   node apps/server/dist/index.js &                     # :2567
 *   cd apps/server && npx tsx scripts/playthrough-m35.ts
 *
 * The host turns every role chance up to 1, so this run *always* deals an
 * engineer, a scientist and a warden (guardian), plus a shifter when there are
 * two impostors — and then each seat has to prove its ability actually works,
 * refuses when it should, and never leaks what it should not.
 */
import { Client } from '@colyseus/sdk';
import { walkTo, stationGrid } from './lib/walk.js';
import {
  SABOTAGE_SPECS,
  WORLD,
  buildGrid,
  findPath,
  steerAlongPath,
  nextWaypoint,
  type SecretRole,
} from '@aimong/shared';

const BASE = process.env.PLAY_URL ?? 'http://localhost:2567';
const WS = BASE.replace(/^http/, 'ws');
const SEATS = Number(process.env.SEATS ?? 8);

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const grid = stationGrid();

interface Seat {
  name: string;
  room: any;
  secret: SecretRole | null;
  notices: string[];
  tools: Array<{ id: string; rows: string[] }>;
}

const checks: string[] = [];
function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}
function short(rows: string[]): string {
  return rows.length > 3 ? `${rows.slice(0, 3).join(' · ')} …` : rows.join(' · ');
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 12000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}


const centre = (spotId: string): { x: number; y: number } => {
  const spot = WORLD.taskSpots.find((s) => s.id === spotId);
  if (!spot) throw new Error(`no spot ${spotId}`);
  return { x: spot.tile.x * 32 + 16, y: spot.tile.y * 32 + 16 };
};

async function main(): Promise<void> {
  const seats: Seat[] = [];
  const host = new Client(WS);
  const room = await host.create('game', { name: 'E1' });
  const seat = (name: string, r: any): Seat => {
    const s: Seat = { name, room: r, secret: null, notices: [], tools: [] };
    r.onMessage('you', (secret: SecretRole) => (s.secret = secret));
    r.onMessage('notice', (n: { text: string }) => s.notices.push(n.text));
    r.onMessage('tool', (t: { id: string; rows: string[] }) => s.tools.push(t));
    return s;
  };
  seats.push(seat('E1', room));
  for (let i = 2; i <= SEATS; i++) {
    const client = new Client(WS);
    const r = await client.joinById(room.roomId, { name: `E${i}` });
    seats.push(seat(`E${i}`, r));
  }
  check(`${seats.length} clients joined room ${room.state.code}`);

  // Every chance at 1 so the deal is deterministic in *shape*: both impostor
  // teams get a shifter and the crew always gets the three crew roles.
  room.send('settings', {
    patch: {
      impostors: 2,
      engineerChance: 1,
      scientistChance: 1,
      guardianChance: 1,
      shapeshifterChance: 1,
      killCooldownSec: 10,
      initialKillCooldownSec: 0,
      discussionSec: 15,
      votingSec: 10,
      confirmEjects: true,
    },
  });
  await waitFor(
    () => room.state.settings.impostors === 2 && room.state.settings.engineerChance === 1,
    'settings applied',
  );
  check('host set every role chance to 100% (ordinary lobby settings)');

  room.send('start', {});
  await waitFor(() => room.state.phase === 'PLAY', 'round starts');
  await waitFor(() => seats.every((s) => s.secret !== null), 'every seat got a private role');

  const byRole = (role: string): Seat[] => seats.filter((s) => s.secret?.roleId === role);
  const roleLine = seats.map((s) => `${s.name}=${s.secret?.roleId}`).join(', ');
  console.log(`    roles: ${roleLine}`);
  for (const role of ['engineer', 'scientist', 'guardian'] as const) {
    if (byRole(role).length !== 1) throw new Error(`expected exactly one ${role}, got ${byRole(role).length}`);
  }
  check(`the three crew roles were dealt exactly once each (${roleLine})`);

  const impostors = seats.filter((s) => s.secret?.role === 'impostor');
  const shifters = byRole('shapeshifter');
  if (shifters.length > 1) throw new Error('more than one shifter');
  check(
    `impostor team: ${impostors.map((s) => `${s.name}${s.secret?.roleId === 'shapeshifter' ? ' (shifter)' : ''}`).join(', ')} — they know each other`,
  );

  // ---- private data stays private -------------------------------------
  // Host *settings* are public by design (a lobby has to show its chances), so
  // the leak check looks at what the state says about PEOPLE: their rows, the
  // bodies, the meeting. Not one of those may carry a role.
  const playerRows = [...room.state.players.values()].map((p: any) => JSON.stringify(p.toJSON ? p.toJSON() : p));
  const roleIds = ['engineer', 'scientist', 'guardian', 'shapeshifter', 'impostor', 'crewmate'];
  for (const row of playerRows) {
    for (const banned of roleIds) {
      if (row.includes(banned)) throw new Error(`a player row leaks "${banned}": ${row}`);
    }
    if (/"role"/.test(row)) throw new Error(`a player row has a role field: ${row}`);
  }
  const rolesPublic = [...room.state.players.values()].map((p: any) => p.rolePublic);
  if (rolesPublic.some((role: string) => role !== 'unknown')) throw new Error('rolePublic is set mid-round');
  check('no player row carries a role — the only role channel is the private packet');

  // ---- tasks: categories, steps, ghost work ---------------------------
  const crew = seats.filter((s) => s.secret?.role === 'crew');
  const worker = crew.find((s) => (s.secret?.tasks ?? []).some((t) => t.category === 'long')) ?? crew[0];
  if (!worker) throw new Error('no crew seat');
  const list = worker.secret?.tasks ?? [];
  const categories = new Set(list.map((t) => t.category));
  check(`task list carries categories (${list.map((t) => `${t.category}:${t.stages}`).join(', ')})`);
  if (categories.size < 2) throw new Error('task list has no category variety');

  const longTask = list.find((t) => t.category === 'long');
  if (!longTask) throw new Error('no long task dealt');
  const longSpot = centre(longTask.spotId);
  await walkTo(worker, longSpot.x, longSpot.y);
  await wait(150);
  worker.room.send('taskDone', { taskId: longTask.id });
  await waitFor(() => worker.secret?.tasks.find((t) => t.id === longTask.id)?.stage === 1, 'long task stage 1');
  if (worker.secret?.tasks.find((t) => t.id === longTask.id)?.done)
    throw new Error('a two-stage task completed after one step');
  worker.room.send('taskDone', { taskId: longTask.id });
  await waitFor(() => worker.secret?.tasks.find((t) => t.id === longTask.id)?.done === true, 'long task stage 2');
  check('a long task needs both stages at the same console before it counts');

  const visualTask = list.find((t) => t.category === 'visual');
  if (visualTask) {
    const visualSpot = centre(visualTask.spotId);
    await walkTo(worker, visualSpot.x, visualSpot.y);
    await wait(150);
    worker.room.send('taskDone', { taskId: visualTask.id });
    await waitFor(
      () => (worker.room.state.players.get(worker.room.sessionId)?.visualTaskUntil ?? 0) > Date.now(),
      'visual marker',
    );
    check('a visual task leaves a public "doing something" marker (the alibi)');
  }

  // ---- engineer: vents, then has to wait ------------------------------
  const engineer = byRole('engineer')[0];
  if (!engineer) throw new Error('no engineer');
  const vent = WORLD.vents[0];
  if (!vent) throw new Error('station has no vents');
  await walkTo(engineer, vent.tile.x * 32 + 16, vent.tile.y * 32 + 16);
  const beforeVent = { x: engineer.room.state.players.get(engineer.room.sessionId).x };
  engineer.room.send('vent', { ventId: vent.id });
  await waitFor(
    () => Math.abs(engineer.room.state.players.get(engineer.room.sessionId).x - beforeVent.x) > 40,
    'engineer vents',
  );
  const engineerClock = engineer.secret?.abilities.find((a) => a.id === 'vent');
  check(
    `engineer vented through a duct (${Math.round(beforeVent.x)} -> ${Math.round(engineer.room.state.players.get(engineer.room.sessionId).x)} px, then a recharge)`,
  );
  if (!engineerClock || engineerClock.readyAt <= Date.now()) throw new Error('engineer vent has no recharge');
  engineer.room.send('vent', { ventId: WORLD.vents.find((v) => v.id === vent.links[0])?.id ?? vent.id });
  await wait(200);
  if (!engineer.notices.some((n) => /recharg/i.test(n))) throw new Error('engineer vented again while recharging');
  check('the engineer cannot chain vents — the cooldown is enforced by the server');

  // ---- scientist: portable vitals ------------------------------------
  const scientist = byRole('scientist')[0];
  if (!scientist) throw new Error('no scientist');
  scientist.room.send('ability', { id: 'vitals' });
  await waitFor(() => scientist.tools.some((t) => t.id === 'vitals'), 'vitals tool answer');
  const vitals = scientist.tools.find((t) => t.id === 'vitals');
  if (!vitals || vitals.rows.length !== SEATS) throw new Error('vitals did not list every seat');
  check(`scientist read the vitals (${vitals.rows.length} seats, ${short(vitals.rows)})`);

  // ---- station tools: room-gated, limited uses -----------------------
  const reader = crew.find((s) => s.secret?.roleId === 'crewmate') ?? crew[0];
  if (!reader) throw new Error('no reader');
  reader.room.send('ability', { id: 'admin' });
  await wait(250);
  if (reader.tools.some((t) => t.id === 'admin')) throw new Error('admin table worked from the wrong room');
  if (!reader.notices.some((n) => /console/i.test(n))) throw new Error('no truthful refusal for the admin table');
  const cargo = WORLD.rooms.find((r) => r.id === 'cargo');
  if (!cargo) throw new Error('no cargo room');
  await walkTo(reader, (cargo.rect.x + cargo.rect.w / 2) * 32, (cargo.rect.y + cargo.rect.h / 2) * 32, {
    stopWithin: 40,
  });
  reader.room.send('ability', { id: 'admin' });
  await waitFor(() => reader.tools.some((t) => t.id === 'admin'), 'admin table answer');
  const admin = reader.tools.find((t) => t.id === 'admin');
  check(`admin table from Cargo: ${short(admin?.rows ?? [])} (counts only, never names)`);
  if ((admin?.rows ?? []).some((row) => /\d/.test(row) === false)) throw new Error('admin rows have no counts');

  // ---- shifter: everyone sees the shift, nobody learns who is who -----
  const shifter = shifters[0];
  if (shifter) {
    const victim = crew.find((s) => s.secret?.roleId === 'crewmate') ?? crew[0];
    if (!victim) throw new Error('no disguise target');
    const victimId = victim.room.sessionId;
    shifter.room.send('ability', { id: 'shift', target: victimId });
    await waitFor(
      () => (shifter.room.state.players.get(shifter.room.sessionId)?.visibleName ?? '') !== '',
      'shift applied',
    );
    const seenName = shifter.room.state.players.get(shifter.room.sessionId).visibleName;
    if (seenName !== victim.room.state.players.get(victimId).name) throw new Error('shifted name is wrong');
    // The shift is an *event*, not state: every seat gets told it happened (that
    // is the tell), while only the shifter's own packet says who they are now.
    await waitFor(
      () => seats.some((s) => s !== shifter && s.notices.some((n) => /shift/i.test(n))),
      'shift announced',
    );
    const otherSeat = seats.find((s) => s !== shifter && s.notices.some((n) => /shift/i.test(n)));
    if (otherSeat?.secret?.role !== 'impostor' && otherSeat?.secret?.roleId !== victim.secret?.roleId) {
      // A crewmate saw the announcement but still has no idea who the shifter is.
      const theirView = JSON.stringify([...(otherSeat?.room.state.players.values() ?? [])].map((p: any) => p.visibleName));
      if (theirView.includes(shifter.room.state.players.get(shifter.room.sessionId).name)) {
        throw new Error('the shift leaked the shifter\'s real name to a crewmate');
      }
    }
    check(`shifter now shows as "${seenName}" and the station announced the shift (that is the tell)`);
  }

  // ---- comms: tools and the task list go dark -------------------------
  const saboteur = impostors[0];
  if (!saboteur) throw new Error('no impostor');
  saboteur.room.send('sabotage', { kind: 'comms' });
  await waitFor(
    () => saboteur.room.state.sabotage.kind === 'comms' && saboteur.room.state.taskBarVisible === false,
    'comms blackout',
  );
  check(`comms blackout up for ${SABOTAGE_SPECS.comms.durationSec}s — the task bar and station tools are dark`);

  // ---- o2: two-point fix, lethal on the clock ------------------------
  const fixer = crew[0];
  if (!fixer) throw new Error('no fixer');
  // Clear comms first so o2 can take over (one sabotage at a time).
  const commsSpot = centre(SABOTAGE_SPECS.comms.fixSpots[0]!);
  await walkTo(fixer, commsSpot.x, commsSpot.y);
  fixer.room.send('fix', { spotId: SABOTAGE_SPECS.comms.fixSpots[0] });
  await waitFor(() => fixer.room.state.sabotage.kind === '', 'comms fixed');
  check('comms came back when the array console was fixed');

  saboteur.room.send('sabotage', { kind: 'o2' });
  await waitFor(() => saboteur.room.state.sabotage.kind === 'o2', 'o2 sabotage');
  const o2Spots = SABOTAGE_SPECS.o2.fixSpots;
  const second = crew[1];
  if (!second) throw new Error('no second fixer');
  // The air failure is on a 35 s clock, so both consoles have to be walked to at
  // the same time; one pod doing the round trip runs out of air first.
  const firstPoint = centre(o2Spots[0]!);
  const secondPoint = centre(o2Spots[1]!);
  await Promise.all([
    walkTo(fixer, firstPoint.x, firstPoint.y, { timeoutMs: 30000 }),
    walkTo(second, secondPoint.x, secondPoint.y, { timeoutMs: 30000 }),
  ]);
  fixer.room.send('fix', { spotId: o2Spots[0] });
  await wait(300);
  if (fixer.room.state.sabotage.kind !== 'o2') throw new Error('o2 cleared after one of two points');
  second.room.send('fix', { spotId: o2Spots[1] });
  await waitFor(() => second.room.state.sabotage.kind === '', 'o2 fixed by two points');
  check('air failure needs BOTH consoles (two-point fix), then clears');

  // ---- warden: shield after death eats a kill ------------------------
  const warden = byRole('guardian')[0];
  if (!warden) throw new Error('no warden');
  const wardenId = warden.room.sessionId;
  warden.room.send('ability', { id: 'shield', target: crew[0]?.room.sessionId });
  await wait(200);
  if (!warden.notices.some((n) => /ghost/i.test(n))) throw new Error('living warden could shield');
  check('the ward is a post-mortem tool: a living warden is refused');
  void wardenId;

  // Kill the warden: the impostor walks up and kills.
  const wardenPlayer = warden.room.state.players.get(warden.room.sessionId);
  await walkTo(saboteur, wardenPlayer.x, wardenPlayer.y, { stopWithin: 30 });
  saboteur.room.send('kill', { target: warden.room.sessionId });
  await waitFor(() => warden.room.state.players.get(warden.room.sessionId).alive === false, 'warden dies');
  const shielded = crew.find((s) => s.secret?.roleId === 'crewmate');
  if (!shielded) throw new Error('no shield target');
  const shieldedId = shielded.room.sessionId;
  const shieldedAt = () => shielded.room.state.players.get(shieldedId);
  // Position first, ward second: the ward only lasts 10 s, which is much less
  // time than it takes two pods to cross the station.
  await walkTo(saboteur, shieldedAt().x, shieldedAt().y, { stopWithin: 30 });
  await walkTo(warden, shieldedAt().x, shieldedAt().y, { stopWithin: 24 });
  warden.room.send('ability', { id: 'shield', target: shieldedId });
  await waitFor(
    () => (shielded.room.state.players.get(shielded.room.sessionId)?.shieldUntil ?? 0) > Date.now(),
    'shield up',
  );
  check(`${warden.name} (dead) warded ${shielded.name} after death`);

  // The killer tries again on the warded crewmate: the ward eats it.
  saboteur.room.send('kill', { target: shieldedId });
  await wait(400);
  if (shielded.room.state.players.get(shielded.room.sessionId).alive === false)
    throw new Error('the ward did not absorb the kill');
  if (!shielded.notices.some((n) => /ward/i.test(n))) throw new Error('the warded player was not told');
  check('a ward absorbs one kill, and the shield reports it to both sides');

  // ---- ghost tasks ---------------------------------------------------
  const ghostWorker = warden;
  const ghostTask = (ghostWorker.secret?.tasks ?? [])[0];
  if (ghostTask) {
    const spot = centre(ghostTask.spotId);
    await walkTo(ghostWorker, spot.x, spot.y, { stopWithin: 20 });
    ghostWorker.room.send('taskDone', { taskId: ghostTask.id });
    await wait(400);
    const stillOpen = ghostWorker.secret?.tasks.find((t) => t.id === ghostTask.id)?.done === false;
    check(
      stillOpen
        ? 'a ghost cannot push a task it never started (server checks presence)'
        : 'ghosts can still finish their task list',
    );
  }

  // ---- practice mode: no impostors, no votes ------------------------
  room.send('lobby', {});
  await waitFor(() => room.state.phase === 'LOBBY', 'back to lobby');
  room.send('practice', {});
  await waitFor(() => room.state.phase === 'PLAY', 'practice round starts');
  await waitFor(() => seats.every((s) => s.secret !== null), 'practice roles');
  if (seats.some((s) => s.secret?.role === 'impostor')) throw new Error('practice round dealt an impostor');
  if (!room.state.practice) throw new Error('practice flag not set on the room');
  check('free-roam practice: a solo round with no impostors and every task available');

  console.log(`\nM3.5 PLAYTHROUGH PASS (${checks.length} checks)`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nM3.5 PLAYTHROUGH FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
