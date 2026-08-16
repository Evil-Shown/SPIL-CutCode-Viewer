import type { Cut, CutDocument, CutPlan, Pane, ParseResult } from "../model/types.js";
import { stageLabel } from "../model/types.js";

/**
 * Bottero OPT uses hex-encoded coordinates.
 * Scale: 1/16 mm per tick (common for this vendor family).
 *
 * Token grammar (heuristic):
 *   [P<piece>H<height>R<rack><commands>]
 *   Commands: X/Z = x-axis ticks, Y/W = y-axis ticks,
 *             C = arc, R = repeat, Q = quality, t = tilt
 *   Piece dims after t: x<decimal>y<decimal> (mm, NOT hex)
 */
const BOTTERO_SCALE = 1 / 16;

function parseHexVal(token: string): number | undefined {
  const n = parseInt(token, 16);
  return Number.isFinite(n) ? n * BOTTERO_SCALE : undefined;
}

export function parseBotteroOpt(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cuts: Cut[] = [];
  const panes: Pane[] = [];

  let sheetWidth = 0;
  let sheetHeight = 0;
  let seq = 0;

  for (const line of lines) {
    const inner = line.replace(/^\[|\]$/g, "");

    // Piece header: P<n>H<n>R<rackId> — rackId is short, before any t/x command
    const header = inner.match(/^P(\d+)H(\d+)R(\w+?)(?=[a-z]|$)/i);
    let rackCode: string | undefined;
    let pieceId: string | undefined;

    if (header) {
      pieceId = header[1];
      rackCode = header[3];

      // Dimensions: t5x<decimal>y<decimal> (decimal mm, NOT hex)
      const dim = inner.match(/[a-z]\d*x(\d+)y(\d+)/i);
      if (dim) {
        const w = parseInt(dim[1], 10);
        const h = parseInt(dim[2], 10);
        panes.push({
          id: `P${pieceId}`,
          bounds: { x: 0, y: 0, width: w, height: h },
          label: `H${header[2]}`,
        });
        sheetWidth = Math.max(sheetWidth, w);
        sheetHeight = Math.max(sheetHeight, h);
      }
    }

    // Cut tokens — CASE SENSITIVE to avoid eating decimal xNNNyNNN dims as hex.
    // Match uppercase [XYZWQRC] followed by hex digits.
    const tokens = inner.match(/[XYZWQRC][0-9A-F]+/g) ?? [];
    const points: Array<{ x: number; y: number }> = [];
    let lastX: number | undefined;
    let lastY: number | undefined;

    for (const t of tokens) {
      const axis = t[0]!;
      const hexPart = t.slice(1);
      if (axis === "C" || axis === "Q" || axis === "R") continue; // arc/repeat/quality — not cut coords
      const v = parseHexVal(hexPart);
      if (v === undefined) continue;
      if (axis === "X" || axis === "Z") {
        lastX = v;
        if (lastY !== undefined) points.push({ x: lastX, y: lastY });
      } else if (axis === "Y" || axis === "W") {
        lastY = v;
        if (lastX !== undefined) points.push({ x: lastX, y: lastY });
      }
    }

    if (points.length >= 2) {
      for (let i = 0; i < points.length - 1; i++) {
        cuts.push({
          type: "line",
          points: [points[i], points[i + 1]],
          sequenceIndex: seq++,
          rackCode,
          paneRefs: pieceId ? [`P${pieceId}`] : undefined,
        });
      }
      sheetWidth = Math.max(sheetWidth, ...points.map((p) => p.x));
      sheetHeight = Math.max(sheetHeight, ...points.map((p) => p.y));
    } else if (header) {
      warnings.push(`Piece P${pieceId}: could not extract cut polyline from tokens`);
    }
  }

  if (!sheetWidth || !sheetHeight) {
    return {
      status: "failed",
      warnings,
      error: "Could not determine sheet size from Bottero OPT",
      detected: { vendor: "Bottero", formatId: "bottero-opt", confidence: "high" },
    };
  }

  return {
    status: warnings.length || cuts.length === 0 ? "partial" : "ok",
    document: {
      metadata: { vendor: "Bottero", sourcePath },
      sheets: [{
        id: "sheet-1",
        sheet: { width: sheetWidth, height: sheetHeight },
        panes,
        cuts,
        coordinateSemantics: { origin: "top-left", xAxis: "right", units: "mm" },
      }],
    },
    warnings:
      cuts.length === 0
        ? [...warnings, "No cut segments decoded — check hex scale or token grammar"]
        : warnings,
    detected: { vendor: "Bottero", formatId: "bottero-opt", confidence: "high", matchedSignal: "P#H#R line" },
  };
}
