/**
 * The rulebook: roles, tasks and minigames, sabotages, votes, win conditions.
 *
 * Pure functions only — no sockets, no timers. GameRoom orchestrates them and the
 * tests hammer them directly, which is the only way "crew win when every task is
 * done" stays true after six months of edits.
 */
import { z } from 'zod';

export type Role = 'crew' | 'impostor';

export const MINIGAMES = [
  'wires',
  'hold',
  'memory',
  'swipe',
  'slider',
  'sort',
  'morse',
  'sequence',
  'valve',
  'press',
  'scan',
  'connect',
] as const;
export type Minigame = (typeof MINIGAMES)[number];

/** Human label shown in the task list. */
export const MINIGAME_LABELS: Record<Minigame, string> = {
  wires: 'Repair wiring',
  hold: 'Prime the pump',
  memory: 'Match the panel',
  swipe: 'Swipe the keycard',
  slider: 'Align the output',
  sort: 'Sort the samples',
  morse: 'Repeat the signal',
  sequence: 'Reset the breakers',
  valve: 'Balance the valves',
  press: 'Charge the cell',
  scan: 'Scan the specimen',
  connect: 'Reconnect the array',
};

/** Which minigame a map task spot gets. Spot ids are stable, so this is too. */
export function minigameForSpot(spotId: string): Minigame {
  // Stable, order-independent mapping so a task looks the same for everyone.
  let hash = 7;
  for (let i = 0; i < spotId.length; i++) hash = (hash * 31 + spotId.charCodeAt(i)) >>> 0;
  return MINIGAMES[hash % MINIGAMES.length] as Minigame;
}

/**
 * Task lengths. The genre's four buckets, in our own words:
 *   short  — one quick minigame
 *   long   — two stages at the same console (the second one is a different game)
 *   common — every crew member gets this one
 *   visual — done in a public spot, and anyone nearby sees you do it (an alibi)
 */
export const TASK_CATEGORIES = ['short', 'long', 'common', 'visual'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export interface TaskAssignment {
  /** Unique per player: same spot can be on two crews' lists. */
  id: string;
  spotId: string;
  room: string;
  minigame: Minigame;
  category: TaskCategory;
  /** How many stages it takes (long tasks have two). */
  stages: number;
  done: boolean;
  /** Stages completed so far. */
  stage: number;
}

/**
 * Stable category for a map spot, from the *kind of console* it is.
 *
 * The station has four console kinds and three of each, which makes the buckets
 * balanced by construction (3 short, 3 long, 3 common, 3 visual) instead of by
 * luck — and it is explainable to a player: "the repair consoles are the quick
 * jobs, the scan consoles are out in the open".
 */
export function taskCategoryForSpot(spotId: string, kind = ''): TaskCategory {
  switch (kind) {
    case 'repair':
      return 'short';
    case 'fill':
      return 'long';
    case 'tune':
      return 'common';
    case 'scan':
      return 'visual';
    default:
      // No kind (older fixtures, odd map): fall back to the id, stably.
      if (spotId.includes('scan')) return 'visual';
      return 'short';
  }
}

/** Second-stage minigame for a long task: never the same game twice in a row. */
export function stageMinigame(spotId: string, stage: number): Minigame {
  const base = MINIGAMES.indexOf(minigameForSpot(spotId));
  const offset = stage === 0 ? 0 : 3 + (spotId.length % 4);
  return MINIGAMES[(base + offset) % MINIGAMES.length] as Minigame;
}

export function makeTask(
  spotId: string,
  room: string,
  index: number,
  category: TaskCategory = taskCategoryForSpot(spotId),
): TaskAssignment {
  return {
    id: `${spotId}#${index}`,
    spotId,
    room,
    minigame: stageMinigame(spotId, 0),
    category,
    stages: category === 'long' ? 2 : 1,
    done: false,
    stage: 0,
  };
}

/** How many individual minigames a task costs, for the task bar. */
export function taskSteps(task: TaskAssignment): number {
  return Math.max(1, task.stages);
}

/** Minigame for the stage the player is on (0 = first stage). */
export function minigameForStage(task: TaskAssignment): Minigame {
  return stageMinigame(task.spotId, task.stage === 0 ? 0 : 1);
}

/**
 * Deal roles. Impostors are chosen at random from the roster; a seeded RNG keeps
 * simulations reproducible (`pnpm sim` and tests rely on this).
 */
export function assignRoles(
  playerIds: string[],
  impostorCount: number,
  random: () => number,
): Map<string, Role> {
  const pool = [...playerIds];
  const roles = new Map<string, Role>();
  for (const id of pool) roles.set(id, 'crew');
  const count = Math.max(1, Math.min(impostorCount, Math.max(1, pool.length - 2)));
  for (let i = 0; i < count; i++) {
    const index = Math.floor(random() * pool.length);
    const [picked] = pool.splice(index, 1);
    if (picked) roles.set(picked, 'impostor');
  }
  return roles;
}

export interface TaskPlan {
  short: number;
  long: number;
  common: number;
  visual: number;
}

/** Default split: the genre's shape, five tasks per crew. */
export const DEFAULT_TASK_PLAN: TaskPlan = { short: 2, long: 1, common: 1, visual: 1 };

/**
 * Give every crew member their task list.
 *
 * Common tasks are handed to *everyone* (same spots), the other buckets are
 * drawn per player so two crew members have different routes.
 */
export function assignTasks(
  spots: Array<{ id: string; room: string; kind?: string }>,
  crewIds: string[],
  plan: number | TaskPlan,
  random: () => number,
): Map<string, TaskAssignment[]> {
  const resolved: TaskPlan =
    typeof plan === 'number'
      ? { short: Math.max(0, plan - 3), long: 1, common: 1, visual: 1 }
      : plan;

  const byCategory = new Map<TaskCategory, Array<{ id: string; room: string }>>();
  for (const spot of spots) {
    const category = taskCategoryForSpot(spot.id, spot.kind ?? '');
    const list = byCategory.get(category) ?? [];
    list.push({ id: spot.id, room: spot.room });
    byCategory.set(category, list);
  }

  // Everyone shares the same common tasks.
  const commons = shuffleTake(byCategory.get('common') ?? [], resolved.common, random);

  const result = new Map<string, TaskAssignment[]>();
  for (const id of crewIds) {
    const picks: TaskAssignment[] = [];
    let index = 0;
    for (const spot of commons) picks.push(makeTask(spot.id, spot.room, index++, 'common'));
    for (const category of ['short', 'long', 'visual'] as const) {
      const wanted = resolved[category];
      const taken = new Set(picks.map((t) => t.spotId));
      const pool = (byCategory.get(category) ?? []).filter((s) => !taken.has(s.id));
      for (const spot of shuffleTake(pool, wanted, random)) {
        picks.push(makeTask(spot.id, spot.room, index++, category));
      }
    }
    result.set(id, picks);
  }
  return result;
}

function shuffleTake<T>(pool: T[], count: number, random: () => number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  const wanted = Math.max(0, Math.min(count, copy.length));
  for (let i = 0; i < wanted; i++) {
    const index = Math.floor(random() * copy.length);
    const [picked] = copy.splice(index, 1);
    if (picked !== undefined) out.push(picked);
  }
  return out;
}

/** Total minigame steps across a task list — what the task bar counts. */
export function totalSteps(tasks: TaskAssignment[]): number {
  return tasks.reduce((sum, task) => sum + taskSteps(task), 0);
}

/** Steps already finished, counting a half-done long task as half. */
export function doneSteps(tasks: TaskAssignment[]): number {
  return tasks.reduce((sum, task) => sum + (task.done ? taskSteps(task) : task.stage), 0);
}

// ---------------------------------------------------------------- sabotages

export const SABOTAGES = ['lights', 'reactor', 'doors', 'comms', 'o2'] as const;
export type SabotageKind = (typeof SABOTAGES)[number];

export interface SabotageSpec {
  kind: SabotageKind;
  label: string;
  /** How long the crew has before the consequence lands. */
  durationSec: number;
  /** Task spot ids that fix it (reactor needs both). */
  fixSpots: string[];
  /** Impostor win if it is not fixed in time. */
  lethal: boolean;
  /** Every spot must be fixed (two-point saboteurs), not just one. */
  twoPoint: boolean;
  /** Hides the task list and the station tools while it runs. */
  blocksInfo: boolean;
  /** Crew vision while it runs, in tiles (0 = unchanged). */
  visionTiles: number;
}

export const SABOTAGE_SPECS: Record<SabotageKind, SabotageSpec> = {
  lights: {
    kind: 'lights',
    label: 'Lights out',
    durationSec: 40,
    fixSpots: ['task-medbay-lights', 'task-reactor-coolant'],
    lethal: false,
    twoPoint: false,
    blocksInfo: false,
    visionTiles: 2.5,
  },
  reactor: {
    kind: 'reactor',
    label: 'Reactor meltdown',
    durationSec: 45,
    fixSpots: ['task-reactor-rods', 'task-reactor-coolant'],
    lethal: true,
    twoPoint: true,
    blocksInfo: false,
    visionTiles: 0,
  },
  doors: {
    kind: 'doors',
    label: 'Door lockdown',
    durationSec: 12,
    fixSpots: [],
    lethal: false,
    twoPoint: false,
    blocksInfo: false,
    visionTiles: 0,
  },
  comms: {
    kind: 'comms',
    label: 'Comms blackout',
    durationSec: 35,
    // One of the two array consoles brings the link back.
    fixSpots: ['task-comms-array', 'task-bridge-nav'],
    lethal: false,
    twoPoint: false,
    blocksInfo: true,
    visionTiles: 0,
  },
  o2: {
    kind: 'o2',
    label: 'Air failing',
    durationSec: 35,
    fixSpots: ['task-galley-tray', 'task-observatory-lens'],
    lethal: true,
    twoPoint: true,
    blocksInfo: false,
    visionTiles: 0,
  },
};

/** How many fix spots a sabotage needs before it clears. */
export function fixesNeeded(spec: SabotageSpec): number {
  if (spec.fixSpots.length === 0) return 0;
  return spec.twoPoint ? spec.fixSpots.length : 1;
}

/** Crew vision radius in tiles while the lights are out. */
export const DARK_VISION_TILES = 2.5;

// ------------------------------------------------------------------- voting

export interface VoteTally {
  /** Who leaves the station (null = skip / no majority / tie). */
  ejected: string | null;
  counts: Array<{ target: string; votes: number }>;
  skipped: number;
  /** True when fewer than half of the living crew cast a vote at all. */
  tooFewVotes: boolean;
}

/**
 * Simple plurality. `votes` maps voter -> target (null = skip). Dead players are
 * filtered by the caller, so this only has to count.
 */
export function tallyVotes(votes: Map<string, string | null>): VoteTally {
  const counts = new Map<string, number>();
  let skipped = 0;
  for (const target of votes.values()) {
    if (target === null) skipped++;
    else counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const sorted = [...counts.entries()]
    .map(([target, voteCount]) => ({ target, votes: voteCount }))
    .sort((a, b) => b.votes - a.votes);

  const top = sorted[0];
  const runnerUp = sorted[1];
  let ejected: string | null = null;
  if (top && top.votes > (runnerUp?.votes ?? 0) && top.votes > skipped) ejected = top.target;

  return { ejected, counts: sorted, skipped, tooFewVotes: votes.size === 0 };
}

// ------------------------------------------------------------- win conditions

export type WinReason =
  | 'tasks'
  | 'impostors-dead'
  | 'impostors-outnumber'
  | 'reactor'
  | 'ejected-out-last-impostor';

export interface WinCheckInput {
  crewAlive: number;
  impostorsAlive: number;
  tasksRemaining: number;
  reactorCritical: boolean;
}

export function checkWin(input: WinCheckInput): { winner: 'crew' | 'impostor'; reason: WinReason } | null {
  if (input.reactorCritical) return { winner: 'impostor', reason: 'reactor' };
  if (input.impostorsAlive === 0) return { winner: 'crew', reason: 'impostors-dead' };
  if (input.tasksRemaining <= 0) return { winner: 'crew', reason: 'tasks' };
  if (input.impostorsAlive >= input.crewAlive) return { winner: 'impostor', reason: 'impostors-outnumber' };
  return null;
}

export function describeWin(reason: WinReason, winner: 'crew' | 'impostor'): string {
  const crew = winner === 'crew' ? 'Crew' : 'Impostors';
  switch (reason) {
    case 'tasks':
      return `${crew} win — every task on the station is finished.`;
    case 'impostors-dead':
      return `${crew} win — the last impostor was ejected.`;
    case 'impostors-outnumber':
      return `${crew} win — there are as many impostors left as crew.`;
    case 'reactor':
      return `${crew} win — the reactor blew while the crew was busy.`;
    case 'ejected-out-last-impostor':
      return `${crew} win — the last impostor is out.`;
  }
}

// --------------------------------------------------------------- wire shapes

export const VoteMessage = z.object({
  /** Session id of the accused, or null to skip. */
  target: z.string().min(1).max(64).nullable(),
});
export type VoteMessage = z.infer<typeof VoteMessage>;

export const KillMessage = z.object({ target: z.string().min(1).max(64) });
export const ReportMessage = z.object({ bodyId: z.string().min(1).max(64) });
export const TaskMessage = z.object({ taskId: z.string().min(1).max(80) });
export const SabotageMessage = z.object({ kind: z.enum(SABOTAGES) });
export const FixMessage = z.object({ spotId: z.string().min(1).max(64) });

/**
 * Private payload a client gets at game start and on every change to their own
 * hidden information (never in the public state).
 */
export interface SecretRole {
  /** Side for the win conditions: 'crew' | 'impostor'. */
  role: Role;
  /** Exactly what this seat is (crewmate / engineer / …). */
  roleId: import('./roles.js').RoleId;
  /** Impostor team-mates (empty for crew). */
  mates: Array<{ id: string; name: string }>;
  tasks: TaskAssignment[];
  /** Ability clocks + which abilities this role has, with their numbers. */
  abilities: Array<{
    id: import('./abilities.js').AbilityId;
    readyAt: number;
    activeUntil: number;
    usesLeft: number;
  }>;
  ejected: boolean;
}
