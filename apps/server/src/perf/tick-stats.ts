/**
 * Tick timing, for the M2 budget ("server tick p95 under 10 ms with 10 players").
 *
 * A fixed ring of recent durations per room; percentiles are computed on demand.
 * Bounded memory, no allocation per tick beyond the one push.
 */
const WINDOW = 1200; // ~60 s of ticks at 20 Hz

export interface TickSnapshot {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  players: number;
  hz: number;
}

export class TickStats {
  private readonly ring = new Float64Array(WINDOW);
  private cursor = 0;
  private filled = 0;
  private players = 0;
  private ticks = 0;
  private startedAt = Date.now();

  record(durationMs: number, players: number): void {
    this.ring[this.cursor] = durationMs;
    this.cursor = (this.cursor + 1) % WINDOW;
    if (this.filled < WINDOW) this.filled++;
    this.players = players;
    this.ticks++;
  }

  snapshot(): TickSnapshot {
    const values = Array.from(this.ring.slice(0, this.filled)).sort((a, b) => a - b);
    const at = (q: number): number =>
      values.length === 0 ? 0 : (values[Math.min(values.length - 1, Math.floor(q * values.length))] ?? 0);
    const elapsedSec = Math.max(0.001, (Date.now() - this.startedAt) / 1000);
    return {
      samples: values.length,
      p50: round(at(0.5)),
      p95: round(at(0.95)),
      p99: round(at(0.99)),
      max: round(values[values.length - 1] ?? 0),
      players: this.players,
      hz: round(this.ticks / elapsedSec),
    };
  }

  reset(): void {
    this.cursor = 0;
    this.filled = 0;
    this.ticks = 0;
    this.startedAt = Date.now();
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
