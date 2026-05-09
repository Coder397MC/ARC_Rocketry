// Linear least-squares via normal equations: β = (XᵀX)⁻¹ Xᵀy.
// Solved with Gauss-Jordan + partial pivoting. For our scale (n ≤ 30
// flights × ≤ 7 features) this is plenty stable.

import type { Flight } from '../types';
import { airDensityKgM3 } from './atmosphere';

export interface LinearModel {
  beta: number[];               // [intercept, β₁, β₂, …]
  featureNames: string[];       // names of non-intercept columns
  rms: number;                  // RMS of residuals (training)
  n: number;
  k: number;                    // number of params (intercept + features)
  residuals: number[];          // ŷ − y
  yMean: number;
  r2: number;
}

export function fitLinear(
  rows: { features: number[]; y: number }[],
  featureNames: string[],
): LinearModel | null {
  const n = rows.length;
  const k = featureNames.length + 1;
  if (n < k) return null;

  const X: number[][] = rows.map((r) => [1, ...r.features]);
  const y = rows.map((r) => r.y);

  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const Xty: number[] = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const beta = solveLinearSystem(XtX, Xty);
  if (!beta) return null;

  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let sse = 0;
  let sst = 0;
  const residuals = rows.map((r, i) => {
    const yhat = beta[0] + r.features.reduce((s, v, j) => s + v * beta[j + 1], 0);
    const e = yhat - y[i];
    sse += e * e;
    sst += (y[i] - yMean) * (y[i] - yMean);
    return e;
  });
  const rms = Math.sqrt(sse / n);
  const r2 = sst > 0 ? 1 - sse / sst : 0;

  return { beta, featureNames, rms, n, k, residuals, yMean, r2 };
}

export function predict(model: LinearModel, features: number[]): number {
  return model.beta[0] + features.reduce((s, v, i) => s + v * model.beta[i + 1], 0);
}

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const k = b.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    }
    if (piv !== i) [M[i], M[piv]] = [M[piv], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    const div = M[i][i];
    for (let c = i; c <= k; c++) M[i][c] /= div;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const factor = M[r][i];
      if (factor === 0) continue;
      for (let c = i; c <= k; c++) M[r][c] -= factor * M[i][c];
    }
  }
  return M.map((row) => row[k]);
}

// ---------- Feature builders ----------

export interface FlightFeatures {
  massKg: number;
  rho: number;
  vWindMph: number;
  rodAngleDeg: number;
  rubberBandCm: number;
  hasWeather: boolean;
  hasRubberBand: boolean;
}

export function flightFeatures(f: Flight): FlightFeatures | null {
  const massKg = f.rocketMass / 1000;
  const tempC = f.tempC ?? f.temp;
  const pressureHpa = f.pressureHpa;
  const humidityPct = f.humidityPct ?? f.humidity;
  const hasWeather =
    typeof tempC === 'number' &&
    typeof pressureHpa === 'number' &&
    typeof humidityPct === 'number';
  const rho = hasWeather
    ? airDensityKgM3(tempC, pressureHpa, humidityPct)
    : 1.225;
  return {
    massKg,
    rho,
    vWindMph: f.windSpeedMph ?? 0,
    rodAngleDeg: f.rodAngleDeg ?? 0,
    rubberBandCm: f.rubberBandCm ?? 0,
    hasWeather,
    hasRubberBand: typeof f.rubberBandCm === 'number' && f.rubberBandCm > 0,
  };
}

// Altitude regression — chooses the richest feature set the data supports.
// With only mass/altitude available everywhere, falls back gracefully.
export function fitAltitudeModel(flights: Flight[]): LinearModel | null {
  const rows = flights
    .map((f) => {
      const ff = flightFeatures(f);
      if (!ff) return null;
      return {
        features: [ff.massKg, ff.rho, ff.vWindMph, ff.vWindMph * ff.vWindMph, ff.rodAngleDeg, ff.massKg * ff.rho],
        y: f.altitude,
        ff,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return null;

  const fullNames = ['mass_kg', 'rho', 'v_wind', 'v_wind_sq', 'rod_angle', 'mass_x_rho'];
  const full = fitLinear(rows, fullNames);
  if (full && full.n >= full.k + 2) return full;

  // Fallback 1: drop interaction + rod_angle when n is tight.
  const lean = rows.map((r) => ({
    features: [r.features[0], r.features[1], r.features[2]],
    y: r.y,
  }));
  const leanModel = fitLinear(lean, ['mass_kg', 'rho', 'v_wind']);
  if (leanModel && leanModel.n >= leanModel.k + 2) return leanModel;

  // Fallback 2: just mass.
  const tiny = rows.map((r) => ({ features: [r.features[0]], y: r.y }));
  return fitLinear(tiny, ['mass_kg']);
}

// Descent-time regression — only uses flights with a recorded duration AND
// a real (non-zero) rubber-band setting. Requires n ≥ k+2 (≥2 dof) before
// returning a model; under that, the fit overfits the few rb>0 anchors.
export function fitDescentModel(flights: Flight[]): LinearModel | null {
  const rows = flights
    .map((f) => {
      const ff = flightFeatures(f);
      if (!ff || !ff.hasRubberBand) return null;
      const total = f.descentTimeSec ?? f.time ?? f.duration;
      if (typeof total !== 'number') return null;
      return {
        features: [ff.rubberBandCm, ff.massKg / ff.rho, ff.massKg],
        y: total,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return null;
  const full = fitLinear(rows, ['rb_cm', 'mass_over_rho', 'mass_kg']);
  if (full && full.n >= full.k + 2) return full;

  // Lean fallback when we have enough for the full fit's dof check to fail:
  // drop mass_over_rho and mass_kg, keep rb_cm only. 2 params, n ≥ 4.
  const lean = rows.map((r) => ({ features: [r.features[0]], y: r.y }));
  const leanModel = fitLinear(lean, ['rb_cm']);
  if (leanModel && leanModel.n >= leanModel.k + 2) return leanModel;
  return null;
}

// Solve the altitude model for the mass that hits a given target altitude
// at today's conditions. Returns null if the model has no mass coefficient
// or it is non-physically zero.
export function recommendedMassG(
  model: LinearModel,
  targetAltFt: number,
  rho: number,
  vWindMph: number,
  rodAngleDeg: number,
): number | null {
  // Find all coefficients that contain mass (linear or interaction).
  // ŷ = β₀ + Σ βᵢ·xᵢ.  Solve for massKg given everything else fixed.
  // We assume features[0] is mass_kg; if mass_x_rho is present (last position
  // in full model), include it.
  const idxMass = model.featureNames.indexOf('mass_kg');
  if (idxMass < 0) return null;
  const idxRho = model.featureNames.indexOf('rho');
  const idxVw = model.featureNames.indexOf('v_wind');
  const idxVw2 = model.featureNames.indexOf('v_wind_sq');
  const idxRod = model.featureNames.indexOf('rod_angle');
  const idxMR = model.featureNames.indexOf('mass_x_rho');

  let constPart = model.beta[0];
  if (idxRho >= 0) constPart += model.beta[idxRho + 1] * rho;
  if (idxVw >= 0) constPart += model.beta[idxVw + 1] * vWindMph;
  if (idxVw2 >= 0) constPart += model.beta[idxVw2 + 1] * vWindMph * vWindMph;
  if (idxRod >= 0) constPart += model.beta[idxRod + 1] * rodAngleDeg;

  let coefMass = model.beta[idxMass + 1];
  if (idxMR >= 0) coefMass += model.beta[idxMR + 1] * rho;

  if (Math.abs(coefMass) < 1e-9) return null;
  const massKg = (targetAltFt - constPart) / coefMass;
  return massKg * 1000;
}

// Solve the descent model for rubber-band setting, given target total time
// at today's mass + ρ. Model fitted with features [rb_cm, mass/rho, mass_kg].
export function recommendedRubberBandCm(
  model: LinearModel,
  targetTotalSec: number,
  massKg: number,
  rho: number,
): number | null {
  const idxRb = model.featureNames.indexOf('rb_cm');
  if (idxRb < 0) return null;
  const idxMR = model.featureNames.indexOf('mass_over_rho');
  const idxM = model.featureNames.indexOf('mass_kg');

  let constPart = model.beta[0];
  if (idxMR >= 0) constPart += model.beta[idxMR + 1] * (massKg / rho);
  if (idxM >= 0) constPart += model.beta[idxM + 1] * massKg;

  const coefRb = model.beta[idxRb + 1];
  if (Math.abs(coefRb) < 1e-9) return null;
  return (targetTotalSec - constPart) / coefRb;
}

export function suspiciousFlightIndices(model: LinearModel, sigma = 2): number[] {
  const out: number[] = [];
  if (model.rms === 0) return out;
  for (let i = 0; i < model.residuals.length; i++) {
    if (Math.abs(model.residuals[i]) > sigma * model.rms) out.push(i);
  }
  return out;
}
