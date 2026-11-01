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
    .transform((s) => s
    .replace(/[<>{}\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim())
    .pipe(z.string().min(1, 'Pick a name').max(MAX_NAME_LEN, `Keep it under ${MAX_NAME_LEN} characters`));
/** Chat text: no angle brackets, so <chat> boundaries in prompts stay unforgeable. */
export const ChatText = z
    .string()
    .transform((s) => s.replace(/[<>]/g, '').trim())
    .pipe(z.string().min(1).max(MAX_CHAT_LEN, `Keep it under ${MAX_CHAT_LEN} characters`));
/** Matchmaking options for create / join. */
export const JoinOptions = z.object({
    name: PlayerName,
    /** Marks the creator as host on create; ignored on join. */
    host: z.boolean().optional(),
});
export const ClientMessages = {
    ready: z.object({ ready: z.boolean() }),
    setName: z.object({ name: PlayerName }),
    chat: z.object({ text: ChatText }),
    settings: z.object({ patch: LobbySettingsPatch }),
    start: z.object({}),
    kick: z.object({ playerId: z.string().min(1).max(32) }),
    lookup: z.object({ code: RoomCode }),
};
export const ServerEvents = {
    notice: z.object({
        level: z.enum(['info', 'warn', 'error']),
        text: z.string(),
    }),
    kicked: z.object({ reason: z.string() }),
};
export const Phase = z.enum(['LOBBY', 'STARTING', 'PLAY', 'MEETING', 'END']);
//# sourceMappingURL=protocol.js.map