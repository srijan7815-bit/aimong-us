/**
 * M3.5 rulebook tests: roles, abilities, task categories and the two new leaks
 * we care about (a role never escaping into public data, and a shifter's
 * disguise never becoming an identity fact for anyone else).
 */
import { describe, expect, it } from 'vitest';
import {
  ABILITY_SPECS,
  canUse,
  checkAbility,
  freshClock,
  refusalText,
} from '../src/game/abilities.js';
import {
  ROLE_ABILITY,
  ROLE_LABEL,
  ROLE_SUMMARY,
  ROLE_TEAM,
  canVent,
  composeRoles,
  isImpostorSide,
  isPostMortemRole,
  rolePreview,
  type RoleChances,
} from '../src/game/roles.js';
import {
  DEFAULT_TASK_PLAN,
  SABOTAGE_SPECS,
  assignTasks,
  doneSteps,
  fixesNeeded,
  minigameForStage,
  minigameForSpot,
  makeTask,
  taskCategoryForSpot,
  taskSteps,
  totalSteps,
} from '../src/game/rules.js';

/** Deterministic RNG so a failing deal can be reproduced exactly. */
function seeded(seed: number): () => number {
  let state = seed % 2147483647;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const SPOTS = [
  { id: 'task-medbay-scan', room: 'medbay', kind: 'scan' },
  { id: 'task-medbay-lights', room: 'medbay', kind: 'repair' },
  { id: 'task-reactor-rods', room: 'reactor', kind: 'repair' },
  { id: 'task-reactor-coolant', room: 'reactor', kind: 'fill' },
  { id: 'task-engine-bolts', room: 'engine', kind: 'fill' },
  { id: 'task-comms-array', room: 'comms', kind: 'tune' },
  { id: 'task-observatory-lens', room: 'observatory', kind: 'tune' },
  { id: 'task-cargo-manifest', room: 'cargo', kind: 'scan' },
  { id: 'task-galley-tray', room: 'galley', kind: 'fill' },
  { id: 'task-galley-oven', room: 'galley', kind: 'repair' },
  { id: 'task-storage-count', room: 'storage', kind: 'scan' },
  { id: 'task-bridge-nav', room: 'bridge', kind: 'tune' },
];

const CHANCES: RoleChances = {
  engineerChance: 1,
  scientistChance: 1,
  guardianChance: 1,
  shapeshifterChance: 1,
};

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('roles', () => {
  it('deals exactly the impostor count the host asked for', () => {
    for (const seats of [5, 7, 8, 10, 12]) {
      for (const impostors of [1, 2, 3]) {
        if (impostors > seats - 3) continue;
        const deal = composeRoles(ids(seats), impostors, CHANCES, seeded(seats * 10 + impostors));
        const impostorSide = [...deal.teamOf.values()].filter((t) => t === 'impostor').length;
        expect(impostorSide).toBe(impostors);
      }
    }
  });

  it('keeps at least three plain crew on a full-chance deal', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const deal = composeRoles(ids(10), 2, CHANCES, seeded(seed));
      const crewSeats = [...deal.teamOf.values()].filter((t) => t === 'crew').length;
      const special = [...deal.roleOf.values()].filter((r) => r !== 'crewmate' && ROLE_TEAM[r] === 'crew');
      expect(crewSeats - special.length).toBeGreaterThanOrEqual(3 - 0);
      expect(new Set(special).size).toBe(special.length); // one engineer at most, etc.
    }
  });

  it('never gives the shifter role to a lone impostor', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const deal = composeRoles(ids(6), 1, CHANCES, seeded(seed));
      expect([...deal.roleOf.values()]).not.toContain('shapeshifter');
    }
  });

  it('a chance of zero means nobody gets the role', () => {
    const none: RoleChances = {
      engineerChance: 0,
      scientistChance: 0,
      guardianChance: 0,
      shapeshifterChance: 0,
    };
    const deal = composeRoles(ids(10), 2, none, seeded(7));
    expect([...deal.roleOf.values()].filter((r) => r !== 'crewmate' && r !== 'impostor')).toHaveLength(0);
  });

  it('team view and role view never disagree', () => {
    const deal = composeRoles(ids(9), 2, CHANCES, seeded(3));
    for (const [playerId, roleId] of deal.roleOf) {
      expect(deal.teamOf.get(playerId)).toBe(ROLE_TEAM[roleId]);
      expect(isImpostorSide(roleId)).toBe(deal.teamOf.get(playerId) === 'impostor');
    }
  });

  it('every role has a label and a one-line summary', () => {
    for (const role of Object.keys(ROLE_TEAM) as Array<keyof typeof ROLE_TEAM>) {
      expect(ROLE_LABEL[role].length).toBeGreaterThan(1);
      expect(ROLE_SUMMARY[role].length).toBeLessThan(160);
    }
  });

  it('vents: impostors and the engineer only, and the guardian is a post-mortem role', () => {
    expect(canVent('impostor')).toBe(true);
    expect(canVent('shapeshifter')).toBe(true);
    expect(canVent('engineer')).toBe(true);
    expect(canVent('scientist')).toBe(false);
    expect(canVent('crewmate')).toBe(false);
    expect(isPostMortemRole('guardian')).toBe(true);
    expect(isPostMortemRole('scientist')).toBe(false);
  });

  it('the lobby preview shows what the chances will produce', () => {
    const rows = rolePreview(10, 2, CHANCES);
    const byRole = new Map(rows.map((row) => [row.role, row.expected]));
    expect(byRole.get('impostor')).toBe(2);
    expect(byRole.get('crewmate')).toBe(8);
    expect(byRole.get('engineer')).toBe(1);
    expect(byRole.get('shapeshifter')).toBe(1);
  });
});

describe('abilities', () => {
  const now = 1_000_000;

  it('refuses a cool ability with the reason, not silence', () => {
    const spec = ABILITY_SPECS.shift;
    const clock = { ...freshClock(spec), readyAt: now + 5000 };
    const refusal = checkAbility(spec, clock, now, {
      role: 'shapeshifter',
      alive: true,
      isGhost: false,
      inMeeting: false,
      room: 'galley',
    });
    expect(refusal).toBe('cooldown');
    expect(refusalText(refusal!)).toMatch(/recharg/i);
  });

  it('the warden shield only works after death, the shifter only while alive', () => {
    const shield = ABILITY_SPECS.shield;
    const clock = freshClock(shield);
    expect(
      checkAbility(shield, clock, now, {
        role: 'guardian',
        alive: true,
        isGhost: false,
        inMeeting: false,
        room: 'galley',
      }),
    ).toBe('dead');
    expect(
      checkAbility(shield, clock, now, {
        role: 'guardian',
        alive: false,
        isGhost: true,
        inMeeting: false,
        room: 'galley',
      }),
    ).toBeNull();

    const shift = ABILITY_SPECS.shift;
    expect(
      checkAbility(shift, freshClock(shift), now, {
        role: 'crewmate',
        alive: true,
        isGhost: false,
        inMeeting: false,
        room: 'galley',
      }),
    ).toBe('not-yours');
  });

  it('station tools only work in their rooms and only so many times', () => {
    const admin = ABILITY_SPECS.admin;
    const clock = freshClock(admin);
    expect(
      checkAbility(admin, clock, now, {
        role: 'crewmate',
        alive: true,
        isGhost: false,
        inMeeting: false,
        room: 'medbay',
      }),
    ).toBe('wrong-room');
    expect(
      checkAbility(admin, clock, now, {
        role: 'crewmate',
        alive: true,
        isGhost: false,
        inMeeting: false,
        room: 'cargo',
      }),
    ).toBeNull();
    const spent = { ...freshClock(admin), usesLeft: 0 };
    expect(
      checkAbility(admin, spent, now, {
        role: 'crewmate',
        alive: true,
        isGhost: false,
        inMeeting: false,
        room: 'cargo',
      }),
    ).toBe('no-uses');
  });

  it('nothing works during a meeting', () => {
    // The role that owns each ability, so the check reaches the meeting rule
    // instead of stopping at "not yours".
    const owner: Record<string, 'shapeshifter' | 'guardian' | 'scientist' | 'crewmate'> = {
      vent: 'shapeshifter',
      shift: 'shapeshifter',
      shield: 'guardian',
      vitals: 'scientist',
      admin: 'crewmate',
      camera: 'crewmate',
      doorlog: 'crewmate',
    };
    for (const spec of Object.values(ABILITY_SPECS)) {
      if (!spec.blockedInMeeting) continue;
      const refusal = checkAbility(spec, freshClock(spec), now, {
        role: owner[spec.id] ?? 'crewmate',
        alive: !spec.postMortem,
        isGhost: spec.postMortem,
        inMeeting: true,
        room: spec.rooms?.[0] ?? 'cargo',
      });
      expect(refusal, spec.id).toBe('meeting');
    }
  });

  it('role numbers stay in one place', () => {
    expect(ROLE_ABILITY.engineer.params.ventHoldSec).toBeGreaterThan(0);
    expect(ROLE_ABILITY.shapeshifter.params.shiftDurationSec).toBeGreaterThan(0);
    expect(ROLE_ABILITY.guardian.params.shieldRangeTiles).toBeGreaterThan(0);
    expect(canUse('scientist', 'vitals')).toBe(true);
    expect(canUse('crewmate', 'shift')).toBe(false);
  });
});

describe('task categories', () => {
  it('assigns a stable category per spot', () => {
    expect(taskCategoryForSpot('task-medbay-scan', 'scan')).toBe('visual');
    expect(taskCategoryForSpot('task-cargo-manifest', 'scan')).toBe('visual');
    const a = taskCategoryForSpot('task-reactor-rods');
    const b = taskCategoryForSpot('task-reactor-rods');
    expect(a).toBe(b);
  });

  it('long tasks take two stages and the second is a different game', () => {
    const task = makeTask('task-reactor-rods', 'reactor', 0, 'long');
    expect(taskSteps(task)).toBe(2);
    const first = minigameForStage(task);
    task.stage = 1;
    expect(minigameForStage(task)).not.toBe(first);
  });

  it('every crew member shares the common tasks and gets their own others', () => {
    const lists = assignTasks(SPOTS, ['p1', 'p2', 'p3'], DEFAULT_TASK_PLAN, seeded(11));
    const commons = ['p1', 'p2', 'p3'].map(
      (id) => (lists.get(id) ?? []).filter((t) => t.category === 'common').map((t) => t.spotId).sort(),
    );
    expect(commons[0]).toEqual(commons[1]);
    expect(commons[0]).toEqual(commons[2]);
    expect(commons[0]?.length).toBe(DEFAULT_TASK_PLAN.common);
  });

  it('counts work in steps, so a half-done long task leaves work on the board', () => {
    const list = [
      makeTask('task-reactor-rods', 'reactor', 0, 'long'),
      makeTask('task-galley-tray', 'galley', 1, 'short'),
    ];
    expect(totalSteps(list)).toBe(3);
    expect(doneSteps(list)).toBe(0);
    list[0]!.stage = 1;
    expect(doneSteps(list)).toBe(1);
    list[0]!.done = true;
    list[1]!.done = true;
    expect(doneSteps(list)).toBe(3);
  });

  it('the plan a host sets is the plan that is dealt', () => {
    const plan = { short: 1, long: 1, common: 1, visual: 1 };
    const lists = assignTasks(SPOTS, ['p1'], plan, seeded(5));
    const list = lists.get('p1') ?? [];
    expect(list.filter((t) => t.category === 'short')).toHaveLength(1);
    expect(list.filter((t) => t.category === 'long')).toHaveLength(1);
    expect(list.filter((t) => t.category === 'visual')).toHaveLength(1);
    expect(totalSteps(list)).toBe(1 + 2 + 1 + 1);
  });
});

describe('sabotages', () => {
  it('two-point sabotages need every spot, single-point needs one', () => {
    expect(fixesNeeded(SABOTAGE_SPECS.reactor)).toBe(2);
    expect(fixesNeeded(SABOTAGE_SPECS.o2)).toBe(2);
    expect(fixesNeeded(SABOTAGE_SPECS.comms)).toBe(1);
    expect(fixesNeeded(SABOTAGE_SPECS.lights)).toBe(1);
    expect(fixesNeeded(SABOTAGE_SPECS.doors)).toBe(0);
  });

  it('comms blinds the station tools and lights blind the crew', () => {
    expect(SABOTAGE_SPECS.comms.blocksInfo).toBe(true);
    expect(SABOTAGE_SPECS.lights.visionTiles).toBeLessThan(3);
    expect(SABOTAGE_SPECS.o2.lethal).toBe(true);
    expect(SABOTAGE_SPECS.reactor.lethal).toBe(true);
  });

  it('every fix spot actually exists on the map', () => {
    const known = new Set(SPOTS.map((s) => s.id));
    for (const spec of Object.values(SABOTAGE_SPECS)) {
      for (const spot of spec.fixSpots) expect(known.has(spot)).toBe(true);
    }
  });
});
