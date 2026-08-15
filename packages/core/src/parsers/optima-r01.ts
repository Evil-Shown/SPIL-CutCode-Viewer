import type { ParseResult } from "../model/types.js";
import { parseIntermacFamily } from "./intermac-family.js";

export function parseOptimaR01(content: string, sourcePath: string): ParseResult {
  return parseIntermacFamily(content, sourcePath, "Optima", "optima-r01", {
    pattern: "pattern",
    cuttings: "cuttings",
    versionKey: "OPTCutVersion",
  });
}
