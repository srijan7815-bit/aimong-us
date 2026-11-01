/**
 * Synced room state (Colyseus Schema 5 `schema()` builder API — no decorators,
 * so plain `tsc` works without experimental flags).
 *
 * Only public-information lives here. Roles, AI thoughts, prompts and per-seat
 * costs stay server-side and are revealed at the end of a game (M8).
 */
import { schema, t } from '@colyseus/schema';
import { DEFAULT_SETTINGS } from '@aimong/shared';

export const SettingsState = schema({
  maxPlayers: t.number().default(DEFAULT_SETTINGS.maxPlayers),
  aiSeats: t.number().default(DEFAULT_SETTINGS.aiSeats),
  impostors: t.number().default(DEFAULT_SETTINGS.impostors),
  discussionSec: t.number().default(DEFAULT_SETTINGS.discussionSec),
  votingSec: t.number().default(DEFAULT_SETTINGS.votingSec),
  killCooldownSec: t.number().default(DEFAULT_SETTINGS.killCooldownSec),
  tasksPerCrew: t.number().default(DEFAULT_SETTINGS.tasksPerCrew),
  costCapUsd: t.number().default(DEFAULT_SETTINGS.costCapUsd),
  revealEjectedRole: t.boolean().default(DEFAULT_SETTINGS.revealEjectedRole),
  aiAggression: t.number().default(DEFAULT_SETTINGS.aiAggression),
});

export const PlayerState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  colorName: t.string(),
  isHost: t.boolean().default(false),
  isAi: t.boolean().default(false),
  ready: t.boolean().default(false),
  connected: t.boolean().default(true),
  joinedAt: t.number().default(0),
  // --- M2: world position, authoritative on the server ---
  x: t.number().default(0),
  y: t.number().default(0),
  dirX: t.number().default(0),
  dirY: t.number().default(0),
  moving: t.boolean().default(false),
  /** Last movement input sequence applied — clients use it to reconcile. */
  seq: t.number().default(0),
  // --- M3: rules. Roles are NOT here: role is private per client. ---
  alive: t.boolean().default(true),
  isGhost: t.boolean().default(false),
  tasksDone: t.number().default(0),
  tasksTotal: t.number().default(0),
  /** Impostor kill cooldown ready at (epoch ms). 0 = ready now. */
  killReadyAt: t.number().default(0),
  /** Emergency meetings this player has left. */
  emergenciesLeft: t.number().default(1),
  /** Role, revealed only after the match ends (or at the ejection banner). */
  rolePublic: t.string().default('unknown'),
});

/** A body on the floor. Everyone alive can see and report it. */
export const BodyState = schema({
  id: t.string(),
  victimId: t.string(),
  victimName: t.string(),
  color: t.string(),
  x: t.number(),
  y: t.number(),
  killedAt: t.number().default(0),
  reported: t.boolean().default(false),
});

/** Live sabotage. Only one is ever active. */
export const SabotageState = schema({
  kind: t.string().default(''),
  endsAt: t.number().default(0),
  /** Task spots already fixed for this sabotage. */
  fixed: t.array('string'),
});

/** Meeting + voting. Votes themselves stay server-side until the tally. */
export const MeetingState = schema({
  active: t.boolean().default(false),
  /** 'DISCUSSION' | 'VOTING' */
  stage: t.string().default(''),
  calledBy: t.string().default(''),
  reason: t.string().default(''),
  /** Body that was reported, if any. */
  bodyId: t.string().default(''),
  endsAt: t.number().default(0),
  votesCast: t.number().default(0),
  votersAlive: t.number().default(0),
});

/** End-of-match result, broadcast so every client draws the same screen. */
export const ResultState = schema({
  winner: t.string().default(''),
  reason: t.string().default(''),
  text: t.string().default(''),
});

export const ChatEntryState = schema({
  id: t.string(),
  name: t.string(),
  color: t.string(),
  text: t.string(),
  ts: t.number().default(0),
  system: t.boolean().default(false),
});

export const LobbyState = schema({
  code: t.string(),
  phase: t.string().default('LOBBY'),
  hostId: t.string().default(''),
  station: t.string().default('Halcyon-9'),
  version: t.string().default(''),
  createdAt: t.number().default(0),
  settings: SettingsState,
  players: t.map(PlayerState),
  chat: t.array(ChatEntryState),
  // --- M3 ---
  bodies: t.map(BodyState),
  sabotage: SabotageState,
  meeting: MeetingState,
  result: ResultState,
  /** Matching tasks left across living crew (0 = crew win). */
  tasksRemaining: t.number().default(0),
  /** Doors locked until (epoch ms). */
  doorsClosedUntil: t.number().default(0),
});

export type LobbyState = InstanceType<typeof LobbyState>;
export type PlayerState = InstanceType<typeof PlayerState>;
export type ChatEntryState = InstanceType<typeof ChatEntryState>;
export type SettingsState = InstanceType<typeof SettingsState>;
export type BodyState = InstanceType<typeof BodyState>;
export type MeetingState = InstanceType<typeof MeetingState>;
export type ResultState = InstanceType<typeof ResultState>;

export const MAX_CHAT_HISTORY = 60;
