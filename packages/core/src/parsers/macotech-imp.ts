import type { ParseResult } from "../model/types.js";
import { parseIntermacFamily } from "./intermac-family.js";

export function parseMacotechImp(content: string, sourcePath: string): ParseResult {
  const result = parseIntermacFamily(content, sourcePath, "Macotech", "macotech-imp");

  const sheetMatch = content.match(/B=([\d.]+);H=([\d.]+)/);
  if (sheetMatch && result.plan) {
    if (!result.plan.sheet.width) result.plan.sheet.width = parseFloat(sheetMatch[1]);
    if (!result.plan.sheet.height) result.plan.sheet.height = parseFloat(sheetMatch[2]);
  }

  if (result.plan && result.plan.cuts.length === 0) {
    result.status = "partial";
    result.warnings.push("No cut segments found in IMP file");
  }

  return result;
}
