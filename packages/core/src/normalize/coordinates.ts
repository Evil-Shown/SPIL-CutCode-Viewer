import type { CoordinateSemantics, Cut, CutDocument, CutPlan, Point, Rect } from "../model/types.js";

/** Canonical viewer space: top-left origin, X right, Y down, mm */
export const CANONICAL_SEMANTICS: CoordinateSemantics = {
  origin: "top-left",
  xAxis: "right",
  units: "mm",
};

function scaleOf(sem: CoordinateSemantics): number {
  return sem.units === "internal-ticks" ? (sem.unitsToMm ?? 1) : 1;
}

function isFlippedY(sem: CoordinateSemantics): boolean {
  return sem.origin === "bottom-left";
}

export function normalizePoint(
  x: number,
  y: number,
  semantics: CoordinateSemantics,
  sheetHeightMm: number
): Point {
  const s = scaleOf(semantics);
  let nx = x * s;
  let ny = y * s;
  if (isFlippedY(semantics)) ny = sheetHeightMm - ny;
  if (semantics.xAxis === "left") nx = -nx;
  return { x: nx, y: ny };
}

/**
 * Normalize a rectangle. A bottom-left-origin rect's y is measured from the
 * bottom edge, so the whole extent must be flipped — not just the corner —
 * or the rect lands off-sheet (the pre-v2 bug).
 */
export function normalizeRect(
  x: number,
  y: number,
  width: number,
  height: number,
  semantics: CoordinateSemantics,
  sheetHeightMm: number
): Rect {
  const s = scaleOf(semantics);
  const w = width * s;
  const h = height * s;
  let nx = x * s;
  let ny = y * s;
  if (isFlippedY(semantics)) ny = sheetHeightMm - (ny + h);
  if (semantics.xAxis === "left") nx = -nx;
  return { x: nx, y: ny, width: w, height: h };
}

function normalizeCutPlan(plan: CutPlan): CutPlan {
  const sheetW = plan.sheet.width * scaleOf(plan.coordinateSemantics);
  const sheetH = plan.sheet.height * scaleOf(plan.coordinateSemantics);
  const sem = plan.coordinateSemantics;

  const panes = plan.panes.map((p) => {
    const bounds = normalizeRect(p.bounds.x, p.bounds.y, p.bounds.width, p.bounds.height, sem, sheetH);
    return { ...p, bounds, polygon: p.polygon?.map((pt) => normalizePoint(pt.x, pt.y, sem, sheetH)) };
  });

  const cuts: Cut[] = plan.cuts.map((c) => ({
    ...c,
    points: c.points.map((pt) => normalizePoint(pt.x, pt.y, sem, sheetH)),
    center: c.center ? normalizePoint(c.center.x, c.center.y, sem, sheetH) : undefined,
  }));

  const laser = plan.laser?.map((l) => {
    const p = normalizePoint(l.x, l.y, sem, sheetH);
    return { ...l, x: p.x, y: p.y };
  });

  return {
    ...plan,
    sheet: { ...plan.sheet, width: sheetW, height: sheetH },
    panes,
    cuts,
    laser,
    coordinateSemantics: CANONICAL_SEMANTICS,
  };
}

export { normalizeCutPlan };

export function normalizeCutDocument(doc: CutDocument): CutDocument {
  return { ...doc, sheets: doc.sheets.map(normalizeCutPlan) };
}
