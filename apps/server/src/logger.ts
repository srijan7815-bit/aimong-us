import { pino } from 'pino';

/**
 * Structured JSON logs. Pretty in dev, JSON in production (Render parses it).
 * Secrets are never logged: this logger is only handed ids and counts.
 */
export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    base: { app: 'aimong-us' },
    redact: {
      paths: ['*.apiKey', '*.authorization', 'req.headers.authorization', 'key', '*_API_KEY'],
      censor: '[redacted]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
