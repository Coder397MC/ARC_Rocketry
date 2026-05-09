// Condition-aware flight diagnostics.
//
// The diagnoser sees the full flight record (altitude, time, conditions,
// rod angle, wind, etc.), the round's targets from Settings, and an
// optional regression model. It speaks in actionable sentences that name
// the physical culprit — density, wind, rod angle, motor lot — instead
// of generic "fly higher / fly slower" advice.

import type { Flight, FlightScore, FlightDiagnosis } from '../types';
import { airDensityKgM3 } from './atmosphere';
import type { LinearModel } from './regression';

export interface DiagnosisContext {
  targetAltitudeFt: number;
  targetTimeMinSec: number;
  targetTimeMaxSec: number;
  referenceDensityKgM3: number;
  /** Optional regression model for motor-anomaly detection. */
  altitudeModel?: LinearModel | null;
  /** All logged flights up to (and including) the one being diagnosed. */
  history: Flight[];
}

const FT_TO_M = 0.3048;
const MPH_TO_FTSEC = 1.46667;

function flightDensity(flight: Flight): number | null {
  const tempC = flight.tempC ?? flight.temp;
  const pressureHpa = flight.pressureHpa;
  const humidityPct = flight.humidityPct ?? flight.humidity;
  if (
    typeof tempC !== 'number' ||
    typeof pressureHpa !== 'number' ||
    typeof humidityPct !== 'number'
  ) return null;
  return airDensityKgM3(tempC, pressureHpa, humidityPct);
}

export function calculateScore(flight: Flight, ctx: DiagnosisContext): FlightScore {
  const target = flight.targetAltitude > 0 ? flight.targetAltitude : ctx.targetAltitudeFt;
  const altitudeError = Math.abs(flight.altitude - target);

  const time = flight.time || flight.duration || 0;
  let timeError = 0;
  if (time && time < ctx.targetTimeMinSec) timeError = (ctx.targetTimeMinSec - time) * 4;
  else if (time && time > ctx.targetTimeMaxSec) timeError = (time - ctx.targetTimeMaxSec) * 4;

  return { altitudeError, timeError, totalScore: altitudeError + timeError };
}

export function diagnoseFlight(flight: Flight, ctx: DiagnosisContext): FlightDiagnosis[] {
  const out: FlightDiagnosis[] = [];
  const target = flight.targetAltitude > 0 ? flight.targetAltitude : ctx.targetAltitudeFt;
  const time = flight.time || flight.duration || 0;
  const altDelta = flight.altitude - target;

  // ---------------- Altitude with density attribution ----------------
  if (Math.abs(altDelta) > 5) {
    const rho = flightDensity(flight);
    let densityNote = '';
    let densityPct = 0;
    if (rho !== null && ctx.referenceDensityKgM3 > 0) {
      densityPct = (rho / ctx.referenceDensityKgM3 - 1) * 100;
      if (Math.abs(densityPct) > 1.5) {
        // For drag-dominated flight, altitude scales as 1/ρ. Δh from density:
        const expectedDeltaFt = -densityPct / 100 * target;  // approx
        densityNote =
          ` Air density was ${densityPct > 0 ? '+' : ''}${densityPct.toFixed(1)}% vs. calibration` +
          ` (≈ ${expectedDeltaFt > 0 ? '+' : ''}${expectedDeltaFt.toFixed(0)} ft of the gap is density alone).`;
      }
    }

    if (altDelta > 0) {
      out.push({
        phase: 'boost', severity: Math.abs(altDelta) > 30 ? 'high' : 'medium',
        title: 'Altitude Overshoot',
        description: `Flew +${Math.round(altDelta)} ft above target (${flight.altitude} vs. ${target}).${densityNote}`,
        recommendation: densityPct < -1.5
          ? `Add ~${Math.round(Math.abs(altDelta) * 0.6)} g for next flight, or wait for warmer air to thicken density toward calibration.`
          : `Add ~${Math.round(Math.abs(altDelta) * 0.6)} g (≈0.6 g per ft of overshoot).`,
        physicsReasoning: 'Excess altitude means the boost+coast retained more energy than the calibration assumed. Mass increases the gravity well during boost and reduces coast velocity through drag, both lowering apogee.',
        directionalEffect: 'Increasing mass decreases peak altitude.',
      });
    } else {
      out.push({
        phase: 'boost', severity: Math.abs(altDelta) > 30 ? 'high' : 'medium',
        title: 'Altitude Undershoot',
        description: `Flew ${Math.round(altDelta)} ft below target (${flight.altitude} vs. ${target}).${densityNote}`,
        recommendation: densityPct > 1.5
          ? `Drop ~${Math.round(Math.abs(altDelta) * 0.6)} g, or fly later in the day when air thins toward calibration.`
          : `Drop ~${Math.round(Math.abs(altDelta) * 0.6)} g, check fin alignment, polish surfaces.`,
        physicsReasoning: 'Lower-than-target apogee means insufficient kinetic energy at burnout, or excess drag during coast. Reducing mass lifts the thrust-to-weight ratio.',
        directionalEffect: 'Decreasing mass increases peak altitude.',
      });
    }
  }

  // ---------------- Descent / time + wind drift ----------------
  if (time > 0) {
    const wind = flight.windSpeedMph ?? 0;
    const descentSec = flight.descentTimeSec ?? Math.max(0, time - 8);  // fallback: total − boost+coast
    const driftFt = wind * MPH_TO_FTSEC * descentSec;
    const driftNote = wind >= 5 && descentSec > 0
      ? ` Downwind drift ≈ ${driftFt.toFixed(0)} ft at ${wind} mph for ${descentSec.toFixed(1)} s descent.`
      : '';

    if (time < ctx.targetTimeMinSec) {
      out.push({
        phase: 'descent', severity: 'medium',
        title: 'Descent Too Fast',
        description: `Flight time ${time.toFixed(1)} s (target ${ctx.targetTimeMinSec}–${ctx.targetTimeMaxSec} s).${driftNote}`,
        recommendation: 'Loosen the rubber band by 1–2 cm (more open chute area) or shrink the spill hole.',
        physicsReasoning: 'Terminal velocity v_term = √(2 m g / (ρ · C_D · A_eff)). A smaller A_eff (or higher mass) means faster descent.',
        directionalEffect: 'Larger effective chute area → slower descent → longer flight time.',
      });
    } else if (time > ctx.targetTimeMaxSec) {
      out.push({
        phase: 'descent', severity: 'medium',
        title: 'Descent Too Slow',
        description: `Flight time ${time.toFixed(1)} s (target ${ctx.targetTimeMinSec}–${ctx.targetTimeMaxSec} s).${driftNote}`,
        recommendation: 'Tighten the rubber band by 1–2 cm or enlarge the spill hole.',
        physicsReasoning: 'Excess descent time means too much chute area for the flight mass at today\'s density. Tightening the band shrinks A_eff.',
        directionalEffect: 'Smaller effective chute area → faster descent → shorter flight time.',
      });
    } else if (wind >= 8) {
      out.push({
        phase: 'descent', severity: 'low',
        title: 'High-Wind Drift',
        description: `Time was on target but wind was ${wind} mph.${driftNote}`,
        recommendation: 'Check recovery zone clearance; tilt rod into wind for next flight if drift threatens the safe area.',
        physicsReasoning: 'Drift distance ≈ wind speed × descent time. Independent of altitude.',
        directionalEffect: 'Less wind or shorter descent → smaller drift footprint.',
      });
    }
  }

  // ---------------- Rod-angle weathercocking ----------------
  if (typeof flight.rodAngleDeg === 'number' && Math.abs(flight.rodAngleDeg) > 5 && altDelta < -8) {
    const wind = flight.windSpeedMph ?? 0;
    if (wind >= 5) {
      out.push({
        phase: 'boost', severity: 'low',
        title: 'Weathercocking Loss',
        description: `Rod was tilted ${flight.rodAngleDeg}° in ${wind} mph wind. Some apogee was lost to off-vertical climb.`,
        recommendation: 'For TARC, set the rod within ±3° of vertical even when there\'s wind — the altitude cost outweighs the drift saving.',
        physicsReasoning: 'A tilted rod plus crosswind gives the rocket a horizontal velocity component during boost; energy goes sideways instead of up.',
        directionalEffect: 'Smaller rod angle → more vertical boost → higher apogee.',
      });
    }
  }

  // ---------------- Motor anomaly via regression residual ----------------
  if (ctx.altitudeModel && ctx.altitudeModel.n >= 4) {
    const idx = ctx.history.findIndex(f => f.id === flight.id);
    if (idx >= 0 && idx < ctx.altitudeModel.residuals.length) {
      const resid = ctx.altitudeModel.residuals[idx];
      if (Math.abs(resid) > 2 * ctx.altitudeModel.rms) {
        out.push({
          phase: 'boost', severity: 'high',
          title: 'Suspect Motor Anomaly',
          description: `Residual vs. regression model is ${resid > 0 ? '+' : ''}${resid.toFixed(0)} ft (model RMS ±${ctx.altitudeModel.rms.toFixed(1)} ft over ${ctx.altitudeModel.n} flights).`,
          recommendation: flight.motorLot
            ? `Cross-check lot ${flight.motorLot} against other flights — if other lot-${flight.motorLot} flights also drift, that lot is biased.`
            : 'Record the motor lot number on future flights so we can isolate batch effects.',
          physicsReasoning: 'When all controllables (mass, ρ, wind, angle) are accounted for and the flight still misses by >2σ, the unmodelled variable is most often motor impulse variation.',
          directionalEffect: 'Tagging motor lots and comparing within-lot vs. across-lot residuals will surface bad batches.',
        });
      }
    }
  }

  // ---------------- Calibration drift detector ----------------
  const recent = ctx.history.slice(-3);
  if (recent.length === 3 && recent.every(f => f.targetAltitude > 0)) {
    const meanDelta = recent.reduce((s, f) => s + (f.altitude - f.targetAltitude), 0) / 3;
    if (Math.abs(meanDelta) >= 12) {
      out.push({
        phase: 'general', severity: 'medium',
        title: 'Calibration Drift',
        description: `Last 3 flights averaged ${meanDelta > 0 ? '+' : ''}${meanDelta.toFixed(0)} ft vs. their targets — the table is no longer the freshest predictor.`,
        recommendation: 'Apply the suggested altitude bias in Settings, or lean on the regression-driven weight (it auto-corrects for this).',
        physicsReasoning: 'Persistent residual sign suggests an unmodelled systematic — drag change, mass-scale calibration drift, or motor-batch shift.',
        directionalEffect: 'Updating the bias slider, or letting the regression drive the recommended weight, neutralises the drift.',
      });
    }
  }

  // ---------------- Variance flag (kept from earlier) ----------------
  if (ctx.history.length >= 3) {
    const last3 = ctx.history.slice(-3);
    const alts = last3.map(f => f.altitude);
    const mean = alts.reduce((a, b) => a + b, 0) / alts.length;
    const variance = alts.reduce((s, v) => s + (v - mean) ** 2, 0) / alts.length;
    const stdDev = Math.sqrt(variance);
    const fitRms = ctx.altitudeModel?.rms ?? 0;
    if (stdDev > 20 && (fitRms === 0 || stdDev > 2 * fitRms)) {
      out.push({
        phase: 'general', severity: 'high',
        title: 'High Altitude Variance',
        description: `Last ${last3.length} flights vary by ±${Math.round(stdDev)} ft${fitRms > 0 ? ` — well beyond the ±${fitRms.toFixed(1)} ft fit RMS.` : '.'}`,
        recommendation: 'Check motor lot consistency, fin alignment, and that mass is being recorded post-prep (after wadding/glue cure).',
        physicsReasoning: 'When variance dwarfs the model fit RMS, the leftover scatter is unmodelled — usually motor batch or mechanical drift.',
        directionalEffect: 'Fixing the inconsistent variable should pull stdDev back toward fit RMS.',
      });
    }
  }

  // Use the FT_TO_M constant somewhere — silence unused warning for now in case
  // future Phase-4 code needs it inside this file's drift math.
  void FT_TO_M;

  return out;
}
