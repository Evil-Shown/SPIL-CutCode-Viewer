import type { ParseResult } from "../model/types.js";
import { parseIntermacFamily } from "./intermac-family.js";
import type { FamilyConfig } from "./intermac-family.js";

const CONFIG: FamilyConfig = {
  patternKey: "opt_pattern",
  cuttingsKey: "opt_cuttings",
  versionKey: "OPTCutVersion",
  vendor: "Macotech",
  formatId: "macotech-imp",
};

export function parseMacotechImp(content: string, sourcePath: string): ParseResult {
  const result = parseIntermacFamily(content, sourcePath, CONFIG);

  // Fallback sheet dims from [SHEETS] B=...;H=... format
  if (result.document) {
    for (const sheet of result.document.sheets) {
      if (!sheet.sheet.width || !sheet.sheet.height) {
        const bh = content.match(/B=(\d+);.*?H=(\d+)/);
        if (bh) {
          sheet.sheet.width = parseInt(bh[1], 10);
          sheet.sheet.height = parseInt(bh[2], 10);
        }
      }
    }
    // Remove sheets that still have no dims after fallback
    result.document.sheets = result.document.sheets.filter((s) => s.sheet.width > 0 && s.sheet.height > 0);
  }

  if (result.document && result.document.sheets.length === 0) {
    return {
      status: "failed",
      warnings: result.warnings,
      error: "Could not determine sheet dimensions from IMP file",
      detected: result.detected,
    };
  }

  // Warn if no cuts found
  if (result.document && result.document.sheets.every((s) => s.cuts.length === 0)) {
    result.status = "partial";
    result.warnings.push("No cut segments found in IMP file");
  }

  return result;
}
