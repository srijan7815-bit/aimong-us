/**
 * Home screen: create a room or join with a 5-character code.
 * Mobile first: one thumb, big targets, paste-friendly code boxes.
 */
import { APP_NAME, STATION_NAME, MILESTONE, CODE_LENGTH, normalizeCode, isValidCode } from '@aimong/shared';
import { el } from '../lib/dom.js';
import { brandMarkSvg } from '../lib/pod.js';
import { haptics } from '../lib/haptics.js';
import type { Prefs } from '../lib/prefs.js';

export interface HomeCallbacks {
  onCreate: (name: string) => Promise<void>;
  onJoin: (code: string, name: string) => Promise<void>;
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
  let name = prefs.name;
  let busy = false;

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

  const createBtn = el('button', {
    class: 'btn btn-primary btn-block btn-lg',
    type: 'button',
    text: 'Create room',
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
    createBtn.textContent = value && label ? label : 'Create room';
    if (!value) createBtn.textContent = 'Create room';
    const spinner = value ? el('span', { class: 'spinner' }) : null;
    createBtn.querySelector('.spinner')?.remove();
    if (spinner) createBtn.prepend(spinner);
    syncButtons();
  }

  async function doCreate(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Pick a name first');
      nameInput.focus();
      return;
    }
    cb.onPrefsChanged({ ...prefs, name: trimmed });
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
    cb.onPrefsChanged({ ...prefs, name: trimmed });
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
      createBtn,
      el('p', {
        class: 'hint',
        text: 'You get a room code to share. Friends tap the link, type the code, done.',
      }),
    ]),

    el('div', { class: 'card stack' }, [
      el('p', { class: 'label', text: 'Join a station' }),
      codeEntry,
      joinBtn,
    ]),

    resumeBtn,
    installCard,
    installedCard,
    serverNote,
    errorNode,
    el('div', { class: 'footer-note' }, [
      helpBtn,
      el('span', { text: ` · ${MILESTONE} build · station online` }),
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
