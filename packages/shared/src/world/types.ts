/**
 * Map + movement contract shared by client and server.
 *
 * The point of this module is that there is exactly ONE definition of "where the
 * walls are", "what can I see" and "where do I end up if I walk this way". The
 * server is authoritative, but it and the client run the same functions, so the
 * client's prediction and its fog mask cannot drift from the server's truth.
 */

export const TILE_SIZE = 32;
/** Player collision radius in pixels (a pod is a circle, for now). */
export const PLAYER_RADIUS = 10;
/** Walking speed in pixels per second. */
export const WALK_SPEED = 132;
/** How far a player can see, in tiles. */
export const VISION_RADIUS_TILES = 7;
/** Server simulation rate (Hz). */
export const SIM_HZ = 20;
export const SIM_STEP_MS = 1000 / SIM_HZ;
/** Joystick deadzone (fraction of full deflection). */
export const INPUT_DEADZONE = 0.12;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomDef {
  id: string;
  name: string;
  kind: string;
  rect: Rect;
}

export interface RoomNode {
  id: string;
  links: string[];
}

export interface TilePoint {
  x: number;
  y: number;
}

export interface VentDef {
  id: string;
  room: string;
  tile: TilePoint;
  links: string[];
}

export interface TaskSpotDef {
  id: string;
  room: string;
  kind: string;
  tile: TilePoint;
}

export interface SpawnDef {
  id: string;
  tile: TilePoint;
}

export interface WorldMap {
  station: string;
  tileSize: number;
  cols: number;
  rows: number;
  /** One row per line: '.' floor, '#' wall, ' ' void. */
  ascii: string[];
  rooms: RoomDef[];
  roomGraph: RoomNode[];
  vents: VentDef[];
  taskSpots: TaskSpotDef[];
  spawns: SpawnDef[];
}
