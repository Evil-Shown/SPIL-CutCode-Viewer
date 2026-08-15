import type { CutPlan, ParseResult } from "../model/types.js";

function extractCoordPairs(line: string): Array<{ x: number; y: number }> {
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
  const cuts: CutPlan["cuts"] = [];
  const panes: CutPlan["panes"] = [];
  let seq = 0;
  let sheetWidth = 6000;
  let sheetHeight = 3210;
  let currentF = 0;
  let travelPts: Array<{ x: number; y: number }> = [];

  const dimMatch = content.match(/@@(\d{4})\.0?(\d{4})/);
  if (dimMatch) {
    sheetWidth = parseFloat(dimMatch[1]);
    sheetHeight = parseFloat(dimMatch[2]);
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const fLine = line.match(/^F(\d+)\s*$/i);
    if (fLine) {
      currentF = parseInt(fLine[1], 10);
      continue;
    }

    if (line.startsWith("(")) {
      const pts = extractCoordPairs(line);
      if (pts.length >= 2) {
        if (pts.length >= 3) {
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          panes.push({
            id: `F${currentF || panes.length + 1}`,
            bounds: {
              x: Math.min(...xs),
              y: Math.min(...ys),
              width: Math.max(...xs) - Math.min(...xs),
              height: Math.max(...ys) - Math.min(...ys),
            },
          });
        }
        for (let i = 0; i < pts.length - 1; i++) {
          cuts.push({
            type: "line",
            points: [pts[i], pts[i + 1]],
            sequenceIndex: seq++,
            paneRefs: currentF ? [`F${currentF}`] : undefined,
          });
        }
        if (pts.length >= 3) {
          cuts.push({
            type: "line",
            points: [pts[pts.length - 1], pts[0]],
            sequenceIndex: seq++,
            paneRefs: currentF ? [`F${currentF}`] : undefined,
          });
        }
      }
      continue;
    }

    const xy = line.match(/^X([\d.]+)\s+Y([\d.]+)/i);
    if (xy && !line.includes("F")) {
      travelPts.push({ x: parseFloat(xy[1]), y: parseFloat(xy[2]) });
      continue;
    }

    const cutLine = line.match(/^X([\d.]+)\s+Y([\d.]+)\s+F/i);
    if (cutLine) {
      travelPts.push({ x: parseFloat(cutLine[1]), y: parseFloat(cutLine[2]) });
    }
  }

  for (let i = 0; i < travelPts.length - 1; i++) {
    const a = travelPts[i];
    const b = travelPts[i + 1];
    if (a.x !== b.x || a.y !== b.y) {
      cuts.push({
        type: "line",
        points: [a, b],
        sequenceIndex: seq++,
      });
    }
  }

  const realCuts = cuts.filter(
    (c) => c.points.length >= 2 && (c.points[0].x !== c.points[1].x || c.points[0].y !== c.points[1].y)
  );

  const plan: CutPlan = {
    metadata: { vendor: "Hegla", sourcePath },
    sheet: { width: sheetWidth, height: sheetHeight },
    panes,
    cuts: realCuts,
    coordinateSemantics: {
      origin: "top-left",
      xAxis: "right",
      yAxis: "down",
      units: "mm",
    },
  };

  return {
    status: realCuts.length === 0 ? "partial" : warnings.length ? "partial" : "ok",
    warnings: realCuts.length === 0 ? ["No cut segments decoded from Hegla EDI"] : warnings,
    plan,
    detected: {
      vendor: "Hegla",
      formatId: "hegla-edi",
      confidence: "high",
      matchedSignal: "EDICUT",
    },
  };
}
