import type { CutPlan } from "../model/types.js";

export type BedSize = { width: number; height: number };

export type BedFit = {
  fits: boolean;
  warning?: string;
};

/** True when the sheet lies on the machine bed within `tolMm` on both axes. */
export function sheetFitsBed(plan: CutPlan, bed: BedSize, tolMm = 0.5): boolean {
  return plan.sheet.width <= bed.width + tolMm && plan.sheet.height <= bed.height + tolMm;
}

/** Warning when the sheet is larger than the bed; otherwise undefined. */
export function bedFitWarning(plan: CutPlan, bed: BedSize, tolMm = 0.5): string | undefined {
  if (sheetFitsBed(plan, bed, tolMm)) return undefined;
  const dw = plan.sheet.width - bed.width;
  const dh = plan.sheet.height - bed.height;
  const extras: string[] = [];
  if (dw > tolMm) extras.push(`${dw.toFixed(1)} mm wider`);
  if (dh > tolMm) extras.push(`${dh.toFixed(1)} mm taller`);
  const detail = extras.length ? ` (${extras.join(", ")})` : "";
  return `OVERSIZE: sheet ${plan.sheet.width} × ${plan.sheet.height} mm exceeds bed ${bed.width} × ${bed.height} mm${detail}`;
}

export function checkBedFit(plan: CutPlan, bed: BedSize, tolMm = 0.5): BedFit {
  const warning = bedFitWarning(plan, bed, tolMm);
  return warning ? { fits: false, warning } : { fits: true };
}
