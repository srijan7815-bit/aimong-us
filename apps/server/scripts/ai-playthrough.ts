/**
 * M4/M5 harness: do the residents actually *play*?
 *
 * Creates a real room over the Colyseus SDK, dispatches residents through the
 * same console endpoint the owner uses, starts the match, then watches the
 * authoritative state for the things a player does: walk, finish tasks, kill,
 * report, talk in the meeting, vote.
 *
 *   AI_URL=http://localhost:2597 \
 *   CONSOLE_KEY=... \
 *   pnpm exec tsx apps/server/scripts/ai-playthrough.ts
 *
 * Exit code 0 = every check passed, 1 = a check failed.
 */
import { Client } from '@colyseus/sdk';

const BASE = process.env.AI_URL ?? 'http://localhost:2597';
const WS = BASE.replace(/^http/, 'ws');
const CONSOLE_KEY = process.env.CONSOLE_KEY ?? '';
const WATCH_MS = Number(process.env.WATCH_SEC ?? 90) * 1000;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForCode(room: any): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const code = room?.state?.code;
    if (typeof code === 'string' && code.length >= 4) return code;
    await wait(100);
  }
  throw new Error('room state never synced (no code)');
}

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, label: string): void {
  if (ok) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failures.push(label);
    console.log(`  \u2717 ${label}`);
  }
}

async function main(): Promise<void> {
  const client = new Client(WS);
  const room = await client.create<any>('game', { name: 'Owner' });
  // State arrives in the first patch, not with the join ack: poll for the code.
  const code = await waitForCode(room);
  console.log(`room ${code} created`);

  // Same call the Render panel makes.
  const dispatch = await fetch(`${BASE}/api/console/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-console-key': CONSOLE_KEY },
    body: JSON.stringify({ code, seats: Number(process.env.SEATS ?? 7), note: 'play to win' }),
  });
  check(dispatch.status === 200, `console dispatch accepted (${dispatch.status})`);
  const body = (await dispatch.json()) as { seated?: string[] };
  const wanted = Number(process.env.SEATS ?? 7);
  check((body.seated?.length ?? 0) === wanted, `${wanted} residents seated (${body.seated?.length ?? 0})`);

  await wait(1200);
  const players = () => [...room.state.players.values()] as any[];
  check(players().length === wanted + 1, `lobby holds ${wanted + 1} seats (${players().length})`);

  // Start the round the way a host does.
  room.send('start');
  for (let i = 0; i < 60 && room.state.phase !== 'PLAY'; i++) await wait(250);
  check(room.state.phase === 'PLAY', `match started (${room.state.phase})`);

  const spawnById = new Map(players().map((p) => [p.id, { x: p.x, y: p.y }]));
  const touched = new Set<string>();
  const said = new Set<string>();
  let sawMeeting = false;
  let sawVote = false;
  let sawKillEver = false;
  let maxAiTasks = 0;

  const startedAt = Date.now();
  while (Date.now() - startedAt < WATCH_MS) {
    for (const p of players()) {
      if (!p.isAi) continue;
      const spawn = spawnById.get(p.id);
      if (spawn && Math.hypot(p.x - spawn.x, p.y - spawn.y) > 90) touched.add(p.id);
      maxAiTasks = Math.max(maxAiTasks, p.tasksDone);
      if (!p.alive) sawKillEver = true;
    }
    for (const line of room.state.chat) {
      if (!line.system && Date.now() - line.ts < WATCH_MS) said.add(line.name);
    }
    if (room.state.meeting.active) {
      sawMeeting = true;
      if (room.state.meeting.votesCast > 0) sawVote = true;
    }
    if (room.state.phase === 'END') break;
    await wait(400);
  }

  check(touched.size >= 3, `residents walked around (${touched.size}/${wanted} left their spawn)`);
  check(maxAiTasks > 0, `a resident finished task steps (best ${maxAiTasks})`);
  check(sawMeeting, 'a meeting happened (kill reported or emergency)');
  check(sawVote, `votes were cast by residents (meeting votesCast>0)`);
  check(said.size > 0, `residents talked in the meeting (${said.size} speakers)`);
  if (sawKillEver) check(true, 'someone died (the impostor is hunting)');

  const health = (await (await fetch(`${BASE}/healthz`)).json()) as { llmCalls?: number; brain?: string };
  check((health.llmCalls ?? 0) > 0, `the brain was actually called (${health.llmCalls ?? 0} LLM calls, ${health.brain})`);

  const lines = ([...room.state.chat] as any[]).filter((c) => !c.system).slice(-8);
  if (lines.length > 0) {
    console.log('\nchat heard in the meeting:');
    for (const line of lines) console.log(`  ${line.name}: ${line.text}`);
  }

  await room.leave();
  await client.close?.();

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('failed:');
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('harness error:', err);
  process.exit(1);
});
