import type { Flight, RocketConfig, CalibrationRow } from '../types';

const FLIGHTS_KEY = 'arc_rocketry_flights';
const ROCKET_KEY = 'arc_rocketry_rocket_config';
const CALIBRATION_KEY = 'arc_rocketry_calibration';

export const StorageService = {
  getFlights: (): Flight[] => {
    const data = localStorage.getItem(FLIGHTS_KEY);
    return data ? JSON.parse(data) : [];
  },

  saveFlight: (flight: Flight) => {
    const flights = StorageService.getFlights();
    flights.push(flight);
    localStorage.setItem(FLIGHTS_KEY, JSON.stringify(flights));
  },

  deleteFlight: (id: string) => {
    const flights = StorageService.getFlights();
    const filtered = flights.filter(f => f.id !== id);
    localStorage.setItem(FLIGHTS_KEY, JSON.stringify(filtered));
  },

  getCalibration: (): CalibrationRow[] | null => {
    const data = localStorage.getItem(CALIBRATION_KEY);
    return data ? JSON.parse(data) : null;
  },

  saveCalibration: (data: CalibrationRow[]) => {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(data));
  },

  getRocketConfig: (): RocketConfig | null => {
    const data = localStorage.getItem(ROCKET_KEY);
    return data ? JSON.parse(data) : null;
  },

  saveRocketConfig: (config: RocketConfig) => {
    localStorage.setItem(ROCKET_KEY, JSON.stringify(config));
  },

  clearAll: () => {
    localStorage.removeItem(FLIGHTS_KEY);
    localStorage.removeItem(ROCKET_KEY);
  }
};
