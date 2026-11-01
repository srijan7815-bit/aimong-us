/**
 * Wire protocol (INSTRUCTIONS §4.1). Every client->server payload is zod
 * validated on arrival; anything that fails is dropped and logged, never thrown
 * into the room.
 */
import { z } from 'zod';
export declare const MAX_NAME_LEN = 14;
export declare const MAX_CHAT_LEN = 160;
/**
 * Display names. Sanitised first (so a rejected name cannot carry prompt
 * delimiters even in an error message), then length-checked.
 */
export declare const PlayerName: z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>;
/** Chat text: no angle brackets, so <chat> boundaries in prompts stay unforgeable. */
export declare const ChatText: z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>;
/** Matchmaking options for create / join. */
export declare const JoinOptions: z.ZodObject<{
    name: z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>;
    /** Marks the creator as host on create; ignored on join. */
    host: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    host?: boolean | undefined;
}, {
    name: string;
    host?: boolean | undefined;
}>;
export type JoinOptions = z.infer<typeof JoinOptions>;
export declare const ClientMessages: {
    readonly ready: z.ZodObject<{
        ready: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        ready: boolean;
    }, {
        ready: boolean;
    }>;
    readonly setName: z.ZodObject<{
        name: z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
    }, {
        name: string;
    }>;
    readonly chat: z.ZodObject<{
        text: z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        text: string;
    }, {
        text: string;
    }>;
    readonly settings: z.ZodObject<{
        patch: z.ZodObject<{
            maxPlayers: z.ZodOptional<z.ZodNumber>;
            aiSeats: z.ZodOptional<z.ZodNumber>;
            impostors: z.ZodOptional<z.ZodNumber>;
            discussionSec: z.ZodOptional<z.ZodNumber>;
            votingSec: z.ZodOptional<z.ZodNumber>;
            killCooldownSec: z.ZodOptional<z.ZodNumber>;
            tasksPerCrew: z.ZodOptional<z.ZodNumber>;
            costCapUsd: z.ZodOptional<z.ZodNumber>;
            revealEjectedRole: z.ZodOptional<z.ZodBoolean>;
            aiAggression: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            maxPlayers?: number | undefined;
            aiSeats?: number | undefined;
            impostors?: number | undefined;
            discussionSec?: number | undefined;
            votingSec?: number | undefined;
            killCooldownSec?: number | undefined;
            tasksPerCrew?: number | undefined;
            costCapUsd?: number | undefined;
            revealEjectedRole?: boolean | undefined;
            aiAggression?: number | undefined;
        }, {
            maxPlayers?: number | undefined;
            aiSeats?: number | undefined;
            impostors?: number | undefined;
            discussionSec?: number | undefined;
            votingSec?: number | undefined;
            killCooldownSec?: number | undefined;
            tasksPerCrew?: number | undefined;
            costCapUsd?: number | undefined;
            revealEjectedRole?: boolean | undefined;
            aiAggression?: number | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        patch: {
            maxPlayers?: number | undefined;
            aiSeats?: number | undefined;
            impostors?: number | undefined;
            discussionSec?: number | undefined;
            votingSec?: number | undefined;
            killCooldownSec?: number | undefined;
            tasksPerCrew?: number | undefined;
            costCapUsd?: number | undefined;
            revealEjectedRole?: boolean | undefined;
            aiAggression?: number | undefined;
        };
    }, {
        patch: {
            maxPlayers?: number | undefined;
            aiSeats?: number | undefined;
            impostors?: number | undefined;
            discussionSec?: number | undefined;
            votingSec?: number | undefined;
            killCooldownSec?: number | undefined;
            tasksPerCrew?: number | undefined;
            costCapUsd?: number | undefined;
            revealEjectedRole?: boolean | undefined;
            aiAggression?: number | undefined;
        };
    }>;
    readonly start: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    readonly kick: z.ZodObject<{
        playerId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        playerId: string;
    }, {
        playerId: string;
    }>;
    readonly lookup: z.ZodObject<{
        code: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    }, "strip", z.ZodTypeAny, {
        code: string;
    }, {
        code: string;
    }>;
};
export type ClientMessageName = keyof typeof ClientMessages;
export declare const ServerEvents: {
    readonly notice: z.ZodObject<{
        level: z.ZodEnum<["info", "warn", "error"]>;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        text: string;
        level: "info" | "warn" | "error";
    }, {
        text: string;
        level: "info" | "warn" | "error";
    }>;
    readonly kicked: z.ZodObject<{
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        reason: string;
    }, {
        reason: string;
    }>;
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
}
export declare const Phase: z.ZodEnum<["LOBBY", "STARTING", "PLAY", "MEETING", "END"]>;
export type Phase = z.infer<typeof Phase>;
