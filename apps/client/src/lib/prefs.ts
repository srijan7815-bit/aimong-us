/** Local, device-scoped preferences (name, haptics, motion). No accounts. */
export type HapticsLevel = 'off' | 'light' | 'full';

export interface Prefs {
  name: string;
  haptics: HapticsLevel;
  reduceMotion: boolean;
}

const KEY = 'aimong.prefs.v1';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

const defaults = (): Prefs => ({
  name: '',
  haptics: 'vibrate' in navigator ? 'full' : 'off',
  reduceMotion: prefersReducedMotion(),
});

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...defaults(), ...parsed };
  } catch {
    return defaults();
  }
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: preferences just do not persist */
  }
  return next;
}

/** Room reconnection token, per tab (sessionStorage dies with the tab). */
const RECONNECT_KEY = 'aimong.reconnect.v1';

export function saveReconnect(token: string, roomId: string): void {
  try {
    sessionStorage.setItem(RECONNECT_KEY, JSON.stringify({ token, roomId }));
  } catch {
    /* ignore */
  }
}

export function loadReconnect(): { token: string; roomId: string } | null {
  try {
    const raw = sessionStorage.getItem(RECONNECT_KEY);
    return raw ? (JSON.parse(raw) as { token: string; roomId: string }) : null;
  } catch {
    return null;
  }
}

export function clearReconnect(): void {
  try {
    sessionStorage.removeItem(RECONNECT_KEY);
  } catch {
    /* ignore */
  }
}
