import type { CutPlan, ParseResult } from "../model/types.js";

type OtvRoot = {
  subProjects?: Array<{
    glassFamily?: string;
    glassThickness?: number;
    glassFamilyDescription?: string;
    pieces?: Array<{ id: number; width: number; height: number }>;
    sheets?: Array<{ width: number; height: number; glassCode?: string; glassDescription?: string }>;
    layout?: Array<{
      width: number;
      height: number;
      piecePlacement?: Array<{ id: number; x: number; y: number; rotated?: boolean }>;
      cutLines?: Array<{ id: number; stage?: number; x1: number; y1: number; x2: number; y2: number }>;
    }>;
  }>;
};

export function parseOptimaOtv(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  let data: OtvRoot;
  try {
    data = JSON.parse(content) as OtvRoot;
  } catch {
    return {
      status: "failed",
      warnings,
      error: "Invalid OptiTV JSON",
      detected: { vendor: "Optima", formatId: "optima-otv", confidence: "high" },
    };
  }

  const sub = data.subProjects?.[0];
  const layout = sub?.layout?.[0];
  const sheet = sub?.sheets?.[0];

  const sheetWidth = layout?.width ?? sheet?.width ?? 0;
  const sheetHeight = layout?.height ?? sheet?.height ?? 0;

  if (!sheetWidth || !sheetHeight) {
    return {
      status: "failed",
      warnings,
      error: "Could not determine sheet dimensions from OptiTV JSON",
      detected: { vendor: "Optima", formatId: "optima-otv", confidence: "high" },
    };
  }

  const panes: CutPlan["panes"] = [];
  const pieceMap = new Map(sub?.pieces?.map((p) => [p.id, p]) ?? []);

  for (const pl of layout?.piecePlacement ?? []) {
    const piece = pieceMap.get(pl.id);
    const w = piece?.width ?? 0;
    const h = piece?.height ?? 0;
    if (w && h) {
      panes.push({
        id: String(pl.id),
        bounds: { x: pl.x, y: pl.y, width: w, height: h },
        label: piece ? `${piece.width}×${piece.height}` : undefined,
      });
    }
  }

  const cuts: CutPlan["cuts"] = (layout?.cutLines ?? []).map((line, i) => ({
    type: "line" as const,
    points: [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }],
    sequenceIndex: line.stage ?? i,
    paneRefs: line.id ? [`cut-${line.id}`] : undefined,
  }));

  const plan: CutPlan = {
    metadata: {
      vendor: sub?.glassFamily ? `Optima (${sub.glassFamily})` : "Optima",
      glassType: sheet?.glassCode ?? sub?.glassFamily,
      glassThickness: sub?.glassThickness,
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
    status: "ok",
    plan,
    warnings,
    detected: {
      vendor: "Optima",
      formatId: "optima-otv",
      confidence: "high",
      matchedSignal: "OptiTV JSON",
    },
  };
}
