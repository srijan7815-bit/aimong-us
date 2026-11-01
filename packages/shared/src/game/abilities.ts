/**
 * Abilities and station tools (M3.5).
 *
 * One shape for everything a player can *do* beyond walking, killing, reporting
 * and voting: role abilities (vent, vitals, shield, shift) and station tools
 * (admin table, cameras, door log). Keeping them in one module means the server,
 * the bots and the LLM intent schema all read the same cooldown numbers.
 *
 * Nothing here decides anything on its own — `GameRoom` owns the truth and this
 * module owns the arithmetic.
 */
import type { RoleId } from './roles.js';

export const ABILITY_IDS = ['vent', 'vitals', 'shield', 'shift', 'admin', 'camera', 'doorlog'] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export interface AbilitySpec {
  id: AbilityId;
  label: string;
  /** Shown on the button; one short line. */
  hint: string;
  /** How long the effect lasts once started (0 = instant / held-open). */
  durationSec: number;
  /** Recharge after the effect ends (or after use, for instant tools). */
  cooldownSec: number;
  /** Total uses per round. 0 = unlimited (cooldown-bound). */
  usesPerRound: number;
  /** Which rooms the tool can be used from (empty = anywhere). */
  rooms?: string[];
  /** Abilities only reachable after death (the warden's shield). */
  postMortem: boolean;
  /** Blocked during a meeting. */
  blockedInMeeting: boolean;
}

export const ABILITY_SPECS: Record<AbilityId, AbilitySpec> = {
  vent: {
    id: 'vent',
    label: 'Vent',
    hint: 'Slip into the ducts.',
    durationSec: 0,
    cooldownSec: 0, // engineering uses hold/recharge; impostors are free
    usesPerRound: 0,
    postMortem: false,
    blockedInMeeting: true,
  },
  vitals: {
    id: 'vitals',
    label: 'Vitals',
    hint: 'Handheld scan of who is alive.',
    durationSec: 0,
    cooldownSec: 0,
    usesPerRound: 0,
    postMortem: false,
    blockedInMeeting: true,
  },
  shield: {
    id: 'shield',
    label: 'Ward',
    hint: 'Shield a living crewmate from one kill.',
    durationSec: 10,
    cooldownSec: 35,
    usesPerRound: 0,
    postMortem: true,
    blockedInMeeting: true,
  },
  shift: {
    id: 'shift',
    label: 'Shift',
    hint: 'Wear another crewmate\'s appearance.',
    durationSec: 10,
    cooldownSec: 25,
    usesPerRound: 0,
    postMortem: false,
    blockedInMeeting: true,
  },
  admin: {
    id: 'admin',
    label: 'Table',
    hint: 'How many people are in each room.',
    durationSec: 15,
    cooldownSec: 10,
    usesPerRound: 4,
    rooms: ['cargo', 'bridge'],
    postMortem: false,
    blockedInMeeting: true,
  },
  camera: {
    id: 'camera',
    label: 'Cameras',
    hint: 'Watch two rooms from the security desk.',
    durationSec: 15,
    cooldownSec: 10,
    usesPerRound: 4,
    rooms: ['observatory', 'comms'],
    postMortem: false,
    blockedInMeeting: true,
  },
  doorlog: {
    id: 'doorlog',
    label: 'Door log',
    hint: 'Which doors opened recently.',
    durationSec: 15,
    cooldownSec: 10,
    usesPerRound: 4,
    rooms: ['comms'],
    postMortem: false,
    blockedInMeeting: true,
  },
};

/** Which roles may use which ability. Crew tools are open to every crew role. */
export function canUse(role: RoleId, ability: AbilityId): boolean {
  switch (ability) {
    case 'vent':
      return role === 'impostor' || role === 'shapeshifter' || role === 'engineer';
    case 'vitals':
      return role === 'scientist' || role === 'crewmate' || role === 'engineer' || role === 'guardian';
    case 'shield':
      return role === 'guardian';
    case 'shift':
      return role === 'shapeshifter';
    case 'admin':
    case 'camera':
    case 'doorlog':
      return role !== 'impostor' && role !== 'shapeshifter' ? true : true; // everyone can read the station's own tools
  }
}

/**
 * Per-player ability clock. Lives in the synced state so the client can draw the
 * cooldown ring without asking the server every frame; the server re-checks it
 * on every request anyway.
 */
export interface AbilityClock {
  /** Epoch ms when the ability is usable again. */
  readyAt: number;
  /** Epoch ms when the current effect ends (0 = not active). */
  activeUntil: number;
  /** Uses left this round (0 = this ability is unlimited). */
  usesLeft: number;
}

export function freshClock(spec: AbilitySpec): AbilityClock {
  return { readyAt: 0, activeUntil: 0, usesLeft: spec.usesPerRound };
}

export type AbilityRefusal = 'cooldown' | 'no-uses' | 'busy' | 'wrong-room' | 'dead' | 'meeting' | 'not-yours';

/**
 * Can this be used right now? Returns null when it is fine, or the reason it is
 * not, so the UI can say something true instead of greying a button silently.
 */
export function checkAbility(
  spec: AbilitySpec,
  clock: AbilityClock,
  now: number,
  context: {
    role: RoleId;
    alive: boolean;
    isGhost: boolean;
    inMeeting: boolean;
    room: string;
    sameRoomAlreadyActive?: boolean;
  },
): AbilityRefusal | null {
  if (!canUse(context.role, spec.id)) return 'not-yours';
  if (spec.postMortem) {
    if (context.alive) return 'dead'; // the warden's shield is a post-mortem tool
  } else if (!context.alive || context.isGhost) {
    return 'dead';
  }
  if (spec.blockedInMeeting && context.inMeeting) return 'meeting';
  if (clock.activeUntil > now) return 'busy';
  if (clock.readyAt > now) return 'cooldown';
  if (spec.usesPerRound > 0 && clock.usesLeft <= 0) return 'no-uses';
  if (spec.rooms && spec.rooms.length > 0 && !spec.rooms.includes(context.room)) return 'wrong-room';
  return null;
}

/** Human sentence for a refusal, used in the toast and in the bots' logs. */
export function refusalText(reason: AbilityRefusal): string {
  switch (reason) {
    case 'cooldown':
      return 'Recharging.';
    case 'no-uses':
      return 'No uses left this round.';
    case 'busy':
      return 'Already running.';
    case 'wrong-room':
      return 'You are not at that console.';
    case 'dead':
      return 'Not while you are a ghost.';
    case 'meeting':
      return 'Not during a meeting.';
    case 'not-yours':
      return 'Your role cannot do that.';
  }
}
