export interface Flight {
  id: string;
  date: string;
  altitude: number; // feet
  time: number; // seconds
  motorId: string;
  rocketMass: number; // grams
  parachuteDiameter: number; // inches
  windLevel: 'low' | 'medium' | 'high';
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
