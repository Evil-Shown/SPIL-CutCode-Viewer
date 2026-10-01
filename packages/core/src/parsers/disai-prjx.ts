import type { Cut, CutDocument, CutPlan, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";
import { arcCenterDirected, sampleArcDirected } from "../geometry/arc.js";
import { walkGuillotine, type GuillotineLevel, type GuillotineNode, type GuillotineRegion } from "../geometry/guillotine.js";

/**
 * Disai PRJX machine code (HBT Studio, "PRJX Machine Code Specification",
 * Ver 2023.5.17).
 *
 * A PRJX job is a folder `name.prjx` holding `name.sum` and one
 * `name-00x.dst` per pattern:
 *
 *   name.sum   [SUMINFO] CVERSION, DIMENSION, DATE, VONDER
 *              [PRJXINFO] QUANTITY, DIMENX, PATTERNX
 *              [DIMEN1..n] WIDTH, HEIGHT, THICK, GCLR, QNTY, OTHERS
 *
 *   name-001.dst
 *     [PATTERN] GID, PTNORDER, GDESCRIPTION, GSTRUCTURED, GCOATED, REPEAT,
 *               GCLR, GTHICKNESS, WIDTH, HEIGHT, TRIMLEFT, TRIMBOTTOM,
 *               BORDERTOP, BORDERRIGHT
 *     [SCHEME]  X Y Z U V W R S T  cut levels, each optionally followed by
 *               C (continuous), D (discontinuous), DBx (shape data) or
 *               IBx (glass piece block). Coordinates are relative to the
 *               previous cut of the same level and referenced to the pattern's
 *               zero point (TRIMLEFT, TRIMBOTTOM). The specification states
 *               tenths of a millimetre, but the sample programs write plain
 *               millimetres (a 3660 sheet with 500 mm pieces), so the files are
 *               read as millimetres — see TENTHS.
 *     [BREAKLN] x1 y1 x2 y2   auxiliary (explicit) cut lines
 *     [DBn]     shape details, relative to the round box's lower-left corner:
 *               `x1 y1 x2 y2 C LS` line segment,
 *               `x1 y1 OX OY A R C CR` arc (A > 0 counter-clockwise),
 *               `OX OY R D CO` full circle
 *     [IBn]     glass piece detail: ID, ORDER, PRJNAME, CUSTOMER, BARCODE,
 *               CLASSIFY (1 product, 0 residue), CTIMES, WIDTH, HEIGHT,
 *               ROTATE, DESCRIBE, RACK, GRIND*, NOTE1..9
 */

const VENDOR = "Disai";

/** Unit divisor applied to every coordinate in the file. */
const TENTHS = 1;

/**
 * Level letters and their direction, from the SCHEME table: X/Y/Z/U/V/W/R/S/T
 * alternate vertical and horizontal, starting vertical.
 */
const LEVELS: GuillotineLevel[] = [
  { letter: "X", axis: "X" },
  { letter: "Y", axis: "Y" },
  { letter: "Z", axis: "X" },
  { letter: "U", axis: "Y" },
  { letter: "V", axis: "X" },
  { letter: "W", axis: "Y" },
  { letter: "R", axis: "X" },
  { letter: "S", axis: "Y" },
  { letter: "T", axis: "X" },
];


function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** `Z500.0 IB1`, `U500.0 IB2501`, `Z1000.0` */
const LEVEL_RE = /^([A-Z])\s*(-?[\d.]+)\s*(C|D)?\s*(DB|IB)?\s*(\d+)?\s*$/i;

type ShapeEl =
  | { kind: "line"; to: Point }
  | { kind: "arc"; to: Point; center: Point; radius: number; ccw: boolean }
  | { kind: "circle"; center: Point; radius: number };

type ShapeDef = {
  id: number;
  description?: string;
  sx?: number;
  sy?: number;
  els: ShapeEl[];
};

type PieceBlock = {
  id: string;
  customer?: string;
  order?: string;
  barcode?: string;
  classify: number;
  qty?: number;
  width: number;
  height: number;
  rotate: number;
  rack?: string;
  notes: string[];
};

function parseSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      current = sec[1]!.toUpperCase();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) {
      const bucket = sections.get(current)!;
      bucket.push(line);
    }
  }
  return sections;
}

function kv(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) map.set(m[1]!.toUpperCase(), m[2]!.trim());
  }
  return map;
}

function parseShapeLines(lines: string[]): ShapeDef {
  const shape: ShapeDef = { id: 0, els: [] };
  let from: Point = { x: 0, y: 0 };
  for (const line of lines) {
    const sid = line.match(/^SID\s*=\s*(\d+)/i);
    if (sid) {
      shape.id = parseInt(sid[1]!, 10);
      continue;
    }
    const desc = line.match(/^SDESCRIPTION\s*=\s*(.*)$/i);
    if (desc) {
      shape.description = desc[1]!.trim();
      continue;
    }
    if (/^\d/.test(line)) {
      const parts = line.split(/\s+/);
      // OX OY R D CO — full circle
      if (parts.length === 5 && parts[4]!.toUpperCase() === "CO") {
        shape.els.push({
          kind: "circle",
          center: { x: num(parts[0]) ?? 0, y: num(parts[1]) ?? 0 },
          radius: num(parts[2]) ?? 0,
        });
        continue;
      }
      // x1 y1 OX OY A R C CR — arc
      if (parts.length === 8 && parts[7]!.toUpperCase() === "CR") {
        const x1 = num(parts[0]) ?? 0;
        const y1 = num(parts[1]) ?? 0;
        const ox = num(parts[2]) ?? 0;
        const oy = num(parts[3]) ?? 0;
        const angle = num(parts[4]) ?? 0;
        const r = num(parts[5]) ?? 0;
        const ccw = angle >= 0;
        const to = pointOnCircle({ x: ox, y: oy }, r, Math.atan2(y1 - oy, x1 - ox), ccw);
        shape.els.push({ kind: "arc", to, center: { x: ox, y: oy }, radius: r, ccw });
        from = to;
        continue;
      }
      // x1 y1 x2 y2 C LS — line segment
      if (parts.length === 6 && parts[5]!.toUpperCase() === "LS") {
        const to = { x: num(parts[2]) ?? from.x, y: num(parts[3]) ?? from.y };
        shape.els.push({ kind: "line", to });
        from = to;
        continue;
      }
      // x1 y1 OX OY A R C — arc without the CR suffix (sample variant)
      if (parts.length === 7 && parts[6]!.toUpperCase() === "CR") {
        const x1 = num(parts[0]) ?? 0;
        const y1 = num(parts[1]) ?? 0;
        const ox = num(parts[2]) ?? 0;
        const oy = num(parts[3]) ?? 0;
        const angle = num(parts[4]) ?? 0;
        const r = num(parts[5]) ?? 0;
        const ccw = angle >= 0;
        const to = pointOnCircle({ x: ox, y: oy }, r, Math.atan2(y1 - oy, x1 - ox), ccw);
        shape.els.push({ kind: "arc", to, center: { x: ox, y: oy }, radius: r, ccw });
        from = to;
        continue;
      }
    }
  }
  return shape;
}

function pointOnCircle(center: Point, r: number, angle: number, ccw: boolean): Point {
  // No end angle is written, so the arc is treated as a quarter turn in the
  // direction indicated by the sign of A.
  const sweep = ccw ? Math.PI / 2 : -Math.PI / 2;
  const a = angle + sweep;
  return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
}

function parsePieceBlock(lines: string[]): PieceBlock {
  const map = kv(lines);
  const notes: string[] = [];
  for (let i = 1; i <= 9; i++) {
    const v = map.get(`NOTE${i}`);
    if (v) notes.push(v);
  }
  return {
    id: map.get("ID") ?? "",
    customer: map.get("CUSTOMER"),
    order: map.get("ORDER"),
    barcode: map.get("BARCODE"),
    classify: parseInt(map.get("CLASSIFY") ?? "1", 10),
    qty: num(map.get("CTIMES")),
    width: num(map.get("WIDTH")) ?? 0,
    height: num(map.get("HEIGHT")) ?? 0,
    rotate: parseInt(map.get("ROTATE") ?? "0", 10),
    rack: map.get("RACK"),
    notes,
  };
}

export function parseDisaiPrjx(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const sections = parseSections(content);

  const patternKv = kv(sections.get("PATTERN") ?? []);
  const sheetW = num(patternKv.get("WIDTH"));
  const sheetH = num(patternKv.get("HEIGHT"));
  const thickness = num(patternKv.get("GTHICKNESS"));
  const trimLeft = num(patternKv.get("TRIMLEFT")) ?? 0;
  const trimBottom = num(patternKv.get("TRIMBOTTOM")) ?? 0;
  const glassColor = patternKv.get("GCLR");
  const gid = patternKv.get("GID");

  if (!sheetW || !sheetH) {
    const sum = kv(sections.get("DIMEN1") ?? []);
    const w = num(sum.get("WIDTH"));
    const h = num(sum.get("HEIGHT"));
    if (!w || !h) {
      return {
        status: "failed",
        warnings,
        error: "Disai PRJX file declares no sheet size ([PATTERN] WIDTH/HEIGHT or [DIMEN1])",
        detected: { vendor: VENDOR, formatId: "disai-prjx", confidence: "high", matchedSignal: "[PATTERN]" },
      };
    }
    return buildFromSum(content, sourcePath, warnings);
  }

  /* ---- shapes and pieces ---- */
  const shapes = new Map<number, ShapeDef>();
  for (const [name, lines] of sections) {
    const db = name.match(/^DB(\d+)$/);
    if (db) {
      const shape = parseShapeLines(lines);
      shape.id = parseInt(db[1]!, 10);
      shapes.set(shape.id, shape);
    }
  }

  const pieces = new Map<number, PieceBlock>();
  for (const [name, lines] of sections) {
    const ib = name.match(/^IB(\d+)$/);
    if (ib) pieces.set(parseInt(ib[1]!, 10), parsePieceBlock(lines));
  }

  /* ---- [SCHEME] → guillotine nodes ---- */
  const nodes: GuillotineNode[] = [];
  for (const line of sections.get("SCHEME") ?? []) {
    const m = line.match(LEVEL_RE);
    if (!m) continue;
    const letter = m[1]!.toUpperCase();
    if (!LEVELS.some((l) => l.letter === letter)) continue;
    const value = num(m[2]);
    if (value === undefined) continue;
    const kind = (m[4] ?? "").toUpperCase();
    const order = m[5] ? parseInt(m[5], 10) : undefined;
    if (kind === "IB" && order !== undefined) {
      const piece = pieces.get(order);
      nodes.push({
        letter,
        value,
        id: piece?.id || `IB${order}`,
        label: piece ? [piece.customer, ...piece.notes].filter((s) => s && s.length > 0).join(" · ") || undefined : undefined,
        rack: piece?.rack,
        shapeIndex: undefined,
      });
    } else if (kind === "DB" && order !== undefined) {
      nodes.push({ letter, value, shapeIndex: order });
    } else {
      nodes.push({ letter, value });
    }
  }

  /* ---- explicit break lines ---- */
  const cuts: Cut[] = [];
  const panes: Pane[] = [];
  let seq = 0;

  const walk = walkGuillotine(
    nodes,
    LEVELS,
    { width: sheetW - trimLeft / TENTHS, height: sheetH - trimBottom / TENTHS },
    VENDOR,
    { x: trimLeft / TENTHS, y: trimBottom / TENTHS }
  );
  cuts.push(...walk.cuts);
  warnings.push(...walk.warnings);
  seq = walk.cuts.reduce((n, c) => Math.max(n, (c.sequenceIndex ?? 0) + 1), 0);

  const nextSeq = () => seq++;

  const shapeOutlines = new Map<string, Point[]>();
  walk.pieces.forEach((piece, i) => {
    const id = piece.node.id ?? `piece-${i + 1}`;
    const pane: Pane = {
      id,
      bounds: { ...piece.region },
      label: piece.node.label,
      rackCode: piece.node.rack,
    };
    if (piece.node.shapeIndex !== undefined) {
      const shape = shapes.get(piece.node.shapeIndex);
      if (shape) {
        const placed = emitShape(shape, piece.region, pane.id, cuts, nextSeq);
        if (placed && placed.length > 2) {
          pane.polygon = placed;
          shapeOutlines.set(id, placed);
        }
      } else {
        warnings.push(`Shape DB${piece.node.shapeIndex} is referenced but not defined`);
      }
    }
    panes.push(pane);
  });

  // [BREAKLN] gives the exact break lines; use them when present since they are
  // absolute sheet coordinates.
  const breakLines = (sections.get("BREAKLN") ?? []).filter((l) => /^-?[\d.]/.test(l));
  if (breakLines.length > 0) {
    cuts.length = 0;
    seq = 0;
    for (const line of breakLines) {
      const p = line.trim().split(/\s+/).map((s) => num(s) ?? 0);
      if (p.length < 4) continue;
      const a: Point = { x: p[0]! / TENTHS, y: p[1]! / TENTHS };
      const b: Point = { x: p[2]! / TENTHS, y: p[3]! / TENTHS };
      const vertical = Math.abs(a.x - b.x) < 0.01;
      const stage = vertical ? 1 : 2;
      cuts.push({
        type: "line",
        points: [a, b],
        sequenceIndex: seq++,
        stage,
        stageLabel: stageLabel(VENDOR, stage) ?? (vertical ? "X" : "Y"),
      });
    }
  } else {
    // Assign the pane outlines to the closest break line so cut selection works.
    for (const pane of panes) {
      const outline = shapeOutlines.get(pane.id);
      if (!outline) continue;
      paneRefsForOutline(cuts, outline, pane.id);
    }
  }

  if (cuts.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Disai PRJX pattern contains neither [SCHEME] levels nor [BREAKLN] lines",
      detected: { vendor: VENDOR, formatId: "disai-prjx", confidence: "high", matchedSignal: "[PATTERN]" },
    };
  }

  const sheet: CutPlan = {
    id: "sheet-1",
    label: gid,
    sheet: {
      width: sheetW,
      height: sheetH,
      trims: { top: trimBottom / TENTHS, right: 0, bottom: trimBottom / TENTHS, left: trimLeft / TENTHS },
    },
    panes,
    cuts,
    coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
  };

  const document: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine: "Disai / HBT Studio",
      glassThickness: thickness,
      glassType: glassColor,
      sourcePath,
      formatVersion: kv(sections.get("SUMINFO") ?? []).get("CVERSION"),
    },
    sheets: [sheet],
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document,
    warnings,
    detected: { vendor: VENDOR, formatId: "disai-prjx", confidence: "high", matchedSignal: "[PATTERN]" },
  };
}

function paneRefsForOutline(cuts: Cut[], outline: Point[], paneId: string): void {
  for (const cut of cuts) {
    const inside = cut.points.some(
      (p) => p.x >= outline[0]!.x - 1 && p.x <= Math.max(...outline.map((o) => o.x)) + 1
    );
    if (inside && !cut.paneRefs) cut.paneRefs = [paneId];
  }
}

function emitShape(
  shape: ShapeDef,
  region: GuillotineRegion,
  paneId: string,
  cuts: Cut[],
  nextSeq: () => number
): Point[] | null {
  const stage = 3;
  const label = stageLabel(VENDOR, 3) ?? "Shape";
  const outline: Point[] = [];
  let cursor: Point = { x: region.x, y: region.y };

  for (const el of shape.els) {
    if (el.kind === "circle") {
      const start: Point = { x: el.center.x + el.radius, y: el.center.y };
      const end: Point = { x: el.center.x - el.radius, y: el.center.y };
      cuts.push({
        type: "arc",
        points: [start, end],
        center: el.center,
        radius: el.radius,
        ccw: true,
        sequenceIndex: nextSeq(),
        stage,
        stageLabel: label,
        paneRefs: [paneId],
      });
      outline.push(...sampleArcDirected(start, end, el.radius, true, 32));
      cursor = end;
      continue;
    }
    if (el.kind === "line") {
      if (Math.abs(cursor.x - el.to.x) > 1e-6 || Math.abs(cursor.y - el.to.y) > 1e-6) {
        cuts.push({
          type: "line",
          points: [cursor, el.to],
          sequenceIndex: nextSeq(),
          stage,
          stageLabel: label,
          paneRefs: [paneId],
        });
      }
      outline.push(el.to);
      cursor = el.to;
      continue;
    }
    const center = arcCenterDirected(cursor, el.to, el.radius, el.ccw);
    cuts.push({
      type: "arc",
      points: [cursor, el.to],
      center,
      radius: el.radius,
      ccw: el.ccw,
      sequenceIndex: nextSeq(),
      stage,
      stageLabel: label,
      paneRefs: [paneId],
    });
    outline.push(...sampleArcDirected(cursor, el.to, el.radius, el.ccw, 24).slice(1));
    cursor = el.to;
  }

  return outline.length > 2 ? outline : null;
}

/** `.sum`-only jobs (no pattern file): sheet stock without a layout. */
function buildFromSum(content: string, sourcePath: string, warnings: string[]): ParseResult {
  const sections = parseSections(content);
  const sumKv = kv(sections.get("SUMINFO") ?? []);
  const dims: Array<{ w: number; h: number; thick?: number; qty?: number; color?: string }> = [];
  for (const [name, lines] of sections) {
    const d = name.match(/^DIMEN(\d+)$/);
    if (!d) continue;
    const m = kv(lines);
    dims.push({
      w: num(m.get("WIDTH")) ?? 0,
      h: num(m.get("HEIGHT")) ?? 0,
      thick: num(m.get("THICK")),
      qty: num(m.get("QNTY")),
      color: m.get("GCLR"),
    });
  }

  const sheets: CutPlan[] = dims
    .filter((d) => d.w > 0 && d.h > 0)
    .map((d, i) => ({
      id: `sheet-${i + 1}`,
      label: d.color || `Stock ${i + 1}`,
      sheet: { width: d.w, height: d.h },
      panes: [],
      cuts: [],
      coordinateSemantics: { origin: "bottom-left" as const, xAxis: "right" as const, units: "mm" as const },
    }));

  if (sheets.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Disai PRJX summary file declares no usable [DIMENn] sheet sizes",
      detected: { vendor: VENDOR, formatId: "disai-prjx", confidence: "high", matchedSignal: "[SUMINFO]" },
    };
  }

  warnings.push("Summary file only — sheet stock without a cutting layout (open the .dst pattern file)");

  return {
    status: "partial",
    warnings,
    document: {
      metadata: {
        vendor: VENDOR,
        machine: "Disai / HBT Studio",
        formatVersion: sumKv.get("CVERSION"),
        date: sumKv.get("DATE"),
        sourcePath,
      },
      sheets,
    },
    detected: { vendor: VENDOR, formatId: "disai-prjx", confidence: "high", matchedSignal: "[SUMINFO]" },
  };
}