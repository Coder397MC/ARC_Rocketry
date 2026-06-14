export interface Flight {
  id: string;
  date: string;                 // ISO YYYY-MM-DD
  altitude: number;             // measured peak altitude, ft
  targetAltitude: number;       // ft
  time: number;                 // total flight time, s (== duration)
  motorId: string;
  rocketMass: number;           // grams (liftoff mass)
  parachuteDiameter: number;    // inches
  windLevel: 'low' | 'medium' | 'high';
  drill?: number;
  duration?: number;            // legacy alias for `time`
  temp?: number;                // legacy °C
  humidity?: number;            // legacy %

  // Phase-3 regression inputs
  rubberBandCm?: number;
  windSpeedMph?: number;
  tempC?: number;
  pressureHpa?: number;
  humidityPct?: number;
  motorLot?: string;
  motorTempF?: number;          // motor case temperature at launch
  /** Hardware fault (e.g. staged pop / double-ignition). Excluded from model training. */
  motorAnomaly?: boolean;
  descentTimeSec?: number;
  rodAngleDeg?: number;
  launchFieldId?: string;
  /** True if conditions were back-filled from Open-Meteo historical archive. */
  weatherFilled?: boolean;

  notes: string;
}

export interface RocketConfig {
  id: string;
  name: string;
  baseMass: number;
  diameter: number;
  baseParachuteSize: number;
  typicalMotorIds: string[];
}

export interface FlightScore {
  altitudeError: number;
  timeError: number;
  totalScore: number;
}

export interface FlightDiagnosis {
  phase: 'boost' | 'coast' | 'descent' | 'general';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  recommendation: string;
  physicsReasoning: string;
  directionalEffect: string;
}

export interface CalibrationRow {
  targetHeight: number;
  requiredWeight: number;
  drill: number;
  duration?: number;
  temp?: number;
  wind?: string;
  humidity?: number;
  source?: 'measured' | 'interpolated';
}

export interface LaunchField {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationFt?: number;
}

export interface ChuteConfig {
  diameterIn: number;
  spillHoleDiameterIn: number;
  materialCD: number;
}

export interface Settings {
  targetAltitudeFt: number;
  targetTimeMinSec: number;
  targetTimeMaxSec: number;
  altitudeBiasFt: number;
  /** Flights dated before this ISO date (YYYY-MM-DD) are never uploaded to the
   *  cloud — keeps an old 2026 device from overwriting the 2027 db on Upload. */
  uploadCutoffDate: string;
  /** Bumped when the seeded season targets change; a stored value below the
   *  current one triggers a one-time re-seed of the targets in mergeSettings. */
  settingsVersion?: number;
  launchFields: LaunchField[];
  activeFieldId: string;
  /** Air density (kg/m³) on the day the calibration table was anchored. */
  referenceDensityKgM3: number;
  chute: ChuteConfig;
}

export interface Conditions {
  tempC: number;
  pressureHpa: number;        // station/surface pressure
  humidityPct: number;        // 0–100
  windSpeedMph: number;
  windDirectionDeg: number;   // 0 = headwind down the rod
  fieldElevationFt: number;
  rodAngleDeg: number;        // 0 = vertical
  motorTempF?: number;         // motor case temperature, separate from ambient
  fetchedAt?: string;          // ISO timestamp if pulled from API
  fetchedFor?: string;         // launch field id used for fetch
}
