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
