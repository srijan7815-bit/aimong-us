/**
 * Live room handles by code.
 *
 * Colyseus owns room instances, but the Commons (and the HTTP console) needs to
 * reach a specific room by the code a human typed. Rooms register themselves
 * here on create and leave on dispose.
 */
import type { GameRoom } from './GameRoom.js';

const byCode = new Map<string, GameRoom>();

export function registerRoom(room: GameRoom): void {
  byCode.set(room.code, room);
}

export function unregisterRoom(code: string): void {
  byCode.delete(code);
}

export function roomByCode(code: string): GameRoom | undefined {
  return byCode.get(code.toUpperCase());
}

export function liveRoomCodes(): string[] {
  return [...byCode.keys()];
}
