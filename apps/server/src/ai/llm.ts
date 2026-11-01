/**
 * One provider-agnostic LLM gateway (PLAN §6, INSTRUCTIONS §5).
 *
 * Every provider we use speaks the OpenAI chat-completions dialect, so there is
 * no SDK here: one `fetch`, one request shape, one reply shape. NVIDIA NIM is
 * primary because the owner's key is free-tier and fast; OpenRouter is the
 * fallback when a key happens to be set. If neither is usable the gateway
 * reports `ready: false` and the residents keep their scripted mouths — they
 * never fake a model reply.
 *
 * Rate limits are the reason this file exists rather than a bare fetch:
 * NIM free is ~40 requests/minute, and four residents thinking at once will
 * happily blow through that. A token bucket with a small queue keeps us polite.
 */
import { loadEnv, type Env } from '../config.js';
import { logger } from '../logger-instance.js';

export type LlmTier = 'fast' | 'smart';

export interface LlmCall {
  tier: LlmTier;
  /** Byte-stable per seat: same string every call, so a provider cache can hit. */
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmReply {
  text: string;
  model: string;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cached: boolean;
}

export interface LlmStats {
  calls: number;
  ok: number;
  failed: number;
  skipped: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  lastModel: string;
  lastMs: number;
}

/** Models we have actually seen answer with content on NIM (see DECISIONS 27). */
const DEFAULT_PLAY_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';
const DEFAULT_MEETING_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';

interface Provider {
  name: string;
  baseUrl: string;
  key: string;
  model: string;
  /** USD per 1k tokens; free tiers are 0. */
  costPer1kIn: number;
  costPer1kOut: number;
}

/** Simple token bucket: N requests per window, no burst above the window size. */
class Bucket {
  private times: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(now = Date.now()): boolean {
    while (this.times.length > 0 && now - (this.times[0] as number) > this.windowMs) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }

  get used(): number {
    return this.times.length;
  }
}

export class LlmGateway {
  readonly stats: LlmStats = {
    calls: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastModel: '',
    lastMs: 0,
  };

  private readonly buckets = new Map<string, Bucket>();
  private readonly inFlightMax: number;
  private inFlight = 0;
  readonly mock: boolean;
  readonly play: Provider | null;
  readonly meeting: Provider | null;

  constructor(private readonly env: Env = loadEnv()) {
    this.inFlightMax = env.MAX_LLM_CONCURRENCY;
    this.mock = env.LLM_MOCK === true;
    const nimKey = process.env.NVIDIA_API_KEY?.trim();
    const orKey = process.env.OPENROUTER_API_KEY?.trim();
    const nimBase = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
    const playModel = process.env.NIM_PLAY_MODEL || DEFAULT_PLAY_MODEL;
    const meetingModel = process.env.NIM_MEETING_MODEL || DEFAULT_MEETING_MODEL;

    // NIM first (free tier, lowest latency in our probes); OpenRouter second.
    this.play = nimKey
      ? { name: 'nvidia', baseUrl: nimBase, key: nimKey, model: playModel, costPer1kIn: 0, costPer1kOut: 0 }
      : orKey
        ? {
            name: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            key: orKey,
            model: process.env.OPENROUTER_PLAY_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
            costPer1kIn: 0,
            costPer1kOut: 0,
          }
        : null;
    this.meeting = nimKey
      ? { ...(this.play as Provider), model: meetingModel }
      : orKey
        ? { ...(this.play as Provider) }
        : null;

    // Free tiers differ wildly; keep one bucket per provider.
    this.buckets.set('nvidia', new Bucket(Number(process.env.NIM_RPM || 30), 60_000));
    this.buckets.set('openrouter', new Bucket(Number(process.env.OPENROUTER_RPM || 18), 60_000));

    logger.info(
      {
        mock: this.mock,
        play: this.play ? `${this.play.name}:${this.play.model}` : null,
        meeting: this.meeting ? `${this.meeting.name}:${this.meeting.model}` : null,
      },
      'llm gateway',
    );
  }

  /** True when a resident can actually say something a model wrote. */
  get ready(): boolean {
    return this.mock || this.play !== null;
  }

  get description(): string {
    if (this.mock) return 'mock';
    if (!this.play) return 'offline';
    return `${this.play.name}:${this.play.model}`;
  }

  /** Cheap shape check: a reply with neither content nor reasoning is a failure. */
  async complete(call: LlmCall): Promise<LlmReply | null> {
    this.stats.calls++;
    if (this.mock) {
      const reply: LlmReply = {
        text: mockReply(call),
        model: 'mock',
        ms: 0,
        tokensIn: 0,
        tokensOut: 0,
        cached: false,
      };
      this.stats.ok++;
      this.stats.lastModel = 'mock';
      return reply;
    }
    const provider = call.tier === 'smart' ? this.meeting : this.play;
    if (!provider) {
      this.stats.skipped++;
      return null;
    }
    if (this.inFlight >= this.inFlightMax) {
      // Backpressure beats queueing: a resident simply thinks again next tick.
      this.stats.skipped++;
      return null;
    }
    const bucket = this.buckets.get(provider.name);
    if (bucket && !bucket.take()) {
      this.stats.skipped++;
      return null;
    }

    this.inFlight++;
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.LLM_TIMEOUT_MS || 20_000));
    try {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${provider.key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: call.system },
            { role: 'user', content: call.user },
          ],
          max_tokens: call.maxTokens ?? 160,
          temperature: call.temperature ?? (call.tier === 'smart' ? 0.9 : 0.7),
          stream: false,
        }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 160);
        logger.warn({ status: res.status, model: provider.model, body }, 'llm call failed');
        this.stats.failed++;
        return null;
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const message = json.choices?.[0]?.message;
      // Some NIM reasoning models put everything in `reasoning_content`; a seat
      // that "thinks" but never speaks is worse than silence, so we treat an
      // empty `content` as a failed call and let the scripted fallback talk.
      const text = (message?.content ?? '').trim();
      if (!text) {
        logger.debug({ model: provider.model }, 'llm returned empty content');
        this.stats.failed++;
        return null;
      }
      const tokensIn = json.usage?.prompt_tokens ?? 0;
      const tokensOut = json.usage?.completion_tokens ?? 0;
      const cost = (tokensIn / 1000) * provider.costPer1kIn + (tokensOut / 1000) * provider.costPer1kOut;
      const ms = Date.now() - started;
      this.stats.ok++;
      this.stats.tokensIn += tokensIn;
      this.stats.tokensOut += tokensOut;
      this.stats.costUsd += cost;
      this.stats.lastModel = provider.model;
      this.stats.lastMs = ms;
      return { text, model: provider.model, ms, tokensIn, tokensOut, cached: false };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'llm call threw');
      this.stats.failed++;
      return null;
    } finally {
      clearTimeout(timeout);
      this.inFlight--;
    }
  }
}

/**
 * Deterministic offline mouth for tests (LLM_MOCK=1) and for the playthrough
 * harness: short, in-voice lines, never a model call, never a fake "AI" tell.
 */
function mockReply(call: LlmCall): string {
  const lines = [
    'where was everyone just now',
    'i was on cams the whole time ngl',
    'thats a weird thing to say',
    'ok but who was near the galley',
    'i saw something in cargo, not sure',
    'skip or vote blue, im easy',
    'nah dont trust that',
  ];
  // Pick on the prompt so the same observation reads the same way twice.
  let hash = 0;
  for (let i = 0; i < call.user.length; i++) hash = (hash * 31 + call.user.charCodeAt(i)) % 100000;
  return lines[hash % lines.length] as string;
}

let cached: LlmGateway | null = null;
/** One gateway per process: the buckets only work if they are shared. */
export function gateway(): LlmGateway {
  if (!cached) cached = new LlmGateway();
  return cached;
}
