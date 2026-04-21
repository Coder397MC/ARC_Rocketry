import type { Flight, FlightScore, FlightDiagnosis } from '../types';

export const TARGET_ALTITUDE = 750;
export const TARGET_TIME_MIN = 36;
export const TARGET_TIME_MAX = 39;

export function calculateScore(flight: Flight): FlightScore {
  const altitudeError = Math.abs(flight.altitude - TARGET_ALTITUDE);
  
  let timeError = 0;
  if (flight.time < TARGET_TIME_MIN) {
    timeError = (TARGET_TIME_MIN - flight.time) * 4;
  } else if (flight.time > TARGET_TIME_MAX) {
    timeError = (flight.time - TARGET_TIME_MAX) * 4;
  }
  
  return {
    altitudeError,
    timeError,
    totalScore: altitudeError + timeError
  };
}

export function diagnoseFlight(flight: Flight, lastFlights: Flight[]): FlightDiagnosis[] {
  const diagnoses: FlightDiagnosis[] = [];
  const score = calculateScore(flight);

  // 1. Altitude Analysis
  if (score.altitudeError > 5) {
    if (flight.altitude > TARGET_ALTITUDE) {
      diagnoses.push({
        phase: 'boost',
        severity: score.altitudeError > 30 ? 'high' : 'medium',
        title: 'Altitude Overshoot',
        description: `Rocket flew ${Math.round(flight.altitude - TARGET_ALTITUDE)}ft above target.`,
        recommendation: 'Increase rocket mass slightly or reduce motor impulse.',
        physicsReasoning: 'Altitude is a function of net thrust minus weight and drag. Increasing mass increases the gravity force and reduces acceleration during boost, while also increasing momentum (which can increase coast), but generally, for TARC rockets, more mass lowers the peak altitude.',
        directionalEffect: 'Increasing mass will decrease peak altitude.'
      });
    } else {
      diagnoses.push({
        phase: 'boost',
        severity: score.altitudeError > 30 ? 'high' : 'medium',
        title: 'Altitude Undershoot',
        description: `Rocket flew ${Math.round(TARGET_ALTITUDE - flight.altitude)}ft below target.`,
        recommendation: 'Decrease rocket mass or optimize for lower drag (polish surface, check fin alignment).',
        physicsReasoning: 'A lower peak altitude suggests insufficient energy was maintained during the boost and coast phases. Reducing mass increases the thrust-to-weight ratio, allowing for higher velocities before burnout.',
        directionalEffect: 'Decreasing mass will increase peak altitude.'
      });
    }
  }

  // 2. Descent Analysis
  if (flight.time < TARGET_TIME_MIN) {
    diagnoses.push({
      phase: 'descent',
      severity: 'medium',
      title: 'Descent Too Fast',
      description: `Flight time was ${flight.time}s (Target: 36-39s).`,
      recommendation: 'Increase parachute diameter or use a higher drag coefficient material/spill hole reduction.',
      physicsReasoning: 'Descent rate is determined by the equilibrium between gravity and the drag of the recovery system. A larger surface area (parachute) increases aerodynamic drag, slowing the descent.',
      directionalEffect: 'Increasing parachute size will increase flight time.'
    });
  } else if (flight.time > TARGET_TIME_MAX) {
    diagnoses.push({
      phase: 'descent',
      severity: 'medium',
      title: 'Descent Too Slow',
      description: `Flight time was ${flight.time}s (Target: 36-39s).`,
      recommendation: 'Decrease parachute diameter or add a spill hole (cut a hole in the center).',
      physicsReasoning: 'If the descent is too slow, the drag force exceeds the necessary deceleration. Reducing the surface area or allowing air to pass through (spill hole) reduces the drag coefficient.',
      directionalEffect: 'Decreasing parachute size will decrease flight time.'
    });
  }

  // 3. Consistency Analysis (if we have history)
  if (lastFlights.length >= 2) {
    const alts = lastFlights.map(f => f.altitude);
    const mean = alts.reduce((a, b) => a + b, 0) / alts.length;
    const variance = alts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / alts.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 20) {
      diagnoses.push({
        phase: 'general',
        severity: 'high',
        title: 'High Altitude Variance',
        description: `Your last ${lastFlights.length} flights show a deviation of +/- ${Math.round(stdDev)}ft.`,
        recommendation: 'Check motor consistency and check for aerodynamic inconsistencies (loose fins, inconsistent motor seating).',
        physicsReasoning: 'Low repeatability in altitude often points to variable drag (e.g., oscillating flight) or inconsistent motor performance. Ensure the launch rail is clean and the rocket is stable.',
        directionalEffect: 'Tightening mechanical tolerances will reduce variance.'
      });
    }
  }

  return diagnoses;
}
