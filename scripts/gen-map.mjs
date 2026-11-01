#!/usr/bin/env node
/**
 * Generates the station map — original layout, no borrowed geometry.
 *
 *   node scripts/gen-map.mjs
 *
 * Two artefacts, both checked into git so the game does not depend on this
 * script at runtime:
 *
 *   apps/client/public/assets/maps/halcyon9.tmj   Tiled JSON (for artists / Tiled)
 *   packages/shared/src/world/map-data.ts         walkability grid + room graph,
 *                                                 imported by client AND server
 *
 * The blueprint below is hand-authored (rooms as rectangles, corridors as
 * rectangles) and then validated: every room reachable, at least two loops, vents
 * and task spots inside walkable tiles, spawn points not embedded in walls.
 * If validation fails the script exits non-zero and nothing is written.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TILE = 32;
const COLS = 64;
const ROWS = 44;
const STATION = 'Halcyon-9';

/** Rooms: id, display name, [x, y, w, h] in tiles. Ten rooms, four zones. */
const ROOMS = [
  { id: 'bridge', name: 'Bridge', kind: 'command', rect: [24, 3, 16, 8] },
  { id: 'medbay', name: 'Medbay', kind: 'science', rect: [3, 3, 14, 9] },
  { id: 'hydro', name: 'Hydroponics', kind: 'science', rect: [47, 3, 14, 9] },
  { id: 'reactor', name: 'Reactor', kind: 'engineering', rect: [3, 15, 14, 10] },
  { id: 'galley', name: 'Galley', kind: 'social', rect: [24, 14, 16, 11] },
  { id: 'cargo', name: 'Cargo Bay', kind: 'storage', rect: [47, 15, 14, 10] },
  { id: 'storage', name: 'Storage', kind: 'storage', rect: [24, 26, 8, 5] },
  { id: 'engine', name: 'Engine Room', kind: 'engineering', rect: [4, 32, 15, 9] },
  { id: 'comms', name: 'Comms', kind: 'science', rect: [25, 32, 13, 9] },
  { id: 'observatory', name: 'Observatory', kind: 'social', rect: [45, 31, 16, 10] },
];

/**
 * Corridors are 3 tiles wide and carves as plain rectangles, so a corridor that
 * touches two rooms opens a doorway into both. The graph is derived from these
 * with `connects`, which is what the room graph in shared/ is built from.
 */
const CORRIDORS = [
  { connects: ['medbay', 'bridge'], rect: [17, 6, 7, 3] },
  { connects: ['bridge', 'hydro'], rect: [40, 6, 7, 3] },
  { connects: ['medbay', 'reactor'], rect: [8, 12, 3, 3] },
  { connects: ['reactor', 'engine'], rect: [8, 25, 3, 7] },
  { connects: ['bridge', 'galley'], rect: [30, 11, 3, 3] },
  { connects: ['galley', 'cargo'], rect: [40, 18, 7, 3] },
  { connects: ['hydro', 'cargo'], rect: [52, 12, 3, 3] },
  { connects: ['reactor', 'galley'], rect: [17, 18, 7, 3] },
  { connects: ['galley', 'storage'], rect: [27, 25, 3, 1] },
  { connects: ['storage', 'comms'], rect: [27, 31, 3, 1] },
  { connects: ['engine', 'comms'], rect: [19, 35, 6, 3] },
  { connects: ['comms', 'observatory'], rect: [38, 35, 7, 3] },
  { connects: ['cargo', 'observatory'], rect: [52, 25, 3, 6] },
];

/** Solid blocks inside rooms: cover to hide behind, and they break line of sight. */
const PILLARS = [
  [30, 18, 2, 2],
  [34, 22, 1, 2],
  [51, 19, 2, 3],
  [56, 37, 2, 2],
  [10, 18, 2, 1],
];

/**
 * Doors: the tiles a lockdown seals. They sit in three-wide corridors, so closing
 * one actually cuts the route (used by the "doors" sabotage).
 */
const DOORS = [
  { id: 'door-medbay', rect: [8, 12, 3, 1] },
  { id: 'door-galley', rect: [27, 25, 3, 1] },
  { id: 'door-cargo', rect: [52, 12, 3, 1] },
  { id: 'door-comms', rect: [38, 35, 3, 1] },
];

/** Vents: paired teleport nodes (behaviour lands in M3). */
const VENTS = [
  { id: 'vent-medbay', room: 'medbay', at: [5, 4], links: ['vent-engine'] },
  { id: 'vent-engine', room: 'engine', at: [16, 38], links: ['vent-medbay'] },
  { id: 'vent-reactor', room: 'reactor', at: [4, 22], links: ['vent-cargo'] },
  { id: 'vent-cargo', room: 'cargo', at: [58, 16], links: ['vent-reactor'] },
  { id: 'vent-bridge', room: 'bridge', at: [37, 4], links: ['vent-observatory'] },
  { id: 'vent-observatory', room: 'observatory', at: [58, 38], links: ['vent-bridge'] },
  { id: 'vent-galley', room: 'galley', at: [25, 15], links: ['vent-comms'] },
  { id: 'vent-comms', room: 'comms', at: [35, 38], links: ['vent-galley'] },
];

/** Task spots: 12 of them; M3 wires the minigames. */
const TASKS = [
  { id: 'task-medbay-lights', room: 'medbay', kind: 'repair', at: [15, 4] },
  { id: 'task-medbay-scan', room: 'medbay', kind: 'scan', at: [4, 10] },
  { id: 'task-reactor-rods', room: 'reactor', kind: 'repair', at: [15, 16] },
  { id: 'task-reactor-coolant', room: 'reactor', kind: 'fill', at: [4, 16] },
  { id: 'task-engine-bolts', room: 'engine', kind: 'fill', at: [5, 33] },
  { id: 'task-comms-array', room: 'comms', kind: 'tune', at: [26, 33] },
  { id: 'task-observatory-lens', room: 'observatory', kind: 'tune', at: [59, 32] },
  { id: 'task-cargo-manifest', room: 'cargo', kind: 'scan', at: [48, 23] },
  { id: 'task-galley-tray', room: 'galley', kind: 'fill', at: [38, 23] },
  { id: 'task-galley-oven', room: 'galley', kind: 'repair', at: [25, 23] },
  { id: 'task-storage-count', room: 'storage', kind: 'scan', at: [30, 29] },
  { id: 'task-bridge-nav', room: 'bridge', kind: 'tune', at: [25, 4] },
];

/** Ten spawn points, one per seat, spread across the station. */
const SPAWNS = [
  [31, 7],
  [9, 7],
  [53, 7],
  [9, 19],
  [31, 16],
  [53, 19],
  [27, 28],
  [11, 36],
  [31, 36],
  [51, 34],
];

// ---------------------------------------------------------------------------
// Grid building
// ---------------------------------------------------------------------------

const WALL = '#';
const FLOOR = '.';
const VOID = ' ';

const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => WALL));
const carve = (x, y, w, h) => {
  for (let cy = y; cy < y + h; cy++) {
    for (let cx = x; cx < x + w; cx++) {
      if (cy > 0 && cy < ROWS - 1 && cx > 0 && cx < COLS - 1) grid[cy][cx] = FLOOR;
    }
  }
};

for (const room of ROOMS) carve(...room.rect);
for (const corridor of CORRIDORS) carve(...corridor.rect);
for (const [x, y, w, h] of PILLARS) {
  for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) grid[cy][cx] = WALL;
}

/** Tiles nobody can reach: leave them out of the Tiled floor layer as void. */
const insideRoom = (x, y, pad = 0) =>
  ROOMS.some((r) => {
    const [rx, ry, rw, rh] = r.rect;
    return x >= rx - pad && x < rx + rw + pad && y >= ry - pad && y < ry + rh + pad;
  });
const insideCorridor = (x, y, pad = 0) =>
  CORRIDORS.some((c) => {
    const [rx, ry, rw, rh] = c.rect;
    return x >= rx - pad && x < rx + rw + pad && y >= ry - pad && y < ry + rh + pad;
  });
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (grid[y][x] === WALL && !insideRoom(x, y, 1) && !insideCorridor(x, y, 1)) {
      grid[y][x] = VOID;
    }
  }
}

const walkable = (x, y) => y >= 0 && y < ROWS && x >= 0 && x < COLS && grid[y][x] === FLOOR;

// ---------------------------------------------------------------------------
// Validation — refuse to write a broken station
// ---------------------------------------------------------------------------

const problems = [];

// 1. every room tile is walkable and no two rooms overlap
const overlap = [];
for (let i = 0; i < ROOMS.length; i++) {
  for (let j = i + 1; j < ROOMS.length; j++) {
    const [ax, ay, aw, ah] = ROOMS[i].rect;
    const [bx, by, bw, bh] = ROOMS[j].rect;
    if (ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah) {
      overlap.push(`${ROOMS[i].id}/${ROOMS[j].id}`);
    }
  }
}
if (overlap.length) problems.push(`rooms overlap: ${overlap.join(', ')}`);

// 2. flood fill from the first spawn reaches every room and every point of interest
const reachable = new Set();
const start = SPAWNS[0];
const queue = [start];
reachable.add(`${start[0]},${start[1]}`);
while (queue.length) {
  const [x, y] = queue.shift();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    const key = `${nx},${ny}`;
    if (!reachable.has(key) && walkable(nx, ny)) {
      reachable.add(key);
      queue.push([nx, ny]);
    }
  }
}
for (const room of ROOMS) {
  const [rx, ry, rw, rh] = room.rect;
  let touched = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) if (reachable.has(`${x},${y}`)) touched++;
  }
  if (touched < rw * rh * 0.6) problems.push(`room ${room.id} is not reachable from spawn`);
}
for (const vent of VENTS) if (!reachable.has(`${vent.at[0]},${vent.at[1]}`)) problems.push(`vent ${vent.id} is inside a wall`);
for (const door of DOORS) {
  const [dx, dy, dw, dh] = door.rect;
  for (let y = dy; y < dy + dh; y++)
    for (let x = dx; x < dx + dw; x++)
      if (!walkable(x, y)) problems.push(`door ${door.id} tile ${x},${y} is not floor`);
}
for (const task of TASKS) if (!reachable.has(`${task.at[0]},${task.at[1]}`)) problems.push(`task ${task.id} is inside a wall`);
for (const spawn of SPAWNS) if (!reachable.has(`${spawn[0]},${spawn[1]}`)) problems.push(`spawn ${spawn} is inside a wall`);

// 3. room graph must have at least two independent loops
const adjacency = new Map(ROOMS.map((r) => [r.id, new Set()]));
for (const corridor of CORRIDORS) {
  const [a, b] = corridor.connects;
  adjacency.get(a).add(b);
  adjacency.get(b).add(a);
}
const edges = CORRIDORS.length;
const nodes = ROOMS.length;
// connected components
const seen = new Set();
let components = 0;
for (const room of ROOMS) {
  if (seen.has(room.id)) continue;
  components++;
  const stack = [room.id];
  seen.add(room.id);
  while (stack.length) {
    const id = stack.pop();
    for (const next of adjacency.get(id)) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  }
}
if (components !== 1) problems.push(`room graph has ${components} components`);
const loops = edges - nodes + components;
if (loops < 2) problems.push(`only ${loops} loop(s) in the room graph; need at least 2`);

// 4. vents must pair both ways
for (const vent of VENTS) {
  for (const link of vent.links) {
    const other = VENTS.find((v) => v.id === link);
    if (!other) problems.push(`vent ${vent.id} links to missing ${link}`);
    else if (!other.links.includes(vent.id)) problems.push(`vent ${link} does not link back to ${vent.id}`);
  }
}

if (problems.length) {
  console.error('MAP INVALID:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Artefact 1 — Tiled JSON
// ---------------------------------------------------------------------------

const floorData = [];
const wallData = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const cell = grid[y][x];
    floorData.push(cell === FLOOR ? 1 : 0);
    wallData.push(cell === WALL ? 2 : 0);
  }
}

const obj = (list, extra = {}) =>
  list.map((item, index) => ({
    id: index + 1,
    name: item.id,
    type: item.name ?? item.kind ?? item.room ?? item.id,
    x: item.at[0] * TILE,
    y: item.at[1] * TILE,
    width: TILE,
    height: TILE,
    point: false,
    rotation: 0,
    visible: true,
    properties: Object.entries({
      room: item.room,
      kind: item.kind,
      links: item.links?.join(','),
      ...extra,
    })
      .filter(([, v]) => v !== undefined)
      .map(([name, value]) => ({ name, type: 'string', value })),
  }));

const tiled = {
  type: 'map',
  version: '1.10',
  tiledversion: '1.10.2',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  width: COLS,
  height: ROWS,
  tilewidth: TILE,
  tileheight: TILE,
  nextlayerid: 4,
  nextobjectid: 40,
  properties: [
    { name: 'station', type: 'string', value: STATION },
    { name: 'generatedBy', type: 'string', value: 'scripts/gen-map.mjs' },
  ],
  tilesets: [
    {
      firstgid: 1,
      name: 'placeholder',
      image: '../atlas/placeholder/tiles.png',
      imagewidth: 128,
      imageheight: 32,
      tilewidth: TILE,
      tileheight: TILE,
      tilecount: 4,
      columns: 4,
      margin: 0,
      spacing: 0,
      tiles: [
        { id: 0, properties: [{ name: 'frame', type: 'string', value: 'floor' }] },
        { id: 1, properties: [{ name: 'frame', type: 'string', value: 'wall' }] },
      ],
    },
  ],
  layers: [
    {
      id: 1,
      name: 'floor',
      type: 'tilelayer',
      x: 0,
      y: 0,
      width: COLS,
      height: ROWS,
      opacity: 1,
      visible: true,
      data: floorData,
    },
    {
      id: 2,
      name: 'walls',
      type: 'tilelayer',
      x: 0,
      y: 0,
      width: COLS,
      height: ROWS,
      opacity: 1,
      visible: true,
      properties: [{ name: 'collides', type: 'bool', value: true }],
      data: wallData,
    },
    {
      id: 3,
      name: 'meta',
      type: 'objectgroup',
      opacity: 1,
      visible: true,
      objects: [
        ...ROOMS.map((room, index) => ({
          id: 100 + index,
          name: room.id,
          type: 'room',
          x: room.rect[0] * TILE,
          y: room.rect[1] * TILE,
          width: room.rect[2] * TILE,
          height: room.rect[3] * TILE,
          visible: true,
          rotation: 0,
          properties: [
            { name: 'label', type: 'string', value: room.name },
            { name: 'kind', type: 'string', value: room.kind },
          ],
        })),
        ...DOORS.map((door, index) => ({
          id: 200 + index,
          name: door.id,
          type: 'door',
          x: door.rect[0] * TILE,
          y: door.rect[1] * TILE,
          width: door.rect[2] * TILE,
          height: door.rect[3] * TILE,
          visible: true,
          rotation: 0,
          properties: [],
        })),
        ...obj(VENTS),
        ...obj(TASKS),
        ...SPAWNS.map((at, index) => ({
          id: 300 + index,
          name: `spawn-${index}`,
          type: 'spawn',
          x: at[0] * TILE,
          y: at[1] * TILE,
          width: TILE,
          height: TILE,
          visible: true,
          rotation: 0,
          properties: [],
        })),
      ],
    },
  ],
};

const mapDir = join(ROOT, 'apps/client/public/assets/maps');
mkdirSync(mapDir, { recursive: true });
writeFileSync(join(mapDir, 'halcyon9.tmj'), JSON.stringify(tiled, null, 1) + '\n');

// ---------------------------------------------------------------------------
// Artefact 2 — shared walkability grid + room graph
// ---------------------------------------------------------------------------

const ascii = grid.map((row) => row.join('')).join('\n');
const roomGraph = ROOMS.map((room) => ({
  id: room.id,
  links: CORRIDORS.filter((c) => c.connects.includes(room.id)).map((c) => c.connects.find((id) => id !== room.id)),
}));

const q = (s) => `'${s}'`;
const ts = `/**
 * GENERATED FILE — do not edit by hand.
 *   node scripts/gen-map.mjs
 *
 * The station layout: ASCII walkability grid ('.' floor, '#' wall, ' ' void),
 * the room rectangles, the room graph, vent pairs, task spots and spawn points.
 * Client and server both import this, so "what is a wall" and "which room am I
 * in" can never disagree.
 *
 * Layout is original to this project (see THIRD_PARTY.md); no geometry was taken
 * from any commercial game.
 */
import type { WorldMap } from './types.js';

export const WORLD: WorldMap = {
  station: ${q(STATION)},
  tileSize: ${TILE},
  cols: ${COLS},
  rows: ${ROWS},
  ascii: [
${grid.map((row) => `    ${q(row.join(''))},`).join('\n')}
  ],
  rooms: [
${ROOMS.map((r) => `    { id: ${q(r.id)}, name: ${q(r.name)}, kind: ${q(r.kind)}, rect: { x: ${r.rect[0]}, y: ${r.rect[1]}, w: ${r.rect[2]}, h: ${r.rect[3]} } },`).join('\n')}
  ],
  roomGraph: [
${roomGraph.map((r) => `    { id: ${q(r.id)}, links: [${r.links.map(q).join(', ')}] },`).join('\n')}
  ],
  doors: [
${DOORS.map((d) => `    { id: ${q(d.id)}, rect: { x: ${d.rect[0]}, y: ${d.rect[1]}, w: ${d.rect[2]}, h: ${d.rect[3]} } },`).join('\n')}
  ],
  vents: [
${VENTS.map((v) => `    { id: ${q(v.id)}, room: ${q(v.room)}, tile: { x: ${v.at[0]}, y: ${v.at[1]} }, links: [${v.links.map(q).join(', ')}] },`).join('\n')}
  ],
  taskSpots: [
${TASKS.map((t) => `    { id: ${q(t.id)}, room: ${q(t.room)}, kind: ${q(t.kind)}, tile: { x: ${t.at[0]}, y: ${t.at[1]} } },`).join('\n')}
  ],
  spawns: [
${SPAWNS.map((s, i) => `    { id: ${q(`spawn-${i}`)}, tile: { x: ${s[0]}, y: ${s[1]} } },`).join('\n')}
  ],
};
`;

const worldDir = join(ROOT, 'packages/shared/src/world');
mkdirSync(worldDir, { recursive: true });
writeFileSync(join(worldDir, 'map-data.ts'), ts);

const floorCount = grid.flat().filter((c) => c === FLOOR).length;
console.log(`map ok: ${COLS}x${ROWS} tiles, ${ROOMS.length} rooms, ${edges} corridors, ${loops} loops`);
console.log(`  walkable tiles ${floorCount} (${((floorCount / (COLS * ROWS)) * 100).toFixed(1)}%)`);
console.log(`  ${DOORS.length} doors, ${VENTS.length} vents, ${TASKS.length} task spots, ${SPAWNS.length} spawns`);
console.log('  wrote apps/client/public/assets/maps/halcyon9.tmj');
console.log('  wrote packages/shared/src/world/map-data.ts');
