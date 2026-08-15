import { detectFormat } from "../detect/formatDetector.js";
import type { ParseResult } from "../model/types.js";
import { parseBotteroOpt } from "./bottero-opt.js";
import { parseHeglaEdi } from "./hegla-edi.js";
import { parseIntermacOtd } from "./intermac-otd.js";
import { parseLisecDat } from "./lisec-dat.js";
import { parseMacotechImp } from "./macotech-imp.js";
import { parseOptimaOtv } from "./optima-otv.js";
import { parseOptimaR01 } from "./optima-r01.js";

const PARSERS: Record<string, (content: string, sourcePath: string) => ParseResult> = {
  "intermac-otd": parseIntermacOtd,
  "lisec-dat": parseLisecDat,
  "bottero-opt": parseBotteroOpt,
  "optima-r01": parseOptimaR01,
  "optima-otv": parseOptimaOtv,
  "macotech-imp": parseMacotechImp,
  "hegla-edi": parseHeglaEdi,
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
