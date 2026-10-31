/**
 * Haptics manager (PROD_QUA §3). Android Chrome only; iOS Safari has no
 * Vibration API, so everything degrades to a silent no-op there.
 */
import { loadPrefs, type HapticsLevel } from './prefs.js';

type PatternName =
  | 'tap'
  | 'step'
  | 'taskDone'
  | 'kill'
  | 'killed'
  | 'report'
  | 'meeting'
  | 'vote'
  | 'eject'
  | 'sabotage'
  | 'sabotageFixed'
  | 'mentioned'
  | 'win'
  | 'lose';

const PATTERNS: Record<PatternName, number[]> = {
  tap: [8],
  step: [15],
  taskDone: [25, 30, 40],
  kill: [70, 30, 120],
  killed: [200, 60, 300],
  report: [150, 60, 150],
  meeting: [120, 50, 120, 50, 250],
  vote: [20],
  eject: [400],
  sabotage: [80, 120, 80, 120, 80, 120],
  sabotageFixed: [30, 40, 30],
  mentioned: [25, 40, 25],
  win: [40, 40, 40, 40, 120],
  lose: [300],
};

const MIN_GAP_MS = 50;
let lastAt = 0;

export const haptics = {
  get level(): HapticsLevel {
    return loadPrefs().haptics;
  },

  supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  },

  play(name: PatternName): void {
    if (!this.supported()) return;
    const level = this.level;
    if (level === 'off') return;
    // Respect reduce-motion as "light": keep the signal, cut the punch.
    const pattern = level === 'light' ? PATTERNS[name].slice(0, 1) : PATTERNS[name];
    const now = Date.now();
    if (now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* some browsers throw when not user-activated */
    }
  },
};
