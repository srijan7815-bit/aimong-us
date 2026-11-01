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
import { commons } from '../cluster/commons.js';
import { registerRoom, unregisterRoom } from './presence.js';
import { ChatEntryState, LobbyState, MAX_CHAT_HISTORY, PlayerState } from './state.js';
import { RateLimiter } from '../http/ratelimit.js';
import {
  SIM_STEP_MS,
  WORLD,
  spawnPosition,
  stepPlayer,
  type MoveInput,
} from '@aimong/shared';
import { GRID, GRID_DOORS, OPEN_GRID } from '../world/station.js';
import { TickStats } from '../perf/tick-stats.js';
import {
  SABOTAGE_SPECS,
  DARK_VISION_TILES,
  DEFAULT_SETTINGS,
  QUICK_CHAT,
  ABILITY_SPECS,
  ROLE_ABILITY,
  ROLE_LABEL,
  ROLE_SUMMARY,
  ROLE_TEAM,
  canVent,
  checkAbility,
  readCosmetics,
  composeRoles,
  fixesNeeded,
  freshClock,
  assignTasks,
  checkWin,
  describeWin,
  doneSteps,
  minigameForStage,
  taskPlanOf,
  taskSteps,
  totalSteps,
  tallyVotes,
  canSeeAnywhere,
  findPath,
  type AbilityClock,
  type AbilityId,
  type Role,
  type RoleId,
  type SecretRole,
  type TaskAssignment,
  type SabotageKind,
  type Cosmetics,
} from '@aimong/shared';
import { BodyState } from './state.js';
import { AiDriver, type AiPort } from '../ai/driver.js';
import type { AiSeatView } from '../ai/brain.js';
import { gateway } from '../ai/llm.js';
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
  cosmetics: Cosmetics;
}

/** How long an input stays "live" before the server treats the player as idle. */
const INPUT_TTL_MS = 500;

interface InputState extends MoveInput {
  at: number;
}

export class GameRoom extends Room<{ state: LobbyState }> {
  /** Public so the Commons and the console can address this room by its code. */
  code = '';
  /** Latest movement intent per session (server-side only). */
  private moveInputs = new Map<string, InputState>();
  /** Tick timings, exposed through /api/metrics in non-production. */
  readonly ticks = new TickStats();

  // ---------------------------------------------------------------- match state
  // Roles, per-player tasks and votes NEVER go into the synced state: Colyseus
  // broadcasts state to everyone, so a role in there is a role leak.
  private roles = new Map<string, Role>();
  /** Exactly which role each seat got (private; `roles` is the team view). */
  private roleIds = new Map<string, RoleId>();
  /** Per-player ability clocks (server truth; mirrored to the client privately). */
  private abilities = new Map<string, Map<AbilityId, AbilityClock>>();
  /** Warden shields: targetId -> epoch ms when it lapses. */
  private shields = new Map<string, number>();
  /** Shifters currently wearing someone: shifterId -> victimId they look like. */
  private shifts = new Map<string, string>();
  /** Recent door crossings (no names — the log is anonymous by design). */
  private doorLog: Array<{ door: string; at: number }> = [];
  private lastDoorSeen = new Set<string>();
  private lastDoorSweep = 0;
  private lastEmergencyAt = 0;
  private practice = false;
  private tasks = new Map<string, TaskAssignment[]>();
  private votes = new Map<string, string | null>();
  private sabotageFixed = new Set<string>();
  private meetingStageEndsAt = 0;
  private matchEnded = false;
  private rngSeed = Date.now() % 2147483647;
  /** Residents' body + brain. Null when this build has no gateway. */
  private ai: AiDriver | null = null;

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
    // Movement input arrives at ~20 Hz per player; leave headroom for chat and
    // settings on top of it. Our own per-player limiter guards flooding.
    this.maxMessagesPerSecond = 60;
    // 20 Hz state patches, matching the simulation rate (no interpolation gaps
    // for the client, and no point sending faster than we simulate).
    this.patchRate = SIM_STEP_MS;

    const state = new LobbyState();
    state.code = this.code;
    state.phase = 'LOBBY';
    state.station = STATION_NAME;
    state.version = SHARED_VERSION;
    state.createdAt = Date.now();
    // Copy every knob by name: a hand-maintained list is how a setting silently
    // stops being applied the day someone adds one.
    const defaults: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    defaults.maxPlayers = cfg.defaultSettings.maxPlayers;
    defaults.aiSeats = cfg.defaultSettings.aiSeats;
    defaults.impostors = cfg.defaultSettings.impostors;
    defaults.discussionSec = cfg.defaultSettings.discussionSec;
    defaults.votingSec = cfg.defaultSettings.votingSec;
    defaults.killCooldownSec = cfg.defaultSettings.killCooldownSec;
    defaults.tasksPerCrew = cfg.defaultSettings.tasksPerCrew;
    defaults.costCapUsd = cfg.defaultSettings.costCapUsd;
    defaults.revealEjectedRole = cfg.defaultSettings.revealEjectedRole;
    defaults.aiAggression = cfg.defaultSettings.aiAggression;
    copySettings(state.settings as unknown as Record<string, unknown>, defaults);
    this.setState(state);

    registry.add({
      code: this.code,
      roomId: this.roomId,
      players: 0,
      phase: 'LOBBY',
      createdAt: state.createdAt,
    });

    this.registerHandlers();
    this.ai = new AiDriver(this.aiPort(), gateway());
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), SIM_STEP_MS);
    registerRoom(this);
    logger.info({ roomId: this.roomId, code: this.code }, 'room created');
  }

  /** Runs before onJoin: validate the request and rate limit the IP. */
  override onAuth(client: Client, options: unknown): JoinAuth {
    const ip = clientIp(client);
    if (!joinLimiter.take(ip)) {
      throw new ServerError(429, 'Too many join attempts. Wait a minute.');
    }
    const raw = (options ?? {}) as { name?: unknown; cosmetics?: unknown };
    const name = PlayerName.safeParse(raw.name);
    if (!name.success) {
      throw new ServerError(400, name.error.issues[0]?.message ?? 'Pick a name');
    }
    if (this.state.players.size >= this.maxClients) {
      throw new ServerError(400, 'This lobby is full');
    }
    // Cosmetics are look-only, so anything unrecognised just falls back to plain.
    return { name: name.data, ip, cosmetics: readCosmetics(raw.cosmetics) };
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
    const look = auth?.cosmetics ?? readCosmetics(undefined);
    player.hat = look.hat;
    player.skin = look.skin;
    player.pet = look.pet;
    player.nameplate = look.nameplate;
    // Seat index = join order, so the pod appears somewhere sensible on the map.
    const spawn = spawnPosition(WORLD, this.state.players.size);
    player.x = spawn.x;
    player.y = spawn.y;
    this.state.players.set(client.sessionId, player);

    if (player.isHost) this.state.hostId = client.sessionId;

    this.systemMessage(`${name} joined`);
    // Reconnecting into a live round: hand back the private role/tasks.
    if (this.state.phase !== 'LOBBY') setTimeout(() => this.sendSecret(client.sessionId), 50);
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
    unregisterRoom(this.code);
    commons.releaseRoom(this.code);
    logger.info({ code: this.code }, 'room disposed');
  }

  // ------------------------------------------------------- AI cluster seats

  /**
   * Seat residents from the Commons (they were sent here with the team code).
   * This is the *seat* half of an AI player: name, colour, AI badge. Movement,
   * tasks, chat and the brain arrive in M4/M5 on top of these seats.
   */
  admitResidents(residents: Array<{ id: string; name: string }>): string[] {
    if (this.state.phase !== 'LOBBY') return [];
    const seated: string[] = [];
    for (const resident of residents) {
      const id = `ai:${resident.id}`;
      if (this.state.players.has(id)) {
        seated.push(id);
        continue;
      }
      if (this.state.players.size >= this.maxClients) break;
      const taken = [...this.state.players.values()].map((p) => p.color);
      const color = pickFreeColor(taken);
      const player = new PlayerState();
      player.id = id;
      player.name = this.uniqueName(resident.name);
      player.color = color.id;
      player.colorName = color.name;
      player.isAi = true;
      player.isHost = false;
      player.ready = true;
      player.connected = true;
      player.joinedAt = Date.now();
      // Residents stand on the map too — they just do not move yet (M4 drives them).
      const spawn = spawnPosition(WORLD, this.state.players.size);
      player.x = spawn.x;
      player.y = spawn.y;
      this.state.players.set(id, player);
      seated.push(id);
      this.systemMessage(`${player.name} (AI) took a seat`);
    }
    if (seated.length > 0) {
      // Real residents now occupy seats, so the AI seat counter would double-count.
      const aiSeated = [...this.state.players.values()].filter((p) => p.isAi).length;
      this.state.settings.aiSeats = Math.max(0, this.state.settings.aiSeats - aiSeated);
      this.touchRegistry();
    }
    return seated;
  }

  /** True when at least one resident (AI seat) is at the table. */
  hasAiSeats(): boolean {
    return [...this.state.players.values()].some((p) => p.isAi);
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

    this.onMessage('cosmetics', (client, raw) => {
      const msg = ClientMessages.cosmetics.safeParse(raw);
      if (!msg.success) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // Look-only, so a mid-round change is harmless and needs no cooldown.
      const look = readCosmetics(msg.data, {
        hat: player.hat as never,
        skin: player.skin as never,
        pet: player.pet as never,
        nameplate: player.nameplate as never,
      });
      player.hat = look.hat;
      player.skin = look.skin;
      player.pet = look.pet;
      player.nameplate = look.nameplate;
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
      this.say(player, msg.data.text.slice(0, MAX_CHAT_LEN));
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


    this.onMessage('input', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isAi) return;
      if (this.state.phase !== 'PLAY') return;
      const msg = ClientMessages.input.safeParse(raw);
      if (!msg.success) return;
      const previous = this.moveInputs.get(client.sessionId);
      // Ignore out-of-order packets (UDP-ish reordering over WebSocket is rare but
      // possible when a phone switches networks mid-game).
      if (previous && msg.data.seq < previous.seq) return;
      this.moveInputs.set(client.sessionId, { ...msg.data, at: Date.now() });
    });

    // ---- M3 gameplay messages ----
    this.onMessage('kill', (client, raw) => {
      const killer = this.state.players.get(client.sessionId);
      if (!killer || !this.canAct(killer)) return;
      const msg = ClientMessages.kill.safeParse(raw);
      if (!msg.success) return;
      const result = this.resolveKill(killer, msg.data.target);
      if (result === 'too-far') this.notice(client, 'warn', 'Too far away.');
      if (result === 'warded') this.notice(client, 'warn', 'A ward took that hit.');
      if (result === 'witnessed') this.notice(client, 'info', 'Someone may have seen that.');
    });

    this.onMessage('vent', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !this.canAct(player)) return;
      const role = this.roleIds.get(player.id) ?? 'crewmate';
      if (!canVent(role)) return;
      const now = Date.now();
      // Engineers get a short vent, then a recharge; impostors ride freely.
      const clock = this.clockOf(player.id, 'vent');
      if (role === 'engineer') {
        if (clock.readyAt > now) {
          this.notice(client, 'warn', `Vent recharging (${Math.ceil((clock.readyAt - now) / 1000)}s).`);
          return;
        }
      }
      const msg = ClientMessages.vent.safeParse(raw);
      if (!msg.success) return;
      const vent = WORLD.vents.find((v) => v.id === msg.data.ventId);
      if (!vent) return;
      const near = Math.hypot(player.x - vent.tile.x * 32 - 16, player.y - vent.tile.y * 32 - 16) <= 44;
      if (!near) return;
      const target = WORLD.vents.find((v) => v.id === vent.links[0]);
      if (!target) return;
      player.x = target.tile.x * 32 + 16;
      player.y = target.tile.y * 32 + 16;
      player.ventReadyAt = 0;
      if (role === 'engineer') {
        const hold = ROLE_ABILITY.engineer.params.ventHoldSec ?? 10;
        const recharge = ROLE_ABILITY.engineer.params.ventRechargeSec ?? 30;
        clock.activeUntil = now + hold * 1000;
        clock.readyAt = now + (hold + recharge) * 1000;
        player.ventReadyAt = clock.readyAt;
        this.notice(client, 'info', `Vented — you are out of the ducts in ${hold}s.`);
        this.sendSecret(player.id);
      } else {
        this.notice(client, 'info', 'Vented.');
      }
    });

    this.onMessage('report', (client, raw) => {
      const reporter = this.state.players.get(client.sessionId);
      if (!reporter || !this.canAct(reporter)) return;
      const msg = ClientMessages.report.safeParse(raw);
      if (!msg.success) return;
      this.tryReport(reporter, msg.data.bodyId);
    });

    this.onMessage('lobby', (client) => {
      if (!this.isHost(client)) return;
      this.returnToLobby();
    });

    this.onMessage('emergency', (client) => {
      const caller = this.state.players.get(client.sessionId);
      if (!caller || !this.canAct(caller)) return;
      if (caller.emergenciesLeft <= 0) {
        this.notice(client, 'warn', 'Your emergency button is used up.');
        return;
      }
      // The button lives in the Galley (this station's mess hall).
      const galley = WORLD.rooms.find((r) => r.id === 'galley');
      if (!galley) return;
      const cx = (galley.rect.x + galley.rect.w / 2) * 32;
      const cy = (galley.rect.y + galley.rect.h / 2) * 32;
      if (Math.hypot(caller.x - cx, caller.y - cy) > 96) {
        this.notice(client, 'warn', 'The emergency button is in the Galley.');
        return;
      }
      this.callMeeting(caller.id, 'emergency');
    });

    this.onMessage('taskDone', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      // Ghosts may keep doing tasks (they just cannot be seen doing them), which
      // is why this is not `canAct`.
      const canWork =
        this.state.phase === 'PLAY' &&
        player !== undefined &&
        (this.state.players.get(player.id)?.alive === true || this.state.settings.ghostChat);
      if (!player || !canWork) {
        logger.debug({ session: client.sessionId, phase: this.state.phase }, 'taskDone refused: cannot act');
        return;
      }
      if (this.roles.get(player.id) !== 'crew') {
        logger.debug({ player: player.name }, 'taskDone refused: not crew');
        return;
      }
      const msg = ClientMessages.taskDone.safeParse(raw);
      if (!msg.success) {
        logger.debug({ raw }, 'taskDone refused: bad payload');
        return;
      }
      this.completeTask(player, msg.data.taskId);
    });

    this.onMessage('fix', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !this.canAct(player)) return;
      if (this.roles.get(player.id) !== 'impostor' && !this.state.sabotage.kind) return;
      const msg = ClientMessages.fix.safeParse(raw);
      if (!msg.success) return;
      this.tryFix(player, msg.data.spotId);
    });

    this.onMessage('sabotage', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !this.canAct(player)) return;
      if (this.roles.get(player.id) !== 'impostor') return;
      if (this.state.sabotage.kind) return;
      const msg = ClientMessages.sabotage.safeParse(raw);
      if (!msg.success) return;
      this.startSabotage(player, msg.data.kind);
    });

    this.onMessage('vote', (client, raw) => {
      const voter = this.state.players.get(client.sessionId);
      if (!voter || !voter.alive) return;
      if (this.state.phase !== 'MEETING' || this.state.meeting.stage !== 'VOTING') return;
      const msg = ClientMessages.vote.safeParse(raw);
      if (!msg.success) return;
      this.castVote(voter, msg.data.target);
    });

    // ---- M3.5: role abilities and station tools ----
    this.onMessage('ability', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const msg = ClientMessages.ability.safeParse(raw);
      if (!msg.success) return;
      this.useAbility(client, player.id, msg.data.id, msg.data.target);
    });

    this.onMessage('abilityEnd', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const msg = ClientMessages.abilityEnd.safeParse(raw);
      if (!msg.success) return;
      this.endAbility(player.id, msg.data.id);
    });

    this.onMessage('quickChat', (client, raw) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const msg = ClientMessages.quickChat.safeParse(raw);
      if (!msg.success) return;
      const text = QUICK_CHAT[msg.data.id];
      if (!text) return;
      this.say(player, text);
    });

    this.onMessage('practice', (client) => {
      if (!this.isHost(client)) return;
      if (this.state.phase !== 'LOBBY') return;
      this.startMatch(true);
    });

    this.onMessage('resetPositions', (client) => {
      // Dev aid used by the smoke/perf harness to put everyone back on spawn.
      if (this.isHost(client)) this.placeAtSpawns();
    });
  }

  /** One authoritative simulation step. Called 20 times a second. */
  // ------------------------------------------------ shared action rules
  //
  // These used to live inside the socket handlers. Residents take the same
  // actions as humans, so the rules moved here: one implementation, two callers
  // (the `onMessage` handler and the AI driver). Anything a bot can do, a human
  // can do, and vice versa.

  /** Kill resolution shared by the socket handler and the AI driver. */
  private resolveKill(killer: PlayerState, targetId: string): 'ok' | 'too-far' | 'warded' | 'witnessed' | 'illegal' {
    if (!this.canAct(killer)) return 'illegal';
    if (this.roles.get(killer.id) !== 'impostor') return 'illegal';
    if (Date.now() < killer.killReadyAt) return 'illegal';
    const victim = this.state.players.get(targetId);
    if (!victim || !victim.alive) return 'illegal';
    if (this.roles.get(victim.id) === 'impostor') return 'illegal';
    const range = this.state.settings.killRange * 32;
    if (Math.hypot(victim.x - killer.x, victim.y - killer.y) > range) return 'too-far';
    // A warden's shield eats the kill (and the killer still pays the cooldown).
    const shieldUntil = this.shields.get(victim.id) ?? 0;
    if (shieldUntil > Date.now()) {
      this.shields.delete(victim.id);
      victim.shieldUntil = 0;
      killer.killReadyAt = Date.now() + this.state.settings.killCooldownSec * 1000;
      this.noticeFor(victim.id, 'info', 'Your ward absorbed a kill.');
      return 'warded';
    }
    victim.alive = false;
    victim.isGhost = true;
    victim.moving = false;
    killer.killReadyAt = Date.now() + this.state.settings.killCooldownSec * 1000;
    this.spawnBody(victim.id);
    this.sendSecret(victim.id);
    const witnesses = [...this.state.players.values()].filter(
      (p) =>
        p.id !== killer.id &&
        p.id !== victim.id &&
        p.alive &&
        canSeeAnywhere(
          this.gridFor(p),
          p.x,
          p.y,
          victim.x,
          victim.y,
          this.state.sabotage.kind === 'lights' ? DARK_VISION_TILES : undefined,
        ),
    );
    this.recountTasks();
    this.checkWinNow();
    return witnesses.length > 0 ? 'witnessed' : 'ok';
  }

  /** One step of a task, with the presence check the server has always done. */
  private completeTask(player: PlayerState, taskId: string): boolean {
    if (this.state.phase !== 'PLAY') return false;
    if (this.roles.get(player.id) !== 'crew') return false;
    if (!player.alive && !this.state.settings.ghostChat) return false;
    const list = this.tasks.get(player.id) ?? [];
    const task = list.find((t) => t.id === taskId);
    if (!task || task.done) return false;
    const spot = WORLD.taskSpots.find((s) => s.id === task.spotId);
    if (!spot) return false;
    const sx = spot.tile.x * 32 + 16;
    const sy = spot.tile.y * 32 + 16;
    if (Math.hypot(player.x - sx, player.y - sy) > 56) return false;
    // A long task is two minigames at the same console: advance the stage and
    // only mark it done on the last one.
    task.stage += 1;
    if (task.stage >= taskSteps(task)) {
      task.done = true;
      task.stage = taskSteps(task);
    }
    // Visual tasks leave a public "doing something" marker for a few seconds:
    // that is the alibi, and it is the only task information anyone else gets.
    if (task.category === 'visual' && this.state.settings.visualTasks && player.alive) {
      player.visualTaskUntil = Date.now() + 4000;
    }
    player.tasksDone = list.reduce((sum, t) => sum + (t.done ? taskSteps(t) : t.stage), 0);
    player.tasksTotal = totalSteps(list);
    this.recountTasks();
    // The task list is private, so the client only learns about the tick when
    // the server re-sends 'you'. Without this the HUD stays stale forever.
    this.sendSecret(player.id);
    logger.debug({ player: player.name, spot: spot.id, done: task.done }, 'task step');
    this.checkWinNow();
    return true;
  }

  /** Fix one point of the active sabotage. */
  private tryFix(player: PlayerState, spotId: string): boolean {
    if (!this.canAct(player)) return false;
    const spec = SABOTAGE_SPECS[this.state.sabotage.kind as SabotageKind];
    if (!spec || !spec.fixSpots.includes(spotId)) return false;
    const spot = WORLD.taskSpots.find((s) => s.id === spotId);
    if (!spot) return false;
    const sx = spot.tile.x * 32 + 16;
    const sy = spot.tile.y * 32 + 16;
    if (Math.hypot(player.x - sx, player.y - sy) > 56) return false;
    if (this.sabotageFixed.has(spotId)) return false;
    this.sabotageFixed.add(spotId);
    this.state.sabotage.fixed.push(spotId);
    const needed = fixesNeeded(spec);
    if (this.sabotageFixed.size >= needed) {
      this.state.sabotage.kind = '';
      this.state.sabotage.endsAt = 0;
      this.state.sabotage.fixed.clear();
      this.sabotageFixed.clear();
      this.systemMessage(`${spec.label} fixed. Nice work.`);
    } else {
      this.systemMessage(`${spec.label}: ${this.sabotageFixed.size}/${needed} fixed.`);
    }
    return true;
  }

  /** Start a sabotage. Shared so residents follow the same gate as humans. */
  private startSabotage(player: PlayerState, kind: SabotageKind): boolean {
    if (!this.canAct(player)) return false;
    if (this.roles.get(player.id) !== 'impostor') return false;
    if (this.state.sabotage.kind) return false;
    const spec = SABOTAGE_SPECS[kind];
    if (!spec) return false;
    this.state.sabotage.kind = spec.kind;
    this.state.sabotage.endsAt = Date.now() + spec.durationSec * 1000;
    this.state.sabotage.fixed.clear();
    this.sabotageFixed.clear();
    if (spec.kind === 'doors') {
      this.state.doorsClosedUntil = Date.now() + spec.durationSec * 1000;
    }
    if (spec.blocksInfo) this.state.taskBarVisible = false;
    // Sabotage shortens everyone's kill cooldown: the killer is free to move.
    this.state.players.forEach((p) => {
      if (this.roles.get(p.id) === 'impostor' && p.alive) p.killReadyAt = 0;
    });
    this.systemMessage(`\u26a0 ${spec.label}.`);
    this.broadcast('notice', { level: 'warn', text: `${spec.label} \u2014 ${spec.durationSec}s.` });
    this.touchRegistry();
    return true;
  }

  /** Report a body you are standing next to. */
  private tryReport(reporter: PlayerState, bodyId: string): boolean {
    if (!this.canAct(reporter)) return false;
    if (this.state.phase !== 'PLAY') return false;
    const body = this.state.bodies.get(bodyId);
    if (!body || body.reported) return false;
    if (Math.hypot(body.x - reporter.x, body.y - reporter.y) > 64) return false;
    this.callMeeting(reporter.id, 'report', body.id);
    return true;
  }

  /** Record a vote (null = skip). */
  private castVote(voter: PlayerState, target: string | null): boolean {
    if (!voter.alive) return false;
    if (this.state.phase !== 'MEETING' || this.state.meeting.stage !== 'VOTING') return false;
    if (target) {
      const other = this.state.players.get(target);
      if (!other || !other.alive) return false;
    }
    this.votes.set(voter.id, target);
    this.state.meeting.votesCast = this.votes.size;
    return true;
  }

  // -------------------------------------------------------- AI: the port
  //
  // GameRoom implements AiPort so the driver can act through the rules above
  // without owning any of them. Everything a resident can see passes the same
  // fog check the clients use.

  private aiSeatView(player: PlayerState): AiSeatView {
    return {
      id: player.id,
      name: player.visibleName || player.name,
      colorName: player.colorName,
      x: player.x,
      y: player.y,
      alive: player.alive,
      isAi: player.isAi,
      tasksDone: player.tasksDone,
      tasksTotal: player.tasksTotal,
      killReadyAt: player.killReadyAt,
    };
  }

  private aiPort(): AiPort {
    const self = this;
    return {
      now: () => Date.now(),
      phase: () => self.state.phase,
      practice: () => self.practice,
      ghostChatEnabled: () => self.state.settings.ghostChat,
      killRangePx: () => self.state.settings.killRange * 32,
      selfById: (id) => {
        const player = self.state.players.get(id);
        return player ? self.aiSeatView(player) : null;
      },
      seats: () => [...self.state.players.values()].map((p) => self.aiSeatView(p)),
      bodies: () =>
        [...self.state.bodies.values()]
          .filter((b) => !b.reported)
          .map((b) => ({ id: b.id, victimId: b.victimId, victimName: b.victimName, x: b.x, y: b.y })),
      sabotage: () => {
        const spec = SABOTAGE_SPECS[self.state.sabotage.kind as SabotageKind];
        return {
          kind: self.state.sabotage.kind,
          label: spec?.label ?? '',
          endsAt: self.state.sabotage.endsAt,
          fixSpots: spec?.fixSpots ?? [],
        };
      },
      meeting: () => ({
        active: self.state.meeting.active,
        stage: self.state.meeting.stage,
        endsAt: self.state.meeting.endsAt,
        votesCast: self.state.meeting.votesCast,
        votersAlive: [...self.state.players.values()].filter((p) => p.alive).length,
      }),
      chat: (limit) =>
        self.state.chat
          .filter((c) => !c.system)
          .slice(-limit)
          .map((c) => ({ from: c.name, text: c.text })),
      tasksOf: (id) =>
        (self.tasks.get(id) ?? []).map((t) => ({
          id: t.id,
          spotId: t.spotId,
          room: t.room,
          category: t.category,
          done: t.done,
          stage: t.stage,
          stages: t.stages,
        })),
      roleOf: (id) => {
        const team = self.roles.get(id) ?? 'crew';
        const fellows =
          team === 'impostor'
            ? [...self.roles.entries()]
                .filter(([otherId, otherTeam]) => otherTeam === 'impostor' && otherId !== id)
                .map(([otherId]) => self.state.players.get(otherId)?.name ?? otherId)
            : [];
        return { role: self.roleIds.get(id) ?? 'crewmate', team, fellows };
      },
      roomAt: (x, y) => self.roomOf(x, y),
      spot: (spotId) => {
        const spot = WORLD.taskSpots.find((s) => s.id === spotId);
        return spot ? { x: spot.tile.x * 32 + 16, y: spot.tile.y * 32 + 16 } : null;
      },
      sees: (id, x, y) => {
        const player = self.state.players.get(id);
        if (!player) return false;
        return canSeeAnywhere(
          self.gridFor(player),
          player.x,
          player.y,
          x,
          y,
          self.state.sabotage.kind === 'lights' ? DARK_VISION_TILES : undefined,
        );
      },
      pathTo: (id, x, y) => {
        const player = self.state.players.get(id);
        if (!player) return null;
        return findPath(self.gridFor(player), player.x, player.y, x, y);
      },
      patrolSpots: () =>
        WORLD.taskSpots.map((s) => ({ id: s.id, x: s.tile.x * 32 + 16, y: s.tile.y * 32 + 16 })),
      move: (id, x, y) => {
        const previous = self.moveInputs.get(id);
        self.moveInputs.set(id, { seq: (previous?.seq ?? 0) + 1, x, y, at: Date.now() });
      },
      say: (id, text) => {
        const player = self.state.players.get(id);
        if (player && text.trim().length > 0) self.say(player, text.trim().slice(0, MAX_CHAT_LEN));
      },
      doTask: (id, taskId) => {
        const player = self.state.players.get(id);
        return player ? self.completeTask(player, taskId) : false;
      },
      kill: (id, targetId) => {
        const killer = self.state.players.get(id);
        if (!killer) return false;
        const result = self.resolveKill(killer, targetId);
        return result === 'ok' || result === 'witnessed';
      },
      report: (id, bodyId) => {
        const reporter = self.state.players.get(id);
        return reporter ? self.tryReport(reporter, bodyId) : false;
      },
      vote: (id, target) => {
        const voter = self.state.players.get(id);
        if (voter) self.castVote(voter, target);
      },
      sabotageAction: (id, kind) => {
        const player = self.state.players.get(id);
        return player ? self.startSabotage(player, kind as SabotageKind) : false;
      },
      fix: (id, spotId) => {
        const player = self.state.players.get(id);
        return player ? self.tryFix(player, spotId) : false;
      },
      hasVoted: (id) => self.votes.has(id),
    };
  }

  private tick(_deltaMs: number): void {
    const started = performance.now();
    const now = Date.now();
    // Residents decide before movement is integrated, so a decision made this
    // tick is visible to the players in this tick's patch.
    if (this.ai) {
      try {
        this.ai.tick();
      } catch (err) {
        // A resident bug must never take the match down.
        logger.warn({ err: (err as Error).message }, 'ai driver tick failed');
      }
    }
    if (this.state.phase === 'PLAY') {
      this.state.players.forEach((player) => {
        const input = this.moveInputs.get(player.id);
        const fresh = input && now - input.at <= INPUT_TTL_MS ? input : null;
        const grid = this.gridFor(player);
        const step = fresh
          ? stepPlayer(grid, player.x, player.y, fresh.x, fresh.y, SIM_STEP_MS)
          : { x: player.x, y: player.y, moving: false, dirX: player.dirX, dirY: player.dirY };
        if (step.x !== player.x) player.x = step.x;
        if (step.y !== player.y) player.y = step.y;
        if (player.moving !== step.moving) player.moving = step.moving;
        if (step.dirX !== player.dirX) player.dirX = step.dirX;
        if (step.dirY !== player.dirY) player.dirY = step.dirY;
        if (fresh && player.seq !== fresh.seq) player.seq = fresh.seq;
      });
    }
    // ---- rules timers (MEETING phases, sabotage expiry) ----
    if (this.state.phase === 'MEETING' && this.state.meeting.active && now > this.meetingStageEndsAt) {
      if (this.state.meeting.stage === 'DISCUSSION') {
        this.state.meeting.stage = 'VOTING';
        this.state.meeting.endsAt = now + this.state.settings.votingSec * 1000;
        this.meetingStageEndsAt = this.state.meeting.endsAt;
        this.broadcast('notice', { level: 'info', text: 'Voting is open.' });
      } else {
        this.finishVoting();
      }
    }
    // ---- M3.5 timers: shifts, wards, cameras, sabotages ----
    if (this.state.phase === 'PLAY') {
      for (const [shifterId, victimId] of [...this.shifts.entries()]) {
        const shifter = this.state.players.get(shifterId);
        if (!shifter || now >= shifter.shiftUntil) {
          if (shifter) {
            shifter.visibleName = '';
            shifter.shiftUntil = 0;
          }
          this.shifts.delete(shifterId);
          void victimId;
          this.sendSecret(shifterId);
        }
      }
      for (const [targetId, until] of [...this.shields.entries()]) {
        if (now >= until) {
          this.shields.delete(targetId);
          const target = this.state.players.get(targetId);
          if (target) target.shieldUntil = 0;
        }
      }
      if (this.state.cameraInUseUntil > 0 && now > this.state.cameraInUseUntil) {
        this.state.cameraInUseBy = '';
        this.state.cameraInUseUntil = 0;
      }
      this.state.players.forEach((player) => {
        if (player.visualTaskUntil > 0 && now > player.visualTaskUntil) player.visualTaskUntil = 0;
        if (player.ventReadyAt > 0 && now > player.ventReadyAt) player.ventReadyAt = 0;
      });
      // Door log: anonymous crossings, kept short. Anyone can read it at the
      // comms console; it never says who.
      if (now - this.lastDoorSweep > 400) {
        this.lastDoorSweep = now;
        const seen = new Set<string>();
        for (const player of this.state.players.values()) {
          if (!player.alive) continue;
          const col = Math.floor(player.x / 32);
          const row = Math.floor(player.y / 32);
          for (const door of WORLD.doors) {
            const inside =
              col >= door.rect.x && col < door.rect.x + door.rect.w && row >= door.rect.y && row < door.rect.y + door.rect.h;
            if (!inside) continue;
            const key = `${door.id}:${player.id}`;
            seen.add(key);
            if (this.lastDoorSeen.has(key)) continue;
            this.lastDoorSeen.add(key);
            this.doorLog.push({ door: door.id.replace(/^door-/, ''), at: now });
            if (this.doorLog.length > 40) this.doorLog.shift();
          }
        }
        // Forget crossings we are no longer standing in, so re-entering logs again.
        for (const key of [...this.lastDoorSeen]) if (!seen.has(key)) this.lastDoorSeen.delete(key);
      }
    }
    if (this.state.phase === 'PLAY' && this.state.sabotage.kind) {
      const spec = SABOTAGE_SPECS[this.state.sabotage.kind as SabotageKind];
      if (spec && now > this.state.sabotage.endsAt) {
        if (spec.lethal) {
          this.checkWinNow();
        } else {
          if (spec.blocksInfo) this.state.taskBarVisible = true;
          this.state.sabotage.kind = '';
          this.state.sabotage.endsAt = 0;
          this.state.sabotage.fixed.clear();
          this.systemMessage(`${spec.label} fixed itself. The station resets.`);
        }
      }
    }

    this.ticks.record(performance.now() - started, this.state.players.size);
  }

  /** Teleport everyone (humans and residents) back to their spawn points. */
  private placeAtSpawns(): void {
    let index = 0;
    this.state.players.forEach((player) => {
      const spawn = spawnPosition(WORLD, index++);
      player.x = spawn.x;
      player.y = spawn.y;
      player.dirX = 0;
      player.dirY = 0;
      player.moving = false;
    });
    this.moveInputs.clear();
  }

  // ----------------------------------------------------------------- helpers

  private tryStart(client: Client): void {
    if (this.state.phase !== 'LOBBY') {
      this.notice(client, 'warn', 'The station is already open.');
      return;
    }
    const humans = [...this.state.players.values()].filter((p) => p.connected && !p.isAi);
    // Residents that actually took seats count; otherwise the host's AI-seat
    // setting stands in for seats nobody is sitting in yet.
    const residentSeats = [...this.state.players.values()].filter((p) => p.isAi).length;
    const aiSeats = residentSeats > 0 ? residentSeats : this.state.settings.aiSeats;
    const total = humans.length + aiSeats;
    const minPlayers = getAppConfig().gameDefaults.players.min;
    if (total < minPlayers) {
      this.notice(
        client,
        'warn',
        `Need ${minPlayers} seats to launch — you have ${total} (${humans.length} human + ${aiSeats} AI).`,
      );
      return;
    }
    // M3+: roles, tasks and the whole rulebook. Anyone who cannot play yet
    // (a lone host, a lobby under five seats) is told so instead of launched.
    this.startMatch();
  }

  // ----------------------------------------------------------- M3: match setup

  /** Deterministic-enough RNG so tests and sims can be seeded. */
  private random(): number {
    this.rngSeed = (this.rngSeed * 1103515245 + 12345) & 0x7fffffff;
    return this.rngSeed / 0x7fffffff;
  }

  private startMatch(practice = false): void {
    const players = [...this.state.players.values()];
    const ids = players.map((p) => p.id);
    this.practice = practice;

    // Practice is a free-roam round: no impostors, no parties, every console
    // usable. It exists so a new player can learn the station alone.
    const deal = practice
      ? {
          roleOf: new Map<string, RoleId>(ids.map((id) => [id, 'crewmate' as RoleId])),
          teamOf: new Map<string, Role>(ids.map((id) => [id, 'crew' as Role])),
        }
      : composeRoles(
          ids,
          this.state.settings.impostors,
          {
            engineerChance: this.state.settings.engineerChance,
            scientistChance: this.state.settings.scientistChance,
            guardianChance: this.state.settings.guardianChance,
            shapeshifterChance: this.state.settings.shapeshifterChance,
          },
          () => this.random(),
        );

    this.roleIds = new Map(deal.roleOf);
    this.roles = new Map(deal.teamOf);
    const crew = ids.filter((id) => this.roles.get(id) === 'crew');
    this.tasks = assignTasks(
      WORLD.taskSpots.map((spot) => ({ id: spot.id, room: spot.room, kind: spot.kind })),
      crew,
      taskPlanOf(this.state.settings),
      () => this.random(),
    );

    this.votes.clear();
    this.sabotageFixed.clear();
    this.shields.clear();
    this.shifts.clear();
    this.doorLog = [];
    this.abilities.clear();
    this.matchEnded = false;
    this.moveInputs.clear();
    this.lastEmergencyAt = 0;

    // Reset everyone onto spawn points with their rules fields.
    this.placeAtSpawns();
    const startCooldown = this.state.settings.initialKillCooldownSec * 1000;
    this.state.players.forEach((player) => {
      player.alive = true;
      player.isGhost = false;
      player.killReadyAt = Date.now() + startCooldown;
      player.emergenciesLeft = this.state.settings.emergencyMeetings;
      player.rolePublic = 'unknown';
      player.visibleName = '';
      player.shiftUntil = 0;
      player.shieldUntil = 0;
      player.venting = false;
      player.ventReadyAt = 0;
      player.visualTaskUntil = 0;
      const list = this.tasks.get(player.id) ?? [];
      player.tasksTotal = this.roles.get(player.id) === 'crew' ? totalSteps(list) : 0;
      player.tasksDone = 0;
      // Every role starts with its clocks ready (except a cooldown-gated tool).
      const role = this.roleIds.get(player.id) ?? 'crewmate';
      const clocks = new Map<AbilityId, AbilityClock>();
      for (const ability of ABILITY_IDS_FOR_ROLE(role)) {
        clocks.set(ability, freshClock(ABILITY_SPECS[ability]));
      }
      this.abilities.set(player.id, clocks);
    });

    this.state.bodies.clear();
    this.state.doorsClosedUntil = 0;
    this.state.cameraInUseBy = '';
    this.state.cameraInUseUntil = 0;
    this.state.sabotage.kind = '';
    this.state.sabotage.endsAt = 0;
    this.state.sabotage.fixed.clear();
    this.state.meeting.active = false;
    this.state.meeting.stage = '';
    this.state.result.winner = '';
    this.state.result.reason = '';
    this.state.result.text = '';
    this.state.practice = practice;
    this.state.taskBarVisible = this.state.settings.taskBarMode === 'always';
    this.recountTasks();
    this.state.phase = 'PLAY';
    this.touchRegistry();

    // Private role packets — the only place a role is ever sent.
    for (const player of players) this.sendSecret(player.id);

    this.broadcast('notice', {
      level: 'info',
      text: practice ? 'Practice mode: roam the station, every console is yours.' : 'Roles are out. Tasks are on your list.',
    });
    if (!practice) {
      const impostorCount = ids.filter((id) => this.roles.get(id) === 'impostor').length;
      this.systemMessage(`${players.length} crew on the station · ${impostorCount} impostor(s) among them.`);
    } else {
      this.systemMessage('Practice round — no impostors, no votes. Learn the station.');
    }
    logger.info({ code: this.code, players: players.length, practice }, 'match started');
  }

  // ------------------------------------------------------- M3.5: abilities

  private clockOf(playerId: string, ability: AbilityId): AbilityClock {
    let clocks = this.abilities.get(playerId);
    if (!clocks) {
      clocks = new Map();
      this.abilities.set(playerId, clocks);
    }
    let clock = clocks.get(ability);
    if (!clock) {
      clock = freshClock(ABILITY_SPECS[ability]);
      clocks.set(ability, clock);
    }
    return clock;
  }

  private roomOf(x: number, y: number): string {
    const col = Math.floor(x / 32);
    const row = Math.floor(y / 32);
    return WORLD.rooms.find((r) => col >= r.rect.x && col < r.rect.x + r.rect.w && row >= r.rect.y && row < r.rect.y + r.rect.h)?.id ?? '';
  }

  private useAbility(client: Client, playerId: string, ability: AbilityId, target?: string): void {
    const player = this.state.players.get(playerId);
    if (!player) return;
    const spec = ABILITY_SPECS[ability];
    const role = this.roleIds.get(playerId) ?? 'crewmate';
    const clock = this.clockOf(playerId, ability);
    const now = Date.now();
    const refusal = checkAbility(spec, clock, now, {
      role,
      alive: player.alive,
      isGhost: player.isGhost,
      inMeeting: this.state.meeting.active,
      room: this.roomOf(player.x, player.y),
    });
    if (refusal) {
      this.notice(client, 'warn', refusalTextOf(refusal));
      return;
    }

    switch (ability) {
      case 'vent': {
        this.notice(client, 'warn', 'Walk to a vent and use the vent button.');
        return;
      }
      case 'vitals': {
        // Portable vitals: who is alive, nothing else. Battery + recharge.
        const battery = ROLE_ABILITY.scientist.params.vitalsBatterySec ?? 10;
        const recharge = ROLE_ABILITY.scientist.params.vitalsRechargeSec ?? 15;
        clock.activeUntil = now + battery * 1000;
        clock.readyAt = now + (battery + recharge) * 1000;
        const rows = [...this.state.players.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => `${p.name}${p.alive ? '' : ' — DEAD'}`);
        client.send('tool', { id: 'vitals', rows });
        this.sendSecret(playerId);
        return;
      }
      case 'shield': {
        if (!target) {
          this.notice(client, 'warn', 'Pick someone to ward.');
          return;
        }
        const targetPlayer = this.state.players.get(target);
        if (!targetPlayer || !targetPlayer.alive) {
          this.notice(client, 'warn', 'They are not available to ward.');
          return;
        }
        if (this.roles.get(target) !== 'crew') {
          this.notice(client, 'warn', 'Wards only work on your own side.');
          return;
        }
        const range = (ROLE_ABILITY.guardian.params.shieldRangeTiles ?? 3) * 32;
        if (Math.hypot(targetPlayer.x - player.x, targetPlayer.y - player.y) > range) {
          this.notice(client, 'warn', 'Get closer to ward them.');
          return;
        }
        const duration = ROLE_ABILITY.guardian.params.shieldDurationSec ?? 10;
        const cooldown = ROLE_ABILITY.guardian.params.shieldCooldownSec ?? 35;
        this.shields.set(target, now + duration * 1000);
        targetPlayer.shieldUntil = now + duration * 1000;
        clock.activeUntil = now + duration * 1000;
        clock.readyAt = now + cooldown * 1000;
        this.noticeFor(target, 'info', 'A ward just went up around you.');
        this.notice(client, 'info', `Warding ${targetPlayer.name}.`);
        this.sendSecret(playerId);
        return;
      }
      case 'shift': {
        if (!target) {
          this.notice(client, 'warn', 'Pick a crewmate to look like.');
          return;
        }
        const victim = this.state.players.get(target);
        if (!victim) return;
        if (this.roles.get(target) === 'impostor') {
          this.notice(client, 'warn', 'You cannot wear your own side.');
          return;
        }
        const duration = ROLE_ABILITY.shapeshifter.params.shiftDurationSec ?? 10;
        const cooldown = ROLE_ABILITY.shapeshifter.params.shiftCooldownSec ?? 25;
        clock.activeUntil = now + duration * 1000;
        clock.readyAt = now + cooldown * 1000;
        this.shifts.set(playerId, victim.id);
        player.visibleName = victim.name;
        player.shiftUntil = now + duration * 1000;
        // Everyone nearby sees the change happen — that is the tell.
        this.broadcast('notice', { level: 'warn', text: `${player.name} shifts.` });
        this.sendSecret(playerId);
        return;
      }
      case 'admin': {
        const rows = this.adminRows();
        client.send('tool', { id: 'admin', rows });
        clock.usesLeft = Math.max(0, clock.usesLeft - 1);
        clock.readyAt = now + spec.cooldownSec * 1000;
        clock.activeUntil = now + spec.durationSec * 1000;
        this.sendSecret(playerId);
        return;
      }
      case 'camera': {
        this.state.cameraInUseBy = playerId;
        this.state.cameraInUseUntil = now + spec.durationSec * 1000;
        clock.usesLeft = Math.max(0, clock.usesLeft - 1);
        clock.readyAt = now + (spec.durationSec + spec.cooldownSec) * 1000;
        clock.activeUntil = now + spec.durationSec * 1000;
        client.send('tool', { id: 'camera', rows: this.cameraRows() });
        this.sendSecret(playerId);
        return;
      }
      case 'doorlog': {
        const rows = this.doorLog
          .slice(-12)
          .reverse()
          .map((entry) => `${entry.door} · ${new Date(entry.at).toLocaleTimeString()}`);
        client.send('tool', { id: 'doorlog', rows: rows.length ? rows : ['No door activity yet.'] });
        clock.usesLeft = Math.max(0, clock.usesLeft - 1);
        clock.readyAt = now + spec.cooldownSec * 1000;
        clock.activeUntil = now + spec.durationSec * 1000;
        this.sendSecret(playerId);
        return;
      }
    }
  }

  private endAbility(playerId: string, ability: AbilityId): void {
    const player = this.state.players.get(playerId);
    if (!player) return;
    const clock = this.clockOf(playerId, ability);
    if (ability === 'shift') {
      const victimId = this.shifts.get(playerId);
      this.shifts.delete(playerId);
      player.visibleName = '';
      player.shiftUntil = 0;
      void victimId;
    }
    if (ability === 'camera' && this.state.cameraInUseBy === playerId) {
      this.state.cameraInUseBy = '';
      this.state.cameraInUseUntil = 0;
    }
    if (clock.activeUntil > Date.now()) clock.activeUntil = Date.now();
    this.sendSecret(playerId);
  }

  /** Admin table: room -> how many people are in it. No names, by design. */
  private adminRows(): string[] {
    const counts = new Map<string, number>();
    for (const player of this.state.players.values()) {
      if (!player.alive) continue;
      const room = this.roomOf(player.x, player.y);
      if (!room) continue;
      counts.set(room, (counts.get(room) ?? 0) + 1);
    }
    return WORLD.rooms
      .map((room) => ({ name: room.name, count: counts.get(room.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => `${row.name}: ${row.count}`);
  }

  /** Cameras: where the living are, as rough room occupancy (no walls peeked). */
  private cameraRows(): string[] {
    return this.adminRows();
  }

  private sendSecret(playerId: string): void {
    const role = this.roles.get(playerId);
    if (!role) return;
    const roleId = this.roleIds.get(playerId) ?? (role === 'impostor' ? 'impostor' : 'crewmate');
    const mates =
      role === 'impostor'
        ? [...this.roles.entries()]
            .filter(([id, r]) => r === 'impostor' && id !== playerId)
            .map(([id]) => ({ id, name: this.state.players.get(id)?.name ?? '?' }))
        : [];
    const clocks: SecretRole['abilities'] = [];
    for (const ability of ABILITY_IDS_FOR_ROLE(roleId)) {
      const clock = this.clockOf(playerId, ability);
      clocks.push({
        id: ability,
        readyAt: clock.readyAt,
        activeUntil: clock.activeUntil,
        usesLeft: clock.usesLeft,
      });
    }
    const secret: SecretRole = {
      role,
      roleId,
      mates,
      tasks: this.tasks.get(playerId) ?? [],
      abilities: clocks,
      ejected: false,
    };
    // The client also wants the one-line rules summary + the role's own numbers.
    const payload = {
      ...secret,
      label: ROLE_LABEL[roleId],
      summary: ROLE_SUMMARY[roleId],
      params: ROLE_ABILITY[roleId].params,
      practice: this.practice,
    };
    const client = this.clients.find((c) => c.sessionId === playerId);
    client?.send('you', payload);
  }

  private spawnBody(victimId: string): void {
    const victim = this.state.players.get(victimId);
    if (!victim) return;
    const body = new BodyState();
    body.id = `body-${victimId}-${Date.now()}`;
    body.victimId = victimId;
    body.victimName = victim.name;
    body.color = victim.color;
    body.x = victim.x;
    body.y = victim.y;
    body.killedAt = Date.now();
    body.reported = false;
    this.state.bodies.set(body.id, body);
  }

  /**
   * Tasks left across the crew, counted in *steps* so a half-finished long task
   * really does leave work on the board. A ghost's list still counts (they can
   * finish it), which is why this does not filter on `alive`.
   */
  private recountTasks(): void {
    let remaining = 0;
    for (const player of this.state.players.values()) {
      if (this.roles.get(player.id) !== 'crew') continue;
      const list = this.tasks.get(player.id) ?? [];
      remaining += totalSteps(list) - doneSteps(list);
    }
    this.state.tasksRemaining = remaining;
  }

  private livingOf(role: Role): number {
    let count = 0;
    for (const player of this.state.players.values()) {
      if (player.alive && this.roles.get(player.id) === role) count++;
    }
    return count;
  }

  private gridFor(player: { isGhost: boolean }): typeof GRID {
    if (player.isGhost) return OPEN_GRID; // ghosts drift through walls
    if (Date.now() < this.state.doorsClosedUntil) return GRID_DOORS;
    return GRID;
  }

  private endMatch(winner: 'crew' | 'impostor', reason: Parameters<typeof describeWin>[0]): void {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.state.phase = 'END';
    this.state.meeting.active = false;
    this.state.sabotage.kind = '';
    this.state.result.winner = winner;
    this.state.result.reason = reason;
    this.state.result.text = describeWin(reason, winner);
    // Roles become public at the end — this is the reveal.
    this.state.players.forEach((player) => {
      player.rolePublic = this.roles.get(player.id) ?? 'crew';
    });
    for (const player of this.state.players.values()) this.sendSecret(player.id);
    this.systemMessage(this.state.result.text);
    this.touchRegistry();
    logger.info({ code: this.code, winner, reason }, 'match ended');
  }

  private checkWinNow(): void {
    if (this.matchEnded || this.state.phase === 'LOBBY') return;
    const result = checkWin({
      crewAlive: this.livingOf('crew'),
      impostorsAlive: this.livingOf('impostor'),
      tasksRemaining: this.state.tasksRemaining,
      reactorCritical:
        (this.state.sabotage.kind === 'reactor' || this.state.sabotage.kind === 'o2') &&
        Date.now() > this.state.sabotage.endsAt,
    });
    if (result) this.endMatch(result.winner, result.reason);
  }

  // ---------------------------------------------------------- M3: meetings

  private callMeeting(callerId: string, reason: string, bodyId = ''): void {
    if (this.state.phase !== 'PLAY' || this.state.meeting.active) return;
    const caller = this.state.players.get(callerId);
    if (!caller) return;
    const now = Date.now();
    if (reason === 'emergency' && now < this.lastEmergencyAt) {
      this.noticeFor(callerId, 'warn', 'The button is still cooling down.');
      return;
    }
    if (reason === 'emergency') {
      this.lastEmergencyAt = now + this.state.settings.emergencyCooldownSec * 1000;
    }
    this.votes.clear();
    this.state.phase = 'MEETING';
    this.state.meeting.active = true;
    this.state.meeting.stage = 'DISCUSSION';
    this.state.meeting.calledBy = callerId;
    this.state.meeting.reason = reason;
    this.state.meeting.bodyId = bodyId;
    this.state.meeting.votesCast = 0;
    this.state.meeting.votersAlive = [...this.state.players.values()].filter((p) => p.alive).length;
    this.state.meeting.endsAt = now + this.state.settings.discussionSec * 1000;
    this.meetingStageEndsAt = this.state.meeting.endsAt;
    // Meetings pause the station: cameras close, task bar per the host's mode.
    this.state.cameraInUseBy = '';
    this.state.cameraInUseUntil = 0;
    this.state.taskBarVisible = this.state.settings.taskBarMode !== 'never';
    if (bodyId) {
      const body = this.state.bodies.get(bodyId);
      if (body) body.reported = true;
    }
    // Bodies are cleared once reported, like the genre does it.
    if (bodyId) this.state.bodies.clear();
    if (reason === 'emergency') {
      caller.emergenciesLeft = Math.max(0, caller.emergenciesLeft - 1);
      this.systemMessage(`${caller.name} hit the emergency button.`);
    } else {
      this.systemMessage(`${caller.name} reported a body.`);
    }
    this.broadcast('notice', { level: 'info', text: 'Meeting — talk it out, then vote.' });
    this.touchRegistry();
  }

  private finishVoting(): void {
    const tally = tallyVotes(this.votes);
    this.state.meeting.active = false;
    this.state.meeting.stage = '';
    this.state.phase = 'PLAY';
    this.votes.clear();
    this.state.taskBarVisible =
      this.state.settings.taskBarMode === 'always' && !this.state.sabotage.kind;
    // Every meeting restarts the killers' clocks — nobody leaves a vote ready to kill.
    const cooldown = this.state.settings.killCooldownSec * 1000;
    this.state.players.forEach((p) => {
      if (this.roles.get(p.id) === 'impostor' && p.alive) p.killReadyAt = Date.now() + cooldown;
    });

    let ejectedName = 'nobody';
    if (tally.ejected) {
      const player = this.state.players.get(tally.ejected);
      if (player) {
        player.alive = false;
        player.isGhost = true;
        player.moving = false;
        player.rolePublic = this.state.settings.confirmEjects
          ? this.roles.get(player.id) ?? 'crew'
          : this.state.settings.revealEjectedRole
            ? this.roleIds.get(player.id) ?? 'crewmate'
            : 'unknown';
        ejectedName = player.name;
        // Ejection counts as a reveal to the ejected player themselves.
        this.sendSecret(player.id);
      }
    }
    const summary =
      tally.ejected && ejectedName !== 'nobody'
        ? `${ejectedName} was ejected (${tally.counts[0]?.votes ?? 0} votes).`
        : 'No one was ejected.';
    this.systemMessage(summary);
    this.broadcast('verdict', {
      ejected: tally.ejected,
      name: ejectedName,
      counts: tally.counts,
      skipped: tally.skipped,
      text: summary,
    });
    this.recountTasks();
    this.checkWinNow();
    this.touchRegistry();
  }


  /** Back to the lobby (host action, used between games and by the harness). */
  private returnToLobby(): void {
    if (this.state.phase === 'LOBBY') return;
    this.state.phase = 'LOBBY';
    this.moveInputs.clear();
    this.roles.clear();
    this.roleIds.clear();
    this.tasks.clear();
    this.votes.clear();
    this.abilities.clear();
    this.shields.clear();
    this.shifts.clear();
    this.doorLog = [];
    this.practice = false;
    this.state.practice = false;
    this.state.cameraInUseBy = '';
    this.state.cameraInUseUntil = 0;
    this.state.taskBarVisible = true;
    this.state.bodies.clear();
    this.state.meeting.active = false;
    this.state.sabotage.kind = '';
    this.state.doorsClosedUntil = 0;
    this.touchRegistry();
    this.broadcast('notice', { level: 'info', text: 'Back in the lobby.' });
  }

  private applySettings(patch: LobbySettingsPatch): void {
    const current = readSettings(this.state.settings as unknown as Record<string, unknown>);
    const next = clampSettings(patch, current);
    copySettings(this.state.settings as unknown as Record<string, unknown>, next);
    this.state.taskBarVisible = next.taskBarMode === 'always' && !this.state.sabotage.kind;
    if (this.state.players.size >= next.maxPlayers) this.lock();
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

  /** Alive, in a live round, not mid-meeting. */
  private canAct(player: { alive: boolean; isGhost: boolean }): boolean {
    return this.state.phase === 'PLAY' && player.alive && !player.isGhost;
  }

  /**
   * Chat routing, in one place so every chat path (typed, quick-chat, AI) obeys
   * the same rules:
   *   - during a meeting: everyone alive talks; ghosts talk only if the host
   *     left ghost chat on, and their lines are marked;
   *   - during play: no chat at all except ghosts (a chat window mid-round is a
   *     cheat sheet), and nothing while the lights are out if the host says so.
   */
  private say(player: PlayerState, text: string): void {
    const meeting = this.state.meeting.active;
    const ghost = !player.alive || player.isGhost;
    // The lobby and the result screen have no secrecy at all: everyone can talk.
    if (this.state.phase === 'LOBBY' || this.state.phase === 'END') {
      this.pushChat({
        id: player.id,
        name: ghost ? `${player.name} (ghost)` : player.name,
        color: player.color,
        text,
        ts: Date.now(),
        system: false,
      });
      return;
    }
    if (meeting) {
      if (ghost && !this.state.settings.ghostChat) {
        this.noticeFor(player.id, 'warn', 'Ghost chat is off in this round.');
        return;
      }
    } else {
      if (!ghost) {
        this.noticeFor(player.id, 'warn', 'Chat opens during meetings.');
        return;
      }
      if (!this.state.settings.ghostChat) {
        this.noticeFor(player.id, 'warn', 'Ghost chat is off in this round.');
        return;
      }
      if (this.state.sabotage.kind === 'lights' && !this.state.settings.chatDuringLightsOut) {
        this.noticeFor(player.id, 'warn', 'The lights are out — nothing gets through.');
        return;
      }
    }
    this.pushChat({
      id: player.id,
      name: ghost ? `${player.name} (ghost)` : player.name,
      color: player.color,
      text,
      ts: Date.now(),
      system: false,
    });
  }

  private noticeFor(playerId: string, level: 'info' | 'warn' | 'error', text: string): void {
    this.clients.find((c) => c.sessionId === playerId)?.send('notice', { level, text });
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

/**
 * Which abilities a role owns, in HUD order. Station tools (admin table, cameras,
 * door log) are public property of the station, so every seat gets their clocks
 * and the room decides who may actually read them.
 */
function ABILITY_IDS_FOR_ROLE(role: RoleId): AbilityId[] {
  const ids: AbilityId[] = [];
  const own = ROLE_ABILITY[role].ability;
  if (own) ids.push(own);
  for (const tool of STATION_TOOLS) if (!ids.includes(tool)) ids.push(tool);
  return ids;
}

/** The tools bolted to the station itself. */
const STATION_TOOLS: AbilityId[] = ['admin', 'camera', 'doorlog'];

/** Mirror the synced settings object into a plain object. */
function readSettings(settings: Record<string, unknown>): typeof DEFAULT_SETTINGS {
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = settings[key];
    if (value !== undefined) out[key] = value;
  }
  return out as typeof DEFAULT_SETTINGS;
}

/** Write a plain settings object back into the schema (only known keys). */
function copySettings(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = source[key];
    if (value === undefined) continue;
    if (target[key] !== value) target[key] = value;
  }
}

/** One-line reason text for a refused ability, shared by every handler. */
function refusalTextOf(reason: string): string {
  switch (reason) {
    case 'cooldown':
      return 'Recharging.';
    case 'no-uses':
      return 'No uses left this round.';
    case 'busy':
      return 'Already running.';
    case 'wrong-room':
      return 'You are not at that console.';
    case 'dead':
      return 'Not while you are a ghost.';
    case 'meeting':
      return 'Not during a meeting.';
    default:
      return 'Your role cannot do that.';
  }
}

function clientIp(client: Client): string {
  const anyClient = client as unknown as { ip?: string; userData?: { ip?: string } };
  return anyClient.ip ?? 'unknown';
}

export { RECONNECT_GRACE_SEC };
