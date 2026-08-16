import type { Cut, CutDocument, CutPlan, Pane, ParseResult } from "../model/types.js";
import { stageLabel } from "../model/types.js";

/**
 * Match bare "X123.456 Y789.012 x10.5 y20.5" coordinate pairs (no = signs).
 * Hegla polygon lines carry absolute start (uppercase X/Y) and end (lowercase
 * x/y) points of one segment; blocks may be prefixed with L<radius> (arc).
 */
function extractSegment(line: string): { start: { x: number; y: number }; end: { x: number; y: number }; arcRadius?: number } | null {
  const m = line.match(/^(?:L([\d.]+)\s+)?X([\d.]+)\s+Y([\d.]+)\s+x([\d.]+)\s+y([\d.]+)/i);
  if (!m) return null;
  return {
    start: { x: parseFloat(m[2]), y: parseFloat(m[3]) },
    end: { x: parseFloat(m[4]), y: parseFloat(m[5]) },
    arcRadius: m[1] ? parseFloat(m[1]) : undefined,
  };
}

/** Match "x=123 y=456" coordinate pairs with = signs (alternate Hegla variant). */
function extractEqCoords(line: string): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  let lx: number | undefined;
  let ly: number | undefined;
  for (const m of line.matchAll(/([xy])=([\d.]+)/gi)) {
    const v = parseFloat(m[2]);
    if (m[1].toLowerCase() === "x") lx = v;
    else ly = v;
    if (lx !== undefined && ly !== undefined) {
      pts.push({ x: lx, y: ly });
      lx = undefined;
      ly = undefined;
    }
  }
  return pts;
}

export function parseHeglaEdi(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);
  const cuts: Cut[] = [];
  const panes: Pane[] = [];
  let seq = 0;

  let sheetWidth = 6000;
  let sheetHeight = 3210;
  let currentF = 0;

  // Detect format variant
  const isEdicut = /^EDICUT/i.test(lines[0] ?? "");
  const isKlar = /^\[4CLR\b/i.test(lines[0] ?? "");

  // Sheet dims from @@ pattern or KASUNTX pattern
  const dimMatch = content.match(/@@(\d{4,5})\.0?(\d{4,5})/);
  if (dimMatch) {
    sheetWidth = parseFloat(dimMatch[1]);
    sheetHeight = parseFloat(dimMatch[2]);
  }
  const kasunDim = lines[0]?.match(/KASUNTX(\d+)Y(\d+)/);
  if (kasunDim) {
    sheetWidth = parseInt(kasunDim[1], 10);
    sheetHeight = parseInt(kasunDim[2], 10);
  }

  // Collect travel moves for sequencing
  const travelPts: Array<{ x: number; y: number; f?: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    // F-block marker
    const fLine = line.match(/^F(\d+)\s*$/i);
    if (fLine) { currentF = parseInt(fLine[1], 10); continue; }

    // Parenthesized polygon block: starts with "(", continues on following
    // lines (no paren prefix) until a blank line or non-segment line.
    if (line.startsWith("(") || line.startsWith("((")) {
      const segLine = line.replace(/^\(+/, "");
      const seg = extractSegment(segLine);
      if (seg) {
        const polyId = `F${currentF || panes.length + 1}`;
        const poly: Array<{ x: number; y: number }> = [seg.start];
        const flush = () => {
          if (poly.length >= 3) {
            const xs = poly.map((p) => p.x);
            const ys = poly.map((p) => p.y);
            panes.push({
              id: polyId,
              bounds: {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
              },
              polygon: [...poly],
            });
          }
        };
        const pushSeg = (s: { start: { x: number; y: number }; end: { x: number; y: number } }) => {
          if (Math.abs(s.start.x - s.end.x) > 1e-6 || Math.abs(s.start.y - s.end.y) > 1e-6) {
            cuts.push({
              type: "line",
              points: [s.start, s.end],
              sequenceIndex: seq++,
              paneRefs: [polyId],
            });
          }
          const last = poly[poly.length - 1];
          if (!last || Math.abs(last.x - s.end.x) > 1e-6 || Math.abs(last.y - s.end.y) > 1e-6) {
            poly.push(s.end);
          }
        };
        pushSeg(seg);
        // consume continuation lines
        let j = i + 1;
        for (; j < lines.length; j++) {
          const cont = lines[j]!.trim();
          if (!cont || cont.startsWith("(") || cont.startsWith("[") || cont.startsWith("F") && /^\d+\s*$/.test(cont.slice(1))) break;
          const s2 = extractSegment(cont) ?? extractSegment(cont.replace(/^[A-Z](\d+)?\s+/, ""));
          if (!s2) break;
          pushSeg(s2);
        }
        i = j - 1;
        flush();
      } else {
        // "(" line without immediately parseable segment — try continuation
        const pts2 = extractEqCoords(line);
        if (pts2.length >= 3) {
          const xs = pts2.map((p) => p.x);
          const ys = pts2.map((p) => p.y);
          panes.push({
            id: `F${currentF || panes.length + 1}`,
            bounds: {
              x: Math.min(...xs),
              y: Math.min(...ys),
              width: Math.max(...xs) - Math.min(...xs),
              height: Math.max(...ys) - Math.min(...ys),
            },
            polygon: pts2,
          });
          for (let k = 0; k < pts2.length - 1; k++) {
            cuts.push({ type: "line", points: [pts2[k], pts2[k + 1]], sequenceIndex: seq++ });
          }
        }
      }
      continue;
    }

    // KASUN-style: X... Y... Z...*N B... within [4CLR...] block
    const kasunXY = line.match(/^X([\d.]+)\s+Y([\d.]+)/i);
    if (kasunXY && isKlar) {
      const x = parseFloat(kasunXY[1]);
      const y = parseFloat(kasunXY[2]);
      travelPts.push({ x, y });
      // Check for Z cuts
      const zParts = line.match(/Z([\d.]+)(?:\*(\d+))?/gi);
      if (zParts) {
        for (const zp of zParts) {
          const zm = zp.match(/Z([\d.]+)(?:\*(\d+))?/i);
          if (zm) {
            cuts.push({
              type: "line",
              points: [{ x: parseFloat(zm[1]), y: 0 }, { x: parseFloat(zm[1]), y: sheetHeight }],
              sequenceIndex: seq++,
              stage: 3,
              stageLabel: stageLabel("HEGLA", 3),
            });
          }
        }
      }
      continue;
    }

    // Standard travel move "X... Y... [F...]"
    const xy = line.match(/^X([\d.]+)\s+Y([\d.]+)/i);
    if ((xy && !line.includes("F")) || line.match(/^X([\d.]+)\s+Y([\d.]+)\s+F\d+/i)) {
      const fMatch = line.match(/F(\d+)/);
      travelPts.push({
        x: parseFloat(xy ? xy[1] : ""),
        y: parseFloat(xy ? xy[2] : ""),
        f: fMatch ? parseInt(fMatch[1], 10) : undefined,
      });
    }
  }

  // Build cuts from travel point chain
  for (let i = 0; i < travelPts.length - 1; i++) {
    const a = travelPts[i]!;
    const b = travelPts[i + 1]!;
    if (Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001) {
      cuts.push({
        type: "line",
        points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
        sequenceIndex: seq++,
      });
    }
  }

  if (cuts.length === 0 && panes.length === 0) {
    return {
      status: "partial",
      warnings: ["No segments decoded from Hegla EDI"],
      document: {
        metadata: { vendor: "Hegla", sourcePath },
        sheets: [{ id: "sheet-1", sheet: { width: sheetWidth, height: sheetHeight }, panes: [], cuts: [], coordinateSemantics: { origin: "top-left", xAxis: "right", units: "mm" } }],
      },
      detected: { vendor: "Hegla", formatId: "hegla-edi", confidence: "high", matchedSignal: isEdicut ? "EDICUT" : "extension.edi" },
    };
  }

  return {
    status: warnings.length ? "partial" : "ok",
    document: {
      metadata: { vendor: "Hegla", sourcePath },
      sheets: [{
        id: "sheet-1",
        sheet: { width: sheetWidth, height: sheetHeight },
        panes,
        cuts,
        coordinateSemantics: { origin: "top-left", xAxis: "right", units: "mm" },
      }],
    },
    warnings,
    detected: { vendor: "Hegla", formatId: "hegla-edi", confidence: "high", matchedSignal: isEdicut ? "EDICUT" : isKlar ? "[4CLR...]" : "extension.edi" },
  };
}
