/**
 * Client and server must agree about walls and sight.
 *
 * The client builds its fog from `computeVisionMask` and the server answers
 * visibility questions with the same import of @aimong/shared. These tests are
 * the contract: if either side ever grows its own copy, or the generated map
 * drifts, they fail.
 */
import { describe, expect, it } from 'vitest';
import {
  TILE_SIZE,
  VISION_RADIUS_TILES,
  WORLD,
  buildGrid,
  circleHitsWall,
  computeVisionMask,
  hasLineOfSight,
  isSolid,
  spawnPosition,
  stepPlayer,
} from '@aimong/shared';
import { GRID, roomNameAt, visibilityAt } from '../src/world/station.js';

/** Signature of the station layout, so an accidental map edit shows up loudly. */
function mapSignature(): string {
  let hash = 2166136261;
  for (const row of WORLD.ascii) {
    for (let i = 0; i < row.length; i++) {
      hash ^= row.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16);
}

describe('station map is stable and shared', () => {
  it('matches the recorded layout signature', () => {
    // Regenerate intentionally (node scripts/gen-map.mjs) and update this value.
    expect(mapSignature()).toBe('8b3fb8a4');
  });

  it('server and client build the same walkability grid', () => {
    const clientGrid = buildGrid(WORLD);
    expect(Array.from(GRID.solid)).toEqual(Array.from(clientGrid.solid));
    expect(GRID.cols).toBe(WORLD.cols);
  });

  it('server visibility is exactly the shared vision function', () => {
    const eye = spawnPosition(WORLD, 3);
    const server = visibilityAt(eye.x, eye.y);
    const shared = computeVisionMask(GRID, eye.x, eye.y);
    expect(Array.from(server.tiles)).toEqual(Array.from(shared.tiles));
    expect(server.visibleCount).toBeGreaterThan(20);
    expect(server.radius).toBe(VISION_RADIUS_TILES);
  });

  it('a wall between two rooms hides one from the other, server-side', () => {
    const medbay = WORLD.rooms.find((r) => r.id === 'medbay');
    const reactor = WORLD.rooms.find((r) => r.id === 'reactor');
    expect(medbay && reactor).toBeTruthy();
    const eye = { x: (medbay!.rect.x + 3.5) * TILE_SIZE, y: (medbay!.rect.y + 3.5) * TILE_SIZE };
    const target = { x: (reactor!.rect.x + 3.5) * TILE_SIZE, y: (reactor!.rect.y + 3.5) * TILE_SIZE };
    expect(hasLineOfSight(GRID, eye.x, eye.y, target.x, target.y)).toBe(false);
    const mask = visibilityAt(eye.x, eye.y);
    const col = Math.floor(target.x / TILE_SIZE);
    const row = Math.floor(target.y / TILE_SIZE);
    const inside =
      col >= mask.fromCol && col < mask.toCol && row >= mask.fromRow && row < mask.toRow;
    if (inside) {
      expect(mask.tiles[(row - mask.fromRow) * mask.width + (col - mask.fromCol)]).toBe(0);
    }
  });

  it('names the room a player is standing in', () => {
    const galley = WORLD.rooms.find((r) => r.id === 'galley');
    expect(roomNameAt((galley!.rect.x + 2.5) * TILE_SIZE, (galley!.rect.y + 2.5) * TILE_SIZE)).toBe(
      'Galley',
    );
    expect(roomNameAt(8.5 * TILE_SIZE, 12.5 * TILE_SIZE)).toBeNull();
  });
});

describe('server movement is authoritative', () => {
  it('cannot walk through a wall however hard it tries', () => {
    let position = spawnPosition(WORLD, 0);
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 4000; i++) {
      const angle = random() * Math.PI * 2;
      const step = stepPlayer(GRID, position.x, position.y, Math.cos(angle), Math.sin(angle), 50);
      position = { x: step.x, y: step.y };
      expect(circleHitsWall(GRID, position.x, position.y)).toBe(false);
    }
  });

  it('spawns every seat on solid ground', () => {
    for (let seat = 0; seat < WORLD.spawns.length; seat++) {
      const spawn = spawnPosition(WORLD, seat);
      expect(isSolid(GRID, Math.floor(spawn.x / TILE_SIZE), Math.floor(spawn.y / TILE_SIZE))).toBe(
        false,
      );
      expect(circleHitsWall(GRID, spawn.x, spawn.y)).toBe(false);
    }
  });
});
