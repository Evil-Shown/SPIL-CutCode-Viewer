import type { Cut, CutDocument, CutPlan, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";
import { sampleArcAbout } from "../geometry/arc.js";
import { shapeTransform, decomposeRects, type GuillotineRegion, type RectInput } from "../geometry/guillotine.js";

/**
 * Turomas File Format V40 (JSON).
 * Docs 001_V40_STRUCTURE_AND_FIELDS_DESCRIPTION_V5_EN,
 * 002_V40_KEY_FEATURES_V4_EN and 003_V40_LOWE_DETAILS_V1_EN.
 *
 * Structure:
 *   name, metadata { version, creator, units: "dmm" | "mm" },
 *   pieces[]   { id, Xsize, Ysize, workProcessesTrack[], customer, order, rack, customFields }
 *   remnants[] { id, Xsize, Ysize, isReusable, customFields }
 *   plans[]    { id, Xsize, Ysize, thickness, materialCode, workProcesses[],
 *                Xtrim, Ytrim, glassSheetId?, grindingToolWidth?, placement[] }
 *
 * placement[] items: { id, type: "piece" | "remnant", x, y, rotation }
 * Track items:      { type: "G0"|"G1"|"G2"|"G3", x, y, i?, j?, r? }
 *
 * Unlike V30 the cutting track is not written out ("the cutting track will be
 * obtained by processing the pieces and remnant location"), so the guillotine
 * sequence is reconstructed from the placed rectangles. Only shape tracks
 * inside `workProcessesTrack` are real cut geometry.
 * Units are tenths of a millimetre unless `metadata.units` says `mm`.
 */

const VENDOR = "Turomas";

type TrackItem = {
  type: string;
  x: number;
  y: number;
  i?: number;
  j?: number;
  r?: number;
  /** Owning work process (`CUT`, `LE`, …); set by the piece loader. */
  process?: string;
};

type PieceDef = {
  id: number;
  width: number;
  height: number;
  tracks: TrackItem[];
  /** Distinct work processes seen on this piece, in file order. */
  processes: string[];
  customer?: string;
  order?: string;
  rack?: string;
  note?: string;
};

type RemnantDef = { id: number; width: number; height: number; reusable: boolean };

type Placement = { id: number; type: "piece" | "remnant"; x: number; y: number; rotation: number };

type PlanDef = {
  id: number;
  width: number;
  height: number;
  thickness?: number;
  materialCode?: string;
  xTrim: number;
  yTrim: number;
  glassSheetId?: number;
  grindingToolWidth?: number;
  workProcesses: string[];
  placements: Placement[];
};

function looksLikeV40(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.plans)) return false;
  if (!Array.isArray(o.pieces) && !Array.isArray(o.remnants)) return false;
  const meta = o.metadata as Record<string, unknown> | undefined;
  const creator = typeof meta?.creator === "string" ? meta.creator.toLowerCase() : "";
  return /turomas/.test(creator) || meta?.units !== undefined || Array.isArray(o.pieces);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * `i`/`j` in the V40 track are the arc centre in the piece's own frame, not an
 * offset from the current point: on every real fixture `|start − (i,j)|` and
 * `|end − (i,j)|` both match the declared radius R. Older revisions wrote them
 * as offsets, so that reading is kept as a fallback.
 */
function resolveArcCenter(from: Point, to: Point, i: number, j: number, radius: number): Point {
  const abs = { x: i, y: j };
  const rA = Math.hypot(from.x - abs.x, from.y - abs.y);
  const rB = Math.hypot(to.x - abs.x, to.y - abs.y);
  const tolerance = Math.max(1, radius * 0.05);
  if (radius > 0.1 && Math.abs(rA - radius) <= tolerance && Math.abs(rB - radius) <= tolerance) return abs;
  if (rA > 0.1 && Math.abs(rA - rB) <= Math.max(1, rA * 0.02)) return abs;
  return { x: from.x + i, y: from.y + j };
}

/**
 * Cut one work process track of a piece. Track coordinates are relative to the
 * piece's own origin and are written in the file's own unit, so they need the
 * same scale as the piece sizes.
 *
 * The track is authored in the piece's own frame, so a rotated placement has to
 * rotate the whole path — and every arc centre — into the blank. Returns the
 * outline in sheet coordinates.
 */
function emitTrackCuts(
  track: TrackItem[],
  region: GuillotineRegion,
  paneId: string,
  cuts: Cut[],
  nextSeq: () => number,
  scale: number,
  rotation: number
): Point[] | null {
  if (track.length < 2) return null;
  const stage = 3;
  const label = stageLabel(VENDOR, 3) ?? "Shape";
  const process = track[0]!.process ?? "CUT";

  // Build the outline in the piece's own frame (origin 0,0, millimetres).
  const local: Point[] = [];
  const localArcs: { from: Point; to: Point; center: Point; r: number; ccw: boolean }[] = [];
  const localLines: { from: Point; to: Point }[] = [];
  local.push({ x: num(track[0]!.x) * scale, y: num(track[0]!.y) * scale });

  // Only straight moves become line cuts; arcs stay as one arc cut each. The
  // sampled arc points feed the pane outline, not extra cuts.
  for (let i = 1; i < track.length; i++) {
    const t = track[i]!;
    const from = { x: num(track[i - 1]!.x) * scale, y: num(track[i - 1]!.y) * scale };
    const to = { x: num(t.x) * scale, y: num(t.y) * scale };
    if (Math.abs(from.x - to.x) < 1e-6 && Math.abs(from.y - to.y) < 1e-6) continue;

    if (t.type === "G2" || t.type === "G3") {
      const iOff = num(t.i) * scale;
      const jOff = num(t.j) * scale;
      const r = num(t.r) * scale || Math.hypot(iOff, jOff);
      const ccw = t.type === "G3";
      const center = resolveArcCenter(from, to, iOff, jOff, r);
      localArcs.push({ from, to, center, r, ccw });
      // Sample about the file's own centre: re-deriving it from radius + sense
      // would land on the mirror solution and trace the long way round.
      local.push(...sampleArcAbout(center, from, to, r, ccw, 24).slice(1));
    } else {
      localLines.push({ from, to });
      local.push(to);
    }
  }

  if (local.length <= 2) return null;

  const rot = ((rotation % 360) + 360) % 360;
  // `shapeTransform` rotates about the outline's own centre and centres the
  // result in the blank; reuse it so points and arc centres stay consistent.
  const map = shapeTransform(local, region, rot);

  for (const a of localArcs) {
    cuts.push({
      type: "arc",
      points: [map(a.from), map(a.to)],
      center: map(a.center),
      radius: a.r,
      // A rotation preserves handedness, so the sweep direction is unchanged.
      ccw: a.ccw,
      sequenceIndex: nextSeq(),
      stage,
      stageLabel: label,
      paneRefs: [paneId],
      process,
    });
  }

  for (const l of localLines) {
    if (Math.abs(l.from.x - l.to.x) < 1e-6 && Math.abs(l.from.y - l.to.y) < 1e-6) continue;
    cuts.push({
      type: "line",
      points: [map(l.from), map(l.to)],
      sequenceIndex: nextSeq(),
      stage,
      stageLabel: label,
      paneRefs: [paneId],
      process,
    });
  }

  return local.map(map);
}

/**
 * Split a piece's concatenated tracks into one contiguous run per work process.
 * A process can carry several separate contours (several G0-separated blocks);
 * each becomes its own outline.
 */
function groupTracksByProcess(tracks: TrackItem[]): TrackItem[][] {
  const groups: TrackItem[][] = [];
  let current: TrackItem[] = [];
  let currentProcess: string | undefined;
  for (const t of tracks) {
    // A G0 that starts a fresh block always opens a new contour.
    if (t.type === "G0" && (currentProcess !== undefined || current.length > 0) && t.process === currentProcess) {
      if (current.length > 0) groups.push(current);
      current = [t];
      continue;
    }
    if (currentProcess === undefined) currentProcess = t.process;
    if (t.process !== currentProcess) {
      if (current.length > 1) groups.push(current);
      current = [];
      currentProcess = t.process;
    }
    current.push(t);
  }
  if (current.length > 1) groups.push(current);
  return groups;
}

export function parseTuromasV40(content: string, sourcePath: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return {
      status: "failed",
      warnings: [],
      error: "File is not valid JSON",
      detected: { vendor: VENDOR, formatId: "turomas-v40", confidence: "high", matchedSignal: "extension.json" },
    };
  }

  if (!looksLikeV40(raw)) {
    return {
      status: "failed",
      warnings: [],
      error: "JSON does not match the Turomas V40 layout (expected `plans` plus `pieces` and `remnants`)",
      detected: { vendor: VENDOR, formatId: "turomas-v40", confidence: "medium", matchedSignal: "extension.json" },
    };
  }

  const doc = raw as {
    name?: string;
    metadata?: { version?: string; creator?: string; units?: string };
    pieces?: Array<Record<string, unknown>>;
    remnants?: Array<Record<string, unknown>>;
    plans?: Array<Record<string, unknown>>;
  };

  const unit = doc.metadata?.units ?? "dmm";
  const scale = /^dmm$/i.test(unit) ? 0.1 : 1;

  const pieces = new Map<number, PieceDef>();
  for (const p of doc.pieces ?? []) {
    // Each `workProcessesTrack` entry is one operation on the piece (CUT, LE for
    // Low-E deletion, …) with its own closed track. They overlap on purpose.
    const tracks: TrackItem[] = [];
    const processes: string[] = [];
    for (const wp of (p.workProcessesTrack as Array<Record<string, unknown>>) ?? []) {
      const label = typeof wp.process === "string" ? wp.process.trim().toUpperCase() || "CUT" : "CUT";
      for (const t of (wp.track as TrackItem[]) ?? []) {
        tracks.push({
          type: String(t.type ?? "G0"),
          x: num(t.x),
          y: num(t.y),
          i: num(t.i),
          j: num(t.j),
          r: num(t.r),
          process: label,
        });
        if (!processes.includes(label)) processes.push(label);
      }
    }
    const cf = (p.customFields ?? {}) as Record<string, unknown>;
    pieces.set(num(p.id), {
      id: num(p.id),
      width: num(p.Xsize) * scale,
      height: num(p.Ysize) * scale,
      tracks,
      processes,
      customer: typeof p.customer === "string" ? p.customer.trim() || undefined : undefined,
      order: typeof p.order === "string" ? p.order.trim() || undefined : undefined,
      rack: typeof p.rack === "string" ? p.rack.trim() || undefined : undefined,
      note: typeof cf.note === "string" ? cf.note.trim() || undefined : undefined,
    });
  }

  const remnants = new Map<number, RemnantDef>();
  for (const r of doc.remnants ?? []) {
    remnants.set(num(r.id), {
      id: num(r.id),
      width: num(r.Xsize) * scale,
      height: num(r.Ysize) * scale,
      reusable: r.isReusable === true,
    });
  }

  const warnings: string[] = [];
  const sheets: CutPlan[] = [];
  let globalSeq = 0;

  (doc.plans ?? []).forEach((planRaw, index) => {
    const width = num(planRaw.Xsize) * scale;
    const height = num(planRaw.Ysize) * scale;
    const thicknessRaw = num(planRaw.thickness);
    const xTrim = num(planRaw.Xtrim) * scale;
    const yTrim = num(planRaw.Ytrim) * scale;

    const placements: Placement[] = (planRaw.placement as Array<Record<string, unknown>> ?? []).map((pl) => ({
      id: num(pl.id),
      type: pl.type === "remnant" ? "remnant" : "piece",
      x: num(pl.x) * scale,
      y: num(pl.y) * scale,
      rotation: num(pl.rotation),
    }));

    const plan: PlanDef = {
      id: num(planRaw.id) || index + 1,
      width,
      height,
      thickness: thicknessRaw ? thicknessRaw * scale : undefined,
      materialCode: typeof planRaw.materialCode === "string" ? planRaw.materialCode.trim() || undefined : undefined,
      xTrim,
      yTrim,
      glassSheetId: planRaw.glassSheetId !== undefined ? num(planRaw.glassSheetId) : undefined,
      grindingToolWidth: planRaw.grindingToolWidth !== undefined ? num(planRaw.grindingToolWidth) * scale : undefined,
      workProcesses: ((planRaw.workProcesses as string[]) ?? []).map((s) => String(s)),
      placements,
    };

    const cuts: Cut[] = [];
    const panes: Pane[] = [];
    let seq = globalSeq;
    const nextSeq = () => seq++;

    const rects: RectInput[] = [];
    const pieceOf = new Map<string, { piece: PieceDef; rotation: number }>();

    placements.forEach((pl, i) => {
      if (pl.type === "piece") {
        const piece = pieces.get(pl.id);
        if (!piece) {
          warnings.push(`Plan ${plan.id}: piece ${pl.id} is not declared`);
          return;
        }
        const rot = ((pl.rotation % 360) + 360) % 360;
        const swap = rot === 90 || rot === 270;
        const w = swap ? piece.height : piece.width;
        const h = swap ? piece.width : piece.height;
        const id = `piece-${pl.id}-${i + 1}`;
        pieceOf.set(id, { piece, rotation: rot });
        rects.push({
          id,
          x: pl.x,
          y: pl.y,
          width: w,
          height: h,
          label: [piece.customer, piece.note].filter((s) => s && s.length > 0).join(" · ") || undefined,
          rackCode: piece.rack,
          rotated: rot !== 0 ? true : undefined,
        });
      } else {
        const rem = remnants.get(pl.id);
        if (!rem) {
          warnings.push(`Plan ${plan.id}: remnant ${pl.id} is not declared`);
          return;
        }
        rects.push({
          id: `remnant-${pl.id}`,
          x: pl.x,
          y: pl.y,
          width: rem.width,
          height: rem.height,
          label: rem.reusable ? "Reusable remnant" : "Remnant",
        });
      }
    });

    const decomp = decomposeRects(
      rects,
      { width: width - xTrim, height: height - yTrim },
      VENDOR,
      { x: xTrim, y: yTrim },
      seq
    );
    cuts.push(...decomp.cuts);
    panes.push(...decomp.panes);
    warnings.push(...decomp.warnings);

    // Shape tracks become stage-3 cuts, attached to their own pane. Each work
    // process (CUT outline, LE deletion track, …) is emitted separately; the
    // cutting outline is the one that becomes the pane polygon.
    for (const pane of decomp.panes) {
      const placed = pieceOf.get(pane.id);
      if (!placed || placed.piece.tracks.length < 2) continue;
      for (const group of groupTracksByProcess(placed.piece.tracks)) {
        const polygon = emitTrackCuts(group, { ...pane.bounds }, pane.id, cuts, nextSeq, scale, placed.rotation);
        if (polygon && group[0]!.process === "CUT") pane.polygon = polygon;
      }
    }

    globalSeq = cuts.reduce((n, c) => Math.max(n, (c.sequenceIndex ?? 0) + 1), globalSeq);

    sheets.push({
      id: `sheet-${index + 1}`,
      label: plan.materialCode ?? doc.name,
      sheet: { width, height, trims: { top: yTrim, right: 0, bottom: yTrim, left: xTrim } },
      panes,
      cuts,
      coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
    });
  });

  if (sheets.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Turomas V40 file contains no usable `plans` entries",
      detected: { vendor: VENDOR, formatId: "turomas-v40", confidence: "high", matchedSignal: "plans/pieces/remnants" },
    };
  }

  const document: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine: "Turomas",
      formatVersion: doc.metadata?.version ?? "1.0",
      glassType: sheets.map((s) => s.label).filter(Boolean).join(" + ") || undefined,
      glassThickness: sheets[0] ? (num((doc.plans ?? [])[0]?.thickness) || undefined) : undefined,
      sourcePath,
    },
    sheets,
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document,
    warnings,
    detected: { vendor: VENDOR, formatId: "turomas-v40", confidence: "high", matchedSignal: "plans/pieces/remnants" },
  };
}