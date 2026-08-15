import type { CutPlan, ParseResult } from "../model/types.js";

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s.trim());
  return Number.isFinite(n) ? n : undefined;
}

type SectionAliases = {
  pattern: string;
  cuttings: string;
  versionKey: string;
};

const DEFAULT_ALIASES: SectionAliases = {
  pattern: "pattern",
  cuttings: "cuttings",
  versionKey: "OTDCutVersion",
};

/** Shared parser for Intermac OTD, Optima R01, Macotech IMP (Intermac-family layout). */
export function parseIntermacFamily(
  content: string,
  sourcePath: string,
  vendor: string,
  formatId: string,
  aliases: SectionAliases = DEFAULT_ALIASES
): ParseResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  let formatVersion: string | undefined;
  let machine: string | undefined;
  let glassThickness: number | undefined;
  let glassId: string | undefined;
  let sheetWidth = 0;
  let sheetHeight = 0;
  let trimLeft = 0;
  let trimBottom = 0;

  const panes: CutPlan["panes"] = [];
  const cuts: CutPlan["cuts"] = [];
  let cutSeq = 0;
  let section = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const sec = line.match(/^\[([^\]]+)\]$/i);
    if (sec) {
      section = sec[1].toLowerCase().replace(/^opt_/, "");
      continue;
    }

    if (section === "header" || section === "opt_header") {
      const ver = line.match(new RegExp(`^${aliases.versionKey}\\s*=\\s*(.+)$`, "i")) ||
        line.match(/^OTDCutVersion\s*=\s*(.+)$/i) ||
        line.match(/^OPTCutVersion\s*=\s*(.+)$/i);
      if (ver) formatVersion = ver[1].trim();
    }

    if (section === aliases.pattern || section === "pattern") {
      const kv = line.match(/^(\w+)\s*=\s*(.*)$/);
      if (kv) {
        const key = kv[1];
        const val = kv[2].trim();
        if (key === "MachineName") machine = val;
        if (key === "GlassThickness") glassThickness = num(val);
        if (key === "GlassID") glassId = val;
        if (key === "Width") sheetWidth = num(val) ?? sheetWidth;
        if (key === "Height") sheetHeight = num(val) ?? sheetHeight;
        if (key === "TrimLeft") trimLeft = num(val) ?? 0;
        if (key === "TrimBottom") trimBottom = num(val) ?? 0;
      }
      const indentY = line.match(/^Y=([\d.]+)/);
      const indentZ = line.match(/^\s+Z=([\d.]+)/);
      const indentW = line.match(/^\s+W=([\d.]+)/);
      if (indentY) {
        /* hierarchy markers — cuts come from [Cuttings] */
      }
    }

    if (section === "shape") {
      const pts: Array<{ x: number; y: number }> = [];
      const coordRe = /[xy]=([\d.]+)/gi;
      let m;
      while ((m = coordRe.exec(line)) !== null) {
        /* paired in x/y sequence below */
      }
      const parts = line.match(/[xy]=([\d.]+)/gi);
      if (parts) {
        const nums = parts.map((p) => parseFloat(p.split("=")[1]));
        for (let i = 0; i + 1 < nums.length; i += 2) {
          pts.push({ x: nums[i], y: nums[i + 1] });
        }
        for (let i = 0; i < pts.length - 1; i++) {
          cuts.push({
            type: "line",
            points: [pts[i], pts[i + 1]],
            sequenceIndex: cutSeq++,
          });
        }
      }
    }

    if (section === aliases.cuttings || section === "cuttings") {
      const x1 = num(line.match(/\bx=([\d.]+)/i)?.[1]);
      const y1 = num(line.match(/\by=([\d.]+)/i)?.[1]);
      const x2 = num(line.match(/\bX=([\d.]+)/)?.[1]);
      const y2 = num(line.match(/\bY=([\d.]+)/)?.[1]);
      if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
        cuts.push({
          type: "line",
          points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
          sequenceIndex: cutSeq++,
        });
      }
    }

    const pane = line.match(/^XO=([\d.]+)\s+YO=([\d.]+)\s+Width=([\d.]+)\s+Height=([\d.]+)(?:\s+Info=(\d+))?(?:\s+IndPiece=(\d+))?/i);
    if (pane) {
      const id = pane[5] ?? pane[6] ?? `pane-${panes.length}`;
      if (!panes.some((p) => p.id === String(id))) {
        panes.push({
          id: String(id),
          bounds: {
            x: parseFloat(pane[1]),
            y: parseFloat(pane[2]),
            width: parseFloat(pane[3]),
            height: parseFloat(pane[4]),
          },
          label: pane[5] ? `Info ${pane[5]}` : undefined,
        });
      }
    }
  }

  // IMP [Info] blocks use SheetWidth/SheetHeight — scan [Info] sections for pane sizes
  let inInfo = false;
  let infoId: string | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    const sec = line.match(/^\[([^\]]+)\]$/i);
    if (sec) {
      inInfo = sec[1].toLowerCase() === "info";
      infoId = undefined;
      continue;
    }
    if (!inInfo) continue;
    const idM = line.match(/^Id=(\d+)/i);
    if (idM) infoId = idM[1];
    const sw = num(line.match(/^SheetWidth=([\d.]+)/i)?.[1]);
    const sh = num(line.match(/^SheetHeight=([\d.]+)/i)?.[1]);
    if (sw && sh && infoId && !panes.some((p) => p.id === infoId)) {
      panes.push({
        id: infoId,
        bounds: { x: 0, y: 0, width: sw, height: sh },
      });
    }
  }

  // Pattern section guillotine hints when [Cuttings] is absent (Macotech IMP)
  if (cuts.length === 0 && sheetWidth && sheetHeight) {
    for (const raw of lines) {
      const indent = raw.length - raw.trimStart().length;
      const line = raw.trim();
      if (indent === 0) {
        const x = line.match(/^X=([\d.]+)/);
        if (x) {
          const xv = parseFloat(x[1]);
          cuts.push({
            type: "line",
            points: [{ x: xv, y: 0 }, { x: xv, y: sheetHeight }],
            sequenceIndex: cutSeq++,
          });
        }
      }
      if (indent === 2) {
        const y = line.match(/^Y=([\d.]+)/);
        if (y) {
          const yv = parseFloat(y[1]);
          cuts.push({
            type: "line",
            points: [{ x: 0, y: yv }, { x: sheetWidth, y: yv }],
            sequenceIndex: cutSeq++,
          });
        }
      }
    }
  }

  if (!sheetWidth || !sheetHeight) {
    return {
      status: "failed",
      warnings,
      error: "Could not determine sheet dimensions",
      detected: { vendor, formatId, confidence: "high", version: formatVersion },
    };
  }

  const plan: CutPlan = {
    metadata: {
      vendor,
      formatVersion,
      machine,
      glassType: glassId,
      glassThickness,
      sourcePath,
    },
    sheet: {
      width: sheetWidth,
      height: sheetHeight,
      trims: { top: 0, right: 0, bottom: trimBottom, left: trimLeft },
    },
    panes,
    cuts,
    coordinateSemantics: {
      origin: "top-left",
      xAxis: "right",
      yAxis: "down",
      units: "mm",
    },
  };

  return {
    status: warnings.length ? "partial" : "ok",
    plan,
    warnings,
    detected: {
      vendor,
      formatId,
      confidence: "high",
      version: formatVersion,
    },
  };
}
