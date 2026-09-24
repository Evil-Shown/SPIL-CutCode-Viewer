export type MachineKinematics = {
  rapidSpeedMmS: number;
  scoreSpeedMmS: number;
  accelMmS2: number;
  headDownS: number;
  headUpS: number;
};

/** Rapid 200 m/min, score 120 m/min, accel 8 m/s², head down/up 0.15 s. */
export const DEFAULT_KINEMATICS: MachineKinematics = {
  rapidSpeedMmS: (200 * 1000) / 60,
  scoreSpeedMmS: (120 * 1000) / 60,
  accelMmS2: 8 * 1000,
  headDownS: 0.15,
  headUpS: 0.15,
};

/**
 * Duration of a point-to-point move with a trapezoidal velocity profile
 * (triangular when the distance is too short to reach vmax).
 */
export function moveTimeS(distanceMm: number, vmaxMmS: number, accelMmS2: number): number {
  const d = Math.max(0, distanceMm);
  const v = Math.max(0, vmaxMmS);
  const a = Math.max(0, accelMmS2);
  if (d < 1e-12) return 0;
  if (a < 1e-12) return v > 0 ? d / v : Number.POSITIVE_INFINITY;
  if (v < 1e-12) return Number.POSITIVE_INFINITY;
  const dTrap = (v * v) / a;
  if (d >= dTrap) return d / v + v / a;
  return 2 * Math.sqrt(d / a);
}

/** Distance travelled along a move at time tS under the same profile as `moveTimeS`. */
export function moveDisplacementMm(
  distanceMm: number,
  vmaxMmS: number,
  accelMmS2: number,
  tS: number
): number {
  const d = Math.max(0, distanceMm);
  const v = Math.max(0, vmaxMmS);
  const a = Math.max(0, accelMmS2);
  const T = moveTimeS(d, v, a);
  if (T <= 0) return d;
  const t = Math.min(Math.max(0, tS), T);
  if (a < 1e-12) return (t / T) * d;
  const dTrap = v > 0 ? (v * v) / a : 0;
  if (d >= dTrap && v > 0) {
    const tAcc = v / a;
    const tCruiseEnd = tAcc + (d - dTrap) / v;
    if (t <= tAcc) return 0.5 * a * t * t;
    if (t <= tCruiseEnd) return 0.5 * a * tAcc * tAcc + v * (t - tAcc);
    const td = T - t;
    return d - 0.5 * a * td * td;
  }
  const tAcc = Math.sqrt(d / a);
  if (t <= tAcc) return 0.5 * a * t * t;
  const td = T - t;
  return d - 0.5 * a * td * td;
}
