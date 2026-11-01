/**
 * PWA plumbing: service worker, install prompt, connectivity and the
 * "wake the Render instance" step.
 *
 * The app is designed to live on the phone's home screen and talk to the Render
 * deployment, so two things matter here:
 *  1. the shell must open instantly and never show a browser error page
 *     (service worker + cached shell + a boot screen painted before JS),
 *  2. the Render free instance sleeps when idle, so the first connection of the
 *     night can take ~30–60 s. We ping /healthz with backoff and say so instead
 *     of failing.
 */

export type WakePhase = 'checking' | 'cold-start' | 'ready' | 'failed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();

// Registered at module load: Chrome only fires beforeinstallprompt once per page
// load, and if nothing is listening at that moment the install offer is lost.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); // keep the default mini-infobar out of the way
  installEvent = event as BeforeInstallPromptEvent;
  for (const cb of installListeners) cb(true);
});

window.addEventListener('appinstalled', () => {
  installEvent = null;
  for (const cb of installListeners) cb(false);
});

export function isOnline(): boolean {
  return navigator.onLine !== false;
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || iosStandalone;
}

export function onInstallAvailable(cb: (available: boolean) => void): () => void {
  installListeners.add(cb);
  cb(installEvent !== null);
  return () => installListeners.delete(cb);
}

/** Android/desktop Chrome: ask the browser to install the app. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!installEvent) return 'unavailable';
  await installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  for (const cb of installListeners) cb(false);
  return choice.outcome;
}

export function registerServiceWorker(onUpdateReady: () => void): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        // A new deploy ships a new shell; surface it instead of silently mixing.
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady();
          });
        });
      } catch {
        /* offline-first is a bonus, not a requirement */
      }
    })();
  });
}

export function applyServiceWorkerUpdate(): void {
  navigator.serviceWorker?.controller?.postMessage('skip-waiting');
  location.reload();
}

export function watchConnectivity(cb: (online: boolean) => void): void {
  window.addEventListener('online', () => cb(true));
  window.addEventListener('offline', () => cb(false));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Ping /healthz until the server answers. Render free instances take tens of
 * seconds to wake, so the caller gets progress updates to show on the boot
 * screen. Resolves true once healthy, false if we give up.
 */
export async function ensureServerAwake(
  onPhase: (phase: WakePhase, waitedMs: number) => void,
  timeoutMs = 90_000,
): Promise<boolean> {
  const started = Date.now();
  let attempt = 0;
  onPhase('checking', 0);

  while (Date.now() - started < timeoutMs) {
    attempt++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/healthz', { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean };
        if (body.ok) {
          onPhase('ready', Date.now() - started);
          return true;
        }
      }
    } catch {
      /* not up yet (or the phone just lost signal) */
    }
    const waited = Date.now() - started;
    // A cold Render instance takes ~20-60 s; say so rather than showing an error.
    onPhase(waited > 3500 ? 'cold-start' : 'checking', waited);
    await sleep(Math.min(1500 * attempt, 5000));
  }

  onPhase('failed', Date.now() - started);
  return false;
}
