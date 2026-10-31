/**
 * GameRoom — the authoritative room. One instance per match, in memory.
 *
 * M1 scope: join-by-code lobby (players, host controls, settings, lobby chat,
 * readiness, reconnect grace). The simulation (movement, tasks, kills, meetings)
 * attaches to this same room in M2–M3.
 */
import { Room, ServerError, type Client } from '@colyseus/core';
import {
  ClientMessages,
  MAX_CHAT_LEN,
  PlayerName,
  MAX_PLAYERS,
  pickFreeColor,
  colorById,
  SHARED_VERSION,
  STATION_NAME,
  normalizeCode,
  clampSettings,
  type LobbySettingsPatch,
} from '@aimong/shared';
import { registry } from '../registry.js';
import { ChatEntryState, LobbyState, MAX_CHAT_HISTORY, PlayerState } from './state.js';
import { RateLimiter } from '../http/ratelimit.js';
import { getAppConfig } from '../app-config.js';
import { logger } from '../logger-instance.js';

const RECONNECT_GRACE_SEC = 60;
/** Chat flood guard per player: 6 messages per 5 s. */
const chatLimiter = new RateLimiter({ max: 6, windowMs: 5000 });
/** Join attempts per IP across all rooms: 12 per minute (INSTRUCTIONS §8). */
const joinLimiter = new RateLimiter({ max: 12, windowMs: 60_000 });

interface JoinAuth {
  name: string;
  ip: string;
}

export class GameRoom extends Room<{ state: LobbyState }> {
  private code = '';

  override onCreate(): void {
    const cfg = getAppConfig();
    if (registry.size >= cfg.env.MAX_ROOMS) {
      // Bounded cost (PLAN §8): refuse rather than spin up an unbounded number
      // of AI-filled rooms on one box.
      throw new ServerError(503, 'Station is at capacity right now — try again in a few minutes.');
    }
    this.code = registry.allocateCode();
    this.maxClients = MAX_PLAYERS;
    this.autoDispose = true;
    this.maxMessagesPerSecond = 20;

    const state = new LobbyState();
    state.code = this.code;
    state.phase = 'LOBBY';
    state.station = STATION_NAME;
    state.version = SHARED_VERSION;
    state.createdAt = Date.now();
    state.settings.maxPlayers = cfg.defaultSettings.maxPlayers;
    state.settings.aiSeats = cfg.defaultSettings.aiSeats;
    state.settings.impostors = cfg.defaultSettings.impostors;
    state.settings.discussionSec = cfg.defaultSettings.discussionSec;
    state.settings.votingSec = cfg.defaultSettings.votingSec;
    state.settings.killCooldownSec = cfg.defaultSettings.killCooldownSec;
    state.settings.tasksPerCrew = cfg.defaultSettings.tasksPerCrew;
    state.settings.costCapUsd = cfg.defaultSettings.costCapUsd;
    state.settings.revealEjectedRole = cfg.defaultSettings.revealEjectedRole;
    state.settings.aiAggression = cfg.defaultSettings.aiAggression;
    this.setState(state);

    registry.add({
      code: this.code,
      roomId: this.roomId,
      players: 0,
      phase: 'LOBBY',
      createdAt: state.createdAt,
    });

    this.registerHandlers();
    logger.info({ roomId: this.roomId, code: this.code }, 'room created');
  }

  /** Runs before onJoin: validate the request and rate limit the IP. */
  override onAuth(client: Client, options: unknown): JoinAuth {
    const ip = clientIp(client);
    if (!joinLimiter.take(ip)) {
      throw new ServerError(429, 'Too many join attempts. Wait a minute.');
    }
    const raw = (options ?? {}) as { name?: unknown };
    const name = PlayerName.safeParse(raw.name);
    if (!name.success) {
      throw new ServerError(400, name.error.issues[0]?.message ?? 'Pick a name');
    }
    if (this.state.players.size >= this.maxClients) {
      throw new ServerError(400, 'This lobby is full');
    }
    return { name: name.data, ip };
  }

  override onJoin(client: Client, _options: unknown, auth?: JoinAuth): void {
    const desired = auth?.name ?? 'Player';
    const name = this.uniqueName(desired);
    const taken = [...this.state.players.values()].map((p) => p.color);
    const color = pickFreeColor(taken);

    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = name;
    player.color = color.id;
    player.colorName = color.name;
    player.ready = false;
    player.connected = true;
    player.joinedAt = Date.now();
    player.isAi = false;
    player.isHost = this.state.players.size === 0;
    this.state.players.set(client.sessionId, player);

    if (player.isHost) this.state.hostId = client.sessionId;

    this.systemMessage(`${name} joined`);
    if (name !== desired) {
      this.notice(client, 'info', `Name taken — you are "${name}" here.`);
    }
    this.touchRegistry();
    logger.info({ code: this.code, player: name }, 'player joined');
  }

  /**
   * Unconsented disconnect (screen lock, tunnel, lift). Hold the seat for a
   * minute so a phone refresh does not lose the player's lobby spot. If the
   * grace window expires, Colyseus calls onLeave() and the seat is recycled.
   */
  override async onDrop(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.touchRegistry();
    try {
      await this.allowReconnection(client, RECONNECT_GRACE_SEC);
      player.connected = true;
      this.systemMessage(`${player.name} reconnected`);
      this.touchRegistry();
    } catch {
      // Grace expired: onLeave() runs next and removes the seat.
    }
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const wasHost = this.state.hostId === client.sessionId;
    this.state.players.delete(client.sessionId);
    this.systemMessage(`${player.name} left`);
    if (wasHost) this.promoteHost();
    this.touchRegistry();
    logger.info({ code: this.code, player: player.name }, 'player left');
  }

  override onDispose(): void {
    registry.remove(this.code);
    logger.info({ code: this.code }, 'room disposed');
  }

  // ---------------------------------------------------------------- messages

  private registerHandlers(): void {
    this.onMessage('ready', (client, raw) => {
      const msg = ClientMessages.ready.safeParse(raw);
      if (!msg.success) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.ready = msg.data.ready;
      this.touchRegistry();
    });

    this.onMessage('setName', (client, raw) => {
      const msg = ClientMessages.setName.safeParse(raw);
      if (!msg.success) {
        this.notice(client, 'warn', 'That name will not work — try letters and numbers.');
        return;
      }
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const name = this.uniqueName(msg.data.name, client.sessionId);
      const old = player.name;
      player.name = name;
      this.systemMessage(`${old} is now ${name}`);
      this.touchRegistry();
    });

    this.onMessage('chat', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!chatLimiter.take(client.sessionId)) {
        this.notice(client, 'warn', 'Easy there — slow down the chat.');
        return;
      }
      const msg = ClientMessages.chat.safeParse(raw);
      if (!msg.success) return;
      this.pushChat({
        id: client.sessionId,
        name: player.name,
        color: player.color,
        text: msg.data.text.slice(0, MAX_CHAT_LEN),
        ts: Date.now(),
        system: false,
      });
    });

    this.onMessage('settings', (client, raw) => {
      if (!this.isHost(client)) return;
      const msg = ClientMessages.settings.safeParse(raw);
      if (!msg.success) {
        this.notice(client, 'warn', 'Those settings are out of range.');
        return;
      }
      this.applySettings(msg.data.patch);
    });

    this.onMessage('start', (client) => {
      if (!this.isHost(client)) return;
      this.tryStart(client);
    });

    this.onMessage('kick', (client, raw) => {
      if (!this.isHost(client)) return;
      const msg = ClientMessages.kick.safeParse(raw);
      if (!msg.success) return;
      if (msg.data.playerId === client.sessionId) return;
      const target = this.state.players.get(msg.data.playerId);
      if (!target) return;
      const targetClient = this.clients.find((c) => c.sessionId === msg.data.playerId);
      this.state.players.delete(msg.data.playerId);
      this.systemMessage(`${target.name} was removed by the host`);
      if (targetClient) {
        targetClient.send('kicked', { reason: 'Removed by the host' });
        targetClient.leave(4000);
      }
      this.touchRegistry();
    });

    this.onMessage('lookup', (client, raw) => {
      // Clients normally resolve codes over HTTP (/api/rooms/:code); this is the
      // in-room fallback so a code can be verified without an extra request.
      const msg = ClientMessages.lookup.safeParse(raw);
      if (!msg.success) return;
      const normalized = normalizeCode(msg.data.code);
      this.notice(
        client,
        normalized === this.code ? 'info' : 'warn',
        normalized === this.code ? `You are in ${this.code}` : `This room is ${this.code}, not ${normalized}`,
      );
    });
  }

  // ----------------------------------------------------------------- helpers

  private tryStart(client: Client): void {
    if (this.state.phase !== 'LOBBY') {
      this.notice(client, 'warn', 'The game already started.');
      return;
    }
    const humans = [...this.state.players.values()].filter((p) => p.connected && !p.isAi);
    const total = humans.length + this.state.settings.aiSeats;
    const minPlayers = getAppConfig().gameDefaults.players.min;
    if (total < minPlayers) {
      this.notice(
        client,
        'warn',
        `Need ${minPlayers} seats to launch — you have ${total} (${humans.length} human + ${this.state.settings.aiSeats} AI).`,
      );
      return;
    }
    // M1 stops here on purpose: launching needs the map + rules from M2/M3.
    this.notice(
      client,
      'info',
      'Lobby works. The station opens in M2 (movement) then M3 (rules) — no fake start.',
    );
  }

  private applySettings(patch: LobbySettingsPatch): void {
    const next = clampSettings(patch, {
      maxPlayers: this.state.settings.maxPlayers,
      aiSeats: this.state.settings.aiSeats,
      impostors: this.state.settings.impostors,
      discussionSec: this.state.settings.discussionSec,
      votingSec: this.state.settings.votingSec,
      killCooldownSec: this.state.settings.killCooldownSec,
      tasksPerCrew: this.state.settings.tasksPerCrew,
      costCapUsd: this.state.settings.costCapUsd,
      revealEjectedRole: this.state.settings.revealEjectedRole,
      aiAggression: this.state.settings.aiAggression,
    });
    const s = this.state.settings;
    s.maxPlayers = next.maxPlayers;
    s.aiSeats = next.aiSeats;
    s.impostors = next.impostors;
    s.discussionSec = next.discussionSec;
    s.votingSec = next.votingSec;
    s.killCooldownSec = next.killCooldownSec;
    s.tasksPerCrew = next.tasksPerCrew;
    s.costCapUsd = next.costCapUsd;
    s.revealEjectedRole = next.revealEjectedRole;
    s.aiAggression = next.aiAggression;
    if (this.state.players.size >= s.maxPlayers) this.lock();
    else if (!this.locked) this.unlock();
    this.touchRegistry();
  }

  private isHost(client: Client): boolean {
    if (client.sessionId === this.state.hostId) return true;
    this.notice(client, 'warn', 'Only the host can do that.');
    return false;
  }

  private promoteHost(): void {
    const next = [...this.state.players.values()]
      .filter((p) => p.connected && !p.isAi)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    for (const p of this.state.players.values()) p.isHost = false;
    if (next) {
      next.isHost = true;
      this.state.hostId = next.id;
      this.systemMessage(`${next.name} is the new host`);
    } else {
      this.state.hostId = '';
    }
  }

  /** Names are unique-per-room; collisions get a numeric suffix, not an error. */
  private uniqueName(desired: string, exceptId?: string): string {
    const taken = new Set(
      [...this.state.players.values()].filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()),
    );
    if (!taken.has(desired.toLowerCase())) return desired;
    for (let n = 2; n < 100; n++) {
      const candidate = `${desired}${n}`.slice(0, 14);
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${desired}${Date.now() % 1000}`.slice(0, 14);
  }

  private systemMessage(text: string): void {
    this.pushChat({
      id: 'system',
      name: 'Station',
      color: 'white',
      text,
      ts: Date.now(),
      system: true,
    });
  }

  private pushChat(entry: {
    id: string;
    name: string;
    color: string;
    text: string;
    ts: number;
    system: boolean;
  }): void {
    const row = new ChatEntryState();
    row.id = entry.id;
    row.name = entry.name;
    row.color = colorById(entry.color).id;
    row.text = entry.text;
    row.ts = entry.ts;
    row.system = entry.system;
    this.state.chat.push(row);
    while (this.state.chat.length > MAX_CHAT_HISTORY) this.state.chat.shift();
  }

  private notice(client: Client, level: 'info' | 'warn' | 'error', text: string): void {
    client.send('notice', { level, text });
  }

  private touchRegistry(): void {
    registry.update(this.code, {
      players: this.state.players.size,
      phase: this.state.phase,
    });
  }
}

function clientIp(client: Client): string {
  const anyClient = client as unknown as { ip?: string; userData?: { ip?: string } };
  return anyClient.ip ?? 'unknown';
}

export { RECONNECT_GRACE_SEC };
