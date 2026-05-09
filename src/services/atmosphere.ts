// Pure functions. No I/O. Inputs in human-friendly units; outputs in SI.
//
// Density of moist air via partial pressures:
//   ρ = (P − e) / (R_d · T) + e / (R_v · T)
// Saturation vapor pressure (Clausius-Clapeyron):
//   e_s(T) = 611.3 · exp(19.854 − 5423/T)        [Pa, T in K]
// Station pressure from sea-level pressure (isothermal approximation,
// adequate for launch-field elevations < 2 km):
//   P_station = P_sea · exp(−g·h / (R_d · T))

const R_DRY = 287.05;       // J/(kg·K)
const R_VAPOR = 461.495;    // J/(kg·K)
const G = 9.80665;          // m/s²
const FT_TO_M = 0.3048;
const HPA_TO_PA = 100;

export function saturationVaporPressurePa(tempC: number): number {
  const T = tempC + 273.15;
  return 611.3 * Math.exp(19.854 - 5423 / T);
}

export function airDensityKgM3(
  tempC: number,
  pressureHpa: number,
  humidityPct: number,
): number {
  const T = tempC + 273.15;
  const P = pressureHpa * HPA_TO_PA;
  const rh = Math.max(0, Math.min(1, humidityPct / 100));
  const e = rh * saturationVaporPressurePa(tempC);
  return (P - e) / (R_DRY * T) + e / (R_VAPOR * T);
}

export function stationPressureHpa(
  seaLevelHpa: number,
  elevationFt: number,
  tempC: number,
): number {
  const h = elevationFt * FT_TO_M;
  const T = tempC + 273.15;
  return seaLevelHpa * Math.exp(-G * h / (R_DRY * T));
}

// Standard sea-level ISA reference: 15 °C, 1013.25 hPa, 0% RH ⇒ 1.2250 kg/m³.
export const STANDARD_DENSITY_KG_M3 = 1.225;

// Coast-altitude scales as 1/ρ for drag-dominated flight, so to fly the same
// altitude on a thin-air day (lower ρ), you must add mass. Using the local
// calibration-table slope ∂mass/∂altitude ≈ −0.6 g/ft, the mass nudge is:
//   Δm = (target_ft) · (ρ_cal/ρ_today − 1) · |slope|
// returns grams to add (positive) or subtract (negative).
export function densityMassCorrectionG(
  targetAltitudeFt: number,
  densityToday: number,
  densityReference: number,
  massPerFtG: number = 0.6,
): number {
  if (densityToday <= 0) return 0;
  const altitudeRatio = densityReference / densityToday - 1;
  return targetAltitudeFt * altitudeRatio * massPerFtG;
}
