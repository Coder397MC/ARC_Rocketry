import type { Flight, RocketConfig, CalibrationRow, Settings, Conditions } from '../types';
import { store, StorageKeys } from './storage/index';

export { store, setStorageBackend, StorageKeys } from './storage/index';
export type { KeyValueStore } from './storage/index';

export const StorageService = {
  getFlights: (): Flight[] =>
    store.get<Flight[]>(StorageKeys.flights) ?? [],

  saveFlight: (flight: Flight) => {
    const flights = StorageService.getFlights();
    flights.push(flight);
    store.set(StorageKeys.flights, flights);
  },

  deleteFlight: (id: string) => {
    const filtered = StorageService.getFlights().filter(f => f.id !== id);
    store.set(StorageKeys.flights, filtered);
  },

  replaceFlights: (flights: Flight[]) => {
    store.set(StorageKeys.flights, flights);
  },

  getCalibration: (): CalibrationRow[] | null =>
    store.get<CalibrationRow[]>(StorageKeys.calibration),

  saveCalibration: (data: CalibrationRow[]) => {
    store.set(StorageKeys.calibration, data);
  },

  getRocketConfig: (): RocketConfig | null =>
    store.get<RocketConfig>(StorageKeys.rocketConfig),

  saveRocketConfig: (config: RocketConfig) => {
    store.set(StorageKeys.rocketConfig, config);
  },

  getSettings: (): Settings | null =>
    store.get<Settings>(StorageKeys.settings),

  saveSettings: (settings: Settings) => {
    store.set(StorageKeys.settings, settings);
  },

  getConditions: (): Conditions | null =>
    store.get<Conditions>(StorageKeys.conditions),

  saveConditions: (conditions: Conditions) => {
    store.set(StorageKeys.conditions, conditions);
  },

  clearAll: () => {
    store.remove(StorageKeys.flights);
    store.remove(StorageKeys.rocketConfig);
  },
};
