import { detectFormat } from "./detect/formatDetector.js";
import { normalizeCutDocument } from "./normalize/coordinates.js";
import type { CutDocument, DetectResult, ParseResult } from "./model/types.js";
import { parseCutcode } from "./parsers/index.js";
import { decodeCutcodeBytes } from "./decode/encoding.js";

export type { CutDocument, CutPlan, Cut, Pane, LaserMark, DocumentMetadata, CoordinateSemantics, Rect, Point, PaneShape, DetectResult, ParseResult } from "./model/types.js";
export { detectFormat } from "./detect/formatDetector.js";
export { decodeCutcodeBytes } from "./decode/encoding.js";
export { normalizeCutDocument, CANONICAL_SEMANTICS } from "./normalize/coordinates.js";
export { arcCenter, arcAngles, sampleArc } from "./geometry/arc.js";
export { parseCutcode } from "./parsers/index.js";

export function parseAndNormalize(content: string, sourcePath = ""): ParseResult {
  const result = parseCutcode(content, sourcePath);
  if (result.document) {
    result.document = normalizeCutDocument(result.document);
  }
  return result;
}

export function parseFileBytes(bytes: Uint8Array, sourcePath = ""): ParseResult {
  const content = decodeCutcodeBytes(bytes);
  return parseAndNormalize(content, sourcePath);
}

/** @deprecated use parseFileBytes for proper encoding handling */
export function parseFileContent(content: string, path: string): ParseResult {
  return parseAndNormalize(content, path);
}
