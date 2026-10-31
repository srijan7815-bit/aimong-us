/**
 * Boot: one Node process serves the built client, the REST helpers and the
 * Colyseus WebSocket endpoint on the same PORT (Render web service, single
 * instance — game state is in memory).
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket as WebSocketImpl } from 'ws';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { APP_NAME, MILESTONE, SHARED_VERSION, normalizeCode } from '@aimong/shared';
import { loadConfig } from './config.js';
import { setAppConfig } from './app-config.js';
import { createLogger } from './logger.js';
import { setLogger, logger } from './logger-instance.js';
import { registry } from './registry.js';
import { GameRoom } from './rooms/GameRoom.js';
import { RateLimiter } from './http/ratelimit.js';

/**
 * Colyseus 0.18 checks `client.readyState !== WebSocket.OPEN` inside its
 * reconnection path, relying on a global WebSocket. Node 22+ ships one; Node 20
 * does not, and without it every reconnection is denied with a 4003 close. We
 * polyfill from `ws` (already the transport's engine) so the server behaves
 * identically on Node 20 and 22.
 */
function ensureGlobalWebSocket(): void {
  const g = globalThis as { WebSocket?: unknown };
  if (typeof g.WebSocket === 'undefined') {
    g.WebSocket = WebSocketImpl;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/server/{src|dist} -> apps/client/dist */
const CLIENT_DIST = join(HERE, '..', '..', 'client', 'dist');

export async function main(): Promise<void> {
  ensureGlobalWebSocket();
  const config = loadConfig();
  setAppConfig(config);
  setLogger(createLogger(config.env.LOG_LEVEL, config.env.NODE_ENV === 'development'));

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '32kb' }));

  const bootedAt = Date.now();
  const apiLimiter = new RateLimiter({ max: 60, windowMs: 60_000 });

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      app: APP_NAME,
      milestone: MILESTONE,
      version: SHARED_VERSION,
      rooms: registry.size,
      uptimeSec: Math.round((Date.now() - bootedAt) / 1000),
    });
  });

  // Code -> roomId resolution, so any phone can join with just 5 characters.
  app.get('/api/rooms/:code', (req, res) => {
    if (!apiLimiter.take(req.ip ?? 'unknown')) {
      res.status(429).json({ error: 'slow down' });
      return;
    }
    const code = normalizeCode(req.params.code ?? '');
    const room = registry.get(code);
    if (!room) {
      res.status(404).json({ error: 'No station with that code (it may have closed)' });
      return;
    }
    res.json(room);
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({
      rooms: registry.list().map((r) => ({ code: r.code, players: r.players, phase: r.phase })),
      maxRooms: config.env.MAX_ROOMS,
    });
  });

  if (existsSync(CLIENT_DIST)) {
    app.use(
      express.static(CLIENT_DIST, {
        index: 'index.html',
        setHeaders: (res, path) => {
          // Hashed assets are immutable; the shell must always revalidate.
          if (path.includes('/assets/'))
            res.setHeader('cache-control', 'public, max-age=31536000, immutable');
          else res.setHeader('cache-control', 'no-cache');
        },
      }),
    );
    // SPA fallback. Colyseus' own routes are matched by its router before Express
    // ever sees them, so this cannot swallow /matchmake.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/healthz') return next();
      res.sendFile(join(CLIENT_DIST, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('html')
        .send(
          `<body style="font-family:system-ui;padding:2rem;background:#0b1220;color:#e6edf7">
             <h1>AImong Us server is up</h1>
             <p>Client bundle not built yet. Run <code>pnpm build</code>, or use the Vite dev server.</p>
             <p><a style="color:#7CE2FE" href="/healthz">/healthz</a></p></body>`,
        );
    });
  }

  const httpServer = createServer(app);
  const transport = new WebSocketTransport({ server: httpServer, pingInterval: 15000 });
  const gameServer = new Server({ transport, greet: false });

  gameServer.define('game', GameRoom);

  await gameServer.listen(config.env.PORT);
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await gameServer.gracefullyShutdown(false).catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info(
    {
      port: config.env.PORT,
      env: config.env.NODE_ENV,
      publicUrl: config.env.PUBLIC_URL,
      clientDist: existsSync(CLIENT_DIST) ? CLIENT_DIST : '(not built)',
      maxRooms: config.env.MAX_ROOMS,
    },
    `${APP_NAME} ${MILESTONE} listening`,
  );
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  main().catch((err) => {
    // eslint-disable-next-line no-console -- boot failure must be visible even if logging is broken
    console.error('Fatal boot error:', err);
    process.exit(1);
  });
}
