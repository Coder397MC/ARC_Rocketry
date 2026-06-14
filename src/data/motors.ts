export interface Motor {
  id: string;
  manufacturer: string;
  designation: string;
  class: string;
  avgThrust: number; // Newtons
  totalImpulse: number; // Newton-seconds
  delays: number[];
}

export const APPROVED_MOTORS: Motor[] = [
  {
    // 2027 ARC motor (default for new flights). Nominal F-class values: average
    // thrust ≈ 51 N (the designation number), total impulse ≈ 55 N·s (AeroTech
    // F51 family per ThrustCurve, e.g. F51NT 55.1 N·s / 55.9 N avg). VERIFY
    // against the F51-10R data sheet and the 2027 ARC-approved list before
    // relying on it. Note: only avgThrust feeds the off-rod-velocity / wind
    // correction today; totalImpulse is informational until the integrator exists.
    id: 'f51-10r',
    manufacturer: 'AeroTech',
    designation: 'F51-10R',
    class: 'F',
    avgThrust: 51,
    totalImpulse: 55,
    delays: [10],
  },
  {
    // 2026 motor — kept so the archived 2026 season log resolves its motor.
    id: 'f63-10r',
    manufacturer: 'AeroTech',
    designation: 'F63-10R',
    class: 'F',
    avgThrust: 63,
    totalImpulse: 49.5,
    delays: [10],
  },
];

export const STANDARD_ROD_LENGTH_M = 1.0;  // TARC standard 1010 rail
const G = 9.81;
const MPS_TO_MPH = 2.23694;

export function getMotor(motorId: string | undefined): Motor | undefined {
  if (!motorId) return undefined;
  const key = motorId.toLowerCase();
  return APPROVED_MOTORS.find(
    (m) => m.id.toLowerCase() === key || m.designation.toLowerCase() === key,
  );
}

// Off-the-rod velocity in mph from energy balance over the rod:
//   v_rod = sqrt( 2 · (F_avg − m·g) · L_rod / m )
// Returns null if motor unknown or mass non-physical. Liftoff mass (rocket+motor)
// is what's logged on Flight.rocketMass, which is what we want here.
export function offRodVelocityMph(
  motorId: string | undefined,
  liftoffMassG: number,
  rodLengthM: number = STANDARD_ROD_LENGTH_M,
): number | null {
  const motor = getMotor(motorId);
  if (!motor || !(liftoffMassG > 0)) return null;
  const m = liftoffMassG / 1000;
  const netForce = motor.avgThrust - m * G;
  if (netForce <= 0) return null;
  const vMps = Math.sqrt((2 * netForce * rodLengthM) / m);
  return vMps * MPS_TO_MPH;
}
