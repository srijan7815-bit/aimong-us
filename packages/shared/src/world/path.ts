/**
 * Grid pathfinding (A*, 8-way with no corner cutting).
 *
 * Needed by anything that walks to a place rather than along a line: the M3
 * playthrough script, the M4 scripted bodies, and the M5 "walk there" intent
 * executor. Lives in shared so client debug tools can draw the same path.
 */
import { TILE_SIZE } from './types.js';
import type { Grid } from './world.js';
import { isSolid } from './world.js';
import { hasLineOfSight } from './vision.js';

export interface PathNode {
  x: number;
  y: number;
}

const NEIGHBOURS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Shortest walkable path between two pixel positions, as a list of tile centres
 * ending at the destination tile. Returns null when no route exists.
 */
export function findPath(
  grid: Grid,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  maxNodes = 4000,
): PathNode[] | null {
  const startCol = Math.floor(fromX / TILE_SIZE);
  const startRow = Math.floor(fromY / TILE_SIZE);
  const goalCol = Math.floor(toX / TILE_SIZE);
  const goalRow = Math.floor(toY / TILE_SIZE);
  if (isSolid(grid, goalCol, goalRow)) return null;
  if (startCol === goalCol && startRow === goalRow) return [{ x: toX, y: toY }];

  const key = (col: number, row: number): number => row * grid.cols + col;
  const open: Array<{ col: number; row: number; g: number; f: number }> = [];
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();

  const heuristic = (col: number, row: number): number => {
    const dx = Math.abs(col - goalCol);
    const dy = Math.abs(row - goalRow);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  const startKey = key(startCol, startRow);
  gScore.set(startKey, 0);
  open.push({ col: startCol, row: startRow, g: 0, f: heuristic(startCol, startRow) });

  let visited = 0;
  while (open.length > 0 && visited < maxNodes) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift();
    if (!current) break;
    const currentKey = key(current.col, current.row);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    visited++;

    if (current.col === goalCol && current.row === goalRow) {
      const path: PathNode[] = [];
      let trace: number | undefined = currentKey;
      while (trace !== undefined) {
        const col = trace % grid.cols;
        const row = Math.floor(trace / grid.cols);
        path.push({ x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 });
        trace = cameFrom.get(trace);
      }
      path.reverse();
      // finish exactly on the requested point
      path[path.length - 1] = { x: toX, y: toY };
      return path;
    }

    for (const [dx, dy, cost] of NEIGHBOURS) {
      const col = current.col + dx;
      const row = current.row + dy;
      if (isSolid(grid, col, row)) continue;
      // No squeezing diagonally between two walls.
      if (dx !== 0 && dy !== 0 && (isSolid(grid, current.col + dx, current.row) || isSolid(grid, current.col, current.row + dy))) {
        continue;
      }
      const neighbourKey = key(col, row);
      if (closed.has(neighbourKey)) continue;
      const tentative = current.g + cost;
      const known = gScore.get(neighbourKey);
      if (known !== undefined && tentative >= known) continue;
      gScore.set(neighbourKey, tentative);
      cameFrom.set(neighbourKey, currentKey);
      open.push({ col, row, g: tentative, f: tentative + heuristic(col, row) });
    }
  }
  return null;
}

/** Next waypoint a walker should head for, dropping ones it has reached. */
export function nextWaypoint(
  path: PathNode[],
  x: number,
  y: number,
  reach = 12,
): PathNode | null {
  while (path.length > 0) {
    const head = path[0];
    if (!head) return null;
    if (Math.hypot(head.x - x, head.y - y) <= reach) {
      path.shift();
      continue;
    }
    return head;
  }
  return null;
}

export interface Steer {
  /** Unit vector to send as input this tick. */
  x: number;
  y: number;
  /** The node being aimed at (useful for debug drawing). */
  aim: PathNode;
}

/**
 * Turn a path into a single movement input.
 *
 * Aiming at the *next* tile centre makes a walker oscillate: the path starts at
 * the nearest tile, so as soon as the walker drifts past that centre the aim
 * flips back the way it came and it shuttles in place forever. Aiming a few
 * nodes ahead ("string pulling") keeps it moving along the corridor instead.
 */
export function steerAlongPath(
  path: PathNode[] | null,
  x: number,
  y: number,
  opts: { reach?: number; lookahead?: number; grid?: Grid } = {},
): Steer | null {
  if (!path || path.length === 0) return null;
  const reach = opts.reach ?? 20;
  const lookahead = opts.lookahead ?? 3;
  let index = 0;
  while (index < path.length - 1 && Math.hypot(path[index]!.x - x, path[index]!.y - y) <= reach) {
    index++;
  }
  let target = Math.min(path.length - 1, index + lookahead);
  if (opts.grid) {
    // Cut the corner away: aim at the farthest node we can actually see, so the
    // walker does not press into the wall between two corridors.
    for (let candidate = target; candidate > index; candidate--) {
      if (hasLineOfSight(opts.grid, x, y, path[candidate]!.x, path[candidate]!.y)) {
        target = candidate;
        break;
      }
    }
  }
  const aim = path[target] ?? path[path.length - 1]!;
  const dx = aim.x - x;
  const dy = aim.y - y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return { x: 0, y: 0, aim };
  return { x: dx / length, y: dy / length, aim };
}
