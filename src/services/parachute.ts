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

import type { CalibrationRow, ChuteConfig } from '../types';

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
 * Build A_eff(rubber_band_cm) by back-fitting from calibration rows that have
 * a recorded `duration`. Uses the existing rubber-band schedule
 * `rb(target) = 14 + (target − 725) · 12/50` (the same line the legacy linear
 * interp encodes) to map a row's target altitude to its rubber-band setting.
 */
export function fitRubberBandToAEff(
  calibration: CalibrationRow[],
  chute: ChuteConfig,
  referenceDensityKgM3: number,
): RubberBandFit | null {
  const anchors = calibration
    .filter((r) => typeof r.duration === 'number' && r.duration! > T_BOOST_COAST_SEC)
    .map((r) => {
      const tDescent = (r.duration as number) - T_BOOST_COAST_SEC;
      const apogeeM = r.targetHeight * FT_TO_M;
      const vTerm = apogeeM / tDescent;
      const massKg = r.requiredWeight / 1000;
      // A_eff back-out from v_term, holding C_D constant at chute.materialCD.
      const aEff =
        (2 * massKg * G) / (referenceDensityKgM3 * chute.materialCD * vTerm * vTerm);
      const rbCm = 14 + ((r.targetHeight - 725) * 12) / 50;
      return { rbCm, aEffM2: aEff, sourceTargetFt: r.targetHeight };
    });

  if (anchors.length < 2) return null;

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
