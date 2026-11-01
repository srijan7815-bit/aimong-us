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
});

export type LobbyState = InstanceType<typeof LobbyState>;
export type PlayerState = InstanceType<typeof PlayerState>;
export type ChatEntryState = InstanceType<typeof ChatEntryState>;
export type SettingsState = InstanceType<typeof SettingsState>;

export const MAX_CHAT_HISTORY = 60;
