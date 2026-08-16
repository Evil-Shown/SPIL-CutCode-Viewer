import type { Cut, CutDocument, CutPlan, Pane, ParseResult } from "../model/types.js";
import { stageLabel } from "../model/types.js";

type OtvSubProject = {
  glassFamily?: string;
  glassThickness?: number;
  glassFamilyDescription?: string;
  pieces?: Array<{ id: number; width: number; height: number }>;
  sheets?: Array<{ width: number; height: number; glassCode?: string; glassDescription?: string }>;
  layout?: Array<{
    width: number;
    height: number;
    piecePlacement?: Array<{
      id: number;
      x: number;
      y: number;
      rotated?: boolean;
    }>;
    cutLines?: Array<{
      id?: number;
      stage?: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }>;
  }>;
};

type OtvRoot = { subProjects?: OtvSubProject[] };

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

  const subProjects = data.subProjects ?? [];
  if (subProjects.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "OptiTV JSON has no subProjects",
      detected: { vendor: "Optima", formatId: "optima-otv", confidence: "high" },
    };
  }

  const sheets: CutPlan[] = [];
  let seq = 0;

  for (let si = 0; si < subProjects.length; si++) {
    const sub = subProjects[si]!;
    const pieceMap = new Map(sub.pieces?.map((p) => [p.id, p]) ?? []);

    for (let li = 0; li < (sub.layout?.length ?? 0); li++) {
      const layout = sub.layout![li]!;
      const sh = sub.sheets?.[0];
      const sheetWidth = layout.width ?? sh?.width ?? 0;
      const sheetHeight = layout.height ?? sh?.height ?? 0;

      if (!sheetWidth || !sheetHeight) {
        warnings.push(`SubProject ${si + 1} layout ${li + 1}: missing sheet dims`);
        continue;
      }

      const panes: Pane[] = [];
      for (const pl of layout.piecePlacement ?? []) {
        const piece = pieceMap.get(pl.id);
        let w = piece?.width ?? 0;
        let h = piece?.height ?? 0;
        // Apply rotation: swap width/height
        if (pl.rotated && w && h) { [w, h] = [h, w]; }
        if (w && h) {
          panes.push({
            id: String(pl.id),
            bounds: { x: pl.x, y: pl.y, width: w, height: h },
            label: piece ? `${piece.width}×${piece.height}${pl.rotated ? " (rotated)" : ""}` : undefined,
            rotated: pl.rotated,
          });
        }
      }

      const cuts: Cut[] = (layout.cutLines ?? []).map((cl) => ({
        type: "line" as const,
        points: [{ x: cl.x1, y: cl.y1 }, { x: cl.x2, y: cl.y2 }],
        sequenceIndex: seq++,
        stage: cl.stage,
        stageLabel: cl.stage ? stageLabel("OPTIMA", cl.stage) : undefined,
        id: cl.id !== undefined ? `cut-${cl.id}` : undefined,
      }));

      sheets.push({
        id: `sheet-${si + 1}-${li + 1}`,
        label: sub.glassFamily
          ? `${sub.glassFamily}${sub.layout && sub.layout.length > 1 ? ` layout ${li + 1}` : ""}`
          : undefined,
        sheet: { width: sheetWidth, height: sheetHeight },
        panes,
        cuts,
        coordinateSemantics: { origin: "top-left", xAxis: "right", units: "mm" },
      });
    }
  }

  if (sheets.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "No valid sheets in OptiTV JSON",
      detected: { vendor: "Optima", formatId: "optima-otv", confidence: "high" },
    };
  }

  const firstSub = subProjects[0]!;
  return {
    status: warnings.length ? "partial" : "ok",
    document: {
      metadata: {
        vendor: firstSub.glassFamily ? `Optima (${firstSub.glassFamily})` : "Optima",
        glassType: firstSub.glassFamily,
        glassThickness: firstSub.glassThickness,
        sourcePath,
      },
      sheets,
    },
    warnings,
    detected: { vendor: "Optima", formatId: "optima-otv", confidence: "high", matchedSignal: "OptiTV JSON" },
  };
}
