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
import { gateway } from '../ai/llm.js';
import { personaFor } from '../ai/personas.js';
import { systemPrompt } from '../ai/brain.js';

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
  /** Residents answering the owner in the panel, at most one call each. */
  private replying = new Set<string>();

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
      brain: (() => {
        const stats = gateway().stats;
        return {
          model: gateway().description,
          calls: stats.calls,
          ok: stats.ok,
          failed: stats.failed,
          tokens: stats.tokensIn + stats.tokensOut,
          costUsd: Number(stats.costUsd.toFixed(4)),
          lastMs: stats.lastMs,
        };
      })(),
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
    // Without an LLM provider the residents cannot answer; saying nothing is
    // better than faking a reply.
    if (!this.brainOnline) {
      this.push({
        from: 'system',
        name: 'Commons',
        text: 'Delivered — but no voice is connected, so nobody answers. Set NVIDIA_API_KEY to bring the brains online.',
        to: [],
      });
      return { message, recipients: known };
    }
    // Answer as up to three of the addressed residents, in their own voices.
    void this.answer(text, known.slice(0, 3));
    return { message, recipients: known };
  }

  /**
   * The owner said something in the panel; the residents answer with a model,
   * not with a template. Fire-and-forget: the panel polls the snapshot, so the
   * reply simply appears a second later.
   */
  private async answer(text: string, recipientIds: string[]): Promise<void> {
    const llm = gateway();
    await Promise.all(
      recipientIds.map(async (id) => {
        const resident = this.residentById(id);
        if (!resident || this.replying.has(id)) return;
        this.replying.add(id);
        try {
          const persona = personaFor(id);
          const reply = await llm.complete({
            tier: 'fast',
            system: systemPrompt({
              handle: resident.name,
              vibe: persona.vibe || resident.persona,
              crewStyle: persona.crew,
              impostorStyle: persona.impostor,
              role: 'crewmate',
              team: 'crew',
              fellows: [],
            }),
            user:
              `You are in the lobby waiting for a game code, talking to the host.\n` +
              `The host says: ${text.slice(0, 280)}\n` +
              `Answer in character in ONE short chat line (max 12 words). JSON only.`,
            maxTokens: 120,
            temperature: 0.9,
          });
          const line = reply ? cleanReply(reply.text) : '';
          if (!line) return;
          this.push({ from: 'resident', name: resident.name, text: line, to: [] });
        } catch (err) {
          logger.debug({ err: (err as Error).message }, 'commons answer failed');
        } finally {
          this.replying.delete(id);
        }
      }),
    );
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

/** Pull the chat line out of whatever the model returned. */
function cleanReply(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { say?: unknown; line?: unknown };
      const line = typeof parsed.say === 'string' ? parsed.say : typeof parsed.line === 'string' ? parsed.line : '';
      if (line.trim().length > 0) return line.trim().slice(0, 140);
    } catch {
      // fall through to the raw text
    }
  }
  return trimmed.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 140);
}
