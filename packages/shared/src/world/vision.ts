/**
 * Vision: line of sight + fog-of-war mask.
 *
 * ONE implementation, used by three callers:
 *   • the client, to draw its fog mask,
 *   • the server, to answer "what can this player see" (M3 bodies, M5 AI minds),
 *   • the AI observation builder later on — HUMANIZE's "only know what you could
 *     perceive" rule is only enforceable if AI sight is literally the same
 *     function as human sight, not a re-implementation.
 *
 * Rule: a sight line is blocked by any solid tile it touches between the eye and
 * the target. The eye's own tile and the target tile never block — you can always
 * see the wall in front of your face. Corner touches count as blocking, which is
 * the conservative direction (you cannot peek diagonally through a wall corner)
 * and matches the brute-force reference in `hasLineOfSightReference`.
 */
import { TILE_SIZE, VISION_RADIUS_TILES } from './types.js';
import type { Grid } from './world.js';
import { isSolid } from './world.js';

export interface VisionOptions {
  /** Vision radius in tiles. */
  radiusTiles?: number;
  /** Walls block sight (default true). Set false only for debug views. */
  occlude?: boolean;
}

/**
 * Can the eye at pixel (x0,y0) see the pixel (x1,y1)? Walls block.
 * Exact grid march (Amanatides–Woo), no sampling, no allocations.
 */
export function hasLineOfSight(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  occlude = true,
): boolean {
  if (!occlude) return true;
  let col = Math.floor(x0 / TILE_SIZE);
  let row = Math.floor(y0 / TILE_SIZE);
  const startCol = col;
  const startRow = row;
  const endCol = Math.floor(x1 / TILE_SIZE);
  const endRow = Math.floor(y1 / TILE_SIZE);
  if (col === endCol && row === endRow) return true;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepCol = Math.sign(dx);
  const stepRow = Math.sign(dy);

  // Where (as t in 0..1 along the segment) the next grid lines are crossed.
  const nextColX = (col + (stepCol > 0 ? 1 : 0)) * TILE_SIZE;
  const nextRowY = (row + (stepRow > 0 ? 1 : 0)) * TILE_SIZE;
  let tMaxX = dx === 0 ? Infinity : (nextColX - x0) / dx;
  let tMaxY = dy === 0 ? Infinity : (nextRowY - y0) / dy;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(TILE_SIZE / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(TILE_SIZE / dy);

  const blocks = (c: number, r: number): boolean =>
    !(c === startCol && r === startRow) && !(c === endCol && r === endRow) && isSolid(grid, c, r);

  // Bounded so a degenerate ray can never spin forever.
  const guard = grid.cols + grid.rows + 4;
  for (let i = 0; i < guard; i++) {
    const tie = Math.abs(tMaxX - tMaxY) < 1e-9;
    if (tie) {
      // Through a corner: the line touches two side tiles and one diagonal tile.
      if (tMaxX > 1) return true;
      col += stepCol;
      row += stepRow;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      if (blocks(col, row) || blocks(col - stepCol, row) || blocks(col, row - stepRow)) return false;
    } else if (tMaxX < tMaxY) {
      if (tMaxX > 1) return true;
      col += stepCol;
      tMaxX += tDeltaX;
      if (blocks(col, row)) return false;
    } else {
      if (tMaxY > 1) return true;
      row += stepRow;
      tMaxY += tDeltaY;
      if (blocks(col, row)) return false;
    }
    if (col === endCol && row === endRow) return true;
  }
  return false;
}

export interface VisionMask {
  /** Radius used, in tiles. */
  radius: number;
  /** Eye position in pixels. */
  x: number;
  y: number;
  /** Bounding box of the tested area, in tiles (inclusive-exclusive). */
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  /** Width of the mask in tiles. */
  width: number;
  height: number;
  /** 1 = visible, 0 = hidden. Indexed as row * width + col. */
  tiles: Uint8Array;
  /** Total visible tiles (including the eye's own tile). */
  visibleCount: number;
}

/**
 * The set of tiles visible from a pixel position.
 *
 * Returns a bounding-box mask rather than a full-map one: at radius 7 that is a
 * 15x15 window, which keeps it cheap to draw, to serialise in a test, and to
 * ship to an AI observation.
 */
export function computeVisionMask(
  grid: Grid,
  px: number,
  py: number,
  options: VisionOptions = {},
): VisionMask {
  const radius = options.radiusTiles ?? VISION_RADIUS_TILES;
  const occlude = options.occlude ?? true;
  const eyeCol = Math.floor(px / TILE_SIZE);
  const eyeRow = Math.floor(py / TILE_SIZE);
  const fromCol = Math.max(0, eyeCol - radius);
  const fromRow = Math.max(0, eyeRow - radius);
  const toCol = Math.min(grid.cols, eyeCol + radius + 1);
  const toRow = Math.min(grid.rows, eyeRow + radius + 1);
  const width = toCol - fromCol;
  const height = toRow - fromRow;
  const tiles = new Uint8Array(width * height);
  let visibleCount = 0;
  const radiusSq = (radius + 0.5) * (radius + 0.5);

  for (let row = fromRow; row < toRow; row++) {
    for (let col = fromCol; col < toCol; col++) {
      const dc = col - eyeCol;
      const dr = row - eyeRow;
      if (dc * dc + dr * dr > radiusSq) continue;
      const cx = col * TILE_SIZE + TILE_SIZE / 2;
      const cy = row * TILE_SIZE + TILE_SIZE / 2;
      if (!hasLineOfSight(grid, px, py, cx, cy, occlude)) continue;
      tiles[(row - fromRow) * width + (col - fromCol)] = 1;
      visibleCount++;
    }
  }

  return {
    radius,
    x: px,
    y: py,
    fromCol,
    fromRow,
    toCol,
    toRow,
    width,
    height,
    tiles,
    visibleCount,
  };
}

/** Is a specific tile inside a previously computed mask? */
export function maskHas(mask: VisionMask, col: number, row: number): boolean {
  if (col < mask.fromCol || row < mask.fromRow || col >= mask.toCol || row >= mask.toRow) return false;
  return mask.tiles[(row - mask.fromRow) * mask.width + (col - mask.fromCol)] === 1;
}

/**
 * Can the eye see a point? Distance check + line of sight. Used for gameplay
 * questions like "was the body in view" (M3) and AI perceptions (M5).
 */
export function canSeePoint(
  grid: Grid,
  eyeX: number,
  eyeY: number,
  targetX: number,
  targetY: number,
  radiusTiles = VISION_RADIUS_TILES,
): boolean {
  const dx = targetX - eyeX;
  const dy = targetY - eyeY;
  const limit = (radiusTiles + 0.5) * TILE_SIZE;
  if (dx * dx + dy * dy > limit * limit) return false;
  return hasLineOfSight(grid, eyeX, eyeY, targetX, targetY);
}

/**
 * Convenience wrapper: distance + line of sight, with a radius override (used by
 * the server when the lights are out and vision shrinks for the crew).
 */
export function canSeeAnywhere(
  grid: Grid,
  eyeX: number,
  eyeY: number,
  targetX: number,
  targetY: number,
  radiusTiles: number = VISION_RADIUS_TILES,
): boolean {
  return canSeePoint(grid, eyeX, eyeY, targetX, targetY, radiusTiles);
}

/** Does the segment touch the closed box of this tile? (Liang–Barsky clip.) */
function segmentTouchesTile(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  col: number,
  row: number,
): boolean {
  const minX = col * TILE_SIZE;
  const minY = row * TILE_SIZE;
  const maxX = minX + TILE_SIZE;
  const maxY = minY + TILE_SIZE;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  // x slab, then y slab
  if (!clip(-dx, x0 - minX)) return false;
  if (!clip(dx, maxX - x0)) return false;
  if (!clip(-dy, y0 - minY)) return false;
  if (!clip(dy, maxY - y0)) return false;
  return t0 <= t1;
}

/**
 * Reference implementation used by the unit tests: no DDA, no sampling — every
 * tile in the segment's bounding box is tested geometrically for intersection
 * with the sight line. Deliberately slow and dumb, so a disagreement means the
 * fast path is wrong.
 */
export function hasLineOfSightReference(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const startCol = Math.floor(x0 / TILE_SIZE);
  const startRow = Math.floor(y0 / TILE_SIZE);
  const endCol = Math.floor(x1 / TILE_SIZE);
  const endRow = Math.floor(y1 / TILE_SIZE);
  const minCol = Math.max(0, Math.min(startCol, endCol) - 1);
  const maxCol = Math.min(grid.cols - 1, Math.max(startCol, endCol) + 1);
  const minRow = Math.max(0, Math.min(startRow, endRow) - 1);
  const maxRow = Math.min(grid.rows - 1, Math.max(startRow, endRow) + 1);

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (col === startCol && row === startRow) continue;
      if (col === endCol && row === endRow) continue;
      if (!isSolid(grid, col, row)) continue;
      if (segmentTouchesTile(x0, y0, x1, y1, col, row)) return false;
    }
  }
  return true;
}
