/**
 * Config handoff. Colyseus instantiates rooms itself (no constructor args), so
 * the boot sequence stashes the resolved config here once, before rooms exist.
 */
import type { AppConfig } from './config.js';

let current: AppConfig | null = null;

export function setAppConfig(cfg: AppConfig): void {
  current = cfg;
}

export function getAppConfig(): AppConfig {
  if (!current) throw new Error('App config not initialised — call setAppConfig() at boot');
  return current;
}
