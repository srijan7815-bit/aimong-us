import { describe, expect, it } from 'vitest';
import { RoomRegistry } from '../src/registry.js';
import { RateLimiter } from '../src/http/ratelimit.js';
import { loadConfig } from '../src/config.js';

describe('RoomRegistry', () => {
  it('allocates codes nobody is using', () => {
    const reg = new RoomRegistry();
    const a = reg.allocateCode();
    reg.add({ code: a, roomId: 'r1', players: 0, phase: 'LOBBY', createdAt: 1 });
    const b = reg.allocateCode();
    expect(b).not.toBe(a);
    expect(reg.size).toBe(1);
  });

  it('looks codes up forgivingly (lowercase, spaces) and forgets removed rooms', () => {
    const reg = new RoomRegistry();
    reg.add({ code: 'KXQ7M', roomId: 'r1', players: 2, phase: 'LOBBY', createdAt: 1 });
    expect(reg.get('kxq7m')?.roomId).toBe('r1');
    expect(reg.get(' KXQ7M ')?.roomId).toBe('r1');
    reg.remove('KXQ7M');
    expect(reg.get('KXQ7M')).toBeUndefined();
  });

  it('patches live counts', () => {
    const reg = new RoomRegistry();
    reg.add({ code: 'AAAAA', roomId: 'r1', players: 0, phase: 'LOBBY', createdAt: 1 });
    reg.update('AAAAA', { players: 3 });
    expect(reg.get('AAAAA')?.players).toBe(3);
  });
});

describe('RateLimiter', () => {
  it('allows up to the budget then blocks, and refills over time', () => {
    const rl = new RateLimiter({ max: 2, windowMs: 1000 });
    expect(rl.take('ip', 0)).toBe(true);
    expect(rl.take('ip', 100)).toBe(true);
    expect(rl.take('ip', 200)).toBe(false);
    expect(rl.take('ip', 1200)).toBe(true);
  });

  it('is per key', () => {
    const rl = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.take('a', 0)).toBe(true);
    expect(rl.take('b', 0)).toBe(true);
  });
});

describe('config', () => {
  it('loads defaults from config/*.json with sane values', () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.defaultSettings.maxPlayers).toBe(10);
    expect(cfg.defaultSettings.aiSeats).toBeGreaterThan(0);
    expect(cfg.gameDefaults.room.codeLength).toBe(5);
    expect(cfg.defaultSettings.costCapUsd).toBe(1);
  });

  it('lets the env override the per-game cost cap', () => {
    const cfg = loadConfig({ MAX_COST_USD_PER_GAME: '2.5', PORT: '3000' } as unknown as NodeJS.ProcessEnv);
    expect(cfg.defaultSettings.costCapUsd).toBe(2.5);
    expect(cfg.env.PORT).toBe(3000);
  });

  it('fails loudly on garbage instead of booting half-configured', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' } as unknown as NodeJS.ProcessEnv)).toThrow(/Invalid environment/);
  });
});
