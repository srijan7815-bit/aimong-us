/**
 * The station scene: terrain, pods, fog, camera and movement.
 *
 * Responsibilities are deliberately split:
 *   • prediction  — the local pod is stepped with the SAME shared function the
 *                   server uses, so what you see is what the server computes;
 *                   server corrections are applied to the prediction history, not
 *                   by teleporting the pod (no rubber-banding).
 *   • remote pods — interpolated ~90 ms in the past between state snapshots.
 *   • fog         — from the shared vision mask, redrawn at 10 Hz.
 *
 * There is no game logic here: rules (roles, tasks, kills) belong to the server.
 */
import Phaser from 'phaser';
import {
  SIM_STEP_MS,
  TILE_SIZE,
  WORLD,
  stepPlayer,
  type PlayerView,
} from '@aimong/shared';
import { grid, maskAt } from './fog.js';
import { DARK_VISION_TILES, WORLD as MAP, buildGrid, openGrid } from '@aimong/shared';
import { ATLAS_TEXTURE, type AtlasManifest } from './atlas.js';

export interface BodyView {
  id: string;
  victimName: string;
  color: string;
  x: number;
  y: number;
}

export interface StationBridge {
  selfId(): string;
  players(): PlayerView[];
  sendInput(seq: number, x: number, y: number): void;
  isPlaying(): boolean;
  /** Bodies on the floor (public). */
  bodies(): BodyView[];
  /** 'lights' | 'reactor' | 'doors' | '' */
  sabotage(): string;
  doorsClosed(): boolean;
  /** True when the local player is a ghost (walks through walls). */
  isGhost(): boolean;
}

export interface HudState {
  roomName: string;
  players: number;
  fps: number;
  ping: number;
}

interface Pod {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  visor: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  isSelf: boolean;
  /** Remote interpolation buffer. */
  buffer: Array<{ t: number; x: number; y: number }>;
  lastX: number;
  lastY: number;
}

const SEND_INTERVAL_MS = 1000 / 20;
const INTERP_DELAY_MS = 90;
const SNAP_DISTANCE_PX = 48;

export class StationScene extends Phaser.Scene {
  private bridge!: StationBridge;
  private atlas!: AtlasManifest;
  private pods = new Map<string, Pod>();
  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    UP: Phaser.Input.Keyboard.Key;
    DOWN: Phaser.Input.Keyboard.Key;
    LEFT: Phaser.Input.Keyboard.Key;
    RIGHT: Phaser.Input.Keyboard.Key;
  } | null;

  /** Analog input from the on-screen joystick, -1..1 each axis. */
  joystick = { x: 0, y: 0 };

  private predicted = { x: 0, y: 0 };
  /**
   * Visual error, in pixels: where the pod is drawn relative to the prediction.
   *
   * The prediction itself is used unmodified for motion (zero input lag); only
   * the *correction* the server pushes back is spread over ~45 ms by decaying
   * this offset. A smooth-follow lerp was the obvious alternative and is wrong:
   * once it falls behind at low frame rates it never catches up again.
   */
  private visualOffset = { x: 0, y: 0 };
  private needsResync = false;
  private history: Array<{ seq: number; x: number; y: number }> = [];
  private seq = 0;
  private lastSend = 0;
  private appliedSeq = -1;

  private fog!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogImageData!: ImageData;
  private lastFog = 0;

  private terrain?: Phaser.GameObjects.Image;
  private bodySprites = new Map<string, Phaser.GameObjects.Container>();
  private doorLayer?: Phaser.GameObjects.Graphics;
  private lightsOut = false;
  private ghostMode = false;
  private lastHud = 0;
  private onHud?: (state: HudState) => void;
  /** Last fog mask painted, kept for the ?debug=1 hook. */
  private lastMask: { x: number; y: number; visible: number; hash: string } | null = null;

  constructor(
    private readonly options: { bridge: StationBridge; atlas: AtlasManifest; onHud?: (s: HudState) => void },
  ) {
    super('station');
    this.bridge = options.bridge;
    this.atlas = options.atlas;
    this.onHud = options.onHud;
  }

  preload(): void {
    this.load.image(ATLAS_TEXTURE, `${import.meta.env.BASE_URL}assets/atlas/${import.meta.env.VITE_ATLAS ?? 'placeholder'}/${this.atlas.image}`);
  }

  create(): void {
    // Register each manifest frame on the texture. Without this, setCrop() keeps
    // atlas coordinates and every pod/task sprite drifts off its anchor.
    const texture = this.textures.get(ATLAS_TEXTURE);
    for (const [name, f] of Object.entries(this.atlas.frames)) {
      if (!texture.has(name)) texture.add(name, 0, f.x, f.y, f.w, f.h);
    }
    this.buildTerrain();
    this.buildFog();
    this.buildPods();

    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD.cols * TILE_SIZE, WORLD.rows * TILE_SIZE);
    camera.setBackgroundColor('#05080f');
    // Zoom so roughly 14 tiles are visible across the short side of a phone in
    // landscape — close enough to feel like a person, wide enough to see a room.
    const zoomFor = (): number => {
      const short = Math.min(this.scale.width, this.scale.height);
      return Phaser.Math.Clamp(short / (14 * TILE_SIZE), 1.1, 2.2);
    };
    camera.setZoom(zoomFor());
    this.scale.on('resize', () => camera.setZoom(zoomFor()));

    const self = this.bridge.selfId();
    const player = this.bridge.players().find((p) => p.id === self);
    if (player) {
      this.predicted = { x: player.x, y: player.y };
      this.visualOffset = { x: 0, y: 0 };
      const focus = this.pods.get(self)?.container ?? [...this.pods.values()][0]?.container;
      if (focus) camera.startFollow(focus, true, 0.18, 0.18);
    }

    // Coming back from a backgrounded tab: rAF was throttled, so the local
    // prediction is stale. Resync from the server instead of letting the
    // reconciler drag the pod across the room.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        this.needsResync = true;
        return;
      }
      if (!this.needsResync) return;
      this.needsResync = false;
      const me = this.bridge.players().find((p) => p.id === this.bridge.selfId());
      if (me) {
        this.predicted = { x: me.x, y: me.y };
        this.visualOffset = { x: 0, y: 0 };
        this.history = [];
        this.appliedSeq = -1;
      }
    });

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as unknown as NonNullable<
        StationScene['keys']
      >;
      // Some phone browsers scroll the page when you press space; not needed here.
      keyboard.addCapture(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
    }

    this.events.once('shutdown', () => this.scale.removeAllListeners('resize'));

    // Test hook: only with ?debug=1, so the shipped app exposes nothing extra.
    // The automated M2 checks read the predicted position and the fog the client
    // actually painted, and compare that fog with the server's calculation.
    if (new URLSearchParams(location.search).has('debug')) {
      (window as unknown as Record<string, unknown>).__station = {
        predicted: () => ({ ...this.predicted }),
        appliedSeq: () => this.appliedSeq,
        history: () => this.history.slice(-8).map((h) => ({ ...h })),
        server: () =>
          this.bridge.players().map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), seq: p.seq })),
        mask: () => this.lastMask,
        pods: () =>
          [...this.pods.entries()].map(([id, pod]) => ({
            id,
            name: pod.label.text,
            x: Math.round(pod.container.x),
            y: Math.round(pod.container.y),
            self: pod.isSelf,
          })),
        fps: () => Math.round(this.game.loop.actualFps),
      };
    }
  }

  // ------------------------------------------------------------- construction

  private frame(name: string): { x: number; y: number; w: number; h: number } {
    const frame = this.atlas.frames[name] ?? this.atlas.frames.floor;
    if (!frame) throw new Error('atlas has no frames');
    return frame;
  }

  /** Atlas frame name, falling back to the plain floor tile. */
  private frameName(name: string): string {
    return this.atlas.frames[name] ? name : 'floor';
  }

  /** Draw the whole station once into a single canvas texture (fast to render). */
  private buildTerrain(): void {
    const width = WORLD.cols * TILE_SIZE;
    const height = WORLD.rows * TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = false;

    const source = this.textures.get(ATLAS_TEXTURE).getSourceImage() as HTMLImageElement;
    const draw = (name: string, dx: number, dy: number): void => {
      const f = this.frame(name);
      ctx.drawImage(source, f.x, f.y, f.w, f.h, dx, dy, TILE_SIZE, TILE_SIZE);
    };

    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, width, height);

    for (let row = 0; row < WORLD.rows; row++) {
      const line = WORLD.ascii[row] ?? '';
      for (let col = 0; col < WORLD.cols; col++) {
        const ch = line[col] ?? ' ';
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        if (ch === '.') draw((col + row) % 7 === 0 ? 'floorAlt' : 'floor', x, y);
        else if (ch === '#') draw('wall', x, y);
        // ' ' (void) stays background — the station floats in the dark.
      }
    }

    // task spots and vents sit on top of the floor
    for (const task of WORLD.taskSpots) draw(this.frameName('task'), task.tile.x * TILE_SIZE, task.tile.y * TILE_SIZE);
    for (const vent of WORLD.vents) draw(this.frameName('vent'), vent.tile.x * TILE_SIZE, vent.tile.y * TILE_SIZE);

    this.textures.addCanvas('terrain', canvas);
    this.terrain = this.add.image(0, 0, 'terrain').setOrigin(0, 0).setDepth(0);
  }

  private buildFog(): void {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = WORLD.cols;
    this.fogCanvas.height = WORLD.rows;
    const ctx = this.fogCanvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context for fog');
    this.fogCtx = ctx;
    this.fogImageData = ctx.createImageData(WORLD.cols, WORLD.rows);
    this.textures.addCanvas('fog', this.fogCanvas);
    this.fog = this.add
      .image(0, 0, 'fog')
      .setOrigin(0, 0)
      // One pixel per tile, scaled up: smooth (bilinear) edges read as soft
      // torchlight instead of a blocky grid.
      .setDisplaySize(WORLD.cols * TILE_SIZE, WORLD.rows * TILE_SIZE)
      .setDepth(500);
  }

  private buildPods(): void {
    for (const player of this.bridge.players()) {
      this.addPod(player);
    }
  }

  private addPod(player: PlayerView): Pod {
    const body = this.add
      .image(0, 0, ATLAS_TEXTURE, this.frameName('pod'))
      .setOrigin(0.5, 0.5)
      .setScale(1.35)
      .setTint(Phaser.Display.Color.HexStringToColor(player.color).color);
    const visor = this.add
      .image(0, 0, ATLAS_TEXTURE, this.frameName('podVisor'))
      .setOrigin(0.5, 0.5)
      .setScale(1.35);
    const label = this.add
      .text(0, -22, player.name, {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '9px',
        color: player.isAi ? '#9fd4ff' : '#e8f0fb',
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.85);

    const container = this.add.container(player.x, player.y, [body, visor, label]).setDepth(100);
    const pod: Pod = {
      container,
      body,
      visor,
      label,
      isSelf: player.id === this.bridge.selfId(),
      buffer: [],
      lastX: player.x,
      lastY: player.y,
    };
    this.pods.set(player.id, pod);

    if (pod.isSelf) {
      // Own pod: a subtle ring so you can find yourself in a crowd.
      const ring = this.add.circle(0, 0, 13).setStrokeStyle(1.5, 0x7ce2fe, 0.9);
      container.addAt(ring, 0);
      label.setColor('#7ce2fe');
    }
    return pod;
  }

  // ------------------------------------------------------------------- update

  /** Draw the bodies that are currently on the floor. */
  private syncBodies(): void {
    const visible = new Map<string, BodyView>();
    for (const body of this.bridge.bodies()) visible.set(body.id, body);
    for (const [id, sprite] of this.bodySprites) {
      if (visible.has(id)) continue;
      sprite.destroy(true);
      this.bodySprites.delete(id);
    }
    for (const [id, body] of visible) {
      if (this.bodySprites.has(id)) continue;
      const sprite = this.add
        .image(0, 0, ATLAS_TEXTURE, this.frameName('body'))
        .setOrigin(0.5, 0.5)
        .setScale(1.2)
        .setTint(Phaser.Display.Color.HexStringToColor(body.color).color);
      const ring = this.add.circle(0, 0, 14).setStrokeStyle(1.5, 0xff8f9c, 0.9);
      const label = this.add
        .text(0, 16, body.victimName, {
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: '8px',
          color: '#ffb3bb',
        })
        .setOrigin(0.5, 0);
      this.bodySprites.set(id, this.add.container(body.x, body.y, [ring, sprite, label]).setDepth(90));
    }
  }

  /** Doors draw as a bright bar while a lockdown is active. */
  private syncDoors(): void {
    const closed = this.bridge.doorsClosed();
    if (!closed && !this.doorLayer) return;
    if (!this.doorLayer) {
      this.doorLayer = this.add.graphics().setDepth(60);
      for (const door of MAP.doors) {
        this.doorLayer.fillStyle(0xffc53d, 0.85);
        this.doorLayer.fillRect(
          door.rect.x * TILE_SIZE,
          door.rect.y * TILE_SIZE,
          door.rect.w * TILE_SIZE,
          door.rect.h * TILE_SIZE,
        );
        this.doorLayer.lineStyle(1, 0x070b14, 0.9);
        this.doorLayer.strokeRect(
          door.rect.x * TILE_SIZE,
          door.rect.y * TILE_SIZE,
          door.rect.w * TILE_SIZE,
          door.rect.h * TILE_SIZE,
        );
      }
    }
    this.doorLayer.setVisible(closed);
  }

  override update(time: number, deltaMs: number): void {
    const players = this.bridge.players();
    const self = this.bridge.selfId();
    const selfState = players.find((p) => p.id === self);

    this.syncPods(players);
    this.syncBodies();
    this.syncDoors();

    // Ghosts are drawn translucent and can pass walls; crew cannot.
    this.ghostMode = this.bridge.isGhost();
    this.lightsOut = this.bridge.sabotage() === 'lights' && !this.ghostMode;

    if (selfState) {
      this.reconcile(selfState);
      this.stepLocal(deltaMs);
      // Decay any correction offset over ~45 ms, then draw at prediction+offset.
      const keep = Math.max(0, 1 - deltaMs / 45);
      this.visualOffset.x *= keep;
      this.visualOffset.y *= keep;
      if (Math.abs(this.visualOffset.x) < 0.05) this.visualOffset.x = 0;
      if (Math.abs(this.visualOffset.y) < 0.05) this.visualOffset.y = 0;
      const pod = this.pods.get(self);
      if (pod) {
        pod.container.setPosition(
          this.predicted.x + this.visualOffset.x,
          this.predicted.y + this.visualOffset.y,
        );
      }
    }

    this.interpolateRemotes(time);

    if (time - this.lastFog > 100 && selfState) {
      this.lastFog = time;
      this.paintFog(
        this.predicted.x,
        this.predicted.y,
        this.lightsOut ? DARK_VISION_TILES : undefined,
      );
      const pod = this.pods.get(self);
      if (pod) pod.container.setAlpha(this.ghostMode ? 0.45 : 1);
    }

    if (time - this.lastHud > 500 && this.onHud) {
      this.lastHud = time;
      const room = roomNameAt(this.predicted.x, this.predicted.y);
      this.onHud({
        roomName: room ?? 'Corridor',
        players: players.length,
        fps: Math.round(this.game.loop.actualFps),
        ping: Math.round(this.game.loop.delta),
      });
    }
  }

  /** Add/remove pods as players join or leave. */
  private syncPods(players: PlayerView[]): void {
    const seen = new Set<string>();
    for (const player of players) {
      seen.add(player.id);
      let pod = this.pods.get(player.id);
      if (!pod) pod = this.addPod(player);
      pod.lastX = player.x;
      pod.lastY = player.y;
      if (!pod.isSelf) {
        pod.buffer.push({ t: this.time.now, x: player.x, y: player.y });
        // Keep ~1 s of snapshots — enough for a 90 ms interpolation window.
        while (pod.buffer.length > 40) pod.buffer.shift();
      }
    }
    for (const [id, pod] of this.pods) {
      if (seen.has(id)) continue;
      pod.container.destroy(true);
      this.pods.delete(id);
    }
  }

  /**
   * Apply the server's correction to the *prediction history* rather than to the
   * pod, so a 40 ms-old correction does not yank the pod backwards.
   */
  private reconcile(server: PlayerView): void {
    if (server.seq < this.appliedSeq) return;
    this.appliedSeq = server.seq;
    const entry = this.history.find((h) => h.seq === server.seq);
    if (!entry) {
      // Our history no longer covers that sequence: trust the server outright.
      if (Math.hypot(server.x - this.predicted.x, server.y - this.predicted.y) > SNAP_DISTANCE_PX) {
        this.predicted = { x: server.x, y: server.y };
        this.visualOffset = { x: 0, y: 0 };
        this.history = [];
      }
      return;
    }
    const errorX = server.x - entry.x;
    const errorY = server.y - entry.y;
    const distance = Math.hypot(errorX, errorY);
    if (distance < 1.5) return;
    const clamp = Math.min(1, SNAP_DISTANCE_PX / distance);
    const dx = errorX * clamp;
    const dy = errorY * clamp;
    this.predicted.x += dx;
    this.predicted.y += dy;
    for (const item of this.history) {
      item.x += dx;
      item.y += dy;
    }
    // Show the nudge as a decaying offset instead of an instantaneous jump.
    this.visualOffset.x -= dx;
    this.visualOffset.y -= dy;
  }

  /**
   * Step the local pod with the shared movement function and send input.
   *
   * Sub-stepped at the server's 20 Hz so a slow frame does not turn into a slow
   * walk: one 200 ms hiccup advances 4 steps, not one big one. (Also keeps the
   * client's arithmetic byte-for-byte comparable with the server's.)
   */
  private stepLocal(deltaMs: number): void {
    if (!this.bridge.isPlaying()) return;
    const input = this.readInput();
    const moveGrid = this.ghostMode ? openGrid(MAP) : this.bridge.doorsClosed() ? doorsGrid() : grid;
    let remaining = Math.min(deltaMs, 250);
    while (remaining > 0) {
      const dt = Math.min(remaining, SIM_STEP_MS);
      const step = stepPlayer(moveGrid, this.predicted.x, this.predicted.y, input.x, input.y, dt);
      this.predicted = { x: step.x, y: step.y };
      remaining -= dt;
    }

    const now = performance.now();
    if (now - this.lastSend >= SEND_INTERVAL_MS) {
      this.lastSend = now;
      this.seq += 1;
      this.bridge.sendInput(this.seq, input.x, input.y);
      this.history.push({ seq: this.seq, x: this.predicted.x, y: this.predicted.y });
      while (this.history.length > 60) this.history.shift();
    }
  }

  private readInput(): { x: number; y: number } {
    let x = this.joystick.x;
    let y = this.joystick.y;
    if (this.keys) {
      if (this.keys.A.isDown || this.keys.LEFT.isDown) x -= 1;
      if (this.keys.D.isDown || this.keys.RIGHT.isDown) x += 1;
      if (this.keys.W.isDown || this.keys.UP.isDown) y -= 1;
      if (this.keys.S.isDown || this.keys.DOWN.isDown) y += 1;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Remote pods are drawn ~90 ms in the past, between two snapshots. */
  private interpolateRemotes(now: number): void {
    const renderTime = now - INTERP_DELAY_MS;
    for (const pod of this.pods.values()) {
      if (pod.isSelf || pod.buffer.length === 0) continue;
      let a = pod.buffer[0] ?? { t: 0, x: pod.lastX, y: pod.lastY };
      let b = pod.buffer[pod.buffer.length - 1] ?? a;
      for (let i = 0; i < pod.buffer.length - 1; i++) {
        const current = pod.buffer[i];
        const next = pod.buffer[i + 1];
        if (current && next && current.t <= renderTime && renderTime <= next.t) {
          a = current;
          b = next;
          break;
        }
      }
      const span = b.t - a.t;
      const t = span > 0 ? Phaser.Math.Clamp((renderTime - a.t) / span, 0, 1) : 1;
      pod.container.setPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }

  /** Paint the visibility mask: visible tiles transparent, everything else dark. */
  private paintFog(px: number, py: number, radiusTiles?: number): void {
    const mask = maskAt(px, py, radiusTiles);
    const data = this.fogImageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 3;
      data[i + 1] = 5;
      data[i + 2] = 9;
      data[i + 3] = 236;
    }
    for (let row = mask.fromRow; row < mask.toRow; row++) {
      for (let col = mask.fromCol; col < mask.toCol; col++) {
        if (mask.tiles[(row - mask.fromRow) * mask.width + (col - mask.fromCol)] !== 1) continue;
        const index = (row * WORLD.cols + col) * 4;
        data[index + 3] = 0;
      }
    }
    // Signature of the painted mask, for the client/server parity check.
    let hash = 0;
    for (let row = mask.fromRow; row < mask.toRow; row++) {
      for (let col = mask.fromCol; col < mask.toCol; col++) {
        if (mask.tiles[(row - mask.fromRow) * mask.width + (col - mask.fromCol)] !== 1) continue;
        hash = (hash * 31 + row * 131 + col) % 1_000_000_007;
      }
    }
    // Exact (unrounded) eye position: the parity check recomputes the mask from it,
    // and rounding could move a sight line past a corner.
    this.lastMask = { x: px, y: py, visible: mask.visibleCount, hash: String(hash) };

    this.fogCtx.putImageData(this.fogImageData, 0, 0);
    // Canvas textures need a nudge to re-upload after direct pixel writes.
    (this.fog.texture.source[0] as unknown as { update: () => void }).update();
  }
}

let _doorsGrid: ReturnType<typeof buildGrid> | null = null;
function doorsGrid(): ReturnType<typeof buildGrid> {
  if (!_doorsGrid) _doorsGrid = buildGrid(MAP, { doorsClosed: true });
  return _doorsGrid;
}

/** Which named room a pixel position is in (null in a corridor). */
export function roomNameAt(px: number, py: number): string | null {
  const col = Math.floor(px / TILE_SIZE);
  const row = Math.floor(py / TILE_SIZE);
  for (const room of WORLD.rooms) {
    const { x, y, w, h } = room.rect;
    if (col >= x && col < x + w && row >= y && row < y + h) return room.name;
  }
  return null;
}
