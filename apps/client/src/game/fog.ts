/**
 * Fog of war (client side).
 *
 * This is a thin wrapper on purpose: the mask itself comes from
 * `computeVisionMask` in @aimong/shared, which is the exact function the server
 * runs. `apps/server/test/vision-parity.test.ts` asserts the two agree, so the
 * fog you see cannot be a client-only guess.
 */
import {
  WORLD,
  buildGrid,
  computeVisionMask,
  type Grid,
  type VisionMask,
} from '@aimong/shared';

export const grid: Grid = buildGrid(WORLD);

/** Tiles visible from a world position, in pixels. */
export function maskAt(px: number, py: number, radiusTiles?: number): VisionMask {
  return computeVisionMask(grid, px, py, radiusTiles ? { radiusTiles } : {});
}
