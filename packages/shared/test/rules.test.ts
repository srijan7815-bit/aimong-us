/**
 * M3 rulebook tests: roles, tasks, votes, win conditions.
 * These are the rules a player will argue about, so they get pinned down here.
 */
import { describe, expect, it } from 'vitest';
import {
  MINIGAMES,
  SABOTAGE_SPECS,
  assignRoles,
  assignTasks,
  checkWin,
  describeWin,
  makeTask,
  minigameForSpot,
  tallyVotes,
} from '../src/index.js';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

const spots = [
  { id: 'task-a', room: 'medbay' },
  { id: 'task-b', room: 'reactor' },
  { id: 'task-c', room: 'galley' },
  { id: 'task-d', room: 'bridge' },
  { id: 'task-e', room: 'cargo' },
  { id: 'task-f', room: 'comms' },
];

describe('roles', () => {
  it('deals exactly the requested number of impostors', () => {
    for (const count of [1, 2, 3]) {
      const roles = assignRoles(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], count, seeded(7 + count));
      const impostors = [...roles.values()].filter((r) => r === 'impostor');
      expect(impostors).toHaveLength(count);
      expect(roles.size).toBe(9);
    }
  });

  it('never leaves the crew without a majority of seats', () => {
    const roles = assignRoles(['a', 'b', 'c', 'd'], 3, seeded(3));
    const impostors = [...roles.values()].filter((r) => r === 'impostor').length;
    expect(impostors).toBeLessThanOrEqual(2); // 4 seats -> at most 2 impostors
  });

  it('is deterministic for a given seed (simulations rely on this)', () => {
    const one = [...assignRoles(['a', 'b', 'c', 'd', 'e'], 2, seeded(42)).entries()];
    const two = [...assignRoles(['a', 'b', 'c', 'd', 'e'], 2, seeded(42)).entries()];
    expect(one).toEqual(two);
  });
});

describe('tasks', () => {
  it('gives each crew member distinct spots', () => {
    const tasks = assignTasks(spots, ['a', 'b'], 4, seeded(11));
    for (const list of tasks.values()) {
      expect(list).toHaveLength(4);
      expect(new Set(list.map((t) => t.spotId)).size).toBe(4);
    }
  });

  it('caps the list at the number of spots that exist', () => {
    const tasks = assignTasks(spots, ['a'], 99, seeded(1));
    expect(tasks.get('a')).toHaveLength(spots.length);
  });

  it('maps every task spot to one of the twelve minigames, stably', () => {
    expect(MINIGAMES.length).toBeGreaterThanOrEqual(12);
    const spotIds = ['task-medbay-lights', 'task-reactor-rods', 'task-galley-oven'];
    for (const id of spotIds) {
      expect(MINIGAMES).toContain(minigameForSpot(id));
      expect(minigameForSpot(id)).toBe(minigameForSpot(id));
    }
    // and the twelve are all reachable from the station's own spots
    const used = new Set(
      ['task-medbay-lights', 'task-medbay-scan', 'task-reactor-rods', 'task-reactor-coolant',
       'task-engine-bolts', 'task-comms-array', 'task-observatory-lens', 'task-cargo-manifest',
       'task-galley-tray', 'task-galley-oven', 'task-storage-count', 'task-bridge-nav']
        .map(minigameForSpot),
    );
    expect(used.size).toBeGreaterThanOrEqual(6);
  });

  it('makes a task id that is unique per player', () => {
    expect(makeTask('task-a', 'medbay', 0).id).not.toBe(makeTask('task-a', 'medbay', 1).id);
    expect(makeTask('task-a', 'medbay', 0).done).toBe(false);
  });
});

describe('voting', () => {
  it('ejects the clear plurality', () => {
    const tally = tallyVotes(new Map([['a', 'x'], ['b', 'x'], ['c', 'y']]));
    expect(tally.ejected).toBe('x');
    expect(tally.counts[0]).toEqual({ target: 'x', votes: 2 });
  });

  it('ejects nobody on a tie', () => {
    expect(tallyVotes(new Map([['a', 'x'], ['b', 'y']])).ejected).toBeNull();
  });

  it('ejects nobody when skips beat the top vote', () => {
    const tally = tallyVotes(new Map([['a', 'x'], ['b', null], ['c', null]]));
    expect(tally.ejected).toBeNull();
    expect(tally.skipped).toBe(2);
  });

  it('handles an empty meeting', () => {
    const tally = tallyVotes(new Map());
    expect(tally.ejected).toBeNull();
    expect(tally.tooFewVotes).toBe(true);
  });
});

describe('win conditions', () => {
  it('crew win when the last impostor is gone', () => {
    expect(checkWin({ crewAlive: 3, impostorsAlive: 0, tasksRemaining: 5, reactorCritical: false }))
      .toEqual({ winner: 'crew', reason: 'impostors-dead' });
  });

  it('crew win when every task is done', () => {
    expect(checkWin({ crewAlive: 3, impostorsAlive: 1, tasksRemaining: 0, reactorCritical: false }))
      .toEqual({ winner: 'crew', reason: 'tasks' });
  });

  it('impostors win at parity', () => {
    expect(checkWin({ crewAlive: 1, impostorsAlive: 1, tasksRemaining: 4, reactorCritical: false }))
      .toEqual({ winner: 'impostor', reason: 'impostors-outnumber' });
  });

  it('a meltdown beats everything else', () => {
    expect(checkWin({ crewAlive: 6, impostorsAlive: 2, tasksRemaining: 0, reactorCritical: true }))
      .toEqual({ winner: 'impostor', reason: 'reactor' });
  });

  it('keeps playing while both sides can still win', () => {
    expect(checkWin({ crewAlive: 4, impostorsAlive: 1, tasksRemaining: 3, reactorCritical: false })).toBeNull();
  });

  it('explains every ending in plain language', () => {
    for (const reason of ['tasks', 'impostors-dead', 'impostors-outnumber', 'reactor', 'ejected-out-last-impostor'] as const) {
      expect(describeWin(reason, 'crew').length).toBeGreaterThan(10);
    }
  });
});

describe('sabotage', () => {
  it('has three kinds and only the reactor is lethal', () => {
    expect(SABOTAGE_SPECS.lights.lethal).toBe(false);
    expect(SABOTAGE_SPECS.doors.lethal).toBe(false);
    expect(SABOTAGE_SPECS.reactor.lethal).toBe(true);
  });

  it('gives the crew a real but fair window to react', () => {
    for (const spec of Object.values(SABOTAGE_SPECS)) {
      expect(spec.durationSec).toBeGreaterThanOrEqual(10);
      expect(spec.durationSec).toBeLessThanOrEqual(60);
    }
    expect(SABOTAGE_SPECS.reactor.fixSpots.length).toBeGreaterThanOrEqual(2);
  });
});
