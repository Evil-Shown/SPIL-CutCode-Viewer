/**
 * Machine dialects: per-vendor validation thresholds.
 * Values follow spil-opti's machineDialects.js conventions where known.
 */
export interface MachineDialect {
  /** Minimum parallel-cut spacing in mm (kerf proximity threshold). */
  kerfMinDistanceMm: number;
}

const DEFAULT_DIALECT: MachineDialect = { kerfMinDistanceMm: 3 };

const DIALECTS: Record<string, MachineDialect> = {
  LISEC: { kerfMinDistanceMm: 2 },
  BOTTERO: { kerfMinDistanceMm: 2 },
  HEGLA: { kerfMinDistanceMm: 2.5 },
  INTERMAC: { kerfMinDistanceMm: 3 },
  OPTIMA: { kerfMinDistanceMm: 3 },
  MACOTEC: { kerfMinDistanceMm: 3 },
  MACOTECH: { kerfMinDistanceMm: 3 },
  "PERFECT CUT": { kerfMinDistanceMm: 3 },
  DXF: { kerfMinDistanceMm: 2 },
};

export function dialectFor(vendor: string): MachineDialect {
  return DIALECTS[vendor.toUpperCase()] ?? DEFAULT_DIALECT;
}
