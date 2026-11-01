/**
 * Server-side view of the station.
 *
 * The grid and every visibility answer come from `@aimong/shared`, i.e. exactly
 * the code the client runs for its fog mask. There is no second implementation
 * here on purpose: if the server and the client ever disagreed about what a
 * player could see, every game rule downstream (bodies in view, AI perceptions,
 * meeting "who was where") would be built on sand.
 */
import {
  WORLD,
  buildGrid,
  computeVisionMask,
  type Grid,
  type VisionMask,
} from '@aimong/shared';

/** Built once at boot; the map never changes during a match. */
export const GRID: Grid = buildGrid(WORLD);

/** What a player standing here can see, in tiles. */
export function visibilityAt(x: number, y: number, radiusTiles?: number): VisionMask {
  return computeVisionMask(GRID, x, y, radiusTiles ? { radiusTiles } : {});
}

/** Room name for the HUD ("Galley"), or null while in a corridor. */
export function roomNameAt(x: number, y: number): string | null {
  const col = Math.floor(x / WORLD.tileSize);
  const row = Math.floor(y / WORLD.tileSize);
  for (const room of WORLD.rooms) {
    const { x: rx, y: ry, w, h } = room.rect;
    if (col >= rx && col < rx + w && row >= ry && row < ry + h) return room.name;
  }
  return null;
}
