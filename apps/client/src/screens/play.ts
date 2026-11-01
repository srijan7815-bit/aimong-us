/**
 * The in-game screen: Phaser canvas + touch controls + HUD.
 *
 * Controls: floating virtual joystick on the left half (touch), WASD/arrows on
 * desktop. Everything clickable is at least 48 px so it works with a thumb on a
 * phone in landscape.
 */
import Phaser from 'phaser';
import { loadAtlasManifest } from '../game/atlas.js';
import { StationScene, type HudState, type StationBridge } from '../game/scene.js';
import { el } from '../lib/dom.js';

export interface PlayScreen {
  node: HTMLElement;
  setHud(state: HudState): void;
  destroy(): void;
}

export interface PlayOptions {
  bridge: StationBridge;
  code: string;
  onLeave: () => void;
  onError: (message: string) => void;
}

const JOY_RADIUS = 56;
const DEADZONE = 0.12;

export function renderPlay(options: PlayOptions): PlayScreen {
  const canvasHost = el('div', { class: 'play-canvas' });
  const roomLabel = el('div', { class: 'play-room', text: '—' });
  const statLabel = el('div', { class: 'play-stat', text: '' });
  const hud = el('div', { class: 'play-hud' }, [
    el('div', { class: 'play-code', text: options.code }),
    el('div', { class: 'play-chip', text: 'FREE ROAM · no roles yet' }),
    statLabel,
  ]);
  const leave = el('button', {
    class: 'play-leave',
    type: 'button',
    text: 'Leave',
    on: { click: () => options.onLeave() },
  });
  const roomChip = el('div', { class: 'play-room-chip' }, [roomLabel]);
  const rotate = el('div', { class: 'play-rotate' }, [
    el('div', { class: 'play-rotate-card' }, [
      el('strong', { text: 'Turn your phone sideways' }),
      el('span', { text: 'The station is wider than it is tall.' }),
    ]),
  ]);

  // --- floating joystick ---------------------------------------------------
  const joyBase = el('div', { class: 'joy-base' });
  const joyKnob = el('div', { class: 'joy-knob' });
  joyBase.append(joyKnob);
  const joyZone = el('div', { class: 'joy-zone' }, [joyBase]);
  joyZone.setAttribute('role', 'application');
  joyZone.setAttribute('aria-label', 'Movement stick — drag to walk');
  let pointerId: number | null = null;
  let origin = { x: 0, y: 0 };
  const vector = { x: 0, y: 0 };

  const applyVector = (clientX: number, clientY: number): void => {
    const dx = clientX - origin.x;
    const dy = clientY - origin.y;
    const distance = Math.hypot(dx, dy);
    const clamped = Math.min(1, distance / JOY_RADIUS);
    const angle = Math.atan2(dy, dx);
    const knobX = Math.cos(angle) * clamped * JOY_RADIUS;
    const knobY = Math.sin(angle) * clamped * JOY_RADIUS;
    joyKnob.style.transform = `translate(-50%, -50%) translate(${knobX}px, ${knobY}px)`;
    if (clamped < DEADZONE) {
      vector.x = 0;
      vector.y = 0;
      return;
    }
    vector.x = Math.cos(angle) * clamped;
    vector.y = Math.sin(angle) * clamped;
  };

  const resetJoy = (): void => {
    pointerId = null;
    vector.x = 0;
    vector.y = 0;
    joyBase.classList.remove('active');
    joyKnob.style.transform = 'translate(-50%, -50%)';
  };

  joyZone.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    pointerId = ev.pointerId;
    joyZone.setPointerCapture(ev.pointerId);
    // Floating stick: the base appears wherever the thumb lands.
    origin = { x: ev.clientX, y: ev.clientY };
    joyBase.style.left = `${ev.clientX}px`;
    joyBase.style.top = `${ev.clientY}px`;
    joyBase.classList.add('active');
    applyVector(ev.clientX, ev.clientY);
  });
  joyZone.addEventListener('pointermove', (ev) => {
    if (pointerId !== ev.pointerId) return;
    ev.preventDefault();
    applyVector(ev.clientX, ev.clientY);
  });
  const endPointer = (ev: PointerEvent): void => {
    if (pointerId !== ev.pointerId) return;
    resetJoy();
  };
  joyZone.addEventListener('pointerup', endPointer);
  joyZone.addEventListener('pointercancel', endPointer);
  joyZone.addEventListener('lostpointercapture', endPointer);

  const node = el('div', { class: 'play-screen' }, [
    canvasHost,
    hud,
    roomChip,
    leave,
    joyZone,
    rotate,
  ]);

  // --- Phaser boot ---------------------------------------------------------
  let game: Phaser.Game | null = null;
  let scene: StationScene | null = null;

  const boot = async (): Promise<void> => {
    const atlas = await loadAtlasManifest();
    scene = new StationScene({
      bridge: options.bridge,
      atlas,
      onHud: (state) => screen.setHud(state),
    });
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: canvasHost,
      backgroundColor: '#05080f',
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
      },
      render: { antialias: true, roundPixels: false },
      scene: [scene],
      fps: { target: 60, forceSetTimeOut: false },
      banner: false,
    });
    // Feed the joystick into the scene each frame (the scene owns the movement).
    const pump = (): void => {
      if (scene) {
        scene.joystick.x = vector.x;
        scene.joystick.y = vector.y;
      }
      requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  };

  void boot().catch((err: unknown) => {
    options.onError(err instanceof Error ? err.message : 'Could not load the station art');
  });

  const screen: PlayScreen = {
    node,
    setHud(state) {
      roomLabel.textContent = state.roomName;
      statLabel.textContent = `${state.players} crew · ${state.fps} fps`;
    },
    destroy() {
      resetJoy();
      game?.destroy(true);
      game = null;
      scene = null;
    },
  };
  return screen;
}
