import type { ParseResult } from "../model/types.js";
import { parseIntermacFamily } from "./intermac-family.js";
import type { FamilyConfig } from "./intermac-family.js";

const CONFIG: FamilyConfig = {
  patternKey: "opt_pattern",
  cuttingsKey: "opt_cuttings",
  versionKey: "OPTCutVersion",
  vendor: "Optima",
  formatId: "optima-r01",
};

export function parseOptimaR01(content: string, sourcePath: string): ParseResult {
  return parseIntermacFamily(content, sourcePath, CONFIG);
}
