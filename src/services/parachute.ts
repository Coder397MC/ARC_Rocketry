// Physics-based descent model. Pure functions, SI internally.
//
// A_full   = π·(d/2)²
// A_eff    = A_full(d_chute) − A_full(d_hole)        (geometric area minus spill)
// C_D·A    = C_D · A_eff                              (the one number that matters)
// v_term   = √( 2·m·g / (ρ · C_D·A) )
// t_descent ≈ h_apogee / v_term                       (ignores opening transient)
//
// Rubber-band tightens the chute and effectively shrinks the open area. We
// don't have a first-principles formula, so we fit A_eff = a + b·rb_cm from
// any calibration rows that carry a recorded `duration` (total flight time).
// With ≥2 such anchors, the inverse map gives required rb_cm for a target
// descent time on today's mass+density.

import type { Flight, ChuteConfig } from '../types';
import { airDensityKgM3 } from './atmosphere';

const G = 9.80665;
const IN_TO_M = 0.0254;
const FT_TO_M = 0.3048;

/** Estimated boost+coast time for an F63-10R + ~620 g rocket. */
const T_BOOST_COAST_SEC = 8;

export function chuteFullAreaM2(diameterIn: number): number {
  const r = (diameterIn * IN_TO_M) / 2;
  return Math.PI * r * r;
}

export function chuteEffectiveAreaM2(chute: ChuteConfig): number {
  const aFull = chuteFullAreaM2(chute.diameterIn);
  const aHole = chuteFullAreaM2(chute.spillHoleDiameterIn);
  return Math.max(0, aFull - aHole);
}

export function chuteCDA(chute: ChuteConfig): number {
  return chute.materialCD * chuteEffectiveAreaM2(chute);
}

export function terminalVelocityMps(
  massKg: number,
  densityKgM3: number,
  cdA: number,
): number {
  if (densityKgM3 <= 0 || cdA <= 0 || massKg <= 0) return 0;
  return Math.sqrt((2 * massKg * G) / (densityKgM3 * cdA));
}

export function descentTimeSec(
  apogeeFt: number,
  vTermMps: number,
): number {
  if (vTermMps <= 0) return 0;
  return (apogeeFt * FT_TO_M) / vTermMps;
}

/** Inverse: required C_D·A to land a given altitude in a given descent time. */
export function requiredCDAFromDescentTime(
  apogeeFt: number,
  descentTimeTargetSec: number,
  massKg: number,
  densityKgM3: number,
): number {
  if (descentTimeTargetSec <= 0 || densityKgM3 <= 0 || massKg <= 0) return 0;
  const apogeeM = apogeeFt * FT_TO_M;
  const vTerm = apogeeM / descentTimeTargetSec;
  return (2 * massKg * G) / (densityKgM3 * vTerm * vTerm);
}

export interface RubberBandFit {
  /** A_eff (m²) = a + b · rb_cm */
  a: number;
  b: number;
  /** Anchor points used for the fit — for diagnostics. */
  anchors: { rbCm: number; aEffM2: number; sourceTargetFt: number }[];
}

/**
 * Build A_eff(rubber_band_cm) from real logged flights that carry both a
 * recorded rubber-band setting and a descent (or total) time. Each flight's
 * A_eff is backed out from its *own* apogee, so the fit isolates the effect of
 * rb rather than conflating it with altitude (the bug in the old version,
 * which fabricated rb from target altitude via a fixed schedule and so derived
 * a physically-backwards positive slope). With real data the slope is negative:
 * higher rb → chute pulled up → smaller A_eff → faster descent.
 */
export function fitRubberBandToAEff(
  flights: Flight[],
  chute: ChuteConfig,
  referenceDensityKgM3: number,
): RubberBandFit | null {
  const anchors = flights
    .filter((f) => !f.motorAnomaly && typeof f.rubberBandCm === 'number' && f.rubberBandCm! > 0)
    .map((f) => {
      // Prefer a directly-recorded descent time; otherwise back it out of the
      // total flight time by removing the boost+coast phase.
      const totalTime = f.time ?? f.duration;
      const tDescent =
        typeof f.descentTimeSec === 'number' ? f.descentTimeSec
        : typeof totalTime === 'number' ? totalTime - T_BOOST_COAST_SEC
        : null;
      if (tDescent === null || tDescent <= 0 || !(f.altitude > 0)) return null;
      const tempC = f.tempC ?? f.temp;
      const humidity = f.humidityPct ?? f.humidity;
      const rho =
        typeof tempC === 'number' && typeof f.pressureHpa === 'number' && typeof humidity === 'number'
          ? airDensityKgM3(tempC, f.pressureHpa, humidity)
          : referenceDensityKgM3;
      const apogeeM = f.altitude * FT_TO_M;
      const vTerm = apogeeM / tDescent;
      const massKg = f.rocketMass / 1000;
      // A_eff back-out from v_term, holding C_D constant at chute.materialCD.
      const aEff = (2 * massKg * G) / (rho * chute.materialCD * vTerm * vTerm);
      return { rbCm: f.rubberBandCm as number, aEffM2: aEff, sourceTargetFt: f.targetAltitude };
    })
    .filter((a): a is { rbCm: number; aEffM2: number; sourceTargetFt: number } => a !== null);

  // Need ≥2 anchors spanning ≥2 distinct rb values for a meaningful slope.
  if (anchors.length < 2) return null;
  if (new Set(anchors.map((a) => a.rbCm)).size < 2) return null;

  // Two-point line through the extremes by rbCm; with more anchors, an
  // ordinary least-squares fit on (rbCm, aEffM2).
  const n = anchors.length;
  const sumX = anchors.reduce((s, p) => s + p.rbCm, 0);
  const sumY = anchors.reduce((s, p) => s + p.aEffM2, 0);
  const sumXX = anchors.reduce((s, p) => s + p.rbCm * p.rbCm, 0);
  const sumXY = anchors.reduce((s, p) => s + p.rbCm * p.aEffM2, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const b = (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;
  return { a, b, anchors };
}

export function aEffFromRubberBand(fit: RubberBandFit, rbCm: number): number {
  return fit.a + fit.b * rbCm;
}

export function rubberBandFromAEff(fit: RubberBandFit, aEffM2: number): number {
  if (fit.b === 0) return Number.NaN;
  return (aEffM2 - fit.a) / fit.b;
}

export interface DescentPrediction {
  cdA: number;
  vTermMps: number;
  vTermFtPerSec: number;
  tDescentSec: number;
  totalTimeSec: number;
}

export function predictDescent(
  chute: ChuteConfig,
  apogeeFt: number,
  massKg: number,
  densityKgM3: number,
  cdAOverride?: number,
): DescentPrediction {
  const cdA = cdAOverride ?? chuteCDA(chute);
  const vTerm = terminalVelocityMps(massKg, densityKgM3, cdA);
  const tDesc = descentTimeSec(apogeeFt, vTerm);
  return {
    cdA,
    vTermMps: vTerm,
    vTermFtPerSec: vTerm / FT_TO_M,
    tDescentSec: tDesc,
    totalTimeSec: T_BOOST_COAST_SEC + tDesc,
  };
}

export const BOOST_COAST_SEC = T_BOOST_COAST_SEC;
