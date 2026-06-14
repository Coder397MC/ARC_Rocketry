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
    // 2027 ARC motor (default for new flights). Numbers verified 2026-06 against
    // ThrustCurve's certified AeroTech F51NT (NAR): avgThrust 55.9 N,
    // totalImpulse 55.1 N·s, max 76.5 N, burn 1.0 s, 81 g, 24 mm.
    //   https://www.thrustcurve.org/motors/AeroTech/F51NT/
    // CAUTION — designation mismatch the coach must resolve against the official
    // 2027 ARC approved-motor list: the real product is the F51*NT* (New Blue
    // Thunder) with delays 5/7/9 — there is NO Redline "F51" and NO 10 s delay.
    // The 2026 motor was the F63*R* (Redline). The id below is kept as
    // 'f51-10r' only for data continuity with already-logged flights.
    // Note: only avgThrust feeds the off-rod-velocity / wind correction today;
    // totalImpulse is informational until the impulse integrator exists.
    id: 'f51-10r',
    manufacturer: 'AeroTech',
    designation: 'F51NT',
    class: 'F',
    avgThrust: 55.9,
    totalImpulse: 55.1,
    delays: [5, 7, 9],
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
