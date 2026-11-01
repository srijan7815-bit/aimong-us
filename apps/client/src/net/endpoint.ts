/**
 * Where the game server lives.
 *
 * - Web (browser / installed PWA): same origin. The Node process serving this
 *   bundle *is* the game server, so relative URLs are correct and survive any
 *   domain change.
 * - Native Android shell: the UI is bundled inside the app (instant cold start,
 *   offline shell), so relative URLs would hit the WebView's local scheme. There,
 *   `VITE_SERVER_URL` points at the Render deployment.
 *
 * Both cases flow through these helpers so nothing else has to care.
 */

const override = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim().replace(/\/$/, '');

export const SERVER_HTTP: string = override && override.length > 0 ? override : '';

/** Absolute URL for an API path (`/healthz`, `/api/rooms/ABCDE`, ...). */
export function apiUrl(path: string): string {
  return `${SERVER_HTTP}${path.startsWith('/') ? path : `/${path}`}`;
}

/** WebSocket endpoint for the Colyseus client. */
export function serverWsUrl(): string {
  if (SERVER_HTTP) return SERVER_HTTP.replace(/^http/, 'ws');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

/** True when the UI is served from a bundled asset store instead of the server. */
export const isBundledShell: boolean = SERVER_HTTP !== '';

/** Base for share links (always the public game URL, never the app's local scheme). */
export function shareBase(): string {
  return SERVER_HTTP || location.origin;
}
