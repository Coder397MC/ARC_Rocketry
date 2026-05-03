export interface CalibrationRow {
  targetHeight: number;
  requiredWeight: number;
  drill: number;
  duration?: number;
  temp?: number;
  wind?: string;
  humidity?: number;
}

export const INITIAL_CALIBRATION_DATA: CalibrationRow[] = [
  { targetHeight: 725, requiredWeight: 629, drill: 0 },
  { targetHeight: 726, requiredWeight: 627, drill: 0 },
  { targetHeight: 727, requiredWeight: 626, drill: 0 },
  { targetHeight: 728, requiredWeight: 624, drill: 0 },
  { targetHeight: 729, requiredWeight: 623, drill: 0 },
  { targetHeight: 730, requiredWeight: 623, drill: 0 },
  { targetHeight: 731, requiredWeight: 623, drill: 0 },
  { targetHeight: 732, requiredWeight: 622, drill: 0 },
  { targetHeight: 733, requiredWeight: 622, drill: 0 },
  { targetHeight: 734, requiredWeight: 621, drill: 0 },
  { targetHeight: 735, requiredWeight: 621, drill: 0 },
  { targetHeight: 736, requiredWeight: 620, drill: 0 },
  { targetHeight: 737, requiredWeight: 620, drill: 0 },
  { targetHeight: 738, requiredWeight: 619, drill: 0 },
  { targetHeight: 739, requiredWeight: 619, drill: 0 },
  { targetHeight: 740, requiredWeight: 619, drill: 0 },
  { targetHeight: 741, requiredWeight: 618, drill: 0 },
  { targetHeight: 742, requiredWeight: 618, drill: 0 },
  { targetHeight: 743, requiredWeight: 617, drill: 0 },
  { targetHeight: 744, requiredWeight: 617, drill: 0 },
  { targetHeight: 745, requiredWeight: 616, drill: 0 },
  { targetHeight: 746, requiredWeight: 616, drill: 0 },
  { targetHeight: 747, requiredWeight: 615, drill: 0 },
  { targetHeight: 748, requiredWeight: 615, drill: 0 },
  { targetHeight: 749, requiredWeight: 614, drill: 0 },
  { targetHeight: 750, requiredWeight: 614, drill: 0, duration: 33 },
  { targetHeight: 751, requiredWeight: 613, drill: 0 },
  { targetHeight: 752, requiredWeight: 613, drill: 0 },
  { targetHeight: 753, requiredWeight: 613, drill: 0 },
  { targetHeight: 754, requiredWeight: 612, drill: 0 },
  { targetHeight: 755, requiredWeight: 612, drill: 0 },
  { targetHeight: 756, requiredWeight: 612, drill: 0 },
  { targetHeight: 757, requiredWeight: 611, drill: 0 },
  { targetHeight: 758, requiredWeight: 611, drill: 0 },
  { targetHeight: 759, requiredWeight: 611, drill: 0 },
  { targetHeight: 760, requiredWeight: 610, drill: 0 },
  { targetHeight: 761, requiredWeight: 610, drill: 0 },
  { targetHeight: 762, requiredWeight: 610, drill: 0 },
  { targetHeight: 763, requiredWeight: 609, drill: 0 },
  { targetHeight: 764, requiredWeight: 608, drill: 0 },
  { targetHeight: 765, requiredWeight: 607, drill: 0 },
  { targetHeight: 766, requiredWeight: 606, drill: 0 },
  { targetHeight: 767, requiredWeight: 604, drill: 0 },
  { targetHeight: 768, requiredWeight: 603, drill: 0 },
  { targetHeight: 769, requiredWeight: 601, drill: 0 },
  { targetHeight: 770, requiredWeight: 600, drill: 0 },
  { targetHeight: 771, requiredWeight: 599, drill: 0 },
  { targetHeight: 772, requiredWeight: 598, drill: 0 },
  { targetHeight: 773, requiredWeight: 597, drill: 0 },
  { targetHeight: 774, requiredWeight: 596, drill: 0 },
  { targetHeight: 775, requiredWeight: 595, drill: 0, duration: 42 },
];
