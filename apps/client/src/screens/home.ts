/**
 * Home screen: one big Play button.
 *
 * The app is already pointed at the game gateway, so a player never types an
 * address or a code: tapping Play lands them in the open station (or opens one).
 * The 5-letter code still exists underneath — it is how the owner console sends
 * AI residents to a match, and how a friend on another device can join a
 * *specific* station if they want to.
 */
import {
  APP_NAME,
  STATION_NAME,
  CODE_LENGTH,
  HATS,
  NAMEPLATES,
  PETS,
  SKINS,
  normalizeCode,
  isValidCode,
  type Cosmetics,
} from '@aimong/shared';
import { el } from '../lib/dom.js';
import { brandMarkSvg } from '../lib/pod.js';
import { haptics } from '../lib/haptics.js';
import { shareBase } from '../net/endpoint.js';
import type { Prefs } from '../lib/prefs.js';

export interface HomeCallbacks {
  /** Default path: connect to the gateway and land in the open station. */
  onPlay: (name: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onJoin: (code: string, name: string) => Promise<void>;
  /** Free-roam practice: a solo station with every console live. */
  onPractice: () => Promise<void>;
  onResume: () => Promise<void>;
  onShowHelp: () => void;
  onInstall: () => void;
  onPrefsChanged: (prefs: Prefs) => void;
}

export interface InstallState {
  available: boolean;
  installed: boolean;
}

export interface HomeScreen {
  node: HTMLElement;
  setName: (name: string) => void;
  setBusy: (busy: boolean, label?: string) => void;
  setError: (message: string | null) => void;
  setInstall: (state: InstallState) => void;
  setServerState: (ready: boolean, message: string | null) => void;
}

export function renderHome(prefs: Prefs, hasResume: boolean, cb: HomeCallbacks): HomeScreen {
  // Shown as plain text so nobody has to wonder which server they are on.
  const gatewayHost = (() => {
    try {
      return new URL(shareBase()).host;
    } catch {
      return shareBase();
    }
  })();
  let name = prefs.name;
  let busy = false;
  let cosmetics: Cosmetics = { ...prefs.cosmetics };

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Your name',
    maxlength: 14,
    autocomplete: 'nickname',
    value: prefs.name,
    on: {
      input: (ev) => {
        name = (ev.target as HTMLInputElement).value;
        syncButtons();
      },
    },
  });

  const boxes: HTMLInputElement[] = [];
  const codeEntry = el(
    'div',
    { class: 'code-entry' },
    Array.from({ length: CODE_LENGTH }, (_, i) => {
      const box = el('input', {
        class: 'code-box',
        type: 'text',
        inputmode: 'text',
        maxlength: 1,
        autocomplete: 'off',
        placeholder: '·',
        on: {
          input: (ev) => {
            const input = ev.target as HTMLInputElement;
            const cleaned = normalizeCode(input.value);
            input.value = cleaned.slice(-1);
            input.classList.toggle('filled', input.value.length > 0);
            if (input.value && i < CODE_LENGTH - 1) boxes[i + 1]?.focus();
            syncButtons();
          },
          keydown: (ev) => {
            const key = (ev as KeyboardEvent).key;
            const input = ev.target as HTMLInputElement;
            if (key === 'Backspace' && !input.value && i > 0) boxes[i - 1]?.focus();
            if (key === 'Enter') void doJoin();
          },
          paste: (ev) => {
            const text = (ev as ClipboardEvent).clipboardData?.getData('text') ?? '';
            const cleaned = normalizeCode(text);
            if (!cleaned) return;
            ev.preventDefault();
            cleaned.split('').forEach((ch, idx) => {
              const target = boxes[idx];
              if (target) {
                target.value = ch;
                target.classList.add('filled');
              }
            });
            boxes[Math.min(cleaned.length, CODE_LENGTH - 1)]?.focus();
            syncButtons();
            if (cleaned.length === CODE_LENGTH) void doJoin();
          },
        },
      });
      boxes.push(box);
      return box;
    }),
  );

  const errorNode = el('div', { class: 'banner', role: 'status' });
  errorNode.style.display = 'none';

  function currentCode(): string {
    return boxes
      .map((b) => b.value)
      .join('')
      .toUpperCase();
  }

  const playBtn = el('button', {
    class: 'btn btn-primary btn-block btn-lg',
    type: 'button',
    text: 'Play',
    on: {
      click: () => {
        haptics.play('tap');
        void doPlay();
      },
    },
  });

  const createBtn = el('button', {
    class: 'btn btn-ghost btn-block',
    type: 'button',
    text: 'Open a new station',
    on: {
      click: () => {
        haptics.play('tap');
        void doCreate();
      },
    },
  });

  const joinBtn = el('button', {
    class: 'btn btn-block btn-lg',
    type: 'button',
    text: 'Join with code',
    on: {
      click: () => {
        haptics.play('tap');
        void doJoin();
      },
    },
  });

  const resumeBtn = el('button', {
    class: 'btn btn-ghost btn-block',
    type: 'button',
    text: 'Resume my last lobby',
    on: {
      click: () => {
        haptics.play('tap');
        void run(() => cb.onResume());
      },
    },
  });
  if (!hasResume) resumeBtn.style.display = 'none';

  function syncButtons(): void {
    const readyName = name.trim().length >= 1;
    const readyCode = isValidCode(currentCode());
    playBtn.disabled = busy || !readyName;
    createBtn.disabled = busy || !readyName;
    joinBtn.disabled = busy || !readyName || !readyCode;
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    setBusyLocal(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      haptics.play('lose');
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      busy = false;
      setBusyLocal(false);
    }
  }

  function setBusyLocal(value: boolean, label?: string): void {
    playBtn.textContent = value && label ? label : 'Play';
    if (!value) playBtn.textContent = 'Play';
    const spinner = value ? el('span', { class: 'spinner' }) : null;
    playBtn.querySelector('.spinner')?.remove();
    if (spinner) playBtn.prepend(spinner);
    syncButtons();
  }

  /** The default: no code, no address, just the gateway. */
  async function doPlay(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Pick a name first');
      nameInput.focus();
      return;
    }
    cb.onPrefsChanged({ ...prefs, name: trimmed, cosmetics });
    await run(() => cb.onPlay(trimmed));
  }

  async function doCreate(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Pick a name first');
      nameInput.focus();
      return;
    }
    cb.onPrefsChanged({ ...prefs, name: trimmed, cosmetics });
    await run(() => cb.onCreate(trimmed));
  }

  async function doJoin(): Promise<void> {
    const trimmed = name.trim();
    const code = currentCode();
    if (!trimmed) {
      setError('Pick a name first');
      nameInput.focus();
      return;
    }
    if (!isValidCode(code)) {
      setError('Codes are 5 characters (no 0, O, 1 or I)');
      return;
    }
    cb.onPrefsChanged({ ...prefs, name: trimmed, cosmetics });
    await run(() => cb.onJoin(code, trimmed));
  }

  function setBusy(value: boolean, label?: string): void {
    busy = value;
    setBusyLocal(value, label);
  }

  function setError(message: string | null): void {
    if (!message) {
      errorNode.style.display = 'none';
      errorNode.textContent = '';
      return;
    }
    errorNode.style.display = 'block';
    errorNode.textContent = message;
  }

  const helpBtn = el('button', {
    class: 'linkish',
    type: 'button',
    text: 'How to play',
    on: {
      click: () => {
        haptics.play('tap');
        cb.onShowHelp();
      },
    },
  });

  // ---- install card ------------------------------------------------------
  const installCard = el('div', { class: 'card' }, [
    el('div', { class: 'row spread' }, [
      el('div', {}, [
        el('div', { class: 'setting-name', text: 'Install on your phone' }),
        el('p', { class: 'hint', text: 'Home-screen icon, fullscreen, no address bar.' }),
      ]),
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: 'Install',
        on: {
          click: () => {
            haptics.play('tap');
            cb.onInstall();
          },
        },
      }),
    ]),
  ]);

  const installedCard = el('div', { class: 'card card-tight' }, [
    el('div', { class: 'row spread' }, [
      el('div', {}, [
        el('div', { class: 'setting-name', text: 'Installed app' }),
        el('p', { class: 'hint', text: 'You are running AImong Us from your home screen.' }),
      ]),
      el('span', { class: 'chip chip-ready', text: 'ON' }),
    ]),
  ]);
  installCard.style.display = 'none';
  installedCard.style.display = 'none';

  // ---- server state ------------------------------------------------------
  // ---- cosmetics (look-only; original items) ------------------------------
  const lookRows: HTMLElement[] = [];
  function lookRow(
    label: string,
    options: ReadonlyArray<{ id: string; name: string }>,
    field: keyof Cosmetics,
  ): HTMLElement {
    const chips = options.map((option) =>
      el('button', {
        class: 'look-chip',
        type: 'button',
        text: option.name,
        dataset: { id: option.id },
        on: {
          click: () => {
            haptics.play('tap');
            cosmetics = { ...cosmetics, [field]: option.id } as Cosmetics;
            cb.onPrefsChanged({ ...prefs, name: name.trim() || prefs.name, cosmetics });
            paintLook();
          },
        },
      }),
    );
    const row = el('div', { class: 'look-row' }, [
      el('span', { class: 'look-label', text: label }),
      el('div', { class: 'look-chips' }, chips),
    ]);
    row.dataset.field = field;
    lookRows.push(row);
    return row;
  }
  function paintLook(): void {
    for (const row of lookRows) {
      const field = row.dataset.field as keyof Cosmetics;
      for (const chip of row.querySelectorAll<HTMLButtonElement>('.look-chip')) {
        chip.classList.toggle('on', chip.dataset.id === cosmetics[field]);
      }
    }
  }
  const lookCard = el('div', { class: 'card stack' }, [
    el('div', { class: 'row spread' }, [
      el('p', { class: 'label', text: 'Your look' }),
      el('span', { class: 'chip', text: 'cosmetics' }),
    ]),
    lookRow('Hat', HATS, 'hat'),
    lookRow('Skin', SKINS, 'skin'),
    lookRow('Pet', PETS, 'pet'),
    lookRow('Plate', NAMEPLATES, 'nameplate'),
    el('p', { class: 'hint', text: 'Looks only — nothing here changes the rules.' }),
  ]);
  paintLook();

  const practiceBtn = el('button', {
    class: 'btn btn-ghost btn-block',
    type: 'button',
    text: 'Practise alone',
    on: {
      click: () => {
        haptics.play('tap');
        if (!name.trim()) {
          setError('Pick a name first');
          nameInput.focus();
          return;
        }
        cb.onPrefsChanged({ ...prefs, name: name.trim(), cosmetics });
        void run(() => cb.onPractice());
      },
    },
  });

  const serverNote = el('div', { class: 'banner banner-info', role: 'status' });
  serverNote.style.display = 'none';

  const node = el('div', { class: 'screen' }, [
    el('div', { class: 'brand' }, [
      el('div', { html: brandMarkSvg() }),
      el('div', { class: 'brand-text' }, [
        el('h1', { text: APP_NAME }),
        el('p', { text: `Orbital research station ${STATION_NAME} · friends only` }),
      ]),
    ]),

    el('div', { class: 'card stack' }, [
      el('div', { class: 'field' }, [el('p', { class: 'label', text: 'Your name' }), nameInput]),
      playBtn,
      el('p', {
        class: 'hint',
        text: `Connects to ${gatewayHost}. You land in the open station with everyone else — no codes to type.`,
      }),
    ]),

    el('div', { class: 'card stack' }, [
      el('p', { class: 'label', text: 'Joining a specific station?' }),
      el('p', { class: 'hint', text: 'Most people never need this. Use it when a friend gives you a 5-letter code.' }),
      codeEntry,
      joinBtn,
      createBtn,
    ]),

    lookCard,
    practiceBtn,
    resumeBtn,
    installCard,
    installedCard,
    serverNote,
    errorNode,
    el('div', { class: 'footer-note' }, [
      helpBtn,
      el('span', { text: ` · ${gatewayHost}` }),
    ]),
  ]);

  syncButtons();
  return {
    node,
    setName: (value: string) => {
      nameInput.value = value;
      name = value;
      syncButtons();
    },
    setBusy,
    setError,
    setInstall: (state: InstallState) => {
      installedCard.style.display = state.installed ? 'block' : 'none';
      installCard.style.display = !state.installed && state.available ? 'block' : 'none';
    },
    setServerState: (ready: boolean, message: string | null) => {
      if (ready && !message) {
        serverNote.style.display = 'none';
        return;
      }
      serverNote.style.display = 'block';
      serverNote.textContent = message ?? 'Cannot reach the station yet — check your connection.';
    },
  };
}
