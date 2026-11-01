/**
 * The in-game screen: Phaser canvas + every rule-facing control.
 *
 * The server is authoritative for all of it; this file only decides what to show
 * and when to send an intent. Anything the player cannot legally do right now is
 * hidden rather than shown-and-rejected.
 */
import Phaser from 'phaser';
import {
  MINIGAME_LABELS,
  SABOTAGE_SPECS,
  TILE_SIZE,
  WORLD,
  type Minigame,
} from '@aimong/shared';
import { loadAtlasManifest } from '../game/atlas.js';
import { StationScene, type HudState, type StationBridge } from '../game/scene.js';
import { openMinigame, type MinigameHandle } from '../game/minigames.js';
import { el } from '../lib/dom.js';
import type { BodyRow, LobbyView, PlayerRow, SecretRow, VerdictRow } from '../net/session.js';

export interface PlayScreen {
  node: HTMLElement;
  update(view: LobbyView, you: PlayerRow | undefined, secret: SecretRow | null): void;
  setHud(state: HudState): void;
  showVerdict(verdict: VerdictRow): void;
  destroy(): void;
}

export interface PlayOptions {
  bridge: StationBridge;
  code: string;
  onLeave: () => void;
  onError: (message: string) => void;
  send: (type: string, payload?: unknown) => void;
}

const TASK_RANGE = 56;
const REPORT_RANGE = 64;
const KILL_RANGE = 48;
const VENT_RANGE = 44;
const BUTTON_ROOM = 'galley';

const JOY_RADIUS = 56;
const DEADZONE = 0.12;

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tileCentre(tile: { x: number; y: number }): { x: number; y: number } {
  return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
}

export function renderPlay(options: PlayOptions): PlayScreen {
  const canvasHost = el('div', { class: 'play-canvas' });
  const roomLabel = el('div', { class: 'play-room', text: '—' });
  const statLabel = el('div', { class: 'play-stat', text: '' });
  const roleChip = el('div', { class: 'play-role', text: '' });
  const taskChip = el('button', { class: 'play-task-chip', type: 'button', text: 'Tasks 0/0' });
  const hud = el('div', { class: 'play-hud' }, [
    el('div', { class: 'play-code', text: options.code }),
    roleChip,
    taskChip,
    statLabel,
  ]);
  const leave = el('button', {
    class: 'play-leave',
    type: 'button',
    text: 'Leave',
    on: { click: () => options.onLeave() },
  });
  const roomChip = el('div', { class: 'play-room-chip' }, [roomLabel]);
  const banner = el('div', { class: 'play-banner' });
  const actionBar = el('div', { class: 'play-actions' });
  const taskList = el('div', { class: 'task-panel hidden' });
  const modalHost = el('div', { class: 'mg-host hidden' });
  const meetingHost = el('div', { class: 'meeting-host hidden' });
  const endHost = el('div', { class: 'end-host hidden' });
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
    banner,
    taskList,
    actionBar,
    modalHost,
    meetingHost,
    endHost,
    joyZone,
    rotate,
  ]);

  // --- state ---------------------------------------------------------------
  let latest: LobbyView | null = null;
  let me: PlayerRow | undefined;
  let secret: SecretRow | null = null;
  let activeMinigame: MinigameHandle | null = null;
  let openTaskId: string | null = null;
  let sabotageMenuOpen = false;
  let deviceId: string | null = null;
  let lastPhase = '';

  // --- minigame modal ------------------------------------------------------
  const dbg = (event: string, extra: Record<string, unknown> = {}): void => {
    if (!new URLSearchParams(location.search).has('debug')) return;
    const w = window as unknown as { __mgLog?: Array<Record<string, unknown>> };
    w.__mgLog = w.__mgLog ?? [];
    w.__mgLog.push({ event, at: Date.now(), ...extra });
  };

  const closeMinigame = (): void => {
    dbg('close', { had: Boolean(activeMinigame) });
    activeMinigame?.destroy();
    activeMinigame = null;
    openTaskId = null;
    modalHost.replaceChildren();
    modalHost.classList.add('hidden');
    resetJoy();
  };

  const startMinigame = (kind: Minigame, onSolved: () => void): void => {
    if (activeMinigame) {
      dbg('refused', { kind });
      return;
    }
    dbg('start', { kind });
    modalHost.classList.remove('hidden');
    activeMinigame = openMinigame(kind, () => closeMinigame());
    modalHost.replaceChildren(activeMinigame.node);
    void activeMinigame.result.then((ok) => {
      dbg('resolve', { kind, ok });
      if (ok) onSolved();
      closeMinigame();
    });
  };

  // --- task panel ----------------------------------------------------------
  const renderTaskList = (): void => {
    const tasks = secret?.tasks ?? [];
    const rows = tasks.map((task) =>
      el('div', { class: `task-row${task.done ? ' done' : ''}` }, [
        el('span', { class: 'task-room', text: WORLD.rooms.find((r) => r.id === task.room)?.name ?? task.room }),
        el('span', { class: 'task-name', text: MINIGAME_LABELS[task.minigame as Minigame] ?? task.minigame }),
        el('span', { class: 'task-state', text: task.done ? '✓' : '•' }),
      ]),
    );
    taskList.replaceChildren(
      el('div', { class: 'sheet-title', text: `${tasks.filter((t) => t.done).length} of ${tasks.length} tasks done` }),
      ...(rows.length > 0 ? rows : [el('div', { class: 'task-row', text: 'No tasks — you are not crew.' })]),
    );
  };
  taskChip.addEventListener('click', () => {
    renderTaskList();
    taskList.classList.toggle('hidden');
  });

  // --- action bar ----------------------------------------------------------
  interface Action {
    label: string;
    kind: string;
    onClick: () => void;
    tone?: 'danger' | 'warn' | 'good';
  }

  let lastActionSignature = '';
  let actionsDirty = true;

  const renderActions = (): void => {
    if (!latest || !me || meetingHost.classList.contains('hidden') === false) return;
    const actions: Action[] = [];
    const playing = latest.phase === 'PLAY' && me.alive;

    if (playing) {
      const body: BodyRow | undefined = latest.bodies.find((b) => dist(me!, b) <= REPORT_RANGE);
      if (body) {
        actions.push({
          label: 'Report',
          kind: 'report',
          tone: 'warn',
          onClick: () => options.send('report', { bodyId: body.id }),
        });
      }

      // Tasks: any unfinished task within reach.
      const near = (secret?.tasks ?? []).find((task) => {
        if (task.done) return false;
        const spot = WORLD.taskSpots.find((s) => s.id === task.spotId);
        return spot ? dist(me!, tileCentre(spot.tile)) <= TASK_RANGE : false;
      });
      if (near && secret?.role === 'crew') {
        actions.push({
          label: 'Use',
          kind: 'use',
          tone: 'good',
          onClick: () =>
            startMinigame(near.minigame as Minigame, () => options.send('taskDone', { taskId: near.id })),
        });
      }

      // Sabotage fixing.
      const spec = SABOTAGE_SPECS[latest.sabotage.kind as keyof typeof SABOTAGE_SPECS];
      if (spec) {
        const spot = spec.fixSpots
          .map((id) => WORLD.taskSpots.find((s) => s.id === id))
          .find((s) => s && !latest!.sabotage.fixed.includes(s.id) && dist(me!, tileCentre(s.tile)) <= TASK_RANGE);
        if (spot) {
          actions.push({
            label: 'Fix',
            kind: 'fix',
            tone: 'warn',
            onClick: () => options.send('fix', { spotId: spot.id }),
          });
        }
      }

      // Emergency button (Galley, one use).
      const galley = WORLD.rooms.find((r) => r.id === BUTTON_ROOM);
      if (galley && me.emergenciesLeft > 0) {
        const centre = { x: (galley.rect.x + galley.rect.w / 2) * TILE_SIZE, y: (galley.rect.y + galley.rect.h / 2) * TILE_SIZE };
        if (dist(me, centre) <= 96) {
          actions.push({
            label: 'Emergency',
            kind: 'emergency',
            tone: 'danger',
            onClick: () => options.send('emergency', {}),
          });
        }
      }

      // Impostor tools.
      if (secret?.role === 'impostor') {
        const ready = Date.now() >= me.killReadyAt;
        const victim = latest.players.find(
          (p) => p.id !== me!.id && p.alive && dist(me!, p) <= KILL_RANGE,
        );
        if (ready && victim) {
          actions.push({
            label: 'Kill',
            kind: 'kill',
            tone: 'danger',
            onClick: () => options.send('kill', { target: victim.id }),
          });
        }
        if (!deviceId) {
          const vent = WORLD.vents.find((v) => dist(me!, tileCentre(v.tile)) <= VENT_RANGE);
          if (vent) {
            deviceId = vent.id;
            actions.push({
              label: 'Vent',
              kind: 'vent',
              tone: 'warn',
              onClick: () => options.send('vent', { ventId: vent.id }),
            });
          }
        } else deviceId = null;
        actions.push({
          label: 'Sabotage',
          kind: 'sabotage',
          tone: 'danger',
          onClick: () => {
            sabotageMenuOpen = !sabotageMenuOpen;
            actionsDirty = true;
            renderActions();
          },
        });
      }
    }

    // Rebuilding the bar on every state packet destroys the button under the
    // player's thumb mid-tap (a real bug on phones). Only rebuild when what is
    // on offer has actually changed.
    const signature = `${actions.map((a) => `${a.label}:${a.tone ?? ''}`).join('|')}#${sabotageMenuOpen}`;
    if (signature === lastActionSignature && !actionsDirty) return;
    lastActionSignature = signature;
    actionsDirty = false;

    const buttons = actions.map((action) =>
      el('button', {
        class: `play-action ${action.tone ?? ''}`,
        type: 'button',
        text: action.label,
        on: { click: action.onClick },
      }),
    );

    if (sabotageMenuOpen) {
      for (const spec of Object.values(SABOTAGE_SPECS)) {
        buttons.push(
          el('button', {
            class: 'play-action danger small',
            type: 'button',
            text: spec.label,
            on: {
              click: () => {
                sabotageMenuOpen = false;
                options.send('sabotage', { kind: spec.kind });
                actionsDirty = true;
                renderActions();
              },
            },
          }),
        );
      }
    }

    actionBar.replaceChildren(...buttons);
    actionBar.classList.toggle('hidden', buttons.length === 0);
  };

  // --- banner (sabotage countdown, ghost notice, verdict) -------------------
  let verdictTimer = 0;
  const renderBanner = (): void => {
    if (!latest || !me) return;
    const parts: HTMLElement[] = [];
    if (me.isGhost) {
      parts.push(el('div', { class: 'play-note ghost', text: 'You are a ghost — you can move through walls. Wait for the round to end.' }));
    }
    const kind = latest.sabotage.kind;
    if (kind) {
      const spec = SABOTAGE_SPECS[kind as keyof typeof SABOTAGE_SPECS];
      const secs = Math.max(0, Math.ceil((latest.sabotage.endsAt - Date.now()) / 1000));
      parts.push(
        el('div', { class: `play-note ${spec?.lethal ? 'danger' : 'warn'}` }, [
          el('strong', { text: `${spec?.label ?? kind} · ${secs}s` }),
          el('span', {
            text:
              kind === 'reactor'
                ? 'Fix it in the Reactor before the station goes.'
                : kind === 'lights'
                  ? 'Vision is down. Fix it in Medbay or Reactor.'
                  : 'Doors are sealed.',
          }),
        ]),
      );
    }
    banner.replaceChildren(...parts);
    banner.classList.toggle('hidden', parts.length === 0);
  };

  // --- meeting overlay -----------------------------------------------------
  // Built once. Rebuilding the card on every state packet (20 a second) used to
  // steal focus from the chat box mid-sentence and swallow the tap that was in
  // flight, so only the volatile bits are rewritten now.
  let votingChoice: string | null = null;
  let meetingTimer = 0;
  let meetingCard: HTMLElement | null = null;
  let meetingKey = '';
  let lastChatSig = '';
  let lastVoteSig = '';

  const meetTitle = el('strong');
  const meetTimerEl = el('span', { class: 'meet-timer' });
  const meetSubEl = el('div', { class: 'meet-sub' });
  const meetChatList = el('div', { class: 'meet-chat' });
  const voteListEl = el('div', { class: 'vote-list' });
  const meetInput = el('input', {
    class: 'meet-input',
    placeholder: 'Say something…',
    maxlength: 160,
  }) as HTMLInputElement;
  const sendChat = (): void => {
    const text = meetInput.value.trim();
    if (!text) return;
    options.send('chat', { text });
    meetInput.value = '';
  };
  meetInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') sendChat();
  });

  const castVote = (target: string | null): void => {
    const voting = latest?.meeting.stage === 'VOTING';
    if (!voting || !me?.alive) return;
    votingChoice = target ?? 'skip';
    lastVoteSig = '';
    options.send('vote', { target });
    renderMeeting();
  };

  const buildMeetingCard = (): HTMLElement =>
    el('div', { class: 'meeting-card' }, [
      el('div', { class: 'meet-head' }, [meetTitle, meetTimerEl]),
      meetSubEl,
      meetChatList,
      el('div', { class: 'meet-chatbar' }, [
        meetInput,
        el('button', { class: 'meet-send', type: 'button', text: 'Send', on: { click: sendChat } }),
      ]),
      voteListEl,
      el('div', { class: 'meet-actions' }, [
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: 'Skip vote',
          on: { click: () => castVote(null) },
        }),
      ]),
    ]);

  const renderMeeting = (): void => {
    if (!latest || !latest.meeting.active) {
      meetingHost.classList.add('hidden');
      meetingCard = null;
      meetingKey = '';
      return;
    }
    const meeting = latest.meeting;
    const secs = Math.max(0, Math.ceil((meeting.endsAt - Date.now()) / 1000));
    const caller = latest.players.find((p) => p.id === meeting.calledBy)?.name ?? 'someone';
    const voting = meeting.stage === 'VOTING';
    const alive = latest.players.filter((p) => p.alive);

    if (!meetingCard) {
      meetingCard = buildMeetingCard();
      meetingHost.replaceChildren(meetingCard);
    }
    meetingHost.classList.remove('hidden');

    const key = `${meeting.calledBy}:${meeting.endsAt}`;
    if (key !== meetingKey) {
      meetingKey = key;
      lastChatSig = '';
      lastVoteSig = '';
    }

    meetTitle.textContent = meeting.reason === 'emergency' ? 'Emergency meeting' : 'Body reported';
    meetTimerEl.textContent = `${meeting.stage} · ${secs}s`;
    meetSubEl.textContent = `Called by ${caller} · ${meeting.votesCast}/${meeting.votersAlive} votes in`;

    const lastLine = latest.chat[latest.chat.length - 1];
    const chatSig = `${latest.chat.length}:${lastLine?.id ?? ''}`;
    if (chatSig !== lastChatSig) {
      lastChatSig = chatSig;
      const lines = latest.chat.slice(-8).map((line) =>
        el('div', { class: 'meet-line' }, [
          el('strong', { text: `${line.name}: ` }),
          el('span', { text: line.text }),
        ]),
      );
      meetChatList.replaceChildren(
        ...(lines.length > 0 ? lines : [el('div', { class: 'meet-line dim', text: 'No chat yet.' })]),
      );
      meetChatList.scrollTop = meetChatList.scrollHeight;
    }

    const voteSig = `${voting}:${alive.map((p) => p.id).join(',')}:${votingChoice}:${me?.alive}`;
    if (voteSig !== lastVoteSig) {
      lastVoteSig = voteSig;
      voteListEl.replaceChildren(
        ...alive.map((player) =>
          el(
            'button',
            {
              class: `vote-row${votingChoice === player.id ? ' chosen' : ''}${player.id === me?.id ? ' self' : ''}`,
              type: 'button',
              on: { click: () => castVote(player.id) },
            },
            [
              el('span', { class: 'vote-dot' }),
              el('span', { text: player.name }),
              player.id === me?.id ? el('span', { class: 'vote-tag', text: 'you' }) : el('span'),
            ],
          ),
        ),
      );
    }
  };

  // --- end screen ----------------------------------------------------------
  const renderEnd = (): void => {
    if (!latest || latest.phase !== 'END' || !latest.result.winner) {
      endHost.classList.add('hidden');
      return;
    }
    const impostors = latest.players.filter((p) => p.rolePublic === 'impostor').map((p) => p.name);
    endHost.replaceChildren(
      el('div', { class: 'end-card' }, [
        el('div', { class: `end-title ${latest.result.winner}` }, [
          el('strong', { text: latest.result.winner === 'crew' ? 'Crew win' : 'Impostors win' }),
        ]),
        el('p', { text: latest.result.text }),
        el('p', { class: 'end-sub', text: `Impostors: ${impostors.join(', ') || '—'}` }),
        el('button', { class: 'btn btn-primary', type: 'button', text: 'Back to lobby', on: { click: () => options.onLeave() } }),
      ]),
    );
    endHost.classList.remove('hidden');
  };

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
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      render: { antialias: true, roundPixels: false },
      scene: [scene],
      fps: { target: 60, forceSetTimeOut: false },
      banner: false,
    });
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

  // Test hook (only with ?debug=1): render any minigame on demand so the UI of
  // all twelve can be checked without walking to twelve task spots.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__debugMinigame = (kind: string): void => {
      startMinigame(kind as Minigame, () => undefined);
    };
    (window as unknown as Record<string, unknown>).__debugActions = (): string[] =>
      [...actionBar.querySelectorAll('button')].map((b) => b.textContent ?? '');
    (window as unknown as Record<string, unknown>).__debugTasks = (): unknown[] =>
      (secret?.tasks ?? []).map((task) => {
        const spot = WORLD.taskSpots.find((s) => s.id === task.spotId);
        return {
          id: task.id,
          room: task.room,
          spotId: task.spotId,
          tile: spot?.tile ?? null,
          dist: spot && me ? Math.round(dist(me, tileCentre(spot.tile))) : null,
          done: task.done,
          minigame: task.minigame,
        };
      });
  }

  // Meeting / banner timers need to tick even when no state packet arrived.
  meetingTimer = window.setInterval(() => {
    renderMeeting();
    renderBanner();
  }, 500);

  const screen: PlayScreen = {
    node,
    update(view, you, nextSecret) {
      const phaseChanged = view.phase !== lastPhase;
      lastPhase = view.phase;
      latest = view;
      me = you;
      secret = nextSecret;

      if (secret) {
        roleChip.textContent = secret.role === 'impostor' ? 'Impostor' : 'Crew';
        roleChip.classList.toggle('impostor', secret.role === 'impostor');
        const done = secret.tasks.filter((t) => t.done).length;
        taskChip.textContent = secret.role === 'crew' ? `Tasks ${done}/${secret.tasks.length}` : `Sabotage · ${secret.mates.length + 1} impostor(s)`;
      } else {
        roleChip.textContent = 'Waiting…';
        roleChip.classList.remove('impostor');
      }

      const inMeeting = view.meeting.active;
      joyZone.classList.toggle('disabled', inMeeting || view.phase === 'END');
      if (phaseChanged && view.phase === 'PLAY') {
        votingChoice = null;
        meetingHost.classList.add('hidden');
      }
      if (view.phase === 'END') {
        closeMinigame();
      }
      renderMeeting();
      renderBanner();
      renderActions();
      renderEnd();
    },
    setHud(state) {
      roomLabel.textContent = state.roomName;
      const alive = latest ? latest.players.filter((p) => p.alive).length : 0;
      statLabel.textContent = `${alive} alive · ${state.fps} fps`;
      if (latest && latest.tasksRemaining >= 0) {
        roomLabel.title = `${latest.tasksRemaining} tasks left`;
      }
    },
    showVerdict(verdict) {
      window.clearTimeout(verdictTimer);
      const chip = el('div', { class: 'verdict-toast' }, [
        el('strong', { text: verdict.text }),
      ]);
      document.body.append(chip);
      verdictTimer = window.setTimeout(() => chip.remove(), 6000);
    },
    destroy() {
      window.clearInterval(meetingTimer);
      window.clearTimeout(verdictTimer);
      closeMinigame();
      resetJoy();
      game?.destroy(true);
      game = null;
      scene = null;
    },
  };
  return screen;
}
