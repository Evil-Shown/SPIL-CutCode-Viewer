import { detectFormat } from "./detect/formatDetector.js";
import { normalizeCutPlan } from "./normalize/coordinates.js";
import type { CutPlan, DetectResult, ParseResult } from "./model/types.js";
import { parseCutcode } from "./parsers/index.js";

export type { CutPlan, CoordinateSemantics, DetectResult, ParseResult } from "./model/types.js";
export { detectFormat } from "./detect/formatDetector.js";
export { normalizeCutPlan, CANONICAL_SEMANTICS } from "./normalize/coordinates.js";
export { parseIntermacOtd } from "./parsers/intermac-otd.js";
export { parseLisecDat } from "./parsers/lisec-dat.js";
export { parseBotteroOpt } from "./parsers/bottero-opt.js";
export { parseCutcode } from "./parsers/index.js";

export function parseAndNormalize(content: string, sourcePath = ""): ParseResult {
  const result = parseCutcode(content, sourcePath);
  if (result.plan) {
    result.plan = normalizeCutPlan(result.plan);
  }
  return result;
}

export function parseFileContent(content: string, path: string): ParseResult {
  return parseAndNormalize(content, path);
}
