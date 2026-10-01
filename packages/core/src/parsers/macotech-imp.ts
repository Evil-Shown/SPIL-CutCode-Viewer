import type { CutDocument, CutPlan, ParseResult } from "../model/types.js";
import { parseIntermacFamily } from "./intermac-family.js";
import type { FamilyConfig } from "./intermac-family.js";

const CONFIG: FamilyConfig = {
  patternKey: "opt_pattern",
  cuttingsKey: "opt_cuttings",
  versionKey: "OPTCutVersion",
  vendor: "Macotech",
  formatId: "macotech-imp",
};

/** `N3=FL5;B=3210;H=2000;RX=20;RY=20;…` inside `[SHEETS]`. */
const SHEET_RE = /^N\d+=(.*)$/;

function parseSemiRecord(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of body.split(";")) {
    const idx = field.indexOf("=");
    if (idx === -1) {
      if (field.trim()) map.set(field.trim().toUpperCase(), "");
      continue;
    }
    map.set(field.slice(0, idx).trim().toUpperCase(), field.slice(idx + 1).trim());
  }
  return map;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `.IMP` files come in two flavours (IMPORT_RO_ENG):
 *  - a post-processor program with one or more `[Pattern]` layouts, and
 *  - a project definition with only `[PARAMETERS]`, `[FAM_x]`, `[SHEETS]` and
 *    `[PIECES]` — the stock and the piece catalogue, with no layout at all.
 * The second flavour still has to produce something useful, so its sheet stock
 * and piece sizes are surfaced as a layout-free sheet list.
 */
export function parseMacotechImp(content: string, sourcePath: string): ParseResult {
  const result = parseIntermacFamily(content, sourcePath, CONFIG);

  if (result.document) {
    for (const sheet of result.document.sheets) {
      if (!sheet.sheet.width || !sheet.sheet.height) {
        const bh = content.match(/B=([\d.]+);.*?H=([\d.]+)/);
        if (bh) {
          sheet.sheet.width = num(bh[1]) ?? 0;
          sheet.sheet.height = num(bh[2]) ?? 0;
        }
      }
    }
    result.document.sheets = result.document.sheets.filter((s) => s.sheet.width > 0 && s.sheet.height > 0);

    if (result.document.sheets.length > 0) {
      if (result.document.sheets.every((s) => s.cuts.length === 0)) {
        result.status = "partial";
        result.warnings.push("No cut segments found in IMP file");
      }
      return result;
    }
  }

  // No `[Pattern]`: read the stock and the piece catalogue.
  const sections = content.split(/\r?\n/);
  let section = "";
  const sheets: CutPlan[] = [];
  const pieces: Array<{ id: string; w: number; h: number; qty?: number; customer?: string; order?: string; shape?: string }> = [];
  const families = new Map<string, { thickness?: number; description?: string }>();

  for (const raw of sections) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1]!.toUpperCase();
      continue;
    }

    if (section.startsWith("FAM_") || section === "FAMILY") {
      const kv = line.match(/^([A-Za-z_][\w ]*)\s*=\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1]!.trim().toUpperCase();
      const fam = families.get(section) ?? {};
      if (key === "SPESSORE") fam.thickness = num(kv[2]!);
      if (key === "DESCRIZIONE") fam.description = kv[2]!.trim();
      families.set(section, fam);
      continue;
    }

    if (section === "SHEETS") {
      const m = line.match(SHEET_RE);
      if (!m) continue;
      const rec = parseSemiRecord(m[1]!);
      const w = num(rec.get("B"));
      const h = num(rec.get("H"));
      if (!w || !h) continue;
      const famName = rec.get("FAM") ?? rec.get("FAMILY");
      const fam = famName ? families.get(`FAM_${famName.toUpperCase()}`) ?? families.get("FAMILY") : undefined;
      sheets.push({
        id: `sheet-${sheets.length + 1}`,
        label: rec.get("DESCR") || rec.get("DESCRIZIONE") || famName || `Stock ${sheets.length + 1}`,
        sheet: {
          width: w,
          height: h,
          trims: {
            top: num(rec.get("RY")) ?? 0,
            right: 0,
            bottom: num(rec.get("RY")) ?? 0,
            left: num(rec.get("RX")) ?? 0,
          },
        },
        panes: [],
        cuts: [],
        coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
      });
      continue;
    }

    if (section === "PIECES") {
      const m = line.match(/^N(\d+)=([\s\S]*)$/);
      if (!m) continue;
      const rec = parseSemiRecord(m[2]!);
      const w = num(rec.get("B")) ?? num(rec.get("BASE"));
      const h = num(rec.get("H")) ?? num(rec.get("HEIGHT"));
      if (!w || !h) continue;
      pieces.push({
        id: m[1]!,
        w,
        h,
        qty: num(rec.get("N")) ?? num(rec.get("QUANTITY")),
        customer: rec.get("CL") ?? rec.get("CUSTOMER") ?? undefined,
        order: rec.get("ORD") ?? rec.get("ORDER") ?? undefined,
        shape: rec.get("SAG") || undefined,
      });
    }
  }

  if (sheets.length === 0) {
    return {
      status: "failed",
      warnings: result.warnings,
      error: "Could not determine sheet dimensions from IMP file",
      detected: result.detected,
    };
  }

  const warnings = [...result.warnings];
  warnings.push(
    "IMP project definition — sheet stock and piece catalogue only, no [Pattern] cutting layout was written by Perfect Cut"
  );

  const thickness = [...families.values()].find((f) => f.thickness !== undefined)?.thickness;

  const document: CutDocument = {
    metadata: {
      vendor: CONFIG.vendor,
      machine: "Macotech / Perfect Cut",
      glassThickness: thickness,
      sourcePath,
    },
    sheets,
  };

  return {
    status: "partial",
    warnings,
    document,
    detected: {
      ...result.detected,
      vendor: CONFIG.vendor,
      formatId: CONFIG.formatId,
      confidence: "high",
      matchedSignal: "[PARAMETERS]/[SHEETS]/[PIECES]",
    },
  };
}