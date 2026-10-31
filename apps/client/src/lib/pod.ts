/**
 * Procedural "pod-bot" character art (PROD_QUA §1.2). Original design: rounded
 * body, single antenna with a per-colour symbol, centred porthole visor, two
 * boots. Drawn as inline SVG so 12 colour variants cost zero assets and stay
 * crisp at 20–60 px. The final atlas (M7) will swap in behind the same class.
 */
import { colorById, type PlayerColor } from '@aimong/shared';

const SYMBOL_PATHS: Record<PlayerColor['symbol'], (x: number, y: number, c: string) => string> = {
  circle: (x, y, c) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${c}"/>`,
  triangle: (x, y, c) => `<path d="M${x} ${y - 3}L${x + 3} ${y + 2.4}H${x - 3}Z" fill="${c}"/>`,
  square: (x, y, c) => `<rect x="${x - 2.4}" y="${y - 2.4}" width="4.8" height="4.8" rx="1" fill="${c}"/>`,
  diamond: (x, y, c) => `<path d="M${x} ${y - 3}L${x + 3} ${y}L${x} ${y + 3}L${x - 3} ${y}Z" fill="${c}"/>`,
  star: (x, y, c) =>
    `<path d="M${x} ${y - 3.2}l.95 2.05 2.25.25-1.65 1.5.45 2.2L${x} ${y + 1.9}l-2.05 1.1.45-2.2-1.65-1.5 2.25-.25z" fill="${c}"/>`,
  cross: (x, y, c) => `<path d="M${x - 1} ${y - 3}h2v2h2v2h-2v2h-2v-2h-2v-2h2z" fill="${c}"/>`,
  ring: (x, y, c) => `<circle cx="${x}" cy="${y}" r="2.7" fill="none" stroke="${c}" stroke-width="1.6"/>`,
  half: (x, y, c) => `<path d="M${x - 2.8} ${y}a2.8 2.8 0 0 1 5.6 0z" fill="${c}"/>`,
  bar: (x, y, c) => `<rect x="${x - 3}" y="${y - 1}" width="6" height="2.2" rx="1.1" fill="${c}"/>`,
  dot: (x, y, c) => `<circle cx="${x}" cy="${y}" r="1.7" fill="${c}"/>`,
  chevron: (x, y, c) =>
    `<path d="M${x - 2.8} ${y + 1.6}L${x} ${y - 1.8}L${x + 2.8} ${y + 1.6}" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  hex: (x, y, c) => `<path d="M${x} ${y - 3}l2.6 1.5v3L${x} ${y + 3}l-2.6-1.5v-3z" fill="${c}"/>`,
};

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export interface PodOptions {
  color: string;
  size?: 'xs' | 'sm' | 'lg';
  /** Dims the pod (used for disconnected players / ghosts later). */
  dim?: boolean;
}

export function podSvg({ color, size = 'sm', dim = false }: PodOptions): string {
  const c = colorById(color);
  const body = c.hex;
  const dark = shade(body, -60);
  const light = shade(body, 34);
  const ink = '#0a0e17';
  const antenna = SYMBOL_PATHS[c.symbol](20, 5, light);
  return `<svg class="pod pod-${size}" viewBox="0 0 40 48" role="img" aria-label="${c.name} pod-bot" ${
    dim ? 'opacity="0.45"' : ''
  }>
    <ellipse cx="20" cy="45.4" rx="12.5" ry="2.6" fill="rgba(0,0,0,0.45)"/>
    <line x1="20" y1="11" x2="20" y2="5" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>
    ${antenna}
    <rect x="7.2" y="38" width="7.6" height="6.4" rx="3.2" fill="${dark}"/>
    <rect x="25.2" y="38" width="7.6" height="6.4" rx="3.2" fill="${dark}"/>
    <rect x="6" y="9.5" width="28" height="30" rx="12.5" fill="${body}" stroke="${ink}" stroke-width="2.6"/>
    <path d="M9.6 16.5c1.4-4 4.6-6.2 8.6-6.6" stroke="rgba(255,255,255,0.55)" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <rect x="10.6" y="15.5" width="18.8" height="11.4" rx="5.7" fill="${ink}" opacity="0.9"/>
    <circle cx="16.1" cy="21.2" r="2.5" fill="#dff6ff"/>
    <circle cx="23.9" cy="21.2" r="2.5" fill="#dff6ff"/>
    <rect x="13.6" y="30.6" width="12.8" height="2.6" rx="1.3" fill="${dark}" opacity="0.7"/>
  </svg>`;
}

/** Brand mark used on the home screen (a pod-bot with a wary eye). */
export function brandMarkSvg(): string {
  return `<svg class="brand-mark" viewBox="0 0 40 48" aria-label="AImong Us">
    <ellipse cx="20" cy="45.4" rx="12.5" ry="2.6" fill="rgba(0,0,0,0.4)"/>
    <line x1="20" y1="11" x2="20" y2="5" stroke="#0a0e17" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="20" cy="5" r="2.4" fill="#7ce2fe"/>
    <rect x="7.2" y="38" width="7.6" height="6.4" rx="3.2" fill="#0b6f63"/>
    <rect x="25.2" y="38" width="7.6" height="6.4" rx="3.2" fill="#0b6f63"/>
    <rect x="6" y="9.5" width="28" height="30" rx="12.5" fill="#12a594" stroke="#0a0e17" stroke-width="2.6"/>
    <path d="M9.6 16.5c1.4-4 4.6-6.2 8.6-6.6" stroke="rgba(255,255,255,0.6)" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <rect x="10.6" y="15.5" width="18.8" height="11.4" rx="5.7" fill="#0a0e17" opacity="0.92"/>
    <circle cx="16.1" cy="21.2" r="2.5" fill="#dff6ff"/>
    <circle cx="23.9" cy="21.2" r="2.5" fill="#dff6ff"/>
    <path d="M14.6 17.4l4 4M23.9 17.4l-4 4" stroke="#0a0e17" stroke-width="1.4" opacity="0.5"/>
    <rect x="13.6" y="30.6" width="12.8" height="2.6" rx="1.3" fill="#0b6f63"/>
  </svg>`;
}
