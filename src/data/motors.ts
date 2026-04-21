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
  // E Class
  { id: 'e12', manufacturer: 'Estes', designation: 'E12', class: 'E', avgThrust: 12, totalImpulse: 30, delays: [4, 6, 8] },
  { id: 'e20', manufacturer: 'Aerotech', designation: 'E20', class: 'E', avgThrust: 20, totalImpulse: 35, delays: [4, 7, 10] },
  { id: 'e30', manufacturer: 'Aerotech', designation: 'E30', class: 'E', avgThrust: 30, totalImpulse: 40, delays: [4, 7, 10] },
  
  // F Class
  { id: 'f15', manufacturer: 'Estes', designation: 'F15', class: 'F', avgThrust: 15, totalImpulse: 50, delays: [4, 6, 8] },
  { id: 'f26', manufacturer: 'Aerotech', designation: 'F26', class: 'F', avgThrust: 26, totalImpulse: 55, delays: [6, 9] },
  { id: 'f42', manufacturer: 'Aerotech', designation: 'F42', class: 'F', avgThrust: 42, totalImpulse: 50, delays: [4, 8] },
  { id: 'f51', manufacturer: 'Aerotech', designation: 'F51', class: 'F', avgThrust: 51, totalImpulse: 58, delays: [4, 8, 12] },
  { id: 'f67', manufacturer: 'Aerotech', designation: 'F67', class: 'F', avgThrust: 67, totalImpulse: 62, delays: [4, 6, 9] },
  
  // G Class
  { id: 'g40', manufacturer: 'Aerotech', designation: 'G40', class: 'G', avgThrust: 40, totalImpulse: 80, delays: [4, 7, 10] },
  { id: 'g74', manufacturer: 'Aerotech', designation: 'G74', class: 'G', avgThrust: 74, totalImpulse: 90, delays: [6, 9] },
  { id: 'g80', manufacturer: 'Aerotech', designation: 'G80', class: 'G', avgThrust: 80, totalImpulse: 100, delays: [4, 7, 10] },
  { id: 'g125', manufacturer: 'Aerotech', designation: 'G125', class: 'G', avgThrust: 125, totalImpulse: 120, delays: [6, 9, 14] },
];
