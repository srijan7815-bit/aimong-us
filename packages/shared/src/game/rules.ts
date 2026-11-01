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

export interface TaskAssignment {
  /** Unique per player: same spot can be on two crews' lists. */
  id: string;
  spotId: string;
  room: string;
  minigame: Minigame;
  done: boolean;
  /** Optional second stage (a "two-parter"), kept for M3.1 without new fields. */
  stage: number;
}

export function makeTask(spotId: string, room: string, index: number): TaskAssignment {
  return {
    id: `${spotId}#${index}`,
    spotId,
    room,
    minigame: minigameForSpot(spotId),
    done: false,
    stage: 0,
  };
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

/** Give every crew member `perPlayer` distinct task spots. */
export function assignTasks(
  spots: Array<{ id: string; room: string }>,
  crewIds: string[],
  perPlayer: number,
  random: () => number,
): Map<string, TaskAssignment[]> {
  const result = new Map<string, TaskAssignment[]>();
  for (const id of crewIds) {
    const pool = [...spots];
    const picks: TaskAssignment[] = [];
    const wanted = Math.min(perPlayer, pool.length);
    for (let i = 0; i < wanted; i++) {
      const index = Math.floor(random() * pool.length);
      const [spot] = pool.splice(index, 1);
      if (spot) picks.push(makeTask(spot.id, spot.room, i));
    }
    result.set(id, picks);
  }
  return result;
}

// ---------------------------------------------------------------- sabotages

export const SABOTAGES = ['lights', 'reactor', 'doors'] as const;
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
}

export const SABOTAGE_SPECS: Record<SabotageKind, SabotageSpec> = {
  lights: {
    kind: 'lights',
    label: 'Lights out',
    durationSec: 40,
    fixSpots: ['task-medbay-lights', 'task-reactor-coolant'],
    lethal: false,
  },
  reactor: {
    kind: 'reactor',
    label: 'Reactor meltdown',
    durationSec: 45,
    fixSpots: ['task-reactor-rods', 'task-reactor-coolant'],
    lethal: true,
  },
  doors: {
    kind: 'doors',
    label: 'Door lockdown',
    durationSec: 12,
    fixSpots: [],
    lethal: false,
  },
};

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

/** Private payload a client gets at game start (never in the public state). */
export interface SecretRole {
  role: Role;
  /** Impostor team-mates (also visible to the impostor). */
  mates: Array<{ id: string; name: string }>;
  tasks: TaskAssignment[];
  /** Minigame per task, so the client does not need to recompute. */
  ejected: boolean;
}
