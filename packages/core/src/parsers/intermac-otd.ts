import type { ParseResult } from "../model/types.js";
import { parseIntermacFamily } from "./intermac-family.js";
import type { FamilyConfig } from "./intermac-family.js";

const CONFIG: FamilyConfig = {
  patternKey: "pattern",
  cuttingsKey: "cuttings",
  versionKey: "OTDCutVersion",
  vendor: "Intermac",
  formatId: "intermac-otd",
};

export function parseIntermacOtd(content: string, sourcePath: string): ParseResult {
  return parseIntermacFamily(content, sourcePath, CONFIG);
}
