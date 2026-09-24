import type { CutPlan, Pane, Point } from "../model/types.js";

export type YieldReport = {
  sheetAreaMm2: number;
  paneAreaMm2: number;
  wasteAreaMm2: number;
  yieldPct: number;
  paneCount: number;
  cutCount: number;
};

function shoelaceAreaMm2(pts: Point[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j]!;
    const b = pts[i]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function paneOutline(pane: Pane): Point[] | undefined {
  if (pane.polygon && pane.polygon.length >= 3) return pane.polygon;
  if (pane.shape?.kind === "polygon" && pane.shape.points.length >= 3) return pane.shape.points;
  return undefined;
}

function areaOfPaneMm2(pane: Pane): number {
  const outline = paneOutline(pane);
  if (outline) {
    const area = shoelaceAreaMm2(outline);
    if (area > 1e-6) return area;
  }
  return Math.max(0, pane.bounds.width) * Math.max(0, pane.bounds.height);
}

export function analyzeYield(plan: CutPlan): YieldReport {
  const sheetAreaMm2 = Math.max(0, plan.sheet.width) * Math.max(0, plan.sheet.height);
  let paneAreaMm2 = 0;
  for (const pane of plan.panes) paneAreaMm2 += areaOfPaneMm2(pane);
  const wasteAreaMm2 = Math.max(0, sheetAreaMm2 - paneAreaMm2);
  const yieldPct =
    sheetAreaMm2 <= 0 ? 0 : Math.min(100, Math.max(0, (100 * paneAreaMm2) / sheetAreaMm2));
  return {
    sheetAreaMm2,
    paneAreaMm2,
    wasteAreaMm2,
    yieldPct,
    paneCount: plan.panes.length,
    cutCount: plan.cuts.length,
  };
}
