import type { CutPlan, ParseResult } from "../model/types.js";

/** Bottero OPT uses hex-encoded coordinates; qiewer decompile references .opt token stream. Scale 1/16 mm is common for this family. */
const BOTTERO_SCALE = 1 / 16;

function parseHexCoord(token: string): number | undefined {
  const n = parseInt(token, 16);
  return Number.isFinite(n) ? n * BOTTERO_SCALE : undefined;
}

export function parseBotteroOpt(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cuts: CutPlan["cuts"] = [];
  const panes: CutPlan["panes"] = [];

  let sheetWidth = 0;
  let sheetHeight = 0;
  let rackCode: string | undefined;
  let seq = 0;

  for (const line of lines) {
    const inner = line.replace(/^\[|\]$/g, "");
    const header = inner.match(/^P(\d+)H(\d+)R(\w+)/i);
    if (header) {
      const pieceId = header[1];
      rackCode = header[3];
      const dim = inner.match(/x(\d+)y(\d+)/i);
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

    const tokens = inner.match(/[XYZWQRC]([0-9A-F]+)/gi) ?? [];
    const points: Array<{ x: number; y: number }> = [];
    let lastX: number | undefined;
    let lastY: number | undefined;

    for (const t of tokens) {
      const m = t.match(/^([XYZWQRC])([0-9A-F]+)$/i);
      if (!m) continue;
      const axis = m[1].toUpperCase();
      const v = parseHexCoord(m[2]);
      if (v === undefined) continue;
      if (axis === "X" || axis === "Z") {
        lastX = v;
        if (lastY !== undefined) points.push({ x: lastX, y: lastY });
      }
      if (axis === "Y" || axis === "W") {
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
          paneRefs: header ? [`P${header[1]}`] : undefined,
        });
      }
      sheetWidth = Math.max(sheetWidth, ...points.map((p) => p.x));
      sheetHeight = Math.max(sheetHeight, ...points.map((p) => p.y));
    } else if (header) {
      warnings.push(`Piece P${header[1]}: could not extract cut polyline from tokens`);
    }
  }

  if (!sheetWidth || !sheetHeight) {
    const dim = content.match(/x(\d+)y(\d+)/i);
    if (dim) {
      sheetWidth = parseInt(dim[1], 10);
      sheetHeight = parseInt(dim[2], 10);
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

  const plan: CutPlan = {
    metadata: {
      vendor: "Bottero",
      sourcePath,
    },
    sheet: { width: sheetWidth, height: sheetHeight },
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
    status: warnings.length || cuts.length === 0 ? "partial" : "ok",
    plan,
    warnings:
      cuts.length === 0
        ? [...warnings, "No cut segments decoded — check hex scale or token grammar"]
        : warnings,
    detected: {
      vendor: "Bottero",
      formatId: "bottero-opt",
      confidence: "high",
      matchedSignal: "P#H#R line",
    },
  };
}
