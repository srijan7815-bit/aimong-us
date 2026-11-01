/**
 * Roles and abilities (M3.5).
 *
 * Mechanics only: every role here is described by *what it does*, in our own
 * words and with our own numbers. Nothing in this file is copied from another
 * game's text, art or names — the ids and labels are original ("Watcher",
 * "Shifter", "Warden", "Tuner", "Patch").
 *
 * `team` is what the win conditions care about. `roleId` is what the player is
 * told, what the AI observation builder is allowed to leak, and what the prompt
 * picks its one-paragraph rules summary from.
 */
import type { AbilityId } from './abilities.js';

/** Which side a role wins with. Guardians start on the crew side. */
export type Team = 'crew' | 'impostor';

export const ROLE_IDS = [
  'crewmate',
  'impostor',
  'engineer',
  'scientist',
  'guardian',
  'shapeshifter',
] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ROLE_TEAM: Record<RoleId, Team> = {
  crewmate: 'crew',
  impostor: 'impostor',
  engineer: 'crew',
  scientist: 'crew',
  guardian: 'crew',
  shapeshifter: 'impostor',
};

/** One short line, safe to show in the UI and cheap to put in a prompt. */
export const ROLE_LABEL: Record<RoleId, string> = {
  crewmate: 'Crew',
  impostor: 'Impostor',
  engineer: 'Patch', // can slip through vents, briefly
  scientist: 'Watcher', // portable vitals with a battery
  guardian: 'Warden', // after death: shield a living crewmate
  shapeshifter: 'Shifter', // impostor who wears someone else's face
};

/**
 * Compact rules summary per role. Deliberately one or two sentences: the LLM
 * prompts concatenate these for every seat, so anything longer is paid for on
 * every single request (see DECISIONS: prompt budget).
 */
export const ROLE_SUMMARY: Record<RoleId, string> = {
  crewmate: 'Finish your tasks. Report bodies. Vote out the impostors before they outnumber you.',
  impostor: 'Kill crew, sabotage the station, and lie convincingly. Never kill your own side. Do not admit anything.',
  engineer: 'Crew. You may slip through vents for a few seconds at a time, then wait for the vent to recharge.',
  scientist: 'Crew. Your handheld vitals shows who is alive — but the battery drains and takes a while to come back.',
  guardian: 'Crew. Once you are dead you become a warden: shield one living crewmate from a kill for a few seconds.',
  shapeshifter: 'Impostor. You can wear another crewmate\'s appearance for a few seconds. Everyone sees you shift.',
};

export interface RoleAbilitySpec {
  /** Which ability button this role gets (undefined for plain crew/impostor). */
  ability?: AbilityId;
  /** Extra numbers the UI, the server and the bots all read from one place. */
  params: Record<string, number>;
}

/**
 * The numbers. All of these are also host-tweakable where it makes sense; these
 * are the defaults the balance sim starts from.
 */
export const ROLE_ABILITY: Record<RoleId, RoleAbilitySpec> = {
  crewmate: { params: {} },
  impostor: { params: {} },
  engineer: { ability: 'vent', params: { ventHoldSec: 10, ventRechargeSec: 30 } },
  scientist: { ability: 'vitals', params: { vitalsBatterySec: 10, vitalsRechargeSec: 15 } },
  guardian: {
    ability: 'shield',
    params: { shieldDurationSec: 10, shieldCooldownSec: 35, shieldRangeTiles: 3 },
  },
  shapeshifter: {
    ability: 'shift',
    params: { shiftDurationSec: 10, shiftCooldownSec: 25, shiftWindupMs: 900 },
  },
};

/** Who can use vents. The engineer is time-limited; the impostor is not. */
export function canVent(role: RoleId): boolean {
  return role === 'impostor' || role === 'shapeshifter' || role === 'engineer';
}

/** Roles that become useful only after death. */
export function isPostMortemRole(role: RoleId): boolean {
  return role === 'guardian';
}

/** Does this role count as an impostor for parity / win checks? */
export function isImpostorSide(role: RoleId): boolean {
  return ROLE_TEAM[role] === 'impostor';
}

// ------------------------------------------------------------ role deal

export interface RoleChances {
  engineerChance: number;
  scientistChance: number;
  guardianChance: number;
  shapeshifterChance: number;
}

export interface RoleDeal {
  /** Seats that get each role id. */
  byRole: Map<RoleId, string[]>;
  /** Flat map for fast lookup. */
  roleOf: Map<string, RoleId>;
  teamOf: Map<string, Team>;
}

/**
 * Deal a full role set.
 *
 * Order of operations (documented in DECISIONS so the host-side preview can
 * explain itself):
 *   1. impostor seats come from the host's impostor count;
 *   2. a shapeshifter chance can convert ONE impostor seat into a shifter;
 *   3. engineer / scientist / guardian are drawn from the remaining crew, one
 *      seat each at most, only if the chance rolls pass and at least 3 crew are
 *      left without one.
 *
 * Deterministic for a seeded `random`, so the sim harness and tests reproduce.
 */
export function composeRoles(
  playerIds: string[],
  impostorCount: number,
  chances: RoleChances,
  random: () => number,
): RoleDeal {
  const pool = [...playerIds];
  const roleOf = new Map<string, RoleId>();
  for (const id of pool) roleOf.set(id, 'crewmate');

  const wanted = Math.max(1, Math.min(impostorCount, Math.max(1, pool.length - 2)));
  const impostorSeats: string[] = [];
  for (let i = 0; i < wanted; i++) {
    const index = Math.floor(random() * pool.length);
    const [picked] = pool.splice(index, 1);
    if (picked) {
      impostorSeats.push(picked);
      roleOf.set(picked, 'impostor');
    }
  }

  // One shifter at most, and only if there is a second impostor to keep the
  // team's numbers honest — a lone shifter would be the whole impostor team.
  if (impostorSeats.length > 1 && random() < chances.shapeshifterChance) {
    const index = Math.floor(random() * impostorSeats.length);
    const seat = impostorSeats[index];
    if (seat) roleOf.set(seat, 'shapeshifter');
  }

  const crewSeats = playerIds.filter((id) => roleOf.get(id) === 'crewmate');
  const uniqueCrewRoles: Array<[RoleId, number]> = [
    ['engineer', chances.engineerChance],
    ['scientist', chances.scientistChance],
    ['guardian', chances.guardianChance],
  ];
  // Shuffle so a high chance on one role does not always beat the others to the
  // last seat.
  const order = uniqueCrewRoles
    .map((entry) => ({ entry, rank: random() }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.entry);

  const remaining = [...crewSeats];
  for (const [role, chance] of order) {
    if (remaining.length <= 2) break; // never leave the crew with fewer than 3 plain crew
    if (random() >= chance) continue;
    const index = Math.floor(random() * remaining.length);
    const [seat] = remaining.splice(index, 1);
    if (seat) roleOf.set(seat, role);
  }

  const byRole = new Map<RoleId, string[]>();
  for (const [id, role] of roleOf) {
    const list = byRole.get(role) ?? [];
    list.push(id);
    byRole.set(role, list);
  }
  const teamOf = new Map<string, Team>();
  for (const [id, role] of roleOf) teamOf.set(id, ROLE_TEAM[role]);

  return { byRole, roleOf, teamOf };
}

/**
 * How many of each role a seat count "should" get. Used by the lobby preview so
 * the host can see what their chances will produce before launching.
 */
export function rolePreview(
  seatCount: number,
  impostorCount: number,
  chances: RoleChances,
): Array<{ role: RoleId; expected: number; label: string }> {
  const crew = Math.max(0, seatCount - impostorCount);
  const rows: Array<{ role: RoleId; expected: number; label: string }> = [
    { role: 'impostor', expected: impostorCount, label: ROLE_LABEL.impostor },
    { role: 'crewmate', expected: crew, label: ROLE_LABEL.crewmate },
  ];
  const maybe = (role: RoleId, chance: number): void => {
    if (crew > 3 && impostorCount > 1 && role === 'shapeshifter') {
      rows.push({ role, expected: chance, label: ROLE_LABEL[role] });
      return;
    }
    if (crew > 3) rows.push({ role, expected: chance, label: ROLE_LABEL[role] });
  };
  // Shapeshifters come out of the impostor pool, not the crew pool.
  if (impostorCount > 1) {
    rows.push({ role: 'shapeshifter', expected: chances.shapeshifterChance, label: ROLE_LABEL.shapeshifter });
  }
  maybe('engineer', chances.engineerChance);
  maybe('scientist', chances.scientistChance);
  maybe('guardian', chances.guardianChance);
  return rows;
}
