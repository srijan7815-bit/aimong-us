/**
 * Colyseus session wrapper: create / join-by-code / reconnect, plus the tiny
 * REST helper for resolving a 5-letter code to a room id.
 *
 * Everything the UI needs arrives through callbacks, so screens never touch the
 * socket directly.
 */
import { Client, type Room } from '@colyseus/sdk';
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
  tasksPerCrew: number;
  costCapUsd: number;
  revealEjectedRole: boolean;
  aiAggression: number;
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
}

export interface SessionHandlers {
  onState: (view: LobbyView, you: PlayerRow | undefined) => void;
  onNotice: (notice: Notice) => void;
  onKicked: (reason: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
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

  setHandlers(handlers: SessionHandlers): void {
    this.handlers = handlers;
  }

  get selfId(): string {
    return this.room?.sessionId ?? '';
  }

  async createRoom(name: string): Promise<void> {
    const room = (await this.client.create('game', { name })) as unknown as Room<LobbyView>;
    this.attach(room);
  }

  async joinByCode(code: string, name: string): Promise<void> {
    const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(code)}`));
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'No station with that code');
    }
    const info = (await res.json()) as { roomId: string };
    const room = (await this.client.joinById(info.roomId, { name })) as unknown as Room<LobbyView>;
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
    try {
      await this.room?.leave(true);
    } finally {
      this.room = null;
    }
  }
}
