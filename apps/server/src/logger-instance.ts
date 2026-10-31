/**
 * Process-wide logger instance. Set once at boot; modules import this instead of
 * threading a logger through every constructor.
 */
import { createLogger, type Logger } from './logger.js';

let instance: Logger = createLogger('info', false);

export function setLogger(logger: Logger): void {
  instance = logger;
}

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop) {
    const value = (instance as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
