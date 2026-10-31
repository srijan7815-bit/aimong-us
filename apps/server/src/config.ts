/**
 * Environment + config-file loading. One place, validated, fail-fast.
 *
 * Config JSON files (config/*.json) are the source of truth for game tuning and
 * live outside the packages so the owner (or I) can edit them without touching
 * code. Resolution walks up from this module to the repo root, so it works
 * identically under `tsx src/index.ts` and `node dist/index.js`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_SETTINGS, LobbySettings } from '@aimong/shared';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  PUBLIC_URL: z.string().default('http://localhost:2567'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MAX_COST_USD_PER_GAME: z.coerce.number().min(0).max(100).default(1),
  MAX_LLM_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(6),
  LLM_MOCK: z
    .string()
    .default('0')
    .transform((v) => v === '1' || v.toLowerCase() === 'true'),
  ROOM_CODE_LENGTH: z.coerce.number().int().min(4).max(8).default(5),
  MAX_ROOMS: z.coerce.number().int().min(1).max(20).default(3),
  ADMIN_TOKEN: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${detail}`);
  }
  return parsed.data;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'config')) && existsSync(join(dir, 'apps'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

export function configPath(...parts: string[]): string {
  return join(REPO_ROOT, 'config', ...parts);
}

export function readConfigJson<T>(file: string, validate: (v: unknown) => T): T {
  const full = configPath(file);
  if (!existsSync(full)) throw new Error(`Missing config file: ${full}`);
  return validate(JSON.parse(readFileSync(full, 'utf8')));
}

const gameDefaultsSchema = z
  .object({
    players: z.object({ min: z.number(), max: z.number(), default: z.number() }),
    room: z.object({
      codeLength: z.number(),
      codeAlphabet: z.string(),
      maxRooms: z.number(),
      emptyCloseMin: z.number(),
    }),
    ai: z
      .object({
        maxCostUsdPerGame: z.number(),
        brainBaseIntervalSec: z.number(),
        maxMsgsPerMeeting: z.number(),
        maxChars: z.number(),
      })
      .passthrough(),
  })
  .passthrough();

export type GameDefaults = z.infer<typeof gameDefaultsSchema>;

export interface AppConfig {
  env: Env;
  gameDefaults: GameDefaults;
  /** Settings a fresh room starts with. Env cost cap overrides the JSON default. */
  defaultSettings: LobbySettings;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = loadEnv(source);
  const gameDefaults = readConfigJson('game.defaults.json', (v) => gameDefaultsSchema.parse(v));
  const defaultSettings = LobbySettings.parse({
    ...DEFAULT_SETTINGS,
    maxPlayers: gameDefaults.players.default,
    costCapUsd: env.MAX_COST_USD_PER_GAME,
  });
  return { env, gameDefaults, defaultSettings };
}
