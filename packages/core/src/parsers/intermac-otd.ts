import type { ParseResult } from "../model/types.js";
import { parseIntermacFamily } from "./intermac-family.js";

export function parseIntermacOtd(content: string, sourcePath: string): ParseResult {
  return parseIntermacFamily(content, sourcePath, "Intermac", "intermac-otd", {
    pattern: "pattern",
    cuttings: "cuttings",
    versionKey: "OTDCutVersion",
  });
}
