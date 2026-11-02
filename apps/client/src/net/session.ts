/**
 * Colyseus session wrapper: create / join-by-code / reconnect, plus the tiny
 * REST helper for resolving a 5-letter code to a room id.
 *
 * Everything the UI needs arrives through callbacks, so screens never touch the
 * socket directly.
 */
import { Client, type Room } from '@colyseus/sdk';

/** Colyseus maps/arrays -> plain arrays for the view layer. */
function collectionToArray<T>(source: unknown): T[] {
  const out: T[] = [];
  const collection = source as { forEach?: (cb: (v: T) => void) => void } | undefined;
  if (collection?.forEach) collection.forEach((v) => out.push({ ...v }));
  else if (Array.isArray(source)) out.push(...(source as T[]));
  return out;
}
import { clearReconnect, loadReconnect, saveReconnect } from '../lib/prefs.js';
import { apiUrl, serverWsUrl } from './endpoint.js';

export interface Notice {
  level: 'info' | 'warn' | 'error';
  text: string;
}

/** Shape of the synced state as the client sees it (read-only view). */
export interface PlayerRow {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isHost: boolean;
  isAi: boolean;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  x: number;
  y: number;
  alive: boolean;
  isGhost: boolean;
  tasksDone: number;
  tasksTotal: number;
  killReadyAt: number;
  emergenciesLeft: number;
  rolePublic: string;
  // --- M3.5 ---
  /** Name to draw over this pod (a shifter wears someone else's). */
  visibleName: string;
  shiftUntil: number;
  shieldUntil: number;
  venting: boolean;
  ventReadyAt: number;
  visualTaskUntil: number;
  /** Original cosmetics (look-only). */
  hat: string;
  skin: string;
  pet: string;
  nameplate: string;
}

export interface ChatRow {
  id: string;
  name: string;
  color: string;
  text: string;
  ts: number;
  system: boolean;
}

export interface SettingsRow {
  maxPlayers: number;
  aiSeats: number;
  impostors: number;
  discussionSec: number;
  votingSec: number;
  killCooldownSec: number;
  initialKillCooldownSec: number;
  emergencyMeetings: number;
  emergencyCooldownSec: number;
  playerSpeed: number;
  crewVisionTiles: number;
  impostorVisionTiles: number;
  killRange: number;
  taskShort: number;
  taskLong: number;
  taskCommon: number;
  taskVisual: number;
  tasksPerCrew: number;
  taskBarMode: string;
  visualTasks: boolean;
  anonymousVotes: boolean;
  confirmEjects: boolean;
  ghostChat: boolean;
  chatDuringLightsOut: boolean;
  engineerChance: number;
  scientistChance: number;
  guardianChance: number;
  shapeshifterChance: number;
  mapId: string;
  costCapUsd: number;
  revealEjectedRole: boolean;
  aiAggression: number;
}

export interface BodyRow {
  id: string;
  victimId: string;
  victimName: string;
  color: string;
  x: number;
  y: number;
  killedAt: number;
  reported: boolean;
}

export interface SabotageRow {
  kind: string;
  endsAt: number;
  fixed: string[];
}

export interface MeetingRow {
  active: boolean;
  stage: string;
  calledBy: string;
  reason: string;
  bodyId: string;
  endsAt: number;
  votesCast: number;
  votersAlive: number;
}

export interface ResultRow {
  winner: string;
  reason: string;
  text: string;
}

export interface LobbyView {
  code: string;
  phase: string;
  hostId: string;
  station: string;
  version: string;
  settings: SettingsRow;
  players: PlayerRow[];
  chat: ChatRow[];
  // --- M3 ---
  bodies: BodyRow[];
  sabotage: SabotageRow;
  meeting: MeetingRow;
  result: ResultRow;
  tasksRemaining: number;
  doorsClosedUntil: number;
  // --- M3.5 ---
  cameraInUseBy: string;
  cameraInUseUntil: number;
  taskBarVisible: boolean;
  practice: boolean;
}

/**
 * Private packet: role, team-mates, ability clocks and the task list. Never in
 * public state.
 */
export interface SecretRow {
  role: 'crew' | 'impostor';
  /** crewmate | impostor | engineer | scientist | guardian | shapeshifter */
  roleId: string;
  mates: Array<{ id: string; name: string }>;
  tasks: Array<{
    id: string;
    spotId: string;
    room: string;
    minigame: string;
    done: boolean;
    /** short | long | common | visual */
    category?: string;
    /** Long tasks run in stages; `stage` is how far along this seat is. */
    stage?: number;
    stages?: number;
  }>;
  abilities: Array<{ id: string; readyAt: number; activeUntil: number; usesLeft: number }>;
  /** One-line role name and rules, straight from the shared tables. */
  label?: string;
  summary?: string;
  params?: Record<string, number>;
  practice?: boolean;
}

/** Answer to an admin / camera / door-log / vitals request. */
export interface ToolRow {
  id: 'admin' | 'camera' | 'doorlog' | 'vitals';
  rows: string[];
}

export interface VerdictRow {
  ejected: string | null;
  name: string;
  counts: Array<{ target: string; votes: number }>;
  skipped: number;
  text: string;
}

export interface SessionHandlers {
  onState: (view: LobbyView, you: PlayerRow | undefined) => void;
  onNotice: (notice: Notice) => void;
  onKicked: (reason: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onSecret?: (secret: SecretRow) => void;
  onVerdict?: (verdict: VerdictRow) => void;
  onTool?: (tool: ToolRow) => void;
}

function endpoint(): string {
  // Same-origin in the browser (Vite proxies in dev, the Node server serves the
  // bundle in production). In the native Android shell this is the Render URL.
  return serverWsUrl();
}

export class Session {
  private client = new Client(endpoint());
  room: Room<LobbyView> | null = null;
  private handlers: SessionHandlers | null = null;
  /** Latest private packet (role + tasks). Cleared when the room is left. */
  secret: SecretRow | null = null;

  setHandlers(handlers: SessionHandlers): void {
    this.handlers = handlers;
  }

  get selfId(): string {
    return this.room?.sessionId ?? '';
  }

  async createRoom(name: string, cosmetics?: Record<string, string>): Promise<void> {
    const room = (await this.client.create('game', { name, cosmetics })) as unknown as Room<LobbyView>;
    this.attach(room);
  }

  /**
   * The default way in: ask the gateway which lobby is open and join it, or open
   * a new one. No code is typed by the player — the code is only how the owner
   * console addresses this match afterwards.
   */
  async play(name: string, cosmetics?: Record<string, string>): Promise<void> {
    const open = await fetch(apiUrl('/api/play'))
      .then((r) => (r.ok ? r.json() : { room: null }))
      .catch(() => ({ room: null })) as { room: { roomId: string } | null };
    if (open.room?.roomId) {
      try {
        const room = (await this.client.joinById(open.room.roomId, { name, cosmetics })) as unknown as Room<LobbyView>;
        this.attach(room);
        return;
      } catch {
        // The lobby filled up or closed between the lookup and the join: open one.
      }
    }
    const room = (await this.client.create('game', { name, cosmetics })) as unknown as Room<LobbyView>;
    this.attach(room);
  }

  async joinByCode(code: string, name: string, cosmetics?: Record<string, string>): Promise<void> {
    const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(code)}`));
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'No station with that code');
    }
    const info = (await res.json()) as { roomId: string };
    const room = (await this.client.joinById(info.roomId, { name, cosmetics })) as unknown as Room<LobbyView>;
    this.attach(room);
  }

  /** Try to resume the tab's previous seat (60 s server-side grace window). */
  async tryReconnect(): Promise<boolean> {
    const saved = loadReconnect();
    if (!saved) return false;
    try {
      const room = (await this.client.reconnect(saved.token)) as unknown as Room<LobbyView>;
      this.attach(room);
      return true;
    } catch {
      clearReconnect();
      return false;
    }
  }

  private attach(room: Room<LobbyView>): void {
    this.room = room;
    saveReconnect(room.reconnectionToken, room.roomId);

    room.onMessage('notice', (notice: Notice) => this.handlers?.onNotice(notice));
    room.onMessage('you', (secret: SecretRow) => {
      this.secret = secret;
      this.handlers?.onSecret?.(secret);
    });
    room.onMessage('verdict', (verdict: VerdictRow) => this.handlers?.onVerdict?.(verdict));
    room.onMessage('tool', (tool: ToolRow) => this.handlers?.onTool?.(tool));
    room.onMessage('kicked', (payload: { reason: string }) => {
      this.handlers?.onKicked(payload.reason);
      clearReconnect();
    });
    room.onStateChange((state) => this.emitState(state));
    room.onDrop(() => this.handlers?.onDisconnect());
    room.onReconnect(() => this.handlers?.onReconnect());
    room.onLeave((code) => {
      if (code !== 1000) this.handlers?.onDisconnect();
      clearReconnect();
    });
  }

  private emitState(state: LobbyView): void {
    const players: PlayerRow[] = [];
    const map = state.players as unknown as { forEach: (cb: (v: PlayerRow, k: string) => void) => void };
    map.forEach((p) => players.push({ ...p }));
    players.sort((a, b) => a.joinedAt - b.joinedAt);
    const view: LobbyView = {
      code: state.code,
      phase: state.phase,
      hostId: state.hostId,
      station: state.station,
      version: state.version,
      settings: { ...(state.settings as SettingsRow) },
      players,
      chat: [...(state.chat as unknown as ChatRow[])].map((c) => ({ ...c })),
      bodies: collectionToArray<BodyRow>(state.bodies),
      sabotage: {
        kind: state.sabotage?.kind ?? '',
        endsAt: state.sabotage?.endsAt ?? 0,
        fixed: [...((state.sabotage?.fixed ?? []) as unknown as string[])],
      },
      meeting: { ...(state.meeting as MeetingRow) },
      result: { ...(state.result as ResultRow) },
      tasksRemaining: state.tasksRemaining ?? 0,
      doorsClosedUntil: state.doorsClosedUntil ?? 0,
      cameraInUseBy: state.cameraInUseBy ?? '',
      cameraInUseUntil: state.cameraInUseUntil ?? 0,
      taskBarVisible: state.taskBarVisible !== false,
      practice: state.practice === true,
    };
    this.handlers?.onState(
      view,
      players.find((p) => p.id === this.selfId),
    );
  }

  send(type: string, payload: unknown = {}): void {
    this.room?.send(type, payload);
  }

  async leave(): Promise<void> {
    clearReconnect();
    this.secret = null;
    try {
      await this.room?.leave(true);
    } finally {
      this.room = null;
    }
  }
}
