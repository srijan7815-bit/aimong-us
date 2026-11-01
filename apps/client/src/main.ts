/**
 * App shell: screen switching, toasts, help sheet, and the session lifecycle
 * (create / join / reconnect). All game rendering arrives in M2 with Phaser;
 * this file stays the place where "which screen am I on" is decided.
 */
import './styles.css';
import { APP_NAME, MILESTONE, SHARED_VERSION, STATION_NAME, isValidCode, normalizeCode } from '@aimong/shared';
import { el, mount } from './lib/dom.js';
import { haptics } from './lib/haptics.js';
import { loadPrefs, savePrefs, loadReconnect, type Prefs } from './lib/prefs.js';
import { Session, type LobbyView, type PlayerRow } from './net/session.js';
import { renderHome, type HomeScreen } from './screens/home.js';
import { renderLobby, type LobbyScreen } from './screens/lobby.js';
import { renderPlay, type PlayScreen } from './screens/play.js';
import type { PlayerView } from '@aimong/shared';
import {
  applyServiceWorkerUpdate,
  ensureServerAwake,
  isOnline,
  isStandalone,
  onInstallAvailable,
  promptInstall,
  registerServiceWorker,
  watchConnectivity,
  type WakePhase,
} from './lib/pwa.js';

const root = document.getElementById('app') as HTMLElement;
const toastHost = el('div', { class: 'toasts' });
document.body.append(toastHost);

let prefs: Prefs = loadPrefs();
const session = new Session();
let home: HomeScreen | null = null;
let lobby: LobbyScreen | null = null;
let play: PlayScreen | null = null;
let latestView: LobbyView | null = null;

function toast(level: 'info' | 'warn' | 'error', text: string, ms = 3200): void {
  const node = el('div', { class: `toast ${level}`, text });
  toastHost.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity 200ms, transform 200ms';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

function openSheet(title: string, body: HTMLElement[]): void {
  const backdrop = el('div', { class: 'sheet-backdrop' }, [
    el('div', { class: 'sheet' }, [
      el('div', { class: 'row spread' }, [
        el('h2', { text: title }),
        el('button', {
          class: 'btn btn-ghost btn-ico',
          type: 'button',
          text: 'Close',
          on: { click: () => backdrop.remove() },
        }),
      ]),
      ...body,
    ]),
  ]);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
}

function helpSheet(): void {
  openSheet('How to play', [
    el('div', {
      class: 'banner banner-info',
      text: `${MILESTONE} build: the lobby is live. Movement, tasks, killings and meetings land in the next milestones — there is no fake "start" button.`,
    }),
    el('ul', {}, [
      el('li', { text: 'One person taps Create room and gets a 5-letter code.' }),
      el('li', { text: 'Everyone else types the code (or opens the shared link) on their phone.' }),
      el('li', { text: 'The host picks seats, AI count, timers and the AI cost cap, then launches.' }),
      el('li', {
        text: 'Official rules of the genre: crew do tasks, impostors kill and lie, meetings vote someone into space.',
      }),
      el('li', {
        text: 'AIs only know what they could see on screen — no cheating, and their model names stay hidden until the end.',
      }),
    ]),
    el('div', { class: 'divider' }),
    el('div', { class: 'stock stack' }, [
      el('div', { class: 'setting' }, [
        el('div', {}, [
          el('div', { class: 'setting-name', text: 'Haptics' }),
          el('div', {
            class: 'setting-sub',
            text: haptics.supported() ? 'Android vibration feedback' : 'not supported on this browser',
          }),
        ]),
        el('button', {
          class: 'toggle',
          type: 'button',
          role: 'switch',
          ariaChecked: String(prefs.haptics !== 'off'),
          on: {
            click: (ev) => {
              const on = prefs.haptics === 'off';
              prefs = savePrefs({ haptics: on ? 'full' : 'off' });
              (ev.currentTarget as HTMLElement).setAttribute('aria-checked', String(on));
              if (on) haptics.play('tap');
            },
          },
        }),
      ]),
    ]),
    el('div', {
      class: 'footer-note',
      text: `${APP_NAME} · ${STATION_NAME} · v${SHARED_VERSION} ${MILESTONE}`,
    }),
  ]);
}

// ---------------------------------------------------------------- app shell

const boot = document.getElementById('boot');
const bootMsg = document.getElementById('boot-msg');
let serverReady = false;
let installAvailable = false;

function setBootMessage(text: string): void {
  if (bootMsg) bootMsg.textContent = text;
}

function hideBoot(): void {
  if (!boot) return;
  boot.style.transition = 'opacity 220ms ease';
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 240);
}

function wakeCopy(phase: WakePhase, waitedMs: number): string {
  if (phase === 'checking') return 'Waking up the station…';
  if (phase === 'cold-start') {
    const secs = Math.round(waitedMs / 1000);
    return secs < 20
      ? 'Waking up the station… the free server naps when idle.'
      : `Almost there — ${secs}s. First launch of the night is always the slowest.`;
  }
  if (phase === 'failed') return 'Cannot reach the station. Check your signal and retry.';
  return 'Station online.';
}

function showBootRetry(message: string): void {
  setBootMessage(message);
  if (boot?.querySelector('button')) return;
  const retry = el('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: 'Retry',
    on: {
      click: (ev) => {
        (ev.currentTarget as HTMLButtonElement).disabled = true;
        void bootApp();
      },
    },
  });
  boot?.append(retry);
}

/** Booting: wake the server, then show the home screen. */
async function bootApp(): Promise<void> {
  boot?.querySelector('button')?.remove();
  // No point spinning for 90 s behind an aeroplane-mode icon: say it plainly.
  if (!isOnline()) {
    serverReady = false;
    showBootRetry('You are offline. Get a signal and tap Retry — your room code still works.');
    return;
  }
  const ok = await ensureServerAwake((phase, waited) => setBootMessage(wakeCopy(phase, waited)));
  serverReady = ok;
  if (!ok) {
    serverReady = false;
    showBootRetry(
      'Cannot reach the station. The free server may be waking up — tap Retry, or check your signal.',
    );
    return;
  }
  hideBoot();
  showHome(retryMessage);
  retryMessage = undefined;
  if (isStandalone()) {
    try {
      if (!localStorage.getItem('aimong.installAnnounced')) {
        localStorage.setItem('aimong.installAnnounced', '1');
        toast('info', 'Installed — it opens fullscreen from now on.', 2400);
      }
    } catch {
      /* ignore */
    }
  }
}

let retryMessage: string | undefined;

function showHome(message?: string): void {
  teardownPlay();
  latestView = null;
  lobby = null;
  home = renderHome(prefs, loadReconnect() !== null, {
    onCreate: async (name) => {
      await session.createRoom(name);
    },
    onJoin: async (code, name) => {
      await session.joinByCode(code, name);
    },
    onResume: async () => {
      const ok = await session.tryReconnect();
      if (!ok) {
        home?.setError('That lobby has closed.');
        showHome();
      }
    },
    onShowHelp: helpSheet,
    onPrefsChanged: (next) => {
      prefs = savePrefs({ name: next.name });
    },
    onInstall: () => {
      void (async () => {
        const outcome = await promptInstall();
        if (outcome === 'accepted') toast('info', 'Installed — look for AImong on your home screen.');
        else if (outcome === 'unavailable' && !isStandalone()) {
          openSheet('Put it on your home screen', [
            el('ul', {}, [
              el('li', { text: 'Chrome on Android: tap the ⋮ menu, then "Add to Home screen".' }),
              el('li', { text: 'The app then opens fullscreen, no address bar, like a normal game.' }),
              el('li', { text: 'Same link, same room codes — installing changes nothing else.' }),
            ]),
          ]);
        }
        home?.setInstall({ available: installAvailable, installed: isStandalone() });
      })();
    },
  });
  mount(root, home.node);
  applyDeepLink();
  home.setInstall({ available: installAvailable, installed: isStandalone() });
  home.setServerState(serverReady, retryMessage ?? null);
  home.setBusy(!serverReady, serverReady ? undefined : 'Waking up…');
  if (message) toast('warn', message);
}

function showLobby(view: LobbyView, you: PlayerRow | undefined): void {
  if (!lobby) {
    lobby = renderLobby({
      onLeave: () => void leaveToHome(),
      onReady: (ready) => session.send('ready', { ready }),
      onStart: () => session.send('start', {}),
      onSettings: (patch) => session.send('settings', { patch }),
      onChat: (text) => session.send('chat', { text }),
      onKick: (playerId) => session.send('kick', { playerId }),
      onShowHelp: helpSheet,
      onToast: toast,
    });
    mount(root, lobby.node);
  }
  lobby.update(view, you);
}

function showPlay(view: LobbyView): void {
  if (play) return;
  home = null;
  lobby = null;
  const bridge = {
    selfId: () => session.selfId,
    players: () =>
      (latestView?.players ?? []).map((p) => ({ ...p }) as unknown as PlayerView),
    sendInput: (seq: number, x: number, y: number) => session.send('input', { seq, x, y }),
    isPlaying: () => (latestView?.phase ?? '') === 'PLAY',
  };
  play = renderPlay({
    bridge,
    code: view.code,
    onLeave: () => void leaveToHome(),
    onError: (message) => toast('error', message, 5000),
  });
  mount(root, play.node);
  void keepScreenAwake();
}

function teardownPlay(): void {
  play?.destroy();
  play = null;
}

async function leaveToHome(): Promise<void> {
  teardownPlay();
  await session.leave();
  showHome();
}

session.setHandlers({
  onState: (view, you) => {
    latestView = view;
    if (view.phase === 'PLAY') {
      showPlay(view);
      return;
    }
    // Any other phase (lobby, back-to-lobby, ended) is the lobby screen.
    teardownPlay();
    showLobby(view, you);
  },
  onNotice: (notice) => toast(notice.level, notice.text),
  onKicked: (reason) => {
    showHome(reason);
  },
  onDisconnect: () => {
    toast('warn', 'Connection lost — trying to get your seat back…', 5000);
    void (async () => {
      const ok = await session.tryReconnect();
      if (!ok) showHome('Lost the connection to that station.');
    })();
  },
  onReconnect: () => toast('info', 'Back in. Seat restored.'),
});

// Deep link / app shortcut handling:
//   /?code=ABCDE     -> prefill the join boxes
//   /?action=create  -> home-screen "Create" shortcut
//   /?action=join    -> home-screen "Join" shortcut
// These are applied *after* the home screen mounts: the boot sequence can take
// seconds on a cold Render instance, long after the initial script ran.
const params = new URLSearchParams(location.search);
const deepCode = normalizeCode(params.get('code') ?? '');
const shortcutAction = params.get('action');

function applyDeepLink(): void {
  if (deepCode && isValidCode(deepCode)) {
    document.querySelectorAll<HTMLInputElement>('.code-box').forEach((box, i) => {
      const ch = deepCode[i] ?? '';
      box.value = ch;
      box.classList.toggle('filled', ch.length > 0);
    });
  }
  const target =
    shortcutAction === 'join' || deepCode
      ? document.querySelector<HTMLInputElement>('.code-box')
      : shortcutAction === 'create'
        ? document.querySelector<HTMLInputElement>('input.input[placeholder="Your name"]')
        : null;
  target?.focus({ preventScroll: true });
}

// ------------------------------------------------------------------ bootstrap

onInstallAvailable((available) => {
  installAvailable = available;
  home?.setInstall({ available, installed: isStandalone() });
});

watchConnectivity((online) => {
  if (online) {
    toast('info', 'Back online.');
    if (!serverReady) void bootApp();
  } else {
    toast('warn', 'You are offline — the station link is down.', 6000);
  }
});

registerServiceWorker(() => {
  const bar = el('div', { class: 'toast', text: 'New build available.' });
  const btn = el('button', {
    class: 'linkish',
    type: 'button',
    text: 'Reload',
    on: { click: () => applyServiceWorkerUpdate() },
  });
  bar.append(' ', btn);
  toastHost.append(bar);
});

// Keep phones from sleeping mid-game once the game screen lands (M2+); harmless
// now and it means the API exists before we need it.
async function keepScreenAwake(): Promise<void> {
  const nav = navigator as unknown as {
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (e: string, cb: () => void) => void }> };
  };
  if (!nav.wakeLock) return;
  try {
    const lock = await nav.wakeLock.request('screen');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void keepScreenAwake();
      else void lock.release().catch(() => undefined);
    });
  } catch {
    /* denied — fine */
  }
}

// Resume an interrupted session (tab refresh inside the 60 s grace window),
// then wake the server and show the home screen.
void (async () => {
  const resumed = await session.tryReconnect().catch(() => false);
  if (resumed) {
    serverReady = true;
    hideBoot();
    void keepScreenAwake();
    return;
  }
  await bootApp();
  void keepScreenAwake();
})();
