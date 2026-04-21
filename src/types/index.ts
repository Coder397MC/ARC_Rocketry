export interface Flight {
  id: string;
  date: string;
  altitude: number; // feet
  targetAltitude: number; // The height aimed for
  time: number; // seconds
  motorId: string;
  rocketMass: number; // grams
  parachuteDiameter: number; // inches
  windLevel: 'low' | 'medium' | 'high';
  drill?: number;
  duration?: number;
  temp?: number;
  humidity?: number;
  notes: string;
}

export interface RocketConfig {
  id: string;
  name: string;
  baseMass: number;
  diameter: number;
  baseParachuteSize: number;
  typicalMotorIds: string[];
}

export interface FlightScore {
  altitudeError: number;
  timeError: number;
  totalScore: number;
}

export interface FlightDiagnosis {
  phase: 'boost' | 'coast' | 'descent' | 'general';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  recommendation: string;
  physicsReasoning: string;
  directionalEffect: string;
}

export interface CalibrationRow {
  targetHeight: number;
  requiredWeight: number;
  drill: number;
  duration?: number;
  temp?: number;
  wind?: string;
  humidity?: number;
}
