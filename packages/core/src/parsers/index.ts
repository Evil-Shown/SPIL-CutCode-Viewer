import { detectFormat } from "../detect/formatDetector.js";
import type { ParseResult } from "../model/types.js";
import { parseBotteroOpt } from "./bottero-opt.js";
import { parseDxf } from "./dxf.js";
import { parseHeglaEdi } from "./hegla-edi.js";
import { parseIntermacCut } from "./intermac-cut.js";
import { parseIntermacOtd } from "./intermac-otd.js";
import { parseLisecDat } from "./lisec-dat.js";
import { parseMacotechFamily } from "./macotech-family.js";
import { parseMacotechImp } from "./macotech-imp.js";
import { parseOptimaOtv } from "./optima-otv.js";
import { parseOptimaR01 } from "./optima-r01.js";
import { parsePerfectCutXml } from "./perfectcut-xml.js";

/** Encrypted Perfect Cut archives (.ot5) — cannot be decoded without the key. */
function parsePerfectCutOt5(_content: string, sourcePath: string): ParseResult {
  return {
    status: "failed",
    warnings: [],
    error:
      "Encrypted Perfect Cut archive (.ot5). Export the layout from Perfect Cut as a plain format " +
      "(.OTD/.OPT/.IMP/.DAT/.EDI) and open that instead.",
    detected: { vendor: "Perfect Cut", formatId: "perfectcut-ot5", confidence: "high", matchedSignal: "extension.ot5" },
  };
}

const PARSERS: Record<string, (content: string, sourcePath: string) => ParseResult> = {
  "intermac-otd": parseIntermacOtd,
  "intermac-cut": parseIntermacCut,
  "lisec-dat": parseLisecDat,
  "bottero-opt": parseBotteroOpt,
  "optima-r01": parseOptimaR01,
  "optima-otv": parseOptimaOtv,
  "macotech-imp": parseMacotechImp,
  "hegla-edi": parseHeglaEdi,
  "dxf": parseDxf,
  "perfectcut-xml": parsePerfectCutXml,
  "macotech-family": parseMacotechFamily,
  "perfectcut-ot5": parsePerfectCutOt5,
};

export function parseCutcode(content: string, sourcePath = ""): ParseResult {
  const detected = detectFormat(content, sourcePath);
  const parser = PARSERS[detected.formatId];

  if (!parser) {
    return {
      status: "failed",
      warnings: [],
      error: `Unsupported or unknown format (${detected.vendor}, confidence: ${detected.confidence})`,
      detected,
    };
  }

  const result = parser(content, sourcePath);
  result.detected = { ...detected, ...result.detected };
  return result;
}
