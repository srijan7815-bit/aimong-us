/**
 * M2 performance check: server tick cost with ten players walking.
 *
 *   pnpm --filter @aimong/server dev        # or: node apps/server/dist/index.js
 *   cd apps/server && npx tsx scripts/perf-m2.ts
 *
 * Ten real WebSocket clients join one room, the host opens the station, and every
 * client sends movement input at 20 Hz for 20 s while changing direction and
 * shoving into walls. The server records its own simulation-step durations; this
 * script reads them from /api/metrics (development only) and reports p50/p95/p99.
 */
import { Client } from '@colyseus/sdk';

const BASE = process.env.PERF_URL ?? 'http://localhost:2567';
const WS = BASE.replace(/^http/, 'ws');
const PLAYERS = Number(process.env.PERF_PLAYERS ?? 10);
const SECONDS = Number(process.env.PERF_SECONDS ?? 20);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Metrics {
  ticks: Array<{ code: string; samples: number; p50: number; p95: number; p99: number; max: number; players: number; hz: number }>;
}

async function main(): Promise<void> {
  const clients: Array<{ client: Client; room: any; seq: number }> = [];
  const host = new Client(WS);
  const hostRoom = await host.create('game', { name: 'Host' });
  clients.push({ client: host, room: hostRoom, seq: 0 });

  for (let i = 1; i < PLAYERS; i++) {
    const client = new Client(WS);
    const room = await client.joinById(hostRoom.roomId, { name: `Bot${i}` });
    clients.push({ client, room, seq: 0 });
  }
  console.log(`joined ${clients.length} clients in room ${hostRoom.state.code}`);

  // wait for the full roster to replicate
  const started = Date.now();
  while (hostRoom.state.players.size < PLAYERS && Date.now() - started < 10_000) await wait(50);
  console.log(`roster: ${hostRoom.state.players.size} players`);

  hostRoom.send('start', {});
  await wait(600);
  if (hostRoom.state.phase !== 'PLAY') throw new Error(`phase is ${hostRoom.state.phase}, expected PLAY`);
  console.log('station open, driving input…');

  let running = true;
  const drivers = clients.map(async ({ room }, index) => {
    let angle = (index / PLAYERS) * Math.PI * 2;
    while (running) {
      // Change direction every ~700 ms; occasionally push straight into a wall.
      angle += (Math.random() - 0.5) * 0.6;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      const entry = clients[index];
      if (!entry) continue;
      entry.seq += 1;
      room.send('input', { seq: entry.seq, x, y });
      await wait(50);
    }
  });

  await wait(SECONDS * 1000);
  running = false;
  await Promise.all(drivers);

  const metrics = (await fetch(`${BASE}/api/metrics`).then((r) => r.json())) as Metrics;
  const room = metrics.ticks.find((t) => t.players > 0) ?? metrics.ticks[0];
  if (!room) throw new Error('no tick metrics returned');

  console.log('\nserver simulation step (10 players, 20 Hz):');
  console.log(`  samples ${room.samples}  players ${room.players}  tick rate ${room.hz} Hz`);
  console.log(`  p50 ${room.p50} ms   p95 ${room.p95} ms   p99 ${room.p99} ms   max ${room.max} ms`);

  const budget = 10;
  const passed = room.p95 < budget;
  console.log(`\n${passed ? 'PASS' : 'FAIL'}: p95 ${room.p95} ms vs ${budget} ms budget`);

  // Movement sanity while we are here: nobody is standing inside a wall.
  const { WORLD, buildGrid, circleHitsWall } = await import('@aimong/shared');
  const grid = buildGrid(WORLD);
  let insideWall = 0;
  hostRoom.state.players.forEach((p: any) => {
    if (circleHitsWall(grid, p.x, p.y)) insideWall++;
  });
  console.log(`players inside a wall at the end: ${insideWall}`);
  if (insideWall > 0) throw new Error('someone ended up inside a wall');

  for (const { room } of clients) await room.leave().catch(() => undefined);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('PERF FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
