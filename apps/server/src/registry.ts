/**
 * code -> roomId registry.
 *
 * Game state is in memory on a single Render instance (PLAN §4), so a plain Map
 * is the whole "database". It exists because Colyseus matchmaking addresses
 * rooms by their generated roomId, while humans address rooms by a 5-letter
 * code they can shout across a room.
 */
import { generateCode, normalizeCode } from '@aimong/shared';

export interface RoomSummary {
  code: string;
  roomId: string;
  players: number;
  phase: string;
  createdAt: number;
}

export class RoomRegistry {
  private byCode = new Map<string, RoomSummary>();

  get codes(): string[] {
    return [...this.byCode.keys()];
  }

  get size(): number {
    return this.byCode.size;
  }

  allocateCode(): string {
    return generateCode(this.codes);
  }

  add(entry: RoomSummary): void {
    this.byCode.set(entry.code, entry);
  }

  get(code: string): RoomSummary | undefined {
    return this.byCode.get(normalizeCode(code));
  }

  update(code: string, patch: Partial<Omit<RoomSummary, 'code'>>): void {
    const current = this.byCode.get(code);
    if (!current) return;
    this.byCode.set(code, { ...current, ...patch });
  }

  remove(code: string): void {
    this.byCode.delete(code);
  }

  list(): RoomSummary[] {
    return [...this.byCode.values()];
  }
}

/** Process-wide singleton: the HTTP layer and the rooms both read it. */
export const registry = new RoomRegistry();
