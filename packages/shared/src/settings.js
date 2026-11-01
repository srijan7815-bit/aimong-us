/**
 * Lobby / match settings. Defaults come from config/game.defaults.json; this
 * module is the typed, validated mirror the client and server both use.
 */
import { z } from 'zod';
import { MAX_AI_SEATS, MAX_PLAYERS, MIN_PLAYERS } from './colors.js';
export const LobbySettings = z.object({
    /** Total seats including AI seats. */
    maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS),
    /** AI seats the host wants filled at game start. */
    aiSeats: z.number().int().min(0).max(MAX_AI_SEATS),
    impostors: z.number().int().min(1).max(3),
    discussionSec: z.number().int().min(15).max(180),
    votingSec: z.number().int().min(10).max(120),
    killCooldownSec: z.number().int().min(10).max(60),
    tasksPerCrew: z.number().int().min(3).max(8),
    /** Hard per-game LLM spend cap (USD). 0 disables AI LLM calls (autopilot). */
    costCapUsd: z.number().min(0).max(20),
    /** Host toggle: show the ejected player's role in the result banner. */
    revealEjectedRole: z.boolean(),
    /** Persona aggression dial passed to AI seats (0 calm .. 1 feral). */
    aiAggression: z.number().min(0).max(1),
});
/** Host-editable subset — everything is editable in the lobby for now. */
export const LobbySettingsPatch = LobbySettings.partial();
export const DEFAULT_SETTINGS = {
    maxPlayers: 10,
    aiSeats: 6,
    impostors: 2,
    discussionSec: 60,
    votingSec: 30,
    killCooldownSec: 25,
    tasksPerCrew: 5,
    costCapUsd: 1,
    revealEjectedRole: false,
    aiAggression: 0.5,
};
/** Impostor count that the genre convention implies for a seat count. */
export function defaultImpostors(totalSeats) {
    return totalSeats <= 7 ? 1 : 2;
}
/**
 * Keep AI seats from crowding out humans: total seats is the roster size, AI
 * seats fill whatever humans don't take (resolved at game start).
 */
export function clampSettings(patch, current) {
    const next = { ...current, ...patch };
    next.aiSeats = Math.min(next.aiSeats, next.maxPlayers - 1);
    next.impostors = Math.min(next.impostors, Math.max(1, Math.floor(next.maxPlayers / 3)));
    if (next.impostors > next.maxPlayers - 3)
        next.impostors = Math.max(1, next.maxPlayers - 3);
    return LobbySettings.parse(next);
}
//# sourceMappingURL=settings.js.map