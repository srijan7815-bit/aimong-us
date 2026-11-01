/**
 * Lobby / match settings. Defaults come from config/game.defaults.json; this
 * module is the typed, validated mirror the client and server both use.
 */
import { z } from 'zod';
export declare const LobbySettings: z.ZodObject<{
    /** Total seats including AI seats. */
    maxPlayers: z.ZodNumber;
    /** AI seats the host wants filled at game start. */
    aiSeats: z.ZodNumber;
    impostors: z.ZodNumber;
    discussionSec: z.ZodNumber;
    votingSec: z.ZodNumber;
    killCooldownSec: z.ZodNumber;
    tasksPerCrew: z.ZodNumber;
    /** Hard per-game LLM spend cap (USD). 0 disables AI LLM calls (autopilot). */
    costCapUsd: z.ZodNumber;
    /** Host toggle: show the ejected player's role in the result banner. */
    revealEjectedRole: z.ZodBoolean;
    /** Persona aggression dial passed to AI seats (0 calm .. 1 feral). */
    aiAggression: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    maxPlayers: number;
    aiSeats: number;
    impostors: number;
    discussionSec: number;
    votingSec: number;
    killCooldownSec: number;
    tasksPerCrew: number;
    costCapUsd: number;
    revealEjectedRole: boolean;
    aiAggression: number;
}, {
    maxPlayers: number;
    aiSeats: number;
    impostors: number;
    discussionSec: number;
    votingSec: number;
    killCooldownSec: number;
    tasksPerCrew: number;
    costCapUsd: number;
    revealEjectedRole: boolean;
    aiAggression: number;
}>;
export type LobbySettings = z.infer<typeof LobbySettings>;
/** Host-editable subset — everything is editable in the lobby for now. */
export declare const LobbySettingsPatch: z.ZodObject<{
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
export type LobbySettingsPatch = z.infer<typeof LobbySettingsPatch>;
export declare const DEFAULT_SETTINGS: LobbySettings;
/** Impostor count that the genre convention implies for a seat count. */
export declare function defaultImpostors(totalSeats: number): number;
/**
 * Keep AI seats from crowding out humans: total seats is the roster size, AI
 * seats fill whatever humans don't take (resolved at game start).
 */
export declare function clampSettings(patch: LobbySettingsPatch, current: LobbySettings): LobbySettings;
