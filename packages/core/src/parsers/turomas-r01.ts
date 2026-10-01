import type { Cut, CutDocument, CutPlan, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";
import { sampleArcAbout } from "../geometry/arc.js";
import { boundsOf, placeShape, shapeTransform, walkGuillotine, type GuillotineLevel, type GuillotineNode, type GuillotineRegion } from "../geometry/guillotine.js";

/**
 * Turomas File Format V30 (.R01) — "Turomas File format, Optimization file
 * description for Turomas cutting machine", doc 002_TUROMAS_FILE_FORMAT_V30_V2_EN.
 *
 * Line-oriented ASCII, one plan block per sheet:
 *
 *   P001                            plan number
 *   /comment                        free text, often names the CAM origin
 *   N01                             number of identical repetitions
 *   H32100                          sheet height   (tenths of a millimetre)
 *   L60000                          sheet length   (tenths of a millimetre)
 *   MATERIAL:10CLMGUARD_N70         material code
 *   x350.000                        vertical trim
 *   y350.000                        horizontal trim
 *   DS8 … ES                        shape description (SX, SY, G-code path)
 *   X37448.000                      cuts description: level + position
 *   Y30788.000*CS10Q2,"cust",…      piece arguments, optional ,repetitions
 *   SC … EP                         optional score points (optimised track)
 *   LE … EP                         low-E / TPF deletion track
 *
 * Levels are X, Y, Z, V, W, Q, R, S, T, U — ten nesting levels; positions are
 * given in tenths of a millimetre relative to the preceding cut of the same
 * level, relative to the bottom-left corner of the plan.
 *
 * Shape description: `DS<id>` … `SX<w>` `SY<h>` … `ES`, containing
 *   G <x> <y>                    rapid, no cutting head
 *   G1 <x> <y>                   straight movement, head applied
 *   G2 <x> <y> I<i> J<j> R<r>   clockwise arc
 *   G3 …                         anticlockwise arc
 * Coordinates are local to the shape's enclosing rectangle.
 *
 * `CS<id>Q<1|2>` selects the shape and its orientation (1 as described,
 * 2 rotated 90° clockwise).
 */

const LEVELS: GuillotineLevel[] = [
  { letter: "X", axis: "X" },
  { letter: "Y", axis: "Y" },
  { letter: "Z", axis: "X" },
  { letter: "V", axis: "Y" },
  { letter: "W", axis: "X" },
  { letter: "Q", axis: "Y" },
  { letter: "R", axis: "X" },
  { letter: "S", axis: "Y" },
  { letter: "T", axis: "X" },
  { letter: "U", axis: "Y" },
];

const VENDOR = "Turomas";
const TENTHS = 10;

type TrackEl =
  | { kind: "rapid"; to: Point }
  | { kind: "line"; to: Point }
  | { kind: "arc"; to: Point; center: Point; radius: number; ccw: boolean };

type ShapeDef = {
  id: number;
  sx?: number;
  sy?: number;
  els: TrackEl[];
  general: boolean;
};

type PlanBlock = {
  number: string;
  comment: string;
  repetitions: number;
  height?: number;
  length?: number;
  material?: string;
  trimX?: number;
  trimY?: number;
  shapes: Map<number, ShapeDef>;
  nodes: GuillotineNode[];
  /** SC track: absolute sheet coordinates in tenths of a millimetre. */
  score: TrackEl[];
  /** CS<n> placements inside the SC track (jump to a placed shape). */
  scorePlacements: Array<{ shape: number; x: number; y: number; orientation: 1 | 2 }>;
  /** LE track: shape placements for low-E / TPF deletion. */
  lowE: Array<{ shape: number; x: number; y: number; orientation: 1 | 2 }>;
};

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** `G1X5938.1Y9900`, `GX466Y350`, `G3X4250Y9500I4250J4950R4550` */
function parseMove(text: string): TrackEl | null {
  const m = text.match(
    /^G([0-3])\s*X\s*(-?[\d.]+)\s*Y\s*(-?[\d.]+)(?:\s*I\s*(-?[\d.]+))?(?:\s*J\s*(-?[\d.]+))?(?:\s*R\s*(-?[\d.]+))?/i
  );
  if (!m) return null;
  const code = m[1]!;
  const to: Point = { x: parseFloat(m[2]!), y: parseFloat(m[3]!) };
  if (code === "0") return { kind: "rapid", to };
  if (code === "1") return { kind: "line", to };
  const i = num(m[4]) ?? 0;
  const j = num(m[5]) ?? 0;
  const r = num(m[6]) ?? Math.hypot(i, j);
  return { kind: "arc", to, center: { x: i, y: j }, radius: r, ccw: code === "3" };
}

/** `CS10Q2,"CUSTOMER","ORDER","RACK","ID","NOTE"` */
function parsePieceArgs(rest: string): {
  shapeIndex?: number;
  shapeOrientation?: 1 | 2;
  id?: string;
  label?: string;
  rack?: string;
} {
  const out: { shapeIndex?: number; shapeOrientation?: 1 | 2; id?: string; label?: string; rack?: string } = {};
  const shape = rest.match(/CS\s*(\d+)\s*Q\s*([12])/i);
  if (shape) {
    out.shapeIndex = parseInt(shape[1]!, 10);
    out.shapeOrientation = shape[2] === "2" ? 2 : 1;
  }
  const fields = [...rest.matchAll(/"([^"]*)"/g)].map((m) => (m[1] ?? "").trim());
  const customer = fields[0] ?? "";
  const rack = fields[2] ?? "";
  const id = fields[3] ?? "";
  const note = fields[4] ?? "";
  const label = [customer, note].filter((s) => s.length > 0).join(" · ");
  if (label) out.label = label;
  if (id) out.id = id;
  if (rack) out.rack = rack;
  return out;
}

function resolveCenter(from: Point, to: Point, i: number, j: number, r: number, ccw: boolean): Point {
  const rStart = Math.hypot(from.x - i, from.y - j);
  const rEnd = Math.hypot(to.x - i, to.y - j);
  if (rStart > 0.1 && Math.abs(rStart - rEnd) <= Math.max(1, rStart * 0.02)) return { x: i, y: j };
  const c = { x: from.x + i, y: from.y + j };
  void ccw;
  void r;
  return c;
}

function splitPlans(content: string): string[] {
  return content
    .split(/(?=^P\d+\s*$)/m)
    .map((p) => p.trim())
    // Files may begin with control characters (0x02) before the first plan.
    .filter((p) => /^P\d+\s*$/m.test(p));
}

function parsePlan(raw: string): PlanBlock {
  const plan: PlanBlock = {
    number: "",
    comment: "",
    repetitions: 1,
    shapes: new Map(),
    nodes: [],
    score: [],
    scorePlacements: [],
    lowE: [],
  };

  let shape: ShapeDef | null = null;
  let shapeFrom: Point = { x: 0, y: 0 };
  let scoreFrom: Point = { x: 0, y: 0 };
  let inScore = false;
  let inLowE = false;

  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;

    if (/^P\d+$/.test(text)) {
      plan.number = text.slice(1);
      continue;
    }
    if (text.startsWith("/")) {
      plan.comment = text.slice(1).trim();
      continue;
    }
    if (/^N\d+$/.test(text)) {
      plan.repetitions = parseInt(text.slice(1), 10) || 1;
      continue;
    }
    if (/^H[\d.]+$/.test(text)) {
      plan.height = num(text.slice(1));
      continue;
    }
    if (/^L[\d.]+$/.test(text)) {
      plan.length = num(text.slice(1));
      continue;
    }
    if (/^MATERIAL\s*:/i.test(text)) {
      plan.material = text.slice(text.indexOf(":") + 1).trim();
      continue;
    }
    if (/^x[\d.]+$/i.test(text)) {
      plan.trimX = num(text.slice(1));
      continue;
    }
    if (/^y[\d.]+$/i.test(text)) {
      plan.trimY = num(text.slice(1));
      continue;
    }

    const ds = text.match(/^DS\s*(\d+)$/i);
    if (ds) {
      shape = { id: parseInt(ds[1]!, 10), els: [], general: false };
      plan.shapes.set(shape.id, shape);
      shapeFrom = { x: 0, y: 0 };
      inScore = false;
      inLowE = false;
      continue;
    }
    if (text === "ES") {
      shape = null;
      continue;
    }
    if (text === "SC") {
      inScore = true;
      scoreFrom = { x: 0, y: 0 };
      continue;
    }
    if (text === "LE") {
      inLowE = true;
      continue;
    }
    if (text === "EP") {
      inScore = false;
      inLowE = false;
      continue;
    }

    /* ---- shape description body ---- */
    if (shape) {
      const sx = text.match(/^SX\s*(-?[\d.]+)$/i);
      if (sx) {
        shape.sx = num(sx[1]);
        continue;
      }
      const sy = text.match(/^SY\s*(-?[\d.]+)$/i);
      if (sy) {
        shape.sy = num(sy[1]);
        continue;
      }
      const move = parseMove(text);
      if (!move) continue;
      if (move.kind === "rapid") {
        shapeFrom = move.to;
        shape.els.push(move);
      } else {
        if (move.kind === "arc") move.center = resolveCenter(shapeFrom, move.to, move.center.x, move.center.y, move.radius, move.ccw);
        shape.els.push(move);
        shapeFrom = move.to;
      }
      continue;
    }

    /* ---- low-E track ---- */
    if (inLowE) {
      const cs = text.match(/^CS\s*(\d+)\s*X\s*(-?[\d.]+)\s*Y\s*(-?[\d.]+)\s*Q\s*([12])/i);
      if (cs) {
        plan.lowE.push({
          shape: parseInt(cs[1]!, 10),
          x: num(cs[2]) ?? 0,
          y: num(cs[3]) ?? 0,
          orientation: cs[4] === "2" ? 2 : 1,
        });
      }
      continue;
    }

    /* ---- score points track ---- */
    if (inScore) {
      const cs = text.match(/^CS\s*(\d+)\s*X\s*(-?[\d.]+)\s*Y\s*(-?[\d.]+)\s*Q\s*([12])/i);
      if (cs) {
        plan.scorePlacements.push({
          shape: parseInt(cs[1]!, 10),
          x: num(cs[2]) ?? 0,
          y: num(cs[3]) ?? 0,
          orientation: cs[4] === "2" ? 2 : 1,
        });
        continue;
      }
      const move = parseMove(text);
      if (!move) continue;
      if (move.kind === "rapid") {
        scoreFrom = move.to;
        plan.score.push(move);
      } else {
        if (move.kind === "arc") move.center = resolveCenter(scoreFrom, move.to, move.center.x, move.center.y, move.radius, move.ccw);
        plan.score.push(move);
        scoreFrom = move.to;
      }
      continue;
    }

    /* ---- cuts description ---- */
    const rec = text.match(/^([A-Z])\s*(-?[\d.]+)(.*)$/);
    if (rec && LEVELS.some((l) => l.letter === rec[1])) {
      plan.nodes.push({ letter: rec[1]!, value: num(rec[2]) ?? 0, ...parsePieceArgs(rec[3] ?? "") });
    }
  }

  for (const s of plan.shapes.values()) {
    if (s.sx && s.sy && plan.length && plan.height && s.sx >= plan.length * 0.98 && s.sy >= plan.height * 0.98) {
      s.general = true;
    }
  }

  return plan;
}

/**
 * Absolute local path of a shape with arcs flattened, in millimetres.
 *
 * The file writes tenths of a millimetre, and an arc's centre is given
 * explicitly (`I`/`J` absolute in the shape frame), so the sweep is taken
 * about that centre rather than re-derived from radius + direction — otherwise
 * every arc would be traced the long way round.
 */
function shapePath(plan: PlanBlock, index: number): {
  pts: Point[];
  els: Array<Extract<TrackEl, { kind: "line" | "arc" }>>;
} | null {
  const def = plan.shapes.get(index);
  if (!def) return null;
  const els = def.els.filter((e): e is Extract<TrackEl, { kind: "line" | "arc" }> => e.kind !== "rapid");
  if (els.length === 0) return null;

  let origin: Point = { x: 0, y: 0 };
  const first = def.els[0]!;
  if (first.kind === "rapid") origin = first.to;

  // Sample in the file's own unit, then convert the finished outline once.
  const raw: Point[] = [origin];
  let cursor: Point = origin;
  for (const el of els) {
    if (el.kind === "line") {
      raw.push(el.to);
    } else {
      raw.push(...sampleArcAbout(el.center, cursor, el.to, el.radius, el.ccw, 24).slice(1));
    }
    cursor = el.to;
  }

  const pts: Point[] = raw.map((p) => ({ x: p.x / TENTHS, y: p.y / TENTHS }));
  return { pts, els };
}

/**
 * Rotate + fit a local outline (already in millimetres, from `shapePath`) into
 * `region`, and hand back the same mapping for the raw file coordinates so an
 * arc's centre lands where its arc really is.
 */
function fitMapper(local: readonly Point[], region: GuillotineRegion, rotationDeg: number): (p: Point) => Point {
  const map = shapeTransform(local, region, rotationDeg);
  // Raw file coordinates are still in tenths of a millimetre.
  return (p: Point) => map({ x: p.x / TENTHS, y: p.y / TENTHS });
}

/**
 * Emit a shape's cut segments inside `region` and return its outline.
 * Shape coordinates are local to the shape, so each vertex is placed relative
 * to the blank's own rectangle (and rotated 90° when `orientation` is 2).
 */
function emitShapeCuts(
  plan: PlanBlock,
  index: number,
  orientation: 1 | 2,
  region: GuillotineRegion,
  paneId: string | undefined,
  cuts: Cut[],
  nextSeq: () => number,
  stage: number,
  stageLabelText: string,
  warnings: string[],
  maxExtent: number,
  process?: string
): Point[] | null {
  const path = shapePath(plan, index);
  if (!path) return null;

  const rotation = orientation === 2 ? 90 : 0;
  // One mapping for the whole outline — fitting each point on its own would
  // re-derive the bounding box from a single vertex and collapse the shape.
  const place = fitMapper(path.pts, region, rotation);

  const outline: Point[] = [];
  let cursor = place(path.pts[0]!);
  outline.push(cursor);

  for (const el of path.els) {
    const target = place(el.to);
    if (el.kind === "line") {
      if (Math.abs(cursor.x - target.x) > 1e-6 || Math.abs(cursor.y - target.y) > 1e-6) {
        cuts.push({
          type: "line",
          points: [cursor, target],
          sequenceIndex: nextSeq(),
          stage,
          stageLabel: stageLabelText,
          paneRefs: paneId ? [paneId] : undefined,
          process,
        });
      }
      outline.push(target);
    } else {
      const radius = el.radius / TENTHS;
      const center = place(el.center);
      const chord = Math.hypot(target.x - cursor.x, target.y - cursor.y);
      // Some production files carry an arc record whose radius and endpoints are
      // orders of magnitude outside the blank (a "semicircle" 18,000 km across).
      // Tracing it would produce an absurd cut length, so drop the record.
      if (radius > maxExtent || chord > maxExtent * 2 || !Number.isFinite(radius) || !Number.isFinite(chord)) {
        warnings.push(
          `Shape ${index}: skipped an out-of-range arc (R ${(el.radius / TENTHS).toFixed(0)} mm, chord ${chord.toFixed(0)} mm) in a ${region.width.toFixed(0)}×${region.height.toFixed(0)} mm blank`
        );
        cursor = target;
        continue;
      }
      cuts.push({
        type: "arc",
        points: [cursor, target],
        center,
        radius,
        ccw: el.ccw,
        sequenceIndex: nextSeq(),
        stage,
        stageLabel: stageLabelText,
        paneRefs: paneId ? [paneId] : undefined,
          process,
      });
      outline.push(...sampleArcAbout(center, cursor, target, radius, el.ccw, 24).slice(1));
    }
    cursor = target;
  }

  return outline.length > 2 ? outline : null;
}

function buildSheet(plan: PlanBlock, sheetIndex: number, startSeq: number, warnings: string[]): CutPlan | null {
  if (!plan.length || !plan.height) return null;
  const sheetW = plan.length / TENTHS;
  const sheetH = plan.height / TENTHS;
  const trimX = (plan.trimX ?? 0) / TENTHS;
  const trimY = (plan.trimY ?? 0) / TENTHS;

  const walk = walkGuillotine(
    // Cut positions are written in tenths of a millimetre while the sheet and
    // the trim have already been converted to millimetres.
    plan.nodes.map((n) => ({ ...n, value: n.value / TENTHS })),
    LEVELS,
    { width: sheetW - trimX, height: sheetH - trimY },
    VENDOR,
    { x: trimX, y: trimY },
    startSeq
  );

  const cuts: Cut[] = [...walk.cuts];
  let seq = startSeq + walk.cuts.length;
  const nextSeq = () => seq++;

  const panes: Pane[] = [];
  const shapeStage = stageLabel(VENDOR, 3) ?? "Shape";
  // Nothing on a glass sheet can be larger than the sheet itself. Used to drop
  // arc records whose coordinates are corrupt by orders of magnitude.
  const shapeExtent = Math.max(sheetW, sheetH) * 2;

  walk.pieces.forEach((piece, i) => {
    const node = piece.node;
    const id = node.id ?? (node.shapeIndex !== undefined ? `s${node.shapeIndex}-${i + 1}` : `piece-${i + 1}`);
    const pane: Pane = {
      id,
      bounds: { ...piece.region },
      label: node.label,
      rackCode: node.rack,
    };
    if (node.shapeIndex !== undefined) {
      const placed = emitShapeCuts(plan, node.shapeIndex, node.shapeOrientation ?? 1, piece.region, id, cuts, nextSeq, 3, shapeStage, warnings, shapeExtent);
      if (placed && placed.length > 2) pane.polygon = placed;
    }
    panes.push(pane);
  });

  /* ---- score points (stage 4) ---- */
  const scoreStage = stageLabel(VENDOR, 4) ?? "Score";
  let scoreCursor: Point | null = null;
  const emitTrack = (els: TrackEl[], from: Point | null, stage: number, label: string) => {
    let cursor = from;
    for (const el of els) {
      const to: Point = { x: el.to.x / TENTHS, y: el.to.y / TENTHS };
      if (el.kind === "rapid") {
        cursor = to;
        continue;
      }
      if (cursor) {
        if (Math.abs(cursor.x - to.x) > 1e-6 || Math.abs(cursor.y - to.y) > 1e-6) {
          if (el.kind === "line") {
            cuts.push({ type: "line", points: [cursor, to], sequenceIndex: seq++, stage, stageLabel: label });
          } else {
            const center: Point = { x: el.center.x / TENTHS, y: el.center.y / TENTHS };
            cuts.push({
              type: "arc",
              points: [cursor, to],
              center,
              radius: el.radius / TENTHS,
              ccw: el.ccw,
              sequenceIndex: seq++,
              stage,
              stageLabel: label,
            });
          }
        }
      }
      cursor = to;
    }
    return cursor;
  };
  scoreCursor = emitTrack(plan.score, scoreCursor, 4, scoreStage);

  /* ---- low-E / TPF deletion (stage 6) ---- */
  const lowEStage = 6;
  const lowELabel = "Low-E";
  for (const placement of plan.lowE) {
    const path = shapePath(plan, placement.shape);
    if (!path) continue;
    // `CS<n>X<x>Y<y>` gives the point the deletion track starts from, so the
    // outline is anchored there (rotated for Q2) rather than centred on it.
    const rotation = placement.orientation === 2 ? 90 : 0;
    const anchor: Point = { x: placement.x / TENTHS, y: placement.y / TENTHS };
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const first = path.pts[0]!;
    const place = (p: Point): Point => ({
      x: anchor.x + (p.x - first.x) * cos - (p.y - first.y) * sin,
      y: anchor.y + (p.x - first.x) * sin + (p.y - first.y) * cos,
    });
    const box = boundsOf(path.pts.map(place));
    emitShapeCuts(plan, placement.shape, placement.orientation, box, undefined, cuts, nextSeq, lowEStage, lowELabel, warnings, shapeExtent, "LE");
  }

  return {
    id: `sheet-${sheetIndex + 1}`,
    label: plan.material ?? plan.comment.split(/[\\/]/).pop()?.trim(),
    sheet: { width: sheetW, height: sheetH, trims: { top: trimY, right: 0, bottom: trimY, left: trimX } },
    panes,
    cuts,
    coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
  };
}

/** True when the content looks like Turomas V30 rather than an Optima OPT file. */
export function looksLikeTuromasR01(content: string): boolean {
  return /^\s*P\d+\s*$/m.test(content) && /^\s*N\d+\s*$/m.test(content) && /^\s*H[\d.]+\s*$/m.test(content);
}

export function parseTuromasR01(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const plans = splitPlans(content);
  if (plans.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "No Turomas plan block found (expected a `P001` record)",
      detected: { vendor: VENDOR, formatId: "turomas-r01", confidence: "high", matchedSignal: "P001/N01/H/L" },
    };
  }

  const sheets: CutPlan[] = [];
  const materials = new Set<string>();
  let seq = 0;

  plans.forEach((raw, i) => {
    const plan = parsePlan(raw);
    if (plan.material) materials.add(plan.material);
    const sheet = buildSheet(plan, i, seq, warnings);
    if (!sheet) {
      warnings.push(`Plan ${plan.number || i + 1}: missing H (height) or L (length)`);
      return;
    }
    seq = sheet.cuts.reduce((n, c) => Math.max(n, (c.sequenceIndex ?? 0) + 1), seq);
    if (plan.shapes.size === 0 && plan.nodes.some((n) => n.shapeIndex !== undefined)) {
      warnings.push(`Plan ${plan.number || i + 1}: CS shape references without a DS description`);
    }
    for (const node of plan.nodes) {
      if (node.shapeIndex !== undefined && !plan.shapes.has(node.shapeIndex)) {
        warnings.push(`Plan ${plan.number || i + 1}: shape DS${node.shapeIndex} not described in this plan`);
      }
    }
    sheets.push(sheet);
  });

  if (sheets.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Turomas plan blocks found but none declared a sheet size (H/L)",
      detected: { vendor: VENDOR, formatId: "turomas-r01", confidence: "high", matchedSignal: "P001/N01/H/L" },
    };
  }

  const doc: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine: "Turomas",
      glassType: [...materials].join(" + ") || undefined,
      sourcePath,
      formatVersion: "V30",
    },
    sheets,
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document: doc,
    warnings,
    detected: { vendor: VENDOR, formatId: "turomas-r01", confidence: "high", matchedSignal: "P001/N01/H/L" },
  };
}