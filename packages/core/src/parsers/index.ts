import { detectFormat } from "../detect/formatDetector.js";
import type { ParseResult } from "../model/types.js";
import { parseBotteroOpt } from "./bottero-opt.js";
import { parseBystronicXyz } from "./bystronic-xyz.js";
import { parseChaoyangSrc } from "./chaoyang-src.js";
import { parseDisaiPrjx } from "./disai-prjx.js";
import { parseDxf } from "./dxf.js";
import { parseEagleIso } from "./eagle-isac-iso.js";
import { parseHeglaEdi } from "./hegla-edi.js";
import { parseIntermacCut, parseBavelloniCut } from "./intermac-cut.js";
import { parseIntermacOtd } from "./intermac-otd.js";
import { parseLisecDat } from "./lisec-dat.js";
import { parseMacotechFamily } from "./macotech-family.js";
import { parseMacotechImp } from "./macotech-imp.js";
import { parseOptimaOtv } from "./optima-otv.js";
import { parseOptimaR01 } from "./optima-r01.js";
import { parsePerfectCutPgm } from "./perfectcut-pgm.js";
import { parsePerfectCutPgmIndex } from "./perfectcut-pgm-index.js";
import { parsePerfectCutXml } from "./perfectcut-xml.js";
import { parseTuromasR01 } from "./turomas-r01.js";
import { parseTuromasV40 } from "./turomas-v40.js";
import { parseVetromacIso } from "./vetromac-iso.js";

/** Encrypted Perfect Cut archives (.ot5) — cannot be decoded without the key. */
function parsePerfectCutOt5(_content: string, sourcePath: string): ParseResult {
  return {
    status: "failed",
    warnings: [],
    error:
      "Encrypted Perfect Cut archive (.ot5). Export the layout from Perfect Cut as a plain format " +
      "(.OTD/.OPT/.IMP/.DAT/.EDI/.PGM/.R01/.XYZ) and open that instead.",
    detected: { vendor: "Perfect Cut", formatId: "perfectcut-ot5", confidence: "high", matchedSignal: "extension.ot5" },
  };
}

const PARSERS: Record<string, (content: string, sourcePath: string) => ParseResult> = {
  "intermac-otd": parseIntermacOtd,
  "intermac-cut": parseIntermacCut,
  "bavelloni-cut": parseBavelloniCut,
  "lisec-dat": parseLisecDat,
  "bottero-opt": parseBotteroOpt,
  "optima-r01": parseOptimaR01,
  "optima-otv": parseOptimaOtv,
  "macotech-imp": parseMacotechImp,
  "macotech-family": parseMacotechFamily,
  "hegla-edi": parseHeglaEdi,
  "dxf": parseDxf,
  "perfectcut-xml": parsePerfectCutXml,
  "perfectcut-ot5": parsePerfectCutOt5,
  "perfectcut-pgm": parsePerfectCutPgm,
  "perfectcut-pgm-index": parsePerfectCutPgmIndex,
  "turomas-r01": parseTuromasR01,
  "turomas-v40": parseTuromasV40,
  "bystronic-xyz": parseBystronicXyz,
  "vetromac-iso": parseVetromacIso,
  "eagle-isac-iso": parseEagleIso,
  "disai-prjx": parseDisaiPrjx,
  "chaoyang-src": parseChaoyangSrc,
};

/**
 * Extension-driven second guesses, tried in order when the content-based
 * detection is missing, weak, or the chosen parser comes back empty-handed.
 * The pairs share extensions and are told apart by section names, so trying
 * both is cheap and turns hard "unsupported format" walls into real parses.
 */
const EXTENSION_FALLBACKS: Record<string, string[]> = {
  iso: ["vetromac-iso", "eagle-isac-iso"],
  r01: ["optima-r01", "turomas-r01"],
  json: ["optima-otv", "turomas-v40"],
  imp: ["macotech-imp", "macotech-family"],
  cut: ["bavelloni-cut", "intermac-cut"],
  cni: ["bavelloni-cut", "intermac-cut"],
  pgm: ["perfectcut-pgm"],
  lst: ["perfectcut-pgm-index"],
  opt: ["bottero-opt"],
  xml: ["perfectcut-xml"],
};

/** Formats that can never produce geometry; retrying them only hides the real error. */
const NON_GEOMETRY = new Set(["perfectcut-ot5", "perfectcut-xml", "perfectcut-pgm-index", "macotech-family"]);

function extensionOf(filePath: string): string {
  return filePath.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Candidate formatIds to try, best first: the detected one, then any
 * extension-based alternatives that were not already chosen.
 */
function candidateFormatIds(content: string, sourcePath: string, detectedId: string): string[] {
  if (detectedId === "unknown") {
    // Nothing matched by content or extension — sweep every parser so a file
    // with a misleading (or missing) extension still opens.
    return Object.keys(PARSERS);
  }
  const out = [detectedId];
  for (const id of EXTENSION_FALLBACKS[extensionOf(sourcePath)] ?? []) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * How good an attempt is. A geometry-bearing parse always beats a bare
 * failure, and a bare failure always beats a partial that produced no sheets
 * (an index/statistics read of the wrong file).
 */
function rank(result: ParseResult): number {
  if (result.status === "ok") return 4;
  if (result.status === "partial" && (result.document?.sheets.length ?? 0) > 0) return 3;
  if (result.status === "failed") return 2;
  return 1;
}

/** The generic miss from `detectFormat`, as opposed to a real diagnostic. */
const UNSUPPORTED = /^Unsupported or unknown format/;

/**
 * Parse the file. The detected format is authoritative when it is confident and
 * its parser gave a specific diagnostic (e.g. "this .IMP is a glass-family
 * config"); otherwise the extension alternatives are tried and the best
 * outcome wins.
 */
export function parseCutcode(content: string, sourcePath = ""): ParseResult {
  const detected = detectFormat(content, sourcePath);
  const primary = PARSERS[detected.formatId]?.(content, sourcePath);
  const attempts: string[] = detected.formatId === "unknown" ? [] : [detected.formatId];

  if (primary) {
    primary.detected = { ...detected, ...primary.detected };
    const authoritative =
      detected.confidence === "high" &&
      primary.status === "failed" &&
      !!primary.error &&
      !UNSUPPORTED.test(primary.error);
    if (authoritative || rank(primary) === 4) return primary;
  }

  let best: ParseResult | null = primary ?? null;
  let bestRank = best ? rank(best) : 0;
  if (bestRank >= 3) return best!;

  for (const formatId of candidateFormatIds(content, sourcePath, detected.formatId)) {
    if (formatId === detected.formatId) continue;
    const parser = PARSERS[formatId];
    if (!parser) continue;
    attempts.push(formatId);
    const result = parser(content, sourcePath);
    result.detected = { ...detected, ...result.detected };

    const r = rank(result);
    if (r > bestRank) {
      best = result;
      bestRank = r;
    }
    if (r === 4) break;
  }

  const out: ParseResult = best ?? {
    status: "failed",
    warnings: [],
    error: `Unsupported or unknown format (${detected.vendor}, confidence: ${detected.confidence})`,
    detected,
  };

  if (attempts.length > 1) {
    out.detected.attempts = attempts.join(", ");
    if (out.status === "failed") {
      out.error = `${out.error ?? "Parse failed"} · tried ${attempts.join(", ")}`;
    } else if (out.status === "partial") {
      out.warnings = [
        `Read as ${out.detected.formatId} after trying ${attempts.join(", ")}`,
        ...out.warnings,
      ];
    }
  }
  return out;
}

/** Formats that only ever carry statistics or an index, never geometry. */
export function isNonGeometryFormat(formatId: string): boolean {
  return NON_GEOMETRY.has(formatId);
}

export const SUPPORTED_FORMAT_IDS: string[] = Object.keys(PARSERS);