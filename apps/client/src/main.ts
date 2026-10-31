/**
 * App shell: screen switching, toasts, help sheet, and the session lifecycle
 * (create / join / reconnect). All game rendering arrives in M2 with Phaser;
 * this file stays the place where "which screen am I on" is decided.
 */
import './styles.css';
import { APP_NAME, MILESTONE, SHARED_VERSION, STATION_NAME } from '@aimong/shared';
import { el, mount } from './lib/dom.js';
import { haptics } from './lib/haptics.js';
import { loadPrefs, savePrefs, loadReconnect, type Prefs } from './lib/prefs.js';
import { Session, type LobbyView, type PlayerRow } from './net/session.js';
import { renderHome, type HomeScreen } from './screens/home.js';
import { renderLobby, type LobbyScreen } from './screens/lobby.js';

const root = document.getElementById('app') as HTMLElement;
const toastHost = el('div', { class: 'toasts' });
document.body.append(toastHost);

let prefs: Prefs = loadPrefs();
const session = new Session();
let home: HomeScreen | null = null;
let lobby: LobbyScreen | null = null;
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
    el('div', { class: 'banner banner-info', text: `${MILESTONE} build: the lobby is live. Movement, tasks, killings and meetings land in the next milestones — there is no fake "start" button.` }),
    el('ul', {}, [
      el('li', { text: 'One person taps Create room and gets a 5-letter code.' }),
      el('li', { text: 'Everyone else types the code (or opens the shared link) on their phone.' }),
      el('li', { text: 'The host picks seats, AI count, timers and the AI cost cap, then launches.' }),
      el('li', { text: 'Official rules of the genre: crew do tasks, impostors kill and lie, meetings vote someone into space.' }),
      el('li', { text: 'AIs only know what they could see on screen — no cheating, and their model names stay hidden until the end.' }),
    ]),
    el('div', { class: 'divider' }),
    el('div', { class: 'stock stack' }, [
      el('div', { class: 'setting' }, [
        el('div', {}, [
          el('div', { class: 'setting-name', text: 'Haptics' }),
          el('div', { class: 'setting-sub', text: haptics.supported() ? 'Android vibration feedback' : 'not supported on this browser' }),
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
    el('div', { class: 'footer-note', text: `${APP_NAME} · ${STATION_NAME} · v${SHARED_VERSION} ${MILESTONE}` }),
  ]);
}

function showHome(message?: string): void {
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
  });
  mount(root, home.node);
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

async function leaveToHome(): Promise<void> {
  await session.leave();
  showHome();
}

session.setHandlers({
  onState: (view, you) => {
    latestView = view;
    if (view.phase === 'LOBBY' || view.phase === 'STARTING') {
      showLobby(view, you);
    } else {
      showLobby(view, you);
      toast('info', 'In-game screen arrives in M2.');
    }
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

// Deep link: /?code=ABCDE prefills the join boxes.
const params = new URLSearchParams(location.search);
const deepCode = params.get('code')?.toUpperCase() ?? '';
if (deepCode && /^[A-Z0-9]{5}$/.test(deepCode)) {
  setTimeout(() => {
    document.querySelectorAll<HTMLInputElement>('.code-box').forEach((box, i) => {
      const ch = deepCode[i] ?? '';
      box.value = ch;
      box.classList.toggle('filled', ch.length > 0);
    });
  }, 30);
}

// Resume an interrupted session (tab refresh inside the 60 s grace window).
void (async () => {
  const resumed = await session.tryReconnect().catch(() => false);
  if (!resumed) showHome();
})();
