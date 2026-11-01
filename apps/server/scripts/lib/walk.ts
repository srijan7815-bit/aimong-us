/**
 * Scripted walking for the playthrough harnesses.
 *
 * This is the same body the M4 bots will use, so the walking bugs get fixed
 * once, here: aim a few nodes ahead down the path ("string pulling"), and when
 * the pod wedges on a corner recentre it on the nearest path node before
 * shoving sideways. Aiming at the *next* node makes a pod shuttle back and forth
 * on the spot forever, because every new path starts at the tile it just left.
 */
import { buildGrid, findPath, steerAlongPath, WORLD, type Grid } from '@aimong/shared';

export interface WalkSeat {
  name: string;
  room: any;
}

export interface WalkOptions {
  stopWithin?: number;
  timeoutMs?: number;
  grid?: Grid;
  /** Print every 20th input; set WALK_DEBUG=1 to use it from a script. */
  debug?: boolean;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Input sequence numbers are per seat and must keep rising across the whole
 * match: the server drops any packet older than the last one it saw. Restarting
 * the count in every walk made the pod stand still for the first second and a
 * half of each leg while the counter caught up.
 */
const seqBySeat = new Map<string, number>();
function nextSeq(seat: WalkSeat): number {
  const key = seat.room.sessionId ?? seat.name;
  const next = (seqBySeat.get(key) ?? 0) + 1;
  seqBySeat.set(key, next);
  return next;
}

let sharedGrid: Grid | null = null;
export function stationGrid(): Grid {
  if (!sharedGrid) sharedGrid = buildGrid(WORLD);
  return sharedGrid;
}

export async function walkTo(seat: WalkSeat, x: number, y: number, opts: WalkOptions = {}): Promise<void> {
  const grid = opts.grid ?? stationGrid();
  const stopWithin = opts.stopWithin ?? 14;
  const timeoutMs = opts.timeoutMs ?? 45000;
  const debug = opts.debug ?? process.env.WALK_DEBUG === '1';
  const started = Date.now();
  let best = Infinity;
  let improvedAt = Date.now();
  let slide = 1;
  let nudges = 0;
  let nudgeUntil = 0;
  let nudge = { x: 0, y: 0 };

  while (Date.now() - started < timeoutMs) {
    const player = seat.room.state.players.get(seat.room.sessionId);
    if (!player) break;
    const distance = Math.hypot(player.x - x, player.y - y);
    if (distance < stopWithin) {
      seat.room.send('input', { seq: nextSeq(seat), x: 0, y: 0 });
      await wait(60);
      return;
    }
    if (distance < best - 2) {
      best = distance;
      improvedAt = Date.now();
    }

    let vx = 0;
    let vy = 0;
    if (Date.now() < nudgeUntil) {
      ({ x: vx, y: vy } = nudge);
    } else {
      const steer = steerAlongPath(findPath(grid, player.x, player.y, x, y), player.x, player.y, { grid });
      if (!steer) break;
      vx = steer.x;
      vy = steer.y;
      if (Date.now() - improvedAt > 1200) {
        // Wedged: the pod is pressed into a corner and no forward direction
        // helps. Shove sideways relative to the goal (never relative to the
        // current steering, which may be zero) and keep shoving one way for a
        // few attempts so it cannot ping-pong on the spot.
        const gx = x - player.x;
        const gy = y - player.y;
        const gl = Math.hypot(gx, gy) || 1;
        nudge = { x: (-gy / gl) * slide, y: (gx / gl) * slide };
        nudgeUntil = Date.now() + 450;
        nudges++;
        if (nudges % 3 === 0) slide = -slide;
        improvedAt = Date.now();
        vx = nudge.x;
        vy = nudge.y;
      }
    }

    const sent = nextSeq(seat);
    seat.room.send('input', { seq: sent, x: vx, y: vy });
    if (debug && sent % 20 === 0) {
      console.log(
        `    [walk] ${seat.name} at ${Math.round(player.x)},${Math.round(player.y)} ` +
          `d=${Math.round(distance)} v=${vx.toFixed(2)},${vy.toFixed(2)} ` +
          `moving=${player.moving} phase=${seat.room.state.phase} alive=${player.alive}`,
      );
    }
    await wait(45);
  }
  const stuck = seat.room.state.players.get(seat.room.sessionId);
  throw new Error(
    `${seat.name} could not walk to ${Math.round(x)},${Math.round(y)} ` +
      `(stuck at ${Math.round(stuck?.x ?? 0)},${Math.round(stuck?.y ?? 0)}, closest ${Math.round(best)})`,
  );
}
