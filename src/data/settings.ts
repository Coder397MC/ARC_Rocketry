import type { Settings, Conditions, ChuteConfig } from '../types';
import { STANDARD_DENSITY_KG_M3 } from '../services/atmosphere';

export const DEFAULT_CHUTE: ChuteConfig = {
  diameterIn: 20.5,
  spillHoleDiameterIn: 4,
  materialCD: 0.75,
};

export const DEFAULT_SETTINGS: Settings = {
  // 2027 TARC: qualification altitude is a fixed 800 ft; finals is 775–825 ft
  // (800 ± 25), announced morning-of. Duration window 37–40 s for both. See
  // 2027-rules.md. (Stored settings on an existing device keep their old values
  // until the coach updates them on the Settings tab.)
  targetAltitudeFt: 800,
  targetTimeMinSec: 37,
  targetTimeMaxSec: 40,
  altitudeBiasFt: 0,
  referenceDensityKgM3: STANDARD_DENSITY_KG_M3,
  chute: DEFAULT_CHUTE,
  launchFields: [
    {
      id: 'home',
      name: 'Sixty Acres Park (Redmond, WA)',
      lat: 47.70677362601196,
      lon: -122.13947196072493,
    },
    {
      id: 'finals',
      name: 'TARC Finals (The Plains, VA)',
      lat: 38.829184031331906,
      lon: -77.8088339801777,
    },
  ],
  activeFieldId: 'home',
};

export function mergeSettings(loaded: Partial<Settings> | null): Settings {
  if (!loaded) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    chute: { ...DEFAULT_CHUTE, ...(loaded.chute ?? {}) },
    launchFields:
      loaded.launchFields && loaded.launchFields.length > 0
        ? loaded.launchFields
        : DEFAULT_SETTINGS.launchFields,
  };
}

export const DEFAULT_CONDITIONS: Conditions = {
  tempC: 15,
  pressureHpa: 1013.25,
  humidityPct: 50,
  windSpeedMph: 5,
  windDirectionDeg: 0,
  fieldElevationFt: 0,
  rodAngleDeg: 0,
};

export function mergeConditions(loaded: Partial<Conditions> | null): Conditions {
  if (!loaded) return DEFAULT_CONDITIONS;
  const merged = { ...DEFAULT_CONDITIONS, ...loaded };
  // One-time reset: the previous default rod angle was 5°. If the stored
  // value matches the old default, silently bring it down to today's 0°.
  if (merged.rodAngleDeg === 5) merged.rodAngleDeg = 0;
  return merged;
}
