/**
 * M2 tests: the map, movement and vision.
 *
 * The vision tests matter most: the same `computeVisionMask` is what the client
 * draws and what the server (and later the AI observation builder) trusts, so a
 * bug here is a wallhack or a blind spot for everyone.
 */
import { describe, expect, it } from 'vitest';
import {
  TILE_SIZE,
  VISION_RADIUS_TILES,
  WORLD,
  buildGrid,
  canSeePoint,
  circleHitsWall,
  computeVisionMask,
  hasLineOfSight,
  hasLineOfSightReference,
  isSolid,
  maskHas,
  roomAt,
  spawnPosition,
  stepPlayer,
  tileCentre,
  WALK_SPEED,
} from '../src/index.js';

const grid = buildGrid(WORLD);

/** A tiny hand-built map, so LOS tests state their geometry explicitly. */
function miniGrid(rows: string[]) {
  return buildGrid({
    station: 'test',
    tileSize: TILE_SIZE,
    cols: rows[0].length,
    rows: rows.length,
    ascii: rows,
    rooms: [],
    roomGraph: [],
    vents: [],
    taskSpots: [],
    spawns: [{ id: 'spawn-0', tile: { x: 1, y: 1 } }],
  });
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('station map', () => {
  it('has ten named rooms and a connected room graph with at least two loops', () => {
    expect(WORLD.rooms).toHaveLength(10);
    expect(new Set(WORLD.rooms.map((r) => r.name)).size).toBe(10);

    const nodes = WORLD.roomGraph.map((n) => n.id);
    expect(nodes.sort()).toEqual(WORLD.rooms.map((r) => r.id).sort());
    const edges = WORLD.roomGraph.reduce((sum, n) => sum + n.links.length, 0) / 2;
    // Euler: cycles = E - V + 1 for a single connected component.
    expect(edges - nodes.length + 1).toBeGreaterThanOrEqual(2);

    // and it really is one component
    const seen = new Set<string>([nodes[0]]);
    const stack = [nodes[0]];
    const adj = new Map(WORLD.roomGraph.map((n) => [n.id, n.links]));
    while (stack.length) {
      const id = stack.pop() as string;
      for (const next of adj.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    expect(seen.size).toBe(nodes.length);
  });

  it('has reciprocal vent pairs, and every point of interest stands on floor', () => {
    for (const vent of WORLD.vents) {
      for (const link of vent.links) {
        const other = WORLD.vents.find((v) => v.id === link);
        expect(other, `${vent.id} -> ${link}`).toBeTruthy();
        expect(other?.links).toContain(vent.id);
      }
      expect(isSolid(grid, vent.tile.x, vent.tile.y), vent.id).toBe(false);
    }
    for (const task of WORLD.taskSpots) expect(isSolid(grid, task.tile.x, task.tile.y), task.id).toBe(false);
    for (const spawn of WORLD.spawns) expect(isSolid(grid, spawn.tile.x, spawn.tile.y), spawn.id).toBe(false);
    expect(WORLD.spawns.length).toBeGreaterThanOrEqual(10);
  });

  it('every room is reachable from the first spawn walking only through floor', () => {
    const start = WORLD.spawns[0].tile;
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [[start.x, start.y]];
    while (queue.length) {
      const [x, y] = queue.shift() as [number, number];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (!seen.has(key) && !isSolid(grid, nx, ny)) {
          seen.add(key);
          queue.push([nx, ny]);
        }
      }
    }
    for (const room of WORLD.rooms) {
      const centre = tileCentre({
        x: Math.floor(room.rect.x + room.rect.w / 2),
        y: Math.floor(room.rect.y + room.rect.h / 2),
      });
      const tile = { x: Math.floor(centre.x / TILE_SIZE), y: Math.floor(centre.y / TILE_SIZE) };
      expect(seen.has(`${tile.x},${tile.y}`), `${room.id} centre reachable`).toBe(true);
    }
  });

  it('names the room a position is standing in', () => {
    const galley = WORLD.rooms.find((r) => r.id === 'galley');
    expect(galley).toBeTruthy();
    const inside = tileCentre({ x: galley!.rect.x + 2, y: galley!.rect.y + 2 });
    expect(roomAt(WORLD, inside.x, inside.y)?.id).toBe('galley');
    // corridors belong to no room
    const corridor = tileCentre({ x: 8, y: 12 });
    expect(roomAt(WORLD, corridor.x, corridor.y)).toBeNull();
  });
});

describe('movement + collision', () => {
  it('walks at the advertised speed on open floor', () => {
    const start = spawnPosition(WORLD, 0);
    let pos = start;
    for (let i = 0; i < 20; i++) pos = stepPlayer(grid, pos.x, pos.y, 1, 0, 50); // 1 second total
    expect(pos.x - start.x).toBeCloseTo(WALK_SPEED, 0);
  });

  it('slides along a wall instead of sticking to it', () => {
    // south wall of the bridge: push down-right into the corner
    const start = tileCentre({ x: 24, y: 10 });
    let pos = { x: start.x, y: start.y };
    const before = pos.x;
    for (let i = 0; i < 40; i++) pos = stepPlayer(grid, pos.x, pos.y, 1, 1, 50);
    expect(pos.x).toBeGreaterThan(before); // kept moving sideways
    expect(circleHitsWall(grid, pos.x, pos.y)).toBe(false);
  });

  it('never ends up inside a wall, even after 5000 random steps', () => {
    const rand = mulberry(1234);
    let pos = spawnPosition(WORLD, 4);
    for (let i = 0; i < 5000; i++) {
      const angle = rand() * Math.PI * 2;
      const step = stepPlayer(grid, pos.x, pos.y, Math.cos(angle), Math.sin(angle), 50);
      pos = { x: step.x, y: step.y };
      if (circleHitsWall(grid, pos.x, pos.y)) {
        throw new Error(`walked into a wall at ${pos.x.toFixed(1)},${pos.y.toFixed(1)}`);
      }
    }
  });

  it('a stationary player does not drift', () => {
    const start = spawnPosition(WORLD, 1);
    const still = stepPlayer(grid, start.x, start.y, 0, 0, 50);
    expect(still.x).toBe(start.x);
    expect(still.y).toBe(start.y);
    expect(still.moving).toBe(false);
  });
});

describe('vision', () => {
  it('sees its own room but not across the station', () => {
    const medbay = WORLD.rooms.find((r) => r.id === 'medbay')!;
    const reactor = WORLD.rooms.find((r) => r.id === 'reactor')!;
    const eye = tileCentre({ x: medbay.rect.x + 3, y: medbay.rect.y + 3 });
    const sameRoom = tileCentre({ x: medbay.rect.x + 8, y: medbay.rect.y + 3 });
    // Medbay sits above Reactor with a solid wall between them (the only doorway
    // between those two rooms is three columns to the east).
    const farRoom = tileCentre({ x: reactor.rect.x + 3, y: reactor.rect.y + 3 });
    expect(hasLineOfSight(grid, eye.x, eye.y, sameRoom.x, sameRoom.y)).toBe(true);
    expect(hasLineOfSight(grid, eye.x, eye.y, farRoom.x, farRoom.y)).toBe(false);
  });

  it('wall blocks sight, doorway does not (explicit geometry)', () => {
    const m = miniGrid([
      '###########',
      '#....#....#',
      '#....#....#',
      '#.........#',
      '#....#....#',
      '#....#....#',
      '###########',
    ]);
    // straight through the wall on row 1 -> blocked
    expect(hasLineOfSight(m, 1.5 * TILE_SIZE, 1.5 * TILE_SIZE, 8.5 * TILE_SIZE, 1.5 * TILE_SIZE)).toBe(false);
    // through the gap on row 3 -> visible
    expect(hasLineOfSight(m, 1.5 * TILE_SIZE, 3.5 * TILE_SIZE, 8.5 * TILE_SIZE, 3.5 * TILE_SIZE)).toBe(true);
    // the wall tile itself is still "seen" (you can look at a wall)
    expect(hasLineOfSight(m, 1.5 * TILE_SIZE, 1.5 * TILE_SIZE, 5.5 * TILE_SIZE, 1.5 * TILE_SIZE)).toBe(true);
  });

  it('matches the brute-force reference on 300 random sight lines', () => {
    const rand = mulberry(99);
    // Only stand where a player could stand, otherwise the test is about walls
    // that nobody is ever inside.
    const floor: Array<{ x: number; y: number }> = [];
    for (let row = 1; row < WORLD.rows - 1; row++) {
      for (let col = 1; col < WORLD.cols - 1; col++) {
        if (!isSolid(grid, col, row)) floor.push(tileCentre({ x: col, y: row }));
      }
    }
    let compared = 0;
    for (let i = 0; i < 300; i++) {
      const a = floor[Math.floor(rand() * floor.length)];
      const b = floor[Math.floor(rand() * floor.length)];
      const fast = hasLineOfSight(grid, a.x, a.y, b.x, b.y);
      const slow = hasLineOfSightReference(grid, a.x, a.y, b.x, b.y);
      compared++;
      if (fast !== slow) {
        throw new Error(
          `LOS disagreement at ${a.x.toFixed(1)},${a.y.toFixed(1)} -> ${b.x.toFixed(1)},${b.y.toFixed(1)}: fast=${fast} slow=${slow}`,
        );
      }
    }
    expect(compared).toBe(300);
  });

  it('produces a mask with nothing beyond the vision radius', () => {
    const eye = spawnPosition(WORLD, 4);
    const mask = computeVisionMask(grid, eye.x, eye.y);
    expect(mask.radius).toBe(VISION_RADIUS_TILES);
    const eyeCol = Math.floor(eye.x / TILE_SIZE);
    const eyeRow = Math.floor(eye.y / TILE_SIZE);
    expect(mask.visibleCount).toBeGreaterThan(0);
    for (let row = mask.fromRow; row < mask.toRow; row++) {
      for (let col = mask.fromCol; col < mask.toCol; col++) {
        if (!maskHas(mask, col, row)) continue;
        const distance = Math.hypot(col - eyeCol, row - eyeRow);
        expect(distance).toBeLessThanOrEqual(VISION_RADIUS_TILES + 0.5);
      }
    }
  });

  it('hides tiles inside the radius that are behind a wall', () => {
    const m = miniGrid([
      '#########',
      '#...#...#',
      '#...#...#',
      '#...#...#',
      '#...#...#',
      '#########',
    ]);
    const eye = { x: 1.5 * TILE_SIZE, y: 2.5 * TILE_SIZE };
    const mask = computeVisionMask(m, eye.x, eye.y, { radiusTiles: 4 });
    expect(maskHas(mask, 1, 2)).toBe(true); // own tile
    expect(maskHas(mask, 2, 2)).toBe(true); // open floor next to us
    expect(maskHas(mask, 4, 2)).toBe(true); // the wall we are looking at
    expect(maskHas(mask, 6, 2)).toBe(false); // behind the wall
    expect(maskHas(mask, 7, 2)).toBe(false);
  });

  it('agrees with canSeePoint for every visible tile in the mask', () => {
    const eye = spawnPosition(WORLD, 6);
    const mask = computeVisionMask(grid, eye.x, eye.y);
    let checked = 0;
    for (let row = mask.fromRow; row < mask.toRow; row++) {
      for (let col = mask.fromCol; col < mask.toCol; col++) {
        const centre = tileCentre({ x: col, y: row });
        const expected = maskHas(mask, col, row);
        const actual = canSeePoint(grid, eye.x, eye.y, centre.x, centre.y);
        expect(actual).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('a fogged tile stays fogged while the player does not move', () => {
    const eye = spawnPosition(WORLD, 2);
    const first = computeVisionMask(grid, eye.x, eye.y);
    const second = computeVisionMask(grid, eye.x, eye.y);
    expect(Array.from(second.tiles)).toEqual(Array.from(first.tiles));
  });
});
