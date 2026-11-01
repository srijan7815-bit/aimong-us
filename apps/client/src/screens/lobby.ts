/**
 * Lobby screen: room code, player list, AI seats, host settings, lobby chat.
 *
 * Rendering strategy: build once, then patch in place on every state patch.
 * Re-rendering wholesale would steal focus from the chat box and make typing on
 * a phone miserable.
 */
import { MAX_CHAT_LEN, ROLE_LABEL, defaultImpostors, rolePreview } from '@aimong/shared';
import { el } from '../lib/dom.js';
import { podSvg } from '../lib/pod.js';
import { haptics } from '../lib/haptics.js';
import type { LobbyView, PlayerRow, SettingsRow } from '../net/session.js';
import { shareBase } from '../net/endpoint.js';

export interface LobbyCallbacks {
  onLeave: () => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  /** Host starts a solo practice round on this station. */
  onStartPractice: () => void;
  onSettings: (patch: Partial<SettingsRow>) => void;
  onChat: (text: string) => void;
  onKick: (playerId: string) => void;
  onShowHelp: () => void;
  onToast: (level: 'info' | 'warn' | 'error', text: string) => void;
}

export interface LobbyScreen {
  node: HTMLElement;
  update: (view: LobbyView, you: PlayerRow | undefined) => void;
}

export function renderLobby(cb: LobbyCallbacks): LobbyScreen {
  let lastSig = '';
  let lastChatCount = 0;
  let view: LobbyView | null = null;
  let you: PlayerRow | undefined;

  // ---- header ------------------------------------------------------------
  const codeText = el('div', { class: 'code-display', text: '·····' });
  const phaseChip = el('span', { class: 'chip', text: 'LOBBY' });
  const copyBtn = el('button', {
    class: 'btn btn-ico',
    type: 'button',
    title: 'Copy code',
    text: 'Copy',
    on: {
      click: () => {
        haptics.play('tap');
        void copyCode();
      },
    },
  });
  const shareBtn = el('button', {
    class: 'btn btn-ico btn-ghost',
    type: 'button',
    title: 'Share invite',
    text: 'Share',
    on: {
      click: () => {
        haptics.play('tap');
        void shareCode();
      },
    },
  });
  const leaveBtn = el('button', {
    class: 'btn btn-ghost btn-ico',
    type: 'button',
    text: 'Leave',
    on: {
      click: () => {
        haptics.play('tap');
        cb.onLeave();
      },
    },
  });

  function inviteText(): string {
    const code = view?.code ?? '';
    return `Join me on AImong Us — station ${code}\n${shareBase()}/?code=${code}`;
  }

  async function copyCode(): Promise<void> {
    const code = view?.code ?? '';
    try {
      await navigator.clipboard.writeText(code);
      cb.onToast('info', `Code ${code} copied`);
    } catch {
      cb.onToast('warn', `Code is ${code}`);
    }
  }

  async function shareCode(): Promise<void> {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'AImong Us', text: inviteText() });
        return;
      } catch {
        /* user cancelled */
      }
    }
    await copyCode();
  }

  // ---- players -----------------------------------------------------------
  const playersGrid = el('div', { class: 'players' });

  function playerCard(p: PlayerRow, isYou: boolean, isHostView: boolean): HTMLElement {
    const chips: HTMLElement[] = [];
    if (p.isHost) chips.push(el('span', { class: 'chip chip-host', text: 'Host' }));
    if (isYou) chips.push(el('span', { class: 'chip chip-you', text: 'You' }));
    if (p.isAi) chips.push(el('span', { class: 'chip chip-ai', text: 'AI' }));
    else if (p.ready) chips.push(el('span', { class: 'chip chip-ready', text: 'Ready' }));

    const card = el('div', { class: `player${isYou ? ' you' : ''}${p.connected ? '' : ' offline'}` }, [
      el('div', { html: podSvg({ color: p.color, size: 'sm', dim: !p.connected }) }),
      el('div', {}, [el('div', { class: 'pname', text: p.name }), el('div', { class: 'pmeta' }, chips)]),
    ]);
    if (isHostView && !isYou && !p.isAi) {
      card.append(
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: '✕',
          title: `Remove ${p.name}`,
          on: {
            click: () => {
              haptics.play('tap');
              cb.onKick(p.id);
            },
          },
        }),
      );
      card.style.justifyContent = 'space-between';
    }
    return card;
  }

  // ---- AI seats ----------------------------------------------------------
  const aiNote = el('p', { class: 'hint' });
  const aiSeatsValue = el('span', { class: 'value', text: '0' });
  const aiCard = el('div', { class: 'card card-tight' }, [
    el('div', { class: 'row spread' }, [
      el('div', {}, [el('div', { class: 'setting-name', text: 'AI players' }), aiNote]),
      el('div', { class: 'stepper' }, [aiSeatsValue]),
    ]),
  ]);

  // ---- settings ----------------------------------------------------------
  function stepper(
    label: string,
    sub: string,
    get: (s: SettingsRow) => number,
    format: (v: number) => string,
    step: number,
    min: number,
    max: number,
    apply: (v: number) => Partial<SettingsRow>,
  ): { node: HTMLElement; sync: (s: SettingsRow) => void; setEnabled: (on: boolean) => void } {
    const valueNode = el('span', { class: 'value', text: '—' });
    const minus = el('button', { type: 'button', text: '−', on: { click: () => bump(-step) } });
    const plus = el('button', { type: 'button', text: '+', on: { click: () => bump(step) } });
    function bump(delta: number): void {
      if (!view) return;
      const next = Math.min(max, Math.max(min, get(view.settings) + delta));
      haptics.play('tap');
      cb.onSettings(apply(next));
    }
    const node = el('div', { class: 'setting' }, [
      el('div', {}, [
        el('div', { class: 'setting-name', text: label }),
        el('div', { class: 'setting-sub', text: sub }),
      ]),
      el('div', { class: 'stepper' }, [minus, valueNode, plus]),
    ]);
    return {
      node,
      sync: (s) => {
        valueNode.textContent = format(get(s));
        minus.disabled = get(s) <= min;
        plus.disabled = get(s) >= max;
      },
      setEnabled: (on) => {
        minus.disabled = !on || minus.disabled;
        plus.disabled = !on || plus.disabled;
        node.style.opacity = on ? '1' : '0.6';
      },
    };
  }

  const seatsStepper = stepper(
    'Seats',
    'humans + AI',
    (s) => s.maxPlayers,
    (v) => `${v}`,
    1,
    5,
    12,
    (v) => ({ maxPlayers: v }),
  );
  const aiStepper = stepper(
    'AI seats',
    'filled at launch',
    (s) => s.aiSeats,
    (v) => `${v}`,
    1,
    0,
    9,
    (v) => ({ aiSeats: v }),
  );
  const impStepper = stepper(
    'Impostors',
    'hidden among you',
    (s) => s.impostors,
    (v) => `${v}`,
    1,
    1,
    3,
    (v) => ({ impostors: v }),
  );
  const discussStepper = stepper(
    'Discussion',
    'seconds',
    (s) => s.discussionSec,
    (v) => `${v}s`,
    15,
    15,
    180,
    (v) => ({ discussionSec: v }),
  );
  const voteStepper = stepper(
    'Voting',
    'seconds',
    (s) => s.votingSec,
    (v) => `${v}s`,
    10,
    10,
    120,
    (v) => ({ votingSec: v }),
  );
  const killStepper = stepper(
    'Kill cooldown',
    'seconds',
    (s) => s.killCooldownSec,
    (v) => `${v}s`,
    5,
    10,
    60,
    (v) => ({ killCooldownSec: v }),
  );
  const taskStepper = stepper(
    'Tasks each',
    'crewmates',
    (s) => s.tasksPerCrew,
    (v) => `${v}`,
    1,
    3,
    8,
    (v) => ({ tasksPerCrew: v }),
  );
  const costStepper = stepper(
    'AI cost cap',
    'per game, USD',
    (s) => Math.round(s.costCapUsd * 100) / 100,
    (v) => `$${v.toFixed(2)}`,
    0.25,
    0,
    5,
    (v) => ({ costCapUsd: v }),
  );

  const revealToggle = el('button', {
    class: 'toggle',
    type: 'button',
    role: 'switch',
    ariaChecked: 'false',
    on: {
      click: () => {
        if (!view) return;
        haptics.play('tap');
        cb.onSettings({ revealEjectedRole: !view.settings.revealEjectedRole });
      },
    },
  });

  const settingsCard = el('div', { class: 'card' }, [
    el('div', { class: 'row spread' }, [
      el('p', { class: 'label', text: 'Match settings' }),
      el('span', { class: 'chip', text: 'Host only' }),
    ]),
    seatsStepper.node,
    aiStepper.node,
    impStepper.node,
    taskStepper.node,
    killStepper.node,
    discussStepper.node,
    voteStepper.node,
    costStepper.node,
    el('div', { class: 'setting' }, [
      el('div', {}, [
        el('div', { class: 'setting-name', text: 'Reveal ejected role' }),
        el('div', { class: 'setting-sub', text: 'show crew/impostor on ejection' }),
      ]),
      revealToggle,
    ]),
  ]);

  // ---- M3.5: tasks, roles, meeting rules ---------------------------------
  const toggle = (
    label: string,
    sub: string,
    read: (s: SettingsRow) => boolean,
    apply: (on: boolean) => Partial<SettingsRow>,
  ): { node: HTMLElement; sync: (s: SettingsRow) => void } => {
    const button = el('button', {
      class: 'toggle',
      type: 'button',
      role: 'switch',
      ariaChecked: 'false',
      on: {
        click: () => {
          if (!view) return;
          haptics.play('tap');
          cb.onSettings(apply(!read(view.settings)));
        },
      },
    });
    const node = el('div', { class: 'setting' }, [
      el('div', {}, [el('div', { class: 'setting-name', text: label }), el('div', { class: 'setting-sub', text: sub })]),
      button,
    ]);
    return { node, sync: (s) => button.setAttribute('aria-checked', String(read(s))) };
  };

  const shortStepper = stepper('Short tasks', 'per crewmate', (s) => s.taskShort, (v) => `${v}`, 1, 0, 6, (v) => ({ taskShort: v }));
  const longStepper = stepper('Long tasks', 'two stages each', (s) => s.taskLong, (v) => `${v}`, 1, 0, 6, (v) => ({ taskLong: v }));
  const commonStepper = stepper('Common tasks', 'everyone shares', (s) => s.taskCommon, (v) => `${v}`, 1, 0, 4, (v) => ({ taskCommon: v }));
  const visualStepper = stepper('Visual tasks', 'seen by others', (s) => s.taskVisual, (v) => `${v}`, 1, 0, 4, (v) => ({ taskVisual: v }));
  const engineerStepper = stepper('Patch chance', 'vent-using crew', (s) => Math.round(s.engineerChance * 100), (v) => `${v}%`, 25, 0, 100, (v) => ({ engineerChance: v / 100 }));
  const scientistStepper = stepper('Watcher chance', 'handheld vitals', (s) => Math.round(s.scientistChance * 100), (v) => `${v}%`, 25, 0, 100, (v) => ({ scientistChance: v / 100 }));
  const guardianStepper = stepper('Warden chance', 'wards after death', (s) => Math.round(s.guardianChance * 100), (v) => `${v}%`, 25, 0, 100, (v) => ({ guardianChance: v / 100 }));
  const shifterStepper = stepper('Shifter chance', 'needs 2 impostors', (s) => Math.round(s.shapeshifterChance * 100), (v) => `${v}%`, 25, 0, 100, (v) => ({ shapeshifterChance: v / 100 }));

  const visualToggle = toggle('Visual tasks public', 'others see your alibi', (s) => s.visualTasks, (on) => ({ visualTasks: on }));
  const anonToggle = toggle('Anonymous votes', 'hide who voted for whom', (s) => s.anonymousVotes, (on) => ({ anonymousVotes: on }));
  const confirmToggle = toggle('Confirm ejections', 'say when votes tie', (s) => s.confirmEjects, (on) => ({ confirmEjects: on }));
  const ghostToggle = toggle('Ghost chat', 'the dead can talk', (s) => s.ghostChat, (on) => ({ ghostChat: on }));

  const barModeBtn = el('button', { class: 'btn btn-ghost small', type: 'button', text: 'Always', on: { click: cycleBarMode } });
  function cycleBarMode(): void {
    if (!view) return;
    const order = ['always', 'meetings', 'never'];
    const next = order[(order.indexOf(view.settings.taskBarMode) + 1) % order.length] ?? 'always';
    haptics.play('tap');
    cb.onSettings({ taskBarMode: next });
  }
  const balanceNote = el('p', { class: 'hint' });

  const rolesCard = el('div', { class: 'card' }, [
    el('div', { class: 'row spread' }, [
      el('p', { class: 'label', text: 'Tasks & roles' }),
      el('span', { class: 'chip', text: 'Host only' }),
    ]),
    shortStepper.node,
    longStepper.node,
    commonStepper.node,
    visualStepper.node,
    engineerStepper.node,
    scientistStepper.node,
    guardianStepper.node,
    shifterStepper.node,
    el('div', { class: 'setting' }, [
      el('div', {}, [
        el('div', { class: 'setting-name', text: 'Task bar' }),
        el('div', { class: 'setting-sub', text: 'when the crew bar is shown' }),
      ]),
      barModeBtn,
    ]),
    visualToggle.node,
    anonToggle.node,
    confirmToggle.node,
    ghostToggle.node,
    balanceNote,
  ]);

  const practiceBtn = el('button', {
    class: 'btn btn-ghost btn-block',
    type: 'button',
    text: 'Start a practice round',
    on: {
      click: () => {
        haptics.play('tap');
        cb.onStartPractice();
      },
    },
  });

  // ---- chat --------------------------------------------------------------
  const chatList = el('div', { class: 'chat' });
  const chatInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Say something…',
    maxlength: MAX_CHAT_LEN,
    autocomplete: 'off',
    on: { keydown: (ev) => (ev as KeyboardEvent).key === 'Enter' && sendChat() },
  });
  const chatSend = el('button', {
    class: 'btn btn-primary btn-ico',
    type: 'button',
    text: 'Send',
    on: { click: () => sendChat() },
  });

  function sendChat(): void {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    haptics.play('tap');
    cb.onChat(text);
  }

  // ---- footer ------------------------------------------------------------
  const readyBtn = el('button', {
    class: 'btn btn-block',
    type: 'button',
    text: 'I am ready',
    on: {
      click: () => {
        haptics.play('tap');
        cb.onReady(!(you?.ready ?? false));
      },
    },
  });
  const startBtn = el('button', {
    class: 'btn btn-primary btn-block btn-lg',
    type: 'button',
    text: 'Start game',
    on: {
      click: () => {
        haptics.play('tap');
        cb.onStart();
      },
    },
  });
  const startHint = el('p', { class: 'hint' });

  const node = el('div', { class: 'screen' }, [
    el('div', { class: 'row spread' }, [phaseChip, leaveBtn]),
    el('div', { class: 'card code-panel' }, [
      el('div', {}, [el('p', { class: 'label', text: 'Station code' }), codeText]),
      el('div', { class: 'stack' }, [copyBtn, shareBtn]),
    ]),
    el('div', { class: 'card' }, [el('p', { class: 'label', text: 'Crew on board' }), playersGrid]),
    aiCard,
    settingsCard,
    rolesCard,
    el('div', { class: 'card' }, [
      el('p', { class: 'label', text: 'Lobby chat' }),
      chatList,
      el('div', { class: 'row' }, [chatInput, chatSend]),
    ]),
    el('div', { class: 'stack' }, [readyBtn, startBtn, practiceBtn, startHint]),
    el('div', { class: 'footer-note' }, [
      el('button', {
        class: 'linkish',
        type: 'button',
        text: 'How to play',
        on: { click: () => cb.onShowHelp() },
      }),
    ]),
  ]);

  function update(next: LobbyView, self: PlayerRow | undefined): void {
    view = next;
    you = self;
    const isHost = self?.isHost === true;

    codeText.textContent = next.code || '·····';
    phaseChip.textContent = next.phase;

    const sig = next.players.map((p) => `${p.id}:${p.name}:${p.ready}:${p.connected}:${p.isHost}`).join('|');
    if (sig !== lastSig) {
      lastSig = sig;
      playersGrid.textContent = '';
      for (const p of next.players) playersGrid.append(playerCard(p, p.id === self?.id, isHost));
      const emptySlots = Math.max(0, next.settings.maxPlayers - next.players.length);
      for (let i = 0; i < emptySlots; i++) {
        playersGrid.append(
          el('div', { class: 'player offline' }, [
            el('div', { class: 'pod pod-sm', html: podSvg({ color: 'white', size: 'sm', dim: true }) }),
            el('div', { class: 'pname', text: 'empty seat' }),
          ]),
        );
      }
    }

    aiSeatsValue.textContent = `${next.settings.aiSeats}`;
    aiNote.textContent =
      next.settings.aiSeats === 0
        ? 'No AI players — humans only.'
        : `${next.settings.aiSeats} AI players fill empty seats at launch. Names, personas and models are revealed at the end.`;
    if (seatsStepper) seatsStepper.sync(next.settings);
    aiStepper.sync(next.settings);
    impStepper.sync(next.settings);
    discussStepper.sync(next.settings);
    voteStepper.sync(next.settings);
    killStepper.sync(next.settings);
    taskStepper.sync(next.settings);
    costStepper.sync(next.settings);
    revealToggle.setAttribute('aria-checked', String(next.settings.revealEjectedRole));
    // ---- M3.5 settings ----
    for (const s of [shortStepper, longStepper, commonStepper, visualStepper, engineerStepper, scientistStepper, guardianStepper, shifterStepper]) {
      s.sync(next.settings);
      s.setEnabled(isHost);
    }
    for (const t of [visualToggle, anonToggle, confirmToggle, ghostToggle]) t.sync(next.settings);
    for (const t of [visualToggle.node, anonToggle.node, confirmToggle.node, ghostToggle.node]) {
      t.style.opacity = isHost ? '1' : '0.55';
      (t.querySelector('button') as HTMLButtonElement | null)?.toggleAttribute('disabled', !isHost);
    }
    const BAR_LABEL: Record<string, string> = { always: 'Always', meetings: 'Meetings', never: 'Never' };
    barModeBtn.textContent = BAR_LABEL[next.settings.taskBarMode] ?? 'Always';
    barModeBtn.disabled = !isHost;
    {
      // Show the host what this table would actually deal before they launch.
      const seats = Math.max(next.players.length, next.settings.aiSeats + next.players.filter((p) => !p.isAi).length);
      const rows = rolePreview(seats, next.settings.impostors, {
        engineerChance: next.settings.engineerChance,
        scientistChance: next.settings.scientistChance,
        guardianChance: next.settings.guardianChance,
        shapeshifterChance: next.settings.shapeshifterChance,
      });
      balanceNote.textContent = `With ${seats} seats: ${rows
        .filter((r) => r.expected > 0)
        .map((r) => `${r.label} ${Math.round(r.expected * 100) / 100}`)
        .join(' · ')}`;
    }
    practiceBtn.style.display = isHost ? 'block' : 'none';
    for (const s of [
      seatsStepper,
      aiStepper,
      impStepper,
      discussStepper,
      voteStepper,
      killStepper,
      taskStepper,
      costStepper,
    ]) {
      s.setEnabled(isHost);
    }
    revealToggle.disabled = !isHost;
    revealToggle.style.opacity = isHost ? '1' : '0.55';
    settingsCard.style.display = 'block';

    // chat: append only what is new
    if (next.chat.length < lastChatCount) {
      chatList.textContent = '';
      lastChatCount = 0;
    }
    for (const msg of next.chat.slice(lastChatCount)) {
      chatList.append(
        el('div', { class: `msg${msg.system ? ' msg-system' : ''}` }, [
          msg.system ? null : el('div', { html: podSvg({ color: msg.color, size: 'xs' }) }),
          el('div', {}, [
            msg.system ? null : el('div', { class: 'msg-who', text: msg.name }),
            el('div', { class: 'msg-body', text: msg.text }),
          ]),
        ]),
      );
    }
    lastChatCount = next.chat.length;
    chatList.scrollTop = chatList.scrollHeight;

    // footer state
    const humans = next.players.filter((p) => !p.isAi && p.connected).length;
    // Residents sent from the Commons are already sitting down; the host's AI-seat
    // setting only stands in for seats nobody has taken yet.
    const seatedAi = next.players.filter((p) => p.isAi).length;
    const aiSeats = seatedAi > 0 ? seatedAi : next.settings.aiSeats;
    const totalSeats = humans + aiSeats;
    readyBtn.textContent = self?.ready ? 'Ready — tap to undo' : 'I am ready';
    readyBtn.classList.toggle('btn-primary', self?.ready === true);
    readyBtn.style.display = self ? '' : 'none';
    startBtn.style.display = isHost ? '' : 'none';
    startBtn.disabled = totalSeats < 5;
    const expectedImpostors = defaultImpostors(totalSeats);
    startHint.textContent = isHost
      ? totalSeats < 5
        ? `Need 5 seats to launch — ${humans} human + ${aiSeats} AI right now.`
        : `Launching with ${totalSeats} seats · ${next.settings.impostors} impostor${next.settings.impostors > 1 ? 's' : ''} (genre default: ${expectedImpostors}).`
      : 'Waiting on the host to launch.';
  }

  return { node, update };
}
