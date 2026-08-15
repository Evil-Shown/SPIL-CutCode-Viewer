import type { CoordinateSemantics, CutPlan } from "../model/types.js";

/** Canonical viewer space: top-left origin, Y down, mm */
export const CANONICAL_SEMANTICS: CoordinateSemantics = {
  origin: "top-left",
  xAxis: "right",
  yAxis: "down",
  units: "mm",
};

export function normalizePoint(
  x: number,
  y: number,
  semantics: CoordinateSemantics,
  sheetHeight: number
): { x: number; y: number } {
  let scale = 1;
  if (semantics.units === "internal-ticks" && semantics.unitsToMm) {
    scale = semantics.unitsToMm;
  }
  let nx = x * scale;
  let ny = y * scale;

  if (semantics.origin === "bottom-left") {
    ny = sheetHeight - ny;
  }
  if (semantics.yAxis === "up") {
    ny = sheetHeight - ny;
  }
  if (semantics.xAxis === "left") {
    nx = -nx;
  }
  return { x: nx, y: ny };
}

export function normalizeCutPlan(plan: CutPlan): CutPlan {
  const { width, height } = plan.sheet;
  const sem = plan.coordinateSemantics;

  const panes = plan.panes.map((p) => {
    const tl = normalizePoint(p.bounds.x, p.bounds.y, sem, height);
    return {
      ...p,
      bounds: {
        x: tl.x,
        y: tl.y,
        width: p.bounds.width * (sem.unitsToMm ?? 1),
        height: p.bounds.height * (sem.unitsToMm ?? 1),
      },
    };
  });

  const cuts = plan.cuts.map((c) => ({
    ...c,
    points: c.points.map((pt) => normalizePoint(pt.x, pt.y, sem, height)),
  }));

  const laser = plan.laser?.map((l) => {
    const p = normalizePoint(l.x, l.y, sem, height);
    return { ...l, x: p.x, y: p.y };
  });

  return {
    ...plan,
    panes,
    cuts,
    laser,
    coordinateSemantics: CANONICAL_SEMANTICS,
    sheet: { ...plan.sheet, width: width * (sem.unitsToMm ?? 1), height: height * (sem.unitsToMm ?? 1) },
  };
}
