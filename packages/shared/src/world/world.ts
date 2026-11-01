/**
 * Runtime helpers over the generated map: grid lookups, collision, room lookup.
 * Everything here is pure and allocation-light — the server calls it 20 times a
 * second for every player.
 */
import { PLAYER_RADIUS, TILE_SIZE, WALK_SPEED } from './types.js';
import type { RoomDef, WorldMap } from './types.js';

export interface Grid {
  cols: number;
  rows: number;
  /** 1 = solid (blocks movement and sight), 0 = open. */
  solid: Uint8Array;
  map: WorldMap;
}

export function buildGrid(map: WorldMap, options: { doorsClosed?: boolean } = {}): Grid {
  const solid = new Uint8Array(map.cols * map.rows);
  for (let y = 0; y < map.rows; y++) {
    const row = map.ascii[y] ?? '';
    for (let x = 0; x < map.cols; x++) {
      const ch = row[x] ?? '#';
      solid[y * map.cols + x] = ch === '#' || ch === ' ' ? 1 : 0;
    }
  }
  // Closed doors are just temporary walls — same collision code, no special cases
  // in movement or vision.
  if (options.doorsClosed) {
    for (const door of map.doors) {
      const { x, y, w, h } = door.rect;
      for (let row = y; row < y + h; row++) {
        for (let col = x; col < x + w; col++) {
          if (col >= 0 && row >= 0 && col < map.cols && row < map.rows) solid[row * map.cols + col] = 1;
        }
      }
    }
  }
  return { cols: map.cols, rows: map.rows, solid, map };
}

/** A grid where nothing blocks movement — used by ghosts. */
export function openGrid(map: WorldMap): Grid {
  return { cols: map.cols, rows: map.rows, solid: new Uint8Array(map.cols * map.rows), map };
}

/** Is a position inside a door tile? (client uses it to draw doors) */
export function doorAt(map: WorldMap, col: number, row: number): string | null {
  for (const door of map.doors) {
    const { x, y, w, h } = door.rect;
    if (col >= x && col < x + w && row >= y && row < y + h) return door.id;
  }
  return null;
}

export function isSolid(grid: Grid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return true;
  return grid.solid[row * grid.cols + col] === 1;
}

export function isWalkable(grid: Grid, col: number, row: number): boolean {
  return !isSolid(grid, col, row);
}

/** Tile column/row for a pixel position. */
export function tileAt(grid: Grid, px: number, py: number): { x: number; y: number } {
  return { x: Math.floor(px / TILE_SIZE), y: Math.floor(py / TILE_SIZE) };
}

/** Pixel centre of a tile. */
export function tileCentre(tile: { x: number; y: number }): { x: number; y: number } {
  return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
}

/** Pixel centre of a spawn point, by seat index. */
export function spawnPosition(map: WorldMap, index: number): { x: number; y: number } {
  const spawn = map.spawns[index % map.spawns.length] ?? map.spawns[0];
  if (!spawn) throw new Error('map has no spawn points');
  return tileCentre(spawn.tile);
}

/** True if a circle at (px,py) with radius r overlaps any solid tile. */
export function circleHitsWall(
  grid: Grid,
  px: number,
  py: number,
  radius = PLAYER_RADIUS,
): boolean {
  const minX = Math.floor((px - radius) / TILE_SIZE);
  const maxX = Math.floor((px + radius) / TILE_SIZE);
  const minY = Math.floor((py - radius) / TILE_SIZE);
  const maxY = Math.floor((py + radius) / TILE_SIZE);
  for (let row = minY; row <= maxY; row++) {
    for (let col = minX; col <= maxX; col++) {
      if (!isSolid(grid, col, row)) continue;
      // closest point on the tile box to the circle centre
      const left = col * TILE_SIZE;
      const top = row * TILE_SIZE;
      const nearestX = Math.max(left, Math.min(px, left + TILE_SIZE));
      const nearestY = Math.max(top, Math.min(py, top + TILE_SIZE));
      const dx = px - nearestX;
      const dy = py - nearestY;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
  }
  return false;
}

/**
 * Move a circle by (dx,dy), sliding along walls instead of sticking to them.
 * X and Y are resolved separately, which is what makes wall-hugging feel smooth.
 * The returned position is never inside a wall.
 */
export function resolveMove(
  grid: Grid,
  px: number,
  py: number,
  dx: number,
  dy: number,
  radius = PLAYER_RADIUS,
): { x: number; y: number; blockedX: boolean; blockedY: boolean } {
  let x = px;
  let y = py;
  let blockedX = false;
  let blockedY = false;

  if (dx !== 0) {
    const nx = x + dx;
    if (!circleHitsWall(grid, nx, y, radius)) x = nx;
    else blockedX = true;
  }
  if (dy !== 0) {
    const ny = y + dy;
    if (!circleHitsWall(grid, x, ny, radius)) y = ny;
    else blockedY = true;
  }
  return { x, y, blockedX, blockedY };
}

/**
 * One movement step for a player given an input direction and a duration in ms.
 * Shared by the server (authoritative) and the client (prediction), so a
 * predicted position can be compared with the server's correction directly.
 */
export function stepPlayer(
  grid: Grid,
  px: number,
  py: number,
  inputX: number,
  inputY: number,
  dtMs: number,
  speed = WALK_SPEED,
): { x: number; y: number; moving: boolean; dirX: number; dirY: number } {
  const len = Math.hypot(inputX, inputY);
  if (len < 0.001) return { x: px, y: py, moving: false, dirX: 0, dirY: 0 };
  // Analog magnitude is allowed below 1 (joystick), clamped above.
  const nx = inputX / Math.max(1, len);
  const ny = inputY / Math.max(1, len);
  const distance = speed * (dtMs / 1000) * Math.min(1, len);
  const resolved = resolveMove(grid, px, py, nx * distance, ny * distance);
  return { x: resolved.x, y: resolved.y, moving: true, dirX: nx, dirY: ny };
}

/** Which room contains a pixel position (null when in a corridor). */
export function roomAt(map: WorldMap, px: number, py: number): RoomDef | null {
  const col = px / TILE_SIZE;
  const row = py / TILE_SIZE;
  for (const room of map.rooms) {
    const { x, y, w, h } = room.rect;
    if (col >= x && col < x + w && row >= y && row < y + h) return room;
  }
  return null;
}
