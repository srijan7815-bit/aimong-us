/**
 * Lobby / match settings. Defaults come from config/game.defaults.json; this
 * module is the typed, validated mirror the client and server both use.
 *
 * M3.5 makes every knob in the scope host-editable. Ranges are narrow on
 * purpose: a host can break the *feel* of a round, not the rules of it (the
 * server still owns ranges, speeds and win checks).
 */
import { z } from 'zod';
import { MAX_AI_SEATS, MAX_PLAYERS, MIN_PLAYERS } from './colors.js';
import type { TaskPlan } from './game/rules.js';

export const TASK_BAR_MODES = ['always', 'meetings', 'never'] as const;
export type TaskBarMode = (typeof TASK_BAR_MODES)[number];

export const MAP_IDS = ['halcyon9'] as const;
export type MapId = (typeof MAP_IDS)[number];

export const LobbySettings = z.object({
  /** Total seats including AI seats. */
  maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS),
  /** AI seats the host wants filled at game start. */
  aiSeats: z.number().int().min(0).max(MAX_AI_SEATS),
  impostors: z.number().int().min(1).max(3),

  // --- timers ---
  discussionSec: z.number().int().min(15).max(180),
  votingSec: z.number().int().min(10).max(120),
  killCooldownSec: z.number().int().min(10).max(60),
  /** Kill cooldown served before anyone can kill at the start of a round. */
  initialKillCooldownSec: z.number().int().min(0).max(30),
  /** Emergency meetings each player gets, and how long the button rests after one. */
  emergencyMeetings: z.number().int().min(0).max(3),
  emergencyCooldownSec: z.number().int().min(0).max(120),

  // --- movement and vision ---
  playerSpeed: z.number().min(0.5).max(2),
  crewVisionTiles: z.number().min(1).max(12),
  impostorVisionTiles: z.number().min(1).max(12),
  killRange: z.number().min(0.5).max(4),

  // --- tasks ---
  taskShort: z.number().int().min(0).max(5),
  taskLong: z.number().int().min(0).max(4),
  taskCommon: z.number().int().min(0).max(3),
  taskVisual: z.number().int().min(0).max(3),
  /** Keep `tasksPerCrew` as the headline number the lobby shows. */
  tasksPerCrew: z.number().int().min(3).max(12),
  taskBarMode: z.enum(TASK_BAR_MODES),
  visualTasks: z.boolean(),

  // --- meeting rules ---
  anonymousVotes: z.boolean(),
  /** Show crew/impostor after an ejection (weaker than the full role reveal). */
  confirmEjects: z.boolean(),
  ghostChat: z.boolean(),
  chatDuringLightsOut: z.boolean(),

  // --- role chances ---
  engineerChance: z.number().min(0).max(1),
  scientistChance: z.number().min(0).max(1),
  guardianChance: z.number().min(0).max(1),
  shapeshifterChance: z.number().min(0).max(1),

  // --- map ---
  mapId: z.enum(MAP_IDS),

  // --- housekeeping / AI ---
  costCapUsd: z.number().min(0).max(20),
  /** Host toggle: show the ejected player's role in the result banner. */
  revealEjectedRole: z.boolean(),
  /** Persona aggression dial passed to AI seats (0 calm .. 1 feral). */
  aiAggression: z.number().min(0).max(1),
});

export type LobbySettings = z.infer<typeof LobbySettings>;

/** Host-editable subset — everything is editable in the lobby for now. */
export const LobbySettingsPatch = LobbySettings.partial();
export type LobbySettingsPatch = z.infer<typeof LobbySettingsPatch>;

export const DEFAULT_SETTINGS: LobbySettings = {
  maxPlayers: 10,
  aiSeats: 6,
  impostors: 2,
  discussionSec: 60,
  votingSec: 30,
  killCooldownSec: 25,
  initialKillCooldownSec: 10,
  emergencyMeetings: 1,
  emergencyCooldownSec: 0,
  playerSpeed: 1,
  crewVisionTiles: 5,
  impostorVisionTiles: 7,
  killRange: 1.5,
  taskShort: 2,
  taskLong: 1,
  taskCommon: 1,
  taskVisual: 1,
  tasksPerCrew: 5,
  taskBarMode: 'always',
  visualTasks: true,
  anonymousVotes: false,
  confirmEjects: true,
  ghostChat: true,
  chatDuringLightsOut: false,
  engineerChance: 0.6,
  scientistChance: 0.4,
  guardianChance: 0.3,
  shapeshifterChance: 0.4,
  mapId: 'halcyon9',
  costCapUsd: 1,
  revealEjectedRole: false,
  aiAggression: 0.5,
};

/** The task plan the server deals from, derived from the four counters. */
export function taskPlanOf(settings: Pick<LobbySettings, 'taskShort' | 'taskLong' | 'taskCommon' | 'taskVisual'>): TaskPlan {
  return {
    short: settings.taskShort,
    long: settings.taskLong,
    common: settings.taskCommon,
    visual: settings.taskVisual,
  };
}

/** Impostor count that the genre convention implies for a seat count. */
export function defaultImpostors(totalSeats: number): number {
  return totalSeats <= 7 ? 1 : 2;
}

/**
 * Keep AI seats from crowding out humans: total seats is the roster size, AI
 * seats fill whatever humans don't take (resolved at game start).
 */
export function clampSettings(patch: LobbySettingsPatch, current: LobbySettings): LobbySettings {
  const next: LobbySettings = { ...current, ...patch };
  next.aiSeats = Math.min(next.aiSeats, next.maxPlayers - 1);
  next.impostors = Math.min(next.impostors, Math.max(1, Math.floor(next.maxPlayers / 3)));
  if (next.impostors > next.maxPlayers - 3) next.impostors = Math.max(1, next.maxPlayers - 3);
  // The headline task number follows the four counters so the lobby cannot say
  // "5 tasks" while dealing three.
  next.tasksPerCrew = Math.max(
    1,
    next.taskShort + next.taskLong + next.taskCommon + next.taskVisual,
  );
  return LobbySettings.parse(next);
}
