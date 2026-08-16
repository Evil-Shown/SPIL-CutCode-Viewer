import type { DetectResult } from "../model/types.js";

const BOTTERO_LINE = /^\[P\d+H\d+R/i;
const BOTTERO_TOKEN = /P\d+H\d+R/;

export function detectFormat(content: string, filePath = ""): DetectResult {
  const head = content.slice(0, 8192);
  const trimmed = content.trim();
  const ext = filePath.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase() ?? "";

  if (trimmed.startsWith("{") && /"subProjects"/.test(head)) {
    return {
      vendor: "Optima",
      formatId: "optima-otv",
      confidence: "high",
      matchedSignal: "OptiTV JSON subProjects",
    };
  }

  if (/^EDICUT/i.test(trimmed) || /EDICUT\d+/i.test(head)) {
    return {
      vendor: "Hegla",
      formatId: "hegla-edi",
      confidence: "high",
      matchedSignal: "EDICUT header",
    };
  }

  if (/OPTCutVersion\s*=/i.test(head) || /\[OPT_Pattern\]/i.test(head)) {
    const ver = head.match(/OPTCutVersion\s*=\s*([\d.]+)/i)?.[1];
    return {
      vendor: "Optima",
      formatId: "optima-r01",
      confidence: "high",
      matchedSignal: "OPTCutVersion",
      version: ver,
    };
  }

  if (/OTDCutVersion\s*=/i.test(head) || (/\[Pattern\]/i.test(head) && !/\[PARAMETERS\]/i.test(head))) {
    const ver = head.match(/OTDCutVersion\s*=\s*([\d.]+)/i)?.[1];
    return {
      vendor: "Intermac",
      formatId: "intermac-otd",
      confidence: "high",
      matchedSignal: "OTDCutVersion",
      version: ver,
    };
  }

  if (/\[PARAMETERS\]/i.test(head) && (/\[SHEETS\]/i.test(head) || /MODO_MISURA/i.test(head))) {
    return {
      vendor: "Macotech",
      formatId: "macotech-imp",
      confidence: "high",
      matchedSignal: "[PARAMETERS]/[SHEETS]",
    };
  }

  if (/\[LPL_BREITE\]/i.test(head) || /\[Y_SCHNITT\]/i.test(head) || /\[BOCK_CODE\]/i.test(head)) {
    return {
      vendor: "Lisec",
      formatId: "lisec-dat",
      confidence: "high",
      matchedSignal: "[LPL_BREITE]/[Y_SCHNITT]",
    };
  }

  // Perfect Cut job report XML (statistics, no geometry)
  if (/<CUT>/i.test(content) && /<FAMILY\b/i.test(content)) {
    return {
      vendor: "Perfect Cut",
      formatId: "perfectcut-xml",
      confidence: "high",
      matchedSignal: "<CUT>/<FAMILY>",
    };
  }

  // Macotech/Perfect Cut machine family configuration (dati/*.IMP)
  if (/^\[FAMILY\d+\]\s*$/im.test(content) && !/\[OPT_Pattern\]/i.test(content) && !/\[Pattern\]/i.test(content)) {
    return {
      vendor: "Macotech",
      formatId: "macotech-family",
      confidence: "high",
      matchedSignal: "[FAMILYn] without [Pattern]",
    };
  }

  // DXF: group-code file with a HEADER/ENTITIES section
  if (/^\s*0\r?\nSECTION/i.test(content) || (/\$ACADVER/.test(head) && /ENTITIES/.test(content))) {
    return {
      vendor: "DXF",
      formatId: "dxf",
      confidence: "high",
      matchedSignal: "DXF SECTION/ACADVER",
    };
  }

  if (BOTTERO_LINE.test(trimmed) || BOTTERO_TOKEN.test(head)) {
    return {
      vendor: "Bottero",
      formatId: "bottero-opt",
      confidence: "high",
      matchedSignal: "P#H#R token line",
    };
  }

  if (ext === "otd") {
    return { vendor: "Intermac", formatId: "intermac-otd", confidence: "medium", matchedSignal: "extension.otd" };
  }
  if (ext === "otv") {
    return { vendor: "Optima", formatId: "optima-otv", confidence: "medium", matchedSignal: "extension.otv" };
  }
  if (ext === "dat") {
    return { vendor: "Lisec", formatId: "lisec-dat", confidence: "medium", matchedSignal: "extension.dat" };
  }
  if (ext === "opt") {
    return { vendor: "Bottero", formatId: "bottero-opt", confidence: "low", matchedSignal: "extension.opt" };
  }
  if (ext === "r01") {
    return { vendor: "Optima", formatId: "optima-r01", confidence: "medium", matchedSignal: "extension.r01" };
  }
  if (ext === "imp") {
    return { vendor: "Macotech", formatId: "macotech-imp", confidence: "medium", matchedSignal: "extension.imp" };
  }
  if (ext === "edi") {
    return { vendor: "Hegla", formatId: "hegla-edi", confidence: "medium", matchedSignal: "extension.edi" };
  }
  if (ext === "dxf") {
    return { vendor: "DXF", formatId: "dxf", confidence: "medium", matchedSignal: "extension.dxf" };
  }
  if (ext === "ot5") {
    return { vendor: "Perfect Cut", formatId: "perfectcut-ot5", confidence: "high", matchedSignal: "extension.ot5 (encrypted)" };
  }
  if (ext === "xml") {
    return { vendor: "Perfect Cut", formatId: "perfectcut-xml", confidence: "low", matchedSignal: "extension.xml" };
  }

  return {
    vendor: "unknown",
    formatId: "unknown",
    confidence: "unknown",
    matchedSignal: undefined,
  };
}
