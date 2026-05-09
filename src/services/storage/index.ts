import type { KeyValueStore } from './KeyValueStore';
import { localStorageBackend } from './localStorageBackend';

export type { KeyValueStore } from './KeyValueStore';

let active: KeyValueStore = localStorageBackend;

export const store = {
  get<T>(key: string): T | null {
    return active.get<T>(key);
  },
  set<T>(key: string, value: T): void {
    active.set<T>(key, value);
  },
  remove(key: string): void {
    active.remove(key);
  },
  list(prefix?: string): string[] {
    return active.list(prefix);
  },
};

export function setStorageBackend(backend: KeyValueStore): void {
  active = backend;
}

export const StorageKeys = {
  flights: 'arc_rocketry_flights',
  rocketConfig: 'arc_rocketry_rocket_config',
  calibration: 'arc_rocketry_calibration_v2',
  settings: 'arc_rocketry_settings_v1',
  conditions: 'arc_rocketry_conditions_v1',
} as const;
