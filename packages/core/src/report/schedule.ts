import { cutPathPoints, polylineLength } from "../sim/timeline.js";
import { stageLabel } from "../model/types.js";
import type { CutDocument } from "../model/types.js";

/** One row of the machine-facing cut schedule. */
export type ScheduleRow = {
  sheetIndex: number;
  sheetLabel: string;
  sequenceIndex: number;
  /** 1-based guillotine level; 0 when the format carries no stage. */
  stage: number;
  stageLabel: string;
  type: "line" | "arc";
  /** Total scored length of the cut (arcs use their true sweep). */
  lengthMm: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  vertexCount: number;
  bockCode?: string;
  rackCode?: string;
};

export type StageSummary = {
  stage: number;
  label: string;
  cuts: number;
  lengthMm: number;
  /** Share of total scored length, 0–100. */
  lengthPct: number;
};

export type ScheduleReport = {
  rows: ScheduleRow[];
  stages: StageSummary[];
  totals: {
    sheets: number;
    panes: number;
    cuts: number;
    scoreLengthMm: number;
    /** Number of distinct pane sizes, useful as a rough complexity figure. */
    distinctPaneSizes: number;
  };
};

function fmt(n: number): string {
  return n.toFixed(2);
}

/** Panes are never dimensioned to more than a tenth of a millimetre. */
function sizeKey(w: number, h: number): string {
  return `${fmt(w)}x${fmt(h)}`;
}



/**
 * Flatten a document into the ordered cut schedule the machine would run.
 * Cuts keep their `sequenceIndex` order within a sheet, sheets keep file order.
 */
export function buildSchedule(doc: CutDocument): ScheduleReport {
  const rows: ScheduleRow[] = [];
  const perStage = new Map<number, { cuts: number; lengthMm: number }>();
  const paneSizes = new Set<string>();
  let totalScoreMm = 0;
  let totalPanes = 0;
  let totalCuts = 0;

  doc.sheets.forEach((sheet, sheetIndex) => {
    const sheetLabel = sheet.label ?? (doc.sheets.length > 1 ? `Sheet ${sheetIndex + 1}` : "Sheet 1");
    for (const pane of sheet.panes) {
      paneSizes.add(sizeKey(pane.bounds.width, pane.bounds.height));
      totalPanes++;
    }

    const ordered = [...sheet.cuts].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    for (const cut of ordered) {
      const path = cutPathPoints(cut);
      const lengthMm = polylineLength(path);
      const a = path[0] ?? { x: 0, y: 0 };
      const b = path[path.length - 1] ?? a;
      const stage = cut.stage ?? 0;
      const label = cut.stageLabel ?? (stage > 0 ? stageLabel(doc.metadata.vendor, stage) ?? `S${stage}` : "-");

      rows.push({
        sheetIndex,
        sheetLabel,
        sequenceIndex: cut.sequenceIndex,
        stage,
        stageLabel: label,
        type: cut.type,
        lengthMm,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        vertexCount: path.length,
        bockCode: cut.bockCode,
        rackCode: cut.rackCode,
      });

      const bucket = perStage.get(stage);
      if (bucket) {
        bucket.cuts++;
        bucket.lengthMm += lengthMm;
      } else {
        perStage.set(stage, { cuts: 1, lengthMm });
      }
      totalScoreMm += lengthMm;
      totalCuts++;
    }
  });

  const stages: StageSummary[] = [...perStage.entries()]
    .map(([stage, v]) => ({
      stage,
      label: rows.find((r) => r.stage === stage)?.stageLabel ?? (stage > 0 ? `S${stage}` : "unstaged"),
      cuts: v.cuts,
      lengthMm: v.lengthMm,
      lengthPct: totalScoreMm > 0 ? (100 * v.lengthMm) / totalScoreMm : 0,
    }))
    .sort((a, b) => (a.stage === 0 ? 1 : 0) - (b.stage === 0 ? 1 : 0) || a.stage - b.stage);

  return {
    rows,
    stages,
    totals: {
      sheets: doc.sheets.length,
      panes: totalPanes,
      cuts: totalCuts,
      scoreLengthMm: totalScoreMm,
      distinctPaneSizes: paneSizes.size,
    },
  };
}

function csvField(v: string | number | undefined): string {
  const s = v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Cut schedule as RFC-4180 CSV, one row per cut. */
export function scheduleToCsv(report: ScheduleReport): string {
  const header = [
    "sheet", "sequence", "stage", "stage_label", "type",
    "length_mm", "x1", "y1", "x2", "y2", "vertices", "bock", "rack",
  ];
  const lines = [header.join(",")];
  for (const r of report.rows) {
    lines.push(
      [
        csvField(r.sheetLabel),
        csvField(r.sequenceIndex),
        csvField(r.stage || ""),
        csvField(r.stageLabel),
        csvField(r.type),
        csvField(fmt(r.lengthMm)),
        csvField(fmt(r.x1)),
        csvField(fmt(r.y1)),
        csvField(fmt(r.x2)),
        csvField(fmt(r.y2)),
        csvField(r.vertexCount),
        csvField(r.bockCode),
        csvField(r.rackCode),
      ].join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Pane cut list as CSV: id, position, size, area, label, rack. */
export function panesToCsv(doc: CutDocument): string {
  const lines = ["sheet,pane,x_mm,y_mm,width_mm,height_mm,area_m2,rotated,rack,label"];
  for (const sheet of doc.sheets) {
    const sheetLabel = sheet.label ?? "Sheet 1";
    for (const pane of sheet.panes) {
      lines.push(
        [
          csvField(sheetLabel),
          csvField(pane.id),
          csvField(fmt(pane.bounds.x)),
          csvField(fmt(pane.bounds.y)),
          csvField(fmt(pane.bounds.width)),
          csvField(fmt(pane.bounds.height)),
          csvField(((pane.bounds.width * pane.bounds.height) / 1e6).toFixed(4)),
          csvField(pane.rotated ? "yes" : "no"),
          csvField(pane.rackCode),
          csvField(pane.label),
        ].join(",")
      );
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/** Per-stage length breakdown as CSV. */
export function stagesToCsv(report: ScheduleReport): string {
  const lines = ["stage,label,cuts,length_mm,length_pct"];
  for (const s of report.stages) {
    lines.push([csvField(s.stage || ""), csvField(s.label), csvField(s.cuts), csvField(fmt(s.lengthMm)), csvField(s.lengthPct.toFixed(1))].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}