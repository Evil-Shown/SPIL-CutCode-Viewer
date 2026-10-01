import type { DetectResult } from "../model/types.js";

const BOTTERO_LINE = /^\[P\d+H\d+R/i;
const BOTTERO_TOKEN = /P\d+H\d+R/;

/* ---- shared structural probes for the newly supported vendors ---- */

/** Turomas V30 .R01: `P001 / N01 / H… / L…` plan blocks. */
const TUROMAS_V30 = /^\s*P\d+\s*$/m;

/** Perfect Cut RO / Lampo-CSM .PGM: `P0xx / H… / L… / T…` plus a comment. Same
 *  structural gate as TUROMAS_V30 — the dialects are told apart by the header
 *  comment (`MATERIAL:` vs `by Perfect Cut`) further down. */
const PERFECTCUT_PGM = TUROMAS_V30;

/** Disai PRJX pattern: `[PATTERN]` + `[SCHEME]` or `[BREAKLN]`. */
const DISAI_PRJX = /^\s*\[PATTERN\]\s*$/im;

/** Chaoyang SCR NC: `LIMITS x,y x,y`. */
const CHAOYANG_SRC = /^\s*LIMITS\s+-?[\d.]+\s*,\s*-?[\d.]+/im;

/** Vetromac ISO: VN211/VN212 sheet registers. */
const VETROMAC_ISO = /VN21[12]\s*=\s*-?[\d.]+/i;

/** Eagle / ISAC ISO: R4081/R4082 sheet registers or the Perfect Cut project tag. */
const EAGLE_ISO = /\bR408[12]\s*=\s*-?[\d.]+/i;
const EAGLE_PROJECT = /strNomeProgetto\s*=/i;

/** Bystronic PROG.XYZ: wrapped in `(` … `)` with an M<x>/<y> header. */
const BYSTRONIC_XYZ = /\(\s*P?\d*\s*N?\d*\s*M-?[\d.]+\s*\//;

/** Intermac OTD / Perfect Cut `[Pattern]` sections — case-sensitive on purpose. */
const OTDCutVersionRe = /OTDCutVersion\s*=/i;

/** Perfect Cut RO / Lampo-CSM `.LST` index files list their PGM siblings. */
const PERFECTCUT_LST = /^\s*PGM\s+\S+\s*$/m;

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

  /* ---- Turomas V40 JSON ---- */
  if (trimmed.startsWith("{") && /"plans"\s*:\s*\[/.test(head) && /"pieces"\s*:\s*\[/.test(head)) {
    return {
      vendor: "Turomas",
      formatId: "turomas-v40",
      confidence: "high",
      matchedSignal: "Turomas V40 plans/pieces JSON",
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

  if (OTDCutVersionRe.test(head) || (/^\s*\[Pattern\]\s*$/m.test(head) && !/\[PARAMETERS\]/i.test(head))) {
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

  // NUM ISO (.CUT / .CNI): Bavelloni REV/SYNCRO/Flexium, Glaston UC, Intermac Genius
  if (/^%\d*/.test(trimmed) && (/E30000\s*=/.test(head) || /G77H9\d{3}/i.test(head))) {
    const nc = content.match(/\(\s*(NUM\s+[A-Z0-9][A-Z0-9 ._+-]*)\s*\)/i)?.[1]?.trim();
    const upper = (nc ?? "").toUpperCase();
    if (/SYNCRO|REV\s*372|REV372|FLEXIUM|LOWE/.test(upper) || /NUM SYNCRO|NUM REV|NUM Flexium/i.test(head)) {
      const vendor = /LOWE|SYNCRO_LOWE/.test(upper) ? "Glaston" : "Bavelloni";
      return {
        vendor,
        formatId: "bavelloni-cut",
        confidence: "high",
        matchedSignal: nc ?? "% / E30000 / G77",
      };
    }
    return {
      vendor: "Intermac",
      formatId: "intermac-cut",
      confidence: "high",
      matchedSignal: "% / E30000 / G77",
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

  /* ---- Vetromac ISO ---- */
  if (VETROMAC_ISO.test(head)) {
    return {
      vendor: "Vetromac",
      formatId: "vetromac-iso",
      confidence: "high",
      matchedSignal: "VN211 / VN212",
    };
  }

  /* ---- Eagle / Linghua ISAC ISO ---- */
  if (EAGLE_ISO.test(head) || EAGLE_PROJECT.test(head)) {
    return {
      vendor: "Eagle",
      formatId: "eagle-isac-iso",
      confidence: "high",
      matchedSignal: EAGLE_ISO.test(head) ? "R4081 / R4082" : "strNomeProgetto",
    };
  }

  /* ---- Disai PRJX ---- */
  if (DISAI_PRJX.test(head) || (/^\s*\[SUMINFO\]\s*$/im.test(head) && /^\s*\[DIMEN\d+\]\s*$/im.test(head))) {
    return {
      vendor: "Disai",
      formatId: "disai-prjx",
      confidence: "high",
      matchedSignal: "[PATTERN] / [SUMINFO]",
    };
  }

  /* ---- Chaoyang SCR NC ---- */
  if (CHAOYANG_SRC.test(head)) {
    return {
      vendor: "Chaoyang",
      formatId: "chaoyang-src",
      confidence: "high",
      matchedSignal: "LIMITS / #RECT / LINE",
    };
  }

  /* ---- Bystronic PROG.XYZ ---- */
  if (BYSTRONIC_XYZ.test(trimmed.slice(0, 4096)) || (ext === "xyz" && /^\s*\(/.test(trimmed))) {
    return {
      vendor: "Bystronic",
      formatId: "bystronic-xyz",
      confidence: "high",
      matchedSignal: "( … ) with M<X>/<Y>",
    };
  }

  /* ---- Perfect Cut RO / Lampo-CSM .PGM vs Turomas V30 .R01 ---- */
  if (PERFECTCUT_PGM.test(head) && /^\s*H[\d.]+/m.test(head) && /^\s*L[\d.]+/m.test(head)) {
    // Turomas writes `MATERIAL:` and a `T <n>`-less header; Perfect Cut's RO
    // dialect writes `T <n> - thickness` and a `/Ott. … by Perfect Cut` comment.
    const turomas = /^\s*MATERIAL\s*:/im.test(head) && !/by Perfect Cut/i.test(head);
    if (!turomas) {
      return {
        vendor: "Perfect Cut",
        formatId: "perfectcut-pgm",
        confidence: "high",
        matchedSignal: "P0xx/H/L/T by Perfect Cut",
      };
    }
    return {
      vendor: "Turomas",
      formatId: "turomas-r01",
      confidence: "high",
      matchedSignal: "P001/N01/H/L/MATERIAL",
    };
  }

  /* ---- Turomas V30 .R01 ---- */
  if (TUROMAS_V30.test(head) && /^\s*N\d+\s*$/m.test(head)) {
    return {
      vendor: "Turomas",
      formatId: "turomas-r01",
      confidence: "medium",
      matchedSignal: "P001/N01",
    };
  }

  if (ext === "cut" || ext === "cni") {
    const nc = content.match(/\(\s*(NUM\s+[A-Z0-9][A-Z0-9 ._+-]*)\s*\)/i)?.[1]?.trim() ?? "";
    if (/SYNCRO|REV|FLEXIUM|LOWE/i.test(nc)) {
      return { vendor: /LOWE/i.test(nc) ? "Glaston" : "Bavelloni", formatId: "bavelloni-cut", confidence: "medium", matchedSignal: `extension.${ext}` };
    }
    return { vendor: "Intermac", formatId: "intermac-cut", confidence: "medium", matchedSignal: `extension.${ext}` };
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
  if (ext === "iso") {
    // Both Vetromac and Eagle/Linghua write plain-text ISO macros; without a
    // content signal we can only guess, so try Vetromac first (VN registers are
    // more specific) and let the parser retry chain fall through to Eagle.
    return { vendor: "Vetromac", formatId: "vetromac-iso", confidence: "low", matchedSignal: "extension.iso" };
  }
  if (ext === "xyz") {
    return { vendor: "Bystronic", formatId: "bystronic-xyz", confidence: "medium", matchedSignal: "extension.xyz" };
  }
  if (ext === "lst" || PERFECTCUT_LST.test(head)) {
    return { vendor: "Perfect Cut", formatId: "perfectcut-pgm-index", confidence: "high", matchedSignal: "PGM <name>" };
  }
  if (ext === "pgm") {
    return { vendor: "Perfect Cut", formatId: "perfectcut-pgm", confidence: "medium", matchedSignal: "extension.pgm" };
  }
  if (ext === "dst" || ext === "prjx" || ext === "sum") {
    return { vendor: "Disai", formatId: "disai-prjx", confidence: "medium", matchedSignal: `extension.${ext}` };
  }
  if (ext === "src") {
    return { vendor: "Chaoyang", formatId: "chaoyang-src", confidence: "medium", matchedSignal: "extension.src" };
  }
  if (ext === "json") {
    return { vendor: "Turomas", formatId: "turomas-v40", confidence: "low", matchedSignal: "extension.json" };
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
