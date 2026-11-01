/**
 * The Commons — in-memory home for the AI cluster.
 *
 * Why in memory: one Render instance, state is per-process (PLAN §4). When the
 * service sleeps, the house sleeps; on boot the residents are re-seated from
 * config/personas.json, so their identity is stable even though the process is
 * not. Cross-game memory (HUMANIZE §3) slots in here at M6 by swapping the
 * history store for a file/Uptime-backed one.
 */
import { z } from 'zod';
import { Persona } from '@aimong/shared';
import type {
  ClusterMessage,
  ClusterSnapshot,
  DispatchRequest,
  ResidentStatus,
  ResidentView,
} from '@aimong/shared';
import { readConfigJson } from '../config.js';
import { logger } from '../logger-instance.js';

const personasFile = z.object({ personas: z.array(Persona) });
const rosterFile = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      model: z.string(),
      tier: z.enum(['fast', 'smart']),
    }),
  ),
});

interface Resident {
  id: string;
  name: string;
  persona: string;
  vibe: string;
  tier: 'fast' | 'smart';
  status: ResidentStatus;
  roomCode: string | null;
}

const MAX_FEED = 120;
const OWNER_NAME = 'Owner';

export class Commons {
  private residents: Resident[] = [];
  private feed: ClusterMessage[] = [];
  private seq = 0;
  private lastDispatch: { code: string; at: number; sent: number } | null = null;
  /** Wired by index.ts once the LLM gateway exists (M5). */
  brainOnline = false;

  constructor() {
    this.seatResidents();
  }

  /** (Re)build the resident roster from config: personas are the people, models are the voices. */
  private seatResidents(): void {
    const personas = readConfigJson('personas.json', (v) => personasFile.parse(v)).personas;
    const models = readConfigJson('roster.json', (v) => rosterFile.parse(v)).models;
    const smart = models.filter((m) => m.tier === 'smart');
    const fast = models.filter((m) => m.tier === 'fast');

    // Personas are the identity; the model tier is only how good their mouth is.
    this.residents = personas.map((p, i) => ({
      id: p.id,
      name: p.handle,
      persona: p.vibe,
      vibe: p.crew,
      tier: i % 3 === 0 && smart.length > 0 ? 'smart' : fast.length > 0 ? 'fast' : 'smart',
      status: 'idle',
      roomCode: null,
    }));
    this.push({
      from: 'system',
      name: 'Commons',
      text: `${this.residents.length} residents are home. Waiting for a room code.`,
      to: [],
    });
    logger.info({ residents: this.residents.length }, 'commons seated');
  }

  private push(entry: Omit<ClusterMessage, 'id' | 'ts'> & { ts?: number }): ClusterMessage {
    const message: ClusterMessage = {
      id: `m${++this.seq}`,
      ts: entry.ts ?? Date.now(),
      from: entry.from,
      name: entry.name,
      text: entry.text,
      to: entry.to ?? [],
    };
    this.feed.push(message);
    while (this.feed.length > MAX_FEED) this.feed.shift();
    return message;
  }

  snapshot(): ClusterSnapshot {
    return {
      brainOnline: this.brainOnline,
      residents: this.residents.map(
        (r): ResidentView => ({
          id: r.id,
          name: r.name,
          persona: r.persona,
          vibe: r.vibe,
          tier: r.tier,
          status: r.status,
          roomCode: r.roomCode,
          voiceReady: this.brainOnline,
        }),
      ),
      messages: [...this.feed],
      lastDispatch: this.lastDispatch,
    };
  }

  /** Owner broadcast. Returns the message plus who it was addressed to. */
  ownerSay(text: string, to: string[] = []): { message: ClusterMessage; recipients: string[] } {
    const recipients = to.length > 0 ? to : this.residents.map((r) => r.id);
    const known = recipients.filter((id) => this.residents.some((r) => r.id === id));
    const message = this.push({
      from: 'owner',
      name: OWNER_NAME,
      text,
      to: known,
    });
    // Without an LLM provider the residents cannot answer yet; saying nothing is
    // better than faking a reply.
    if (!this.brainOnline) {
      this.push({
        from: 'system',
        name: 'Commons',
        text: 'Delivered. No voice connected yet, so nobody answers until the model keys are in (M5).',
        to: [],
      });
    }
    return { message, recipients: known };
  }

  /** Mark residents as walking into a specific room. */
  dispatch(req: DispatchRequest): { code: string; sent: string[]; skipped: string[] } {
    const code = req.code.toUpperCase();
    const wanted = typeof req.seats === 'number' ? req.seats : this.residents.length;
    const free = this.residents.filter((r) => r.status === 'idle' || r.status === 'invited');
    const chosen = free.slice(0, wanted);
    const skipped = this.residents.filter((r) => !chosen.includes(r)).map((r) => r.id);

    for (const r of chosen) {
      r.status = 'invited';
      r.roomCode = code;
    }
    this.lastDispatch = { code, at: Date.now(), sent: chosen.length };
    this.push({
      from: 'system',
      name: 'Commons',
      text: `${chosen.length} resident${chosen.length === 1 ? '' : 's'} sent to room ${code}${req.note ? ` — "${req.note}"` : ''}.`,
      to: chosen.map((r) => r.id),
    });
    if (req.note) {
      this.push({ from: 'owner', name: OWNER_NAME, text: req.note, to: chosen.map((r) => r.id) });
    }
    logger.info({ code, sent: chosen.length }, 'commons dispatched');
    return { code, sent: chosen.map((r) => r.id), skipped };
  }

  /** A room confirmed the residents took seats. */
  markJoined(code: string, residentIds: string[]): void {
    for (const r of this.residents) {
      if (residentIds.includes(r.id) && r.roomCode === code) r.status = 'in-game';
    }
  }

  /** Room closed: everyone comes home. */
  releaseRoom(code: string): void {
    let released = 0;
    for (const r of this.residents) {
      if (r.roomCode === code) {
        r.status = 'idle';
        r.roomCode = null;
        released++;
      }
    }
    if (released > 0) {
      this.push({
        from: 'system',
        name: 'Commons',
        text: `Room ${code} closed. ${released} resident${released === 1 ? '' : 's'} back home.`,
        to: [],
      });
    }
  }

  residentById(id: string): Resident | undefined {
    return this.residents.find((r) => r.id === id);
  }

  /** Residents the owner asked to send to a room, with the display names the lobby uses. */
  takeForRoom(code: string, limit: number): Array<{ id: string; name: string }> {
    const eligible = this.residents.filter((r) => r.roomCode === code && r.status !== 'in-game');
    return eligible.slice(0, limit).map((r) => ({ id: r.id, name: r.name }));
  }
}

export const commons = new Commons();
