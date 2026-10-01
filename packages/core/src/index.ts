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
export { buildSchedule, scheduleToCsv, panesToCsv, stagesToCsv } from "./report/schedule.js";
export type { ScheduleReport, ScheduleRow, StageSummary } from "./report/schedule.js";
export { planToDxf, documentToDxf } from "./report/dxf.js";
export { validateCutDocument, groupIssues } from "./validation/validate.js";
export type { ValidationIssue, IssueCode, Severity, IssueGroup } from "./validation/validate.js";
export { dialectFor } from "./validation/dialects.js";
export { parseCutcode, isNonGeometryFormat, SUPPORTED_FORMAT_IDS } from "./parsers/index.js";
export { identifyNumIso } from "./parsers/num-iso.js";
export { stageLabel, STAGE_LABELS } from "./model/types.js";
export { DEFAULT_KINEMATICS, moveTimeS, moveDisplacementMm } from "./sim/kinematics.js";
export type { MachineKinematics } from "./sim/kinematics.js";
export { buildTimeline, headAt, cutPathPoints, polylineLength, pointAlongPolyline } from "./sim/timeline.js";
export type { CutTimeline, TimelineSegment, HeadState } from "./sim/timeline.js";
export { analyzeYield } from "./sim/yield.js";
export type { YieldReport } from "./sim/yield.js";
export { sheetFitsBed, bedFitWarning, checkBedFit } from "./sim/bed.js";
export type { BedSize, BedFit } from "./sim/bed.js";

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
