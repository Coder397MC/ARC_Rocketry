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
    id: 'f63-10r',
    manufacturer: 'AeroTech',
    designation: 'F63-10R',
    class: 'F',
    avgThrust: 63,
    totalImpulse: 49.5,
    delays: [10]
  }
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
