import type { Cut, CutDocument, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";

/**
 * Intermac Genius ISO programs (.CUT / .CNI).
 *
 * Sheet: E30000 is X in tenths of a millimetre when the field is >= 10000
 * (36600 → 3660 mm); E30001 is Y in millimetres; E30002 is thickness.
 * Straight scores: L6/L7 start, L13/L14 end, L8 heading, then G77H9030.
 * Shaped pieces: a local G01/G02/G03 path, placed by L6/L7 origin and L8
 * rotation (degrees) on the G77 shape call.
 */

type PathEl =
  | { kind: "line"; to: Point }
  | { kind: "arc"; to: Point; center: Point; radius: number; ccw: boolean };

type LocalShape = { start: Point; els: PathEl[] };
type Placement = { origin: Point; rotationDeg: number; id: string };

const VENDOR = "Intermac";
const FORMAT_ID = "intermac-cut";

function num(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/** X stock length is often stored in 0.1 mm (5-digit field). Y stays in mm. */
function axisMm(raw: number, tenths: boolean): number {
  if (tenths && raw >= 10000) return raw / 10;
  return raw;
}

function rotate(p: Point, deg: number): Point {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function place(p: Point, origin: Point, deg: number): Point {
  const q = rotate(p, deg);
  return { x: origin.x + q.x, y: origin.y + q.y };
}

function sampleArc(start: Point, center: Point, end: Point, ccw: boolean, segments = 24): Point[] {
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  let a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let a1 = Math.atan2(end.y - center.y, end.x - center.x);
  let sweep = a1 - a0;
  if (ccw && sweep <= 0) sweep += Math.PI * 2;
  if (!ccw && sweep >= 0) sweep -= Math.PI * 2;
  const pts: Point[] = [];
  for (let i = 1; i <= segments; i++) {
    const a = a0 + (sweep * i) / segments;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  pts[pts.length - 1] = end;
  return pts;
}

function resolveArc(start: Point, end: Point, i: number, j: number, ccw: boolean): { center: Point; radius: number } {
  const abs = { x: i, y: j };
  const rAbsStart = Math.hypot(start.x - abs.x, start.y - abs.y);
  const rAbsEnd = Math.hypot(end.x - abs.x, end.y - abs.y);
  if (rAbsStart > 0.1 && Math.abs(rAbsStart - rAbsEnd) <= Math.max(1, rAbsStart * 0.02)) {
    return { center: abs, radius: (rAbsStart + rAbsEnd) / 2 };
  }
  return { center: { x: start.x + i, y: start.y + j }, radius: Math.hypot(i, j) };
}

function bbox(points: Point[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function parseIntermacCut(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const text = content.replace(/\([^)]*\)/g, " ").replace(/\u0013/g, "");

  const e30000 = text.match(/E30000\s*=\s*(-?[\d.]+)/i);
  const e30001 = text.match(/E30001\s*=\s*(-?[\d.]+)/i);
  const e30002 = text.match(/E30002\s*=\s*(-?[\d.]+)/i);
  const glass = content.match(/\(\s*([A-Za-z][A-Za-z0-9 ._-]{2,40})\s*\)/);
  const program = content.match(/N1\s*\(([^)]+)\)/i)?.[1]?.trim();

  if (!e30000 || !e30001) {
    return {
      status: "failed",
      warnings,
      error: "Intermac ISO program is missing sheet size (E30000 / E30001)",
      detected: { vendor: VENDOR, formatId: FORMAT_ID, confidence: "high", matchedSignal: "E30000" },
    };
  }

  const sheetW = axisMm(num(e30000[1]), true);
  const sheetH = axisMm(num(e30001[1]), false);
  const thickness = e30002 ? num(e30002[1]) : undefined;

  const shapes: LocalShape[] = [];
  let current: LocalShape | null = null;
  let pos: Point | null = null;
  const regs = new Map<string, number>();

  const assign = (name: string, raw: string) => {
    const ref = raw.match(/^([EL])(\d+)$/i);
    if (ref) {
      regs.set(name.toUpperCase(), regs.get(ref[1].toUpperCase() + ref[2]) ?? 0);
      return;
    }
    regs.set(name.toUpperCase(), num(raw));
  };

  const ensureShape = (): LocalShape => {
    if (!current) {
      const start = { x: regs.get("L6") ?? 0, y: regs.get("L7") ?? 0 };
      current = { start, els: [] };
      pos = start;
      shapes.push(current);
    }
    return current;
  };

  // Statements: assignments and motion/macro words, in order.
  const stmt = /([EL]\d+\s*=\s*-?(?:[EL]\d+|[\d.]+))|(G0?[123](?!\d)[^G\n]*|G77H9030|G77H9000|EG100|G77N\d+N\d+)/gi;
  const cuts: Cut[] = [];
  const placements: Placement[] = [];
  let seq = 0;
  let shapeSeq = 0;

  const flushShape = () => {
    current = null;
    pos = null;
  };

  const tokens = [...text.matchAll(stmt)].map((m) => m[0].trim());
  for (const token of tokens) {
    const asg = token.match(/^([EL]\d+)\s*=\s*(-?(?:[EL]\d+|[\d.]+))$/i);
    if (asg) {
      assign(asg[1], asg[2]);
      continue;
    }

    if (/^G77H9000/i.test(token)) continue;
    if (/^EG100/i.test(token)) {
      flushShape();
      continue;
    }

    if (/^G77H9030/i.test(token)) {
      const x1 = regs.get("L6");
      const y1 = regs.get("L7");
      const x2 = regs.get("L13");
      const y2 = regs.get("L14");
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        warnings.push("G77H9030 score missing L6/L7/L13/L14");
        continue;
      }
      const vertical = Math.abs(x2 - x1) <= Math.abs(y2 - y1);
      const stage = vertical ? 1 : 2;
      cuts.push({
        type: "line",
        points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        sequenceIndex: seq++,
        stage,
        stageLabel: stageLabel(VENDOR, stage),
      });
      continue;
    }

    const call = token.match(/^G77N(\d+)N(\d+)/i);
    if (call) {
      const a = parseInt(call[1], 10);
      const b = parseInt(call[2], 10);
      // N12–N14 in this dialect is the sheet program, not a piece insert.
      if (a >= 12 && b >= 14 && regs.get("L6") === undefined) continue;
      const ox = regs.get("L6");
      const oy = regs.get("L7");
      if (ox === undefined || oy === undefined) continue;
      shapeSeq += 1;
      placements.push({
        origin: { x: ox, y: oy },
        rotationDeg: regs.get("L8") ?? 0,
        id: String(regs.get("L13") ?? shapeSeq),
      });
      continue;
    }

    const motion = token.match(/^G0?([123])(.*)$/i);
    if (!motion) continue;
    const code = motion[1];
    const rest = motion[2] ?? "";
    const x = rest.match(/X(-?[\d.]+)/i);
    const y = rest.match(/Y(-?[\d.]+)/i);
    if (!x || !y) continue;
    const to = { x: num(x[1]), y: num(y[1]) };
    const shape = ensureShape();
    if (code === "1") {
      shape.els.push({ kind: "line", to });
      pos = to;
      continue;
    }
    const iM = rest.match(/I(-?[\d.]+)/i);
    const jM = rest.match(/J(-?[\d.]+)/i);
    const start = pos ?? shape.start;
    const arc = resolveArc(start, to, iM ? num(iM[1]) : 0, jM ? num(jM[1]) : 0, code === "3");
    shape.els.push({ kind: "arc", to, center: arc.center, radius: arc.radius, ccw: code === "3" });
    pos = to;
  }

  const panes: Pane[] = [];

  placements.forEach((pl, i) => {
    const shape = shapes[i] ?? shapes[0];
    if (!shape || shape.els.length === 0) {
      warnings.push(`Shape call at (${pl.origin.x}, ${pl.origin.y}) has no G01/G02/G03 path`);
      return;
    }
    const outline: Point[] = [place(shape.start, pl.origin, pl.rotationDeg)];
    let cursor = shape.start;
    const stage = 3;
    for (const el of shape.els) {
      const a = place(cursor, pl.origin, pl.rotationDeg);
      const b = place(el.to, pl.origin, pl.rotationDeg);
      if (el.kind === "line") {
        cuts.push({
          type: "line",
          points: [a, b],
          sequenceIndex: seq++,
          stage,
          stageLabel: stageLabel(VENDOR, stage),
          paneRefs: [pl.id],
        });
        outline.push(b);
      } else {
        const center = place(el.center, pl.origin, pl.rotationDeg);
        cuts.push({
          type: "arc",
          points: [a, b],
          center,
          radius: el.radius,
          ccw: el.ccw,
          sequenceIndex: seq++,
          stage,
          stageLabel: stageLabel(VENDOR, stage),
          paneRefs: [pl.id],
        });
        outline.push(...sampleArc(a, center, b, el.ccw));
      }
      cursor = el.to;
    }
    panes.push({
      id: pl.id,
      bounds: bbox(outline),
      polygon: outline,
      label: program,
      glassInfo: glass?.[1]?.trim(),
    });
  });

  if (placements.length === 0) {
    for (const shape of shapes) {
      if (shape.els.length === 0) continue;
      const outline: Point[] = [shape.start];
      let cursor = shape.start;
      for (const el of shape.els) {
        if (el.kind === "line") outline.push(el.to);
        else outline.push(...sampleArc(cursor, el.center, el.to, el.ccw));
        cursor = el.to;
      }
      panes.push({ id: String(panes.length + 1), bounds: bbox(outline), polygon: outline });
    }
  }

  if (cuts.length === 0 && panes.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Intermac ISO program has no scores (G77H9030) or shape path (G01/G02/G03)",
      detected: { vendor: VENDOR, formatId: FORMAT_ID, confidence: "high", matchedSignal: "% / E30000" },
    };
  }

  const doc: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine: "Intermac ISO",
      glassType: glass?.[1]?.trim(),
      glassThickness: thickness && thickness < 100 ? thickness : undefined,
      sourcePath,
      formatVersion: program,
    },
    sheets: [{
      id: "sheet-1",
      label: program,
      sheet: { width: sheetW, height: sheetH },
      panes,
      cuts,
      coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
    }],
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document: doc,
    warnings,
    detected: { vendor: VENDOR, formatId: FORMAT_ID, confidence: "high", matchedSignal: "% / E30000 / G77" },
  };
}
