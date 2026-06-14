// Estimates WIND_K_G from a pair of logged flights. The pair must share
// motor lot, have similar mass (within 10 g), and have meaningfully different
// wind speed (≥ 2 mph apart). Tag flights with "#calib" in notes to force the
// pair; otherwise the helper picks the best available pair automatically.
//
// Physics:
//   apogee_loss_ft = WIND_K_G · (v_wind/v_rod)² · |coefMass_ft_per_g|
//   ⇒ WIND_K_G = −Δapogee / (Δratio² · |coefMass_ft_per_g|)

import type { Flight } from '../types';
import { offRodVelocityMph } from '../data/motors';

export interface WindKEstimate {
  windK: number;
  flightA: Flight;
  flightB: Flight;
  dRatioSq: number;
  dApogeeFt: number;
  source: 'tagged' | 'auto';
}

const CALIB_TAG = /#calib\b/i;

function pairScore(a: Flight, b: Flight): number {
  // Larger wind gap = stronger signal. Penalize mass mismatch. Motor lot is
  // preferred-not-required: reject only if both flights have lots and they
  // differ. Empty lots are accepted (most historical flights lack lot data).
  const dWind = Math.abs((a.windSpeedMph ?? 0) - (b.windSpeedMph ?? 0));
  const dMass = Math.abs(a.rocketMass - b.rocketMass);
  if (dWind < 2) return -Infinity;
  if (dMass > 10) return -Infinity;
  if ((a.motorId ?? '') !== (b.motorId ?? '')) return -Infinity;
  if (a.motorLot && b.motorLot && a.motorLot !== b.motorLot) return -Infinity;
  // Bonus when lots match (more confidence).
  const lotBonus = a.motorLot && b.motorLot && a.motorLot === b.motorLot ? 2 : 0;
  return dWind - dMass * 0.2 + lotBonus;
}

export function estimateWindK(
  flights: Flight[],
  coefMassFtPerKg: number,
): WindKEstimate | null {
  if (!(Math.abs(coefMassFtPerKg) > 1e-6)) return null;
  const coefMassFtPerG = Math.abs(coefMassFtPerKg) / 1000;

  const eligible = flights.filter(
    (f) =>
      // Hardware-faulted flights have an unreliable apogee — never use them
      // as a wind-calibration anchor.
      !f.motorAnomaly &&
      typeof f.windSpeedMph === 'number' &&
      typeof f.rocketMass === 'number' &&
      typeof f.altitude === 'number',
  );

  const tagged = eligible.filter((f) => CALIB_TAG.test(f.notes ?? ''));
  const pool = tagged.length >= 2 ? tagged : eligible;
  const source: 'tagged' | 'auto' = tagged.length >= 2 ? 'tagged' : 'auto';

  let bestA: Flight | null = null;
  let bestB: Flight | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const s = pairScore(pool[i], pool[j]);
      if (s > bestScore) {
        bestScore = s;
        bestA = pool[i];
        bestB = pool[j];
      }
    }
  }
  if (!bestA || !bestB || !isFinite(bestScore)) return null;

  // Order so B is the windier flight
  const A = (bestA.windSpeedMph ?? 0) <= (bestB.windSpeedMph ?? 0) ? bestA : bestB;
  const B = A === bestA ? bestB : bestA;

  const vRodA = offRodVelocityMph(A.motorId, A.rocketMass);
  const vRodB = offRodVelocityMph(B.motorId, B.rocketMass);
  if (!vRodA || !vRodB) return null;

  const ratioSqA = ((A.windSpeedMph ?? 0) / vRodA) ** 2;
  const ratioSqB = ((B.windSpeedMph ?? 0) / vRodB) ** 2;
  const dRatioSq = ratioSqB - ratioSqA;
  if (Math.abs(dRatioSq) < 1e-6) return null;

  const dApogeeFt = B.altitude - A.altitude;
  const windK = -dApogeeFt / (dRatioSq * coefMassFtPerG);

  return { windK, flightA: A, flightB: B, dRatioSq, dApogeeFt, source };
}
