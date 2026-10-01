import type { Cut, CutDocument, CutPlan, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";

/**
 * Chaoyang SCR NC (.src) — "CHAOYANG SCR NC File Format 2016-1-12 - EN".
 *
 *   LIMITS 0,0 3660,2440          original sheet size, lower-left / upper-right
 *   ZOOM A                        view command
 *   COUNTS 30                     number of pieces after optimisation
 *   #THICKNESS 5                  glass thickness, mm
 *   #PER 0.9797                   utilisation ratio
 *   #RECT 10.00,10.00 1010.00,1010.00 *1 $2.2    enclosing rectangle,
 *                                                   optional position marker
 *                                                   (`*`, `+n`, `-n`, `n`)
 *                                                   and optional rack `$`
 *   #REM 1000.0*1000.0 CHAOYANG A23456B          nominal size, customer, order
 *   #GRINDING 1.0                 grind amount
 *   #REM1 … #REM20 <text>         per-piece notes
 *   LINE 500.000,2.000 500.000,2439.000           straight cut
 *   ARC3C cx,cy sx,sy ex,ey                       counter-clockwise circle/arc
 *   ARC2C cx,cy sx,sy ex,ey                       clockwise circle/arc
 *
 * Coordinates are millimetres with the origin at the bottom-left corner named
 * by LIMITS, so the file is already in the same frame as the cut paths.
 */

const VENDOR = "Chaoyang";

function pair(raw: string): Point | null {
  const m = raw.trim().match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/);
  if (!m) return null;
  return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
}

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function parseChaoyangSrc(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];

  const limits = content.match(/^\s*LIMITS\s+(\S+)\s+(\S+)\s*$/im);
  if (!limits) {
    return {
      status: "failed",
      warnings,
      error: "Chaoyang SCR NC file has no `LIMITS x,y x,y` record",
      detected: { vendor: VENDOR, formatId: "chaoyang-src", confidence: "high", matchedSignal: "LIMITS / #RECT / LINE" },
    };
  }
  const lowerLeft = pair(limits[1]!);
  const upperRight = pair(limits[2]!);
  if (!lowerLeft || !upperRight) {
    return {
      status: "failed",
      warnings,
      error: "Chaoyang SCR NC `LIMITS` record is malformed",
      detected: { vendor: VENDOR, formatId: "chaoyang-src", confidence: "high", matchedSignal: "LIMITS" },
    };
  }

  const sheetW = upperRight.x - lowerLeft.x;
  const sheetH = upperRight.y - lowerLeft.y;

  let thickness: number | undefined;
  let count: number | undefined;
  let utilisation: number | undefined;

  const cuts: Cut[] = [];
  const panes: Pane[] = [];
  let seq = 0;

  /* current #RECT context, so following #REM/#GRINDING/#REMn apply to it */
  let current: Pane | null = null;
  let pendingIndex = 0;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (/^LIMITS\b/i.test(line)) continue;
    if (/^ZOOM\b/i.test(line)) continue;

    if (/^COUNTS\b/i.test(line)) {
      count = num(line.split(/\s+/)[1]);
      continue;
    }
    if (/^#THICKNESS\b/i.test(line)) {
      thickness = num(line.split(/\s+/)[1]);
      continue;
    }
    if (/^#PER\b/i.test(line)) {
      utilisation = num(line.split(/\s+/)[1]);
      continue;
    }

    if (/^#RECT\b/i.test(line)) {
      const body = line.slice(5).trim();
      const coords = body.match(/^\S+\s+\S+/);
      if (!coords) continue;
      const corners = coords[0]!.split(/\s+/);
      const p1 = pair(corners[0]!);
      const p2 = pair(corners[1] ?? "");
      if (!p1 || !p2) continue;
      pendingIndex += 1;
      const id = `p${pendingIndex}`;
      current = {
        id,
        bounds: { x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y },
      };
      panes.push(current);
      continue;
    }

    if (/^#GRINDING\b/i.test(line)) {
      const amount = num(line.split(/\s+/)[1]);
      if (current && amount !== undefined) current.label = current.label ? `${current.label} · grind ${amount}` : `grind ${amount}`;
      continue;
    }

    if (/^#REM\d+\b/i.test(line)) {
      const note = line.replace(/^#REM\d+\s*/, "").trim();
      if (current && note) current.label = current.label ? `${current.label} · ${note}` : note;
      continue;
    }

    if (/^#REM\b/i.test(line)) {
      const rest = line.slice(4).trim();
      const sizeMatch = rest.match(/^(-?[\d.]+)\s*\*\s*(-?[\d.]+)/);
      if (sizeMatch && current) {
        const w = parseFloat(sizeMatch[1]!);
        const h = parseFloat(sizeMatch[2]!);
        current.glassInfo = `nominal ${w}×${h}`;
      }
      const tail = rest.replace(/^(-?[\d.]+)\s*\*\s*(-?[\d.]+)/, "").trim();
      if (current && tail) current.label = current.label ? `${current.label} · ${tail}` : tail;
      current = null;
      continue;
    }

    if (/^LINE\b/i.test(line)) {
      const pts = line
        .slice(4)
        .trim()
        .split(/\s+/)
        .map((s) => pair(s))
        .filter((p): p is Point => p !== null);
      if (pts.length < 2) continue;
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const vertical = Math.abs(a.x - b.x) < 0.01;
      const stage = vertical ? 1 : 2;
      cuts.push({
        type: "line",
        points: [a, b],
        sequenceIndex: seq++,
        stage,
        stageLabel: stageLabel(VENDOR, stage) ?? (vertical ? "X" : "Y"),
      });
      continue;
    }

    const arc = line.match(/^ARC([23])C\s+(\S+)\s+(\S+)\s+(\S+)/i);
    if (arc) {
      const ccw = arc[1] === "3";
      const center = pair(arc[2]!);
      const start = pair(arc[3]!);
      const end = pair(arc[4]!);
      if (!center || !start || !end) continue;
      const radius = Math.hypot(start.x - center.x, start.y - center.y);
      cuts.push({
        type: "arc",
        points: [start, end],
        center,
        radius,
        ccw,
        sequenceIndex: seq++,
        stage: 3,
        stageLabel: stageLabel(VENDOR, 3) ?? "Shape",
      });
      continue;
    }
  }

  if (cuts.length === 0 && panes.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Chaoyang SCR NC file contains no #RECT, LINE or ARC records",
      detected: { vendor: VENDOR, formatId: "chaoyang-src", confidence: "high", matchedSignal: "LIMITS / #RECT / LINE" },
    };
  }

  const document: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine: "Chaoyang SCR NC",
      glassThickness: thickness,
      operator: utilisation !== undefined ? `file utilisation ${(utilisation * 100).toFixed(1)}%` : undefined,
      sourcePath,
    },
    sheets: [
      {
        id: "sheet-1",
        label: count !== undefined ? `${count} piece${count === 1 ? "" : "s"}` : undefined,
        sheet: { width: sheetW, height: sheetH },
        panes,
        cuts,
        coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
      },
    ],
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document,
    warnings,
    detected: { vendor: VENDOR, formatId: "chaoyang-src", confidence: "high", matchedSignal: "LIMITS / #RECT / LINE" },
  };
}