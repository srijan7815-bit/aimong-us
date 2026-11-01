/**
 * Wire protocol (INSTRUCTIONS §4.1). Every client->server payload is zod
 * validated on arrival; anything that fails is dropped and logged, never thrown
 * into the room.
 */
import { z } from 'zod';
import { RoomCode } from './codes.js';
import { LobbySettingsPatch } from './settings.js';

export const MAX_NAME_LEN = 14;
export const MAX_CHAT_LEN = 160;

/**
 * Display names. Sanitised first (so a rejected name cannot carry prompt
 * delimiters even in an error message), then length-checked.
 */
export const PlayerName = z
  .string()
  .transform((s) =>
    s
      .replace(/[<>{}\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  .pipe(z.string().min(1, 'Pick a name').max(MAX_NAME_LEN, `Keep it under ${MAX_NAME_LEN} characters`));

/** Chat text: no angle brackets, so <chat> boundaries in prompts stay unforgeable. */
export const ChatText = z
  .string()
  .transform((s) => s.replace(/[<>]/g, '').trim())
  .pipe(z.string().min(1).max(MAX_CHAT_LEN, `Keep it under ${MAX_CHAT_LEN} characters`));

/** Cosmetics a player can wear. Look-only; the server stores and broadcasts it. */
export const CosmeticsPatch = z.object({
  hat: z.string().max(24).optional(),
  skin: z.string().max(24).optional(),
  pet: z.string().max(24).optional(),
  nameplate: z.string().max(24).optional(),
});

/** Matchmaking options for create / join. */
export const JoinOptions = z.object({
  name: PlayerName,
  /** Marks the creator as host on create; ignored on join. */
  host: z.boolean().optional(),
  /** What the seat looks like from the first frame. */
  cosmetics: CosmeticsPatch.optional(),
});
export type JoinOptions = z.infer<typeof JoinOptions>;

/** Movement input: a direction vector (analog magnitude allowed) + sequence. */
export const MoveInput = z.object({
  seq: z.number().int().min(0).max(1e9),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
});
export type MoveInput = z.infer<typeof MoveInput>;

export const ClientMessages = {
  ready: z.object({ ready: z.boolean() }),
  input: MoveInput,
  // --- M3 gameplay ---
  kill: z.object({ target: z.string().min(1).max(64) }),
  vent: z.object({ ventId: z.string().min(1).max(64) }),
  report: z.object({ bodyId: z.string().min(1).max(96) }),
  emergency: z.object({}),
  taskDone: z.object({ taskId: z.string().min(1).max(80) }),
  fix: z.object({ spotId: z.string().min(1).max(64) }),
  sabotage: z.object({ kind: z.enum(['lights', 'reactor', 'doors', 'comms', 'o2']) }),
  // --- M3.5 abilities and station tools ---
  /** Start an ability: vent, vitals, shield, shift, admin, camera, doorlog. */
  ability: z.object({
    id: z.enum(['vent', 'vitals', 'shield', 'shift', 'admin', 'camera', 'doorlog']),
    /** Warden shield target; shifter disguise target. */
    target: z.string().min(1).max(64).optional(),
  }),
  /** Cancel/stop a running ability (leaving vitals, ending a shift early). */
  abilityEnd: z.object({ id: z.enum(['vent', 'vitals', 'shield', 'shift', 'admin', 'camera', 'doorlog']) }),
  /** Free-roam practice: start a solo round with no roles and no impostors. */
  practice: z.object({}),
  /** Change what you look like. Allowed in the lobby and mid-round. */
  cosmetics: CosmeticsPatch,
  /** Quick-chat chips: the id is a canned phrase, never free text. */
  quickChat: z.object({ id: z.string().min(1).max(32) }),
  vote: z.object({ target: z.string().min(1).max(64).nullable() }),
  setName: z.object({ name: PlayerName }),
  chat: z.object({ text: ChatText }),
  settings: z.object({ patch: LobbySettingsPatch }),
  start: z.object({}),
  kick: z.object({ playerId: z.string().min(1).max(32) }),
  lookup: z.object({ code: RoomCode }),
} as const;

export type ClientMessageName = keyof typeof ClientMessages;

export const ServerEvents = {
  notice: z.object({
    level: z.enum(['info', 'warn', 'error']),
    text: z.string(),
  }),
  kicked: z.object({ reason: z.string() }),
  /** Private answer to an admin/camera/doorlog request. */
  tool: z.object({
    id: z.enum(['admin', 'camera', 'doorlog', 'vitals']),
    rows: z.array(z.string()),
  }),
} as const;

/** Canned quick-chat lines. Ids are stable; the client shows the text. */
export const QUICK_CHAT: Record<string, string> = {
  'where-was': 'where was everyone?',
  'seen-x': 'I saw someone near the body',
  'on-tasks': 'I was on my tasks',
  'with-me': 'anyone with me?',
  'susp': 'that is sus',
  'skip': 'let us skip',
  'vote-x': 'vote them out',
  'clear': 'they are clear, leave them',
  'safe': 'staying here, come to me',
  'gg': 'good round either way',
};

export interface Notice {
  level: 'info' | 'warn' | 'error';
  text: string;
}

/** Shared shape of a player row in the synced state (see rooms/state.ts). */
export interface PlayerView {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isHost: boolean;
  isAi: boolean;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  /** World position in pixels (server-authoritative). */
  x: number;
  y: number;
  /** Facing/intent direction, -1..1. */
  dirX: number;
  dirY: number;
  moving: boolean;
  /** Last input sequence the server has applied for this player. */
  seq: number;
  // --- M3.5: public side-effects of private abilities + cosmetics ---
  /** Name to draw over this pod; a shifter wears someone else's. */
  visibleName?: string;
  shiftUntil?: number;
  shieldUntil?: number;
  venting?: boolean;
  visualTaskUntil?: number;
  hat?: string;
  skin?: string;
  pet?: string;
  nameplate?: string;
}

export const Phase = z.enum(['LOBBY', 'STARTING', 'PLAY', 'MEETING', 'END']);
export type Phase = z.infer<typeof Phase>;
