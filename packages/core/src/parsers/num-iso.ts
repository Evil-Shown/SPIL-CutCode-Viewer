import type { Cut, CutDocument, CutPlan, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";

/**
 * NUM ISO piece programs used by Bavelloni (REV 372 SR NUM 1040, Flexium Plus,
 * SYNCRO) and Intermac Genius tables. Same dialect as Glaston UC (NUM SYNCRO).
 *
 * Specs: 9.2.004.PPS.E (REV 372 SR / Flexium) and 9.2.011.PPS.E (SYNCRO).
 *
 * Header:
 *   %n                program number 0..3000 (a file may contain several)
 *   E30000            sheet X in tenths of a millimetre (always 0.1 mm)
 *   E30001            sheet Y in millimetres
 *   E30002            thickness in millimetres
 *   (NUM SYNCRO) / (NUM REV372 -SR ) / (NUM Flexium Plus)
 *
 * Straight scores: L6/L7 start, L13/L14 end, L8 heading, G77H9030.
 * Shapes: local G01/G02/G03 with origin at the centre of the containing square.
 *   G77N8N9 places that shape: L6/L7 = square centre on the sheet, L8 rotation,
 *   L13/L14 = N-label range of the shape block (N10–N11, N12–N13, …).
 * Low-E grind: G77H9039 / G77H9666 vertices / G77H9038.
 */

type PathEl =
  | { kind: "line"; to: Point }
  | { kind: "arc"; to: Point; center: Point; radius: number; ccw: boolean };

type LocalShape = { startN: number; endN?: number; start: Point; els: PathEl[] };

type Placement = { origin: Point; rotationDeg: number; startN: number; endN: number; id: string };

export type NumIsoIdentity = {
  vendor: string;
  formatId: "bavelloni-cut" | "intermac-cut";
  machine: string;
  ncComment?: string;
};

const STMT =
  /([EL]\d+\s*=\s*-?(?:[EL]\d+|[\d.]+))|(G0?[123](?!\d)[^G\n]*)|(G77H\d+)|(G77N\d+N\d+)|(EG100)|(?:^|[^A-Z])(N\d+)/gi;

export function identifyNumIso(content: string): NumIsoIdentity {
  const nc = content.match(/\(\s*(NUM\s+[A-Z0-9][A-Z0-9 ._+-]*)\s*\)/i)?.[1]?.trim();
  const upper = (nc ?? "").toUpperCase();

  if (/SYNCRO.*LOW|LOWE/.test(upper) || /NUM SYNCRO_LOWE/i.test(content)) {
    return { vendor: "Glaston", formatId: "bavelloni-cut", machine: "Glaston UC NUM SYNCRO", ncComment: nc };
  }
  if (/FLEXIUM/i.test(upper) || /NUM Flexium/i.test(content)) {
    return { vendor: "Bavelloni", formatId: "bavelloni-cut", machine: "Bavelloni REV 372 SR Flexium Plus", ncComment: nc };
  }
  if (/REV\s*372|REV372/.test(upper)) {
    return { vendor: "Bavelloni", formatId: "bavelloni-cut", machine: "Bavelloni REV 372 SR", ncComment: nc };
  }
  if (/SYNCRO/.test(upper)) {
    return { vendor: "Bavelloni", formatId: "bavelloni-cut", machine: "Bavelloni SYNCRO", ncComment: nc };
  }
  if (nc) {
    return { vendor: "Bavelloni", formatId: "bavelloni-cut", machine: `NUM ${nc.replace(/^NUM\s+/i, "")}`, ncComment: nc };
  }
  return { vendor: "Intermac", formatId: "intermac-cut", machine: "Intermac ISO" };
}

function num(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/** E30000 is always tenths of a millimetre (5-character field). */
function sheetXmm(raw: number): number {
  return raw / 10;
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

function splitPrograms(content: string): string[] {
  const parts = content.split(/(?=^%\d+)/m).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [content];
}

function stripComments(content: string): string {
  return content.replace(/\([^)]*\)/g, " ").replace(/\u0013/g, "");
}

function lookupShape(shapes: LocalShape[], startN: number, endN: number): LocalShape | undefined {
  return (
    shapes.find((s) => s.startN === startN) ??
    shapes.find((s) => s.startN >= startN && (s.endN ?? s.startN) <= endN) ??
    (shapes.length === 1 ? shapes[0] : undefined)
  );
}

function parseProgram(
  raw: string,
  identity: NumIsoIdentity,
  warnings: string[],
  sheetIndex: number
): CutPlan | null {
  const text = stripComments(raw);
  const e30000 = text.match(/E30000\s*=\s*(-?[\d.]+)/i);
  const e30001 = text.match(/E30001\s*=\s*(-?[\d.]+)/i);
  const glass = raw.match(/\(\s*([A-Za-z][A-Za-z0-9 ._-]{2,40})\s*\)/);
  const program = raw.match(/N1\s*\(([^)]+)\)/i)?.[1]?.trim();

  if (!e30000 || !e30001) return null;

  const sheetW = sheetXmm(num(e30000[1]));
  const sheetH = num(e30001[1]);
  const vendor = identity.vendor;
  const stageFor = (stage: number) => stageLabel(vendor, stage);

  const shapes: LocalShape[] = [];
  const cursor: { current: LocalShape | null; pos: Point | null; n: number } = {
    current: null,
    pos: null,
    n: 0,
  };
  const regs = new Map<string, number>();

  const assign = (name: string, rawVal: string) => {
    const ref = rawVal.match(/^([EL])(\d+)$/i);
    if (ref) {
      regs.set(name.toUpperCase(), regs.get(ref[1].toUpperCase() + ref[2]) ?? 0);
      return;
    }
    regs.set(name.toUpperCase(), num(rawVal));
  };

  const ensureShape = (): LocalShape => {
    if (!cursor.current) {
      const start = cursor.pos ?? { x: regs.get("L6") ?? 0, y: regs.get("L7") ?? 0 };
      cursor.current = { startN: cursor.n || 10, start, els: [] };
      cursor.pos = start;
      shapes.push(cursor.current);
    }
    return cursor.current;
  };

  const flushShape = () => {
    cursor.current = null;
    cursor.pos = null;
  };

  const cuts: Cut[] = [];
  const placements: Placement[] = [];
  let seq = 0;
  let shapeSeq = 0;
  let grindPos: Point | null = null;

  const pushGrind = (to: Point) => {
    if (grindPos && (Math.abs(grindPos.x - to.x) > 1e-6 || Math.abs(grindPos.y - to.y) > 1e-6)) {
      cuts.push({
        type: "line",
        points: [grindPos, to],
        sequenceIndex: seq++,
        stage: 6,
        stageLabel: "Low-E",
      });
    }
    grindPos = to;
  };

  const tokens = [...text.matchAll(STMT)].map((m) => {
    const token = (m[6] ?? m[0]).trim();
    return token.replace(/^[^A-Z0-9]+/i, "");
  });

  for (const token of tokens) {
    const nLabel = token.match(/^N(\d+)$/i);
    if (nLabel) {
      const n = parseInt(nLabel[1], 10);
      if (cursor.current && cursor.current.els.length > 0 && n !== cursor.current.startN) {
        cursor.current.endN = n;
        flushShape();
      }
      cursor.n = n;
      if (shapes.length) {
        const last = shapes[shapes.length - 1];
        if (last.endN === undefined && last !== cursor.current) last.endN = n;
      }
      continue;
    }

    const asg = token.match(/^([EL]\d+)\s*=\s*(-?(?:[EL]\d+|[\d.]+))$/i);
    if (asg) {
      assign(asg[1], asg[2]);
      continue;
    }

    if (/^EG100/i.test(token)) {
      flushShape();
      continue;
    }

    const macro = token.match(/^G77H(\d+)/i);
    if (macro) {
      const h = macro[1];
      if (h === "9001") {
        cursor.pos = { x: regs.get("L6") ?? 0, y: regs.get("L7") ?? 0 };
        if (!cursor.current) ensureShape();
        continue;
      }
      if (h === "9030") {
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
          stageLabel: stageFor(stage),
        });
        continue;
      }
      if (h === "9039") {
        grindPos = { x: regs.get("L6") ?? 0, y: regs.get("L7") ?? 0 };
        continue;
      }
      if (h === "9666") {
        pushGrind({ x: regs.get("L6") ?? 0, y: regs.get("L7") ?? 0 });
        continue;
      }
      if (h === "9038") {
        grindPos = null;
        continue;
      }
      continue;
    }

    const call = token.match(/^G77N(\d+)N(\d+)/i);
    if (call) {
      const a = parseInt(call[1], 10);
      const b = parseInt(call[2], 10);
      // Spec: shape insert is always G77N8N9. N10–N12 / N14–N16 are jumps to the cut list.
      if (a !== 8 || b !== 9) continue;
      const ox = regs.get("L6");
      const oy = regs.get("L7");
      if (ox === undefined || oy === undefined) continue;
      shapeSeq += 1;
      placements.push({
        origin: { x: ox, y: oy },
        rotationDeg: regs.get("L8") ?? 0,
        startN: regs.get("L13") ?? 10,
        endN: regs.get("L14") ?? 11,
        id: String(shapeSeq),
      });
      continue;
    }

    const motion = token.match(/^G0?([123])(.*)$/i);
    if (!motion) continue;
    const code = motion[1];
    const rest = motion[2] ?? "";
    const xM = rest.match(/X(-?[\d.]+)/i);
    const yM = rest.match(/Y(-?[\d.]+)/i);
    if (!xM && !yM) continue;
    const startPt: Point = cursor.pos ?? { x: regs.get("L6") ?? 0, y: regs.get("L7") ?? 0 };
    const to: Point = {
      x: xM ? num(xM[1]) : startPt.x,
      y: yM ? num(yM[1]) : startPt.y,
    };
    const shape = ensureShape();
    if (code === "1") {
      shape.els.push({ kind: "line", to });
      cursor.pos = to;
      continue;
    }
    const iM = rest.match(/I(-?[\d.]+)/i);
    const jM = rest.match(/J(-?[\d.]+)/i);
    const arc = resolveArc(startPt, to, iM ? num(iM[1]) : 0, jM ? num(jM[1]) : 0, code === "3");
    shape.els.push({ kind: "arc", to, center: arc.center, radius: arc.radius, ccw: code === "3" });
    cursor.pos = to;
  }
  flushShape();

  const panes: Pane[] = [];
  const glassInfo = glass?.[1]?.trim();

  const emitShape = (shape: LocalShape, pl: Placement | { origin: Point; rotationDeg: number; id: string }) => {
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
          stageLabel: stageFor(stage),
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
          stageLabel: stageFor(stage),
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
      glassInfo,
    });
  };

  for (const pl of placements) {
    const shape = lookupShape(shapes, pl.startN, pl.endN);
    if (!shape || shape.els.length === 0) {
      warnings.push(`Shape N${pl.startN}–N${pl.endN} at (${pl.origin.x}, ${pl.origin.y}) has no G01/G02/G03 path`);
      continue;
    }
    emitShape(shape, pl);
  }

  if (placements.length === 0) {
    for (const shape of shapes) {
      if (shape.els.length === 0) continue;
      emitShape(shape, { origin: { x: 0, y: 0 }, rotationDeg: 0, id: String(panes.length + 1) });
    }
  }

  if (cuts.length === 0 && panes.length === 0) return null;

  return {
    id: `sheet-${sheetIndex + 1}`,
    label: program,
    sheet: { width: sheetW, height: sheetH },
    panes,
    cuts,
    coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
  };
}

export function parseNumIso(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const identity = identifyNumIso(content);
  const programs = splitPrograms(content);
  const sheets: CutPlan[] = [];

  programs.forEach((prog, i) => {
    const plan = parseProgram(prog, identity, warnings, i);
    if (plan) sheets.push(plan);
  });

  if (sheets.length === 0) {
    const hasHeader = /E30000\s*=/.test(content);
    return {
      status: "failed",
      warnings,
      error: hasHeader
        ? `${identity.machine} program has no scores (G77H9030), shape path (G01/G02/G03) or Low-E grind (G77H9666)`
        : `${identity.machine} program is missing sheet size (E30000 / E30001)`,
      detected: {
        vendor: identity.vendor,
        formatId: identity.formatId,
        confidence: "high",
        matchedSignal: identity.ncComment ?? "% / E30000",
      },
    };
  }

  const first = programs[0] ?? content;
  const e30002 = first.match(/E30002\s*=\s*(-?[\d.]+)/i);
  const thickness = e30002 ? num(e30002[1]) : undefined;
  const glass = content.match(/\(\s*([A-Za-z][A-Za-z0-9 ._-]{2,40})\s*\)/);
  const program = content.match(/N1\s*\(([^)]+)\)/i)?.[1]?.trim();

  const doc: CutDocument = {
    metadata: {
      vendor: identity.vendor,
      machine: identity.machine,
      glassType: glass?.[1]?.trim(),
      glassThickness: thickness !== undefined && thickness < 100 ? thickness : undefined,
      sourcePath,
      formatVersion: program,
    },
    sheets,
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document: doc,
    warnings,
    detected: {
      vendor: identity.vendor,
      formatId: identity.formatId,
      confidence: "high",
      matchedSignal: identity.ncComment ?? "% / E30000 / G77",
    },
  };
}

export function parseIntermacCut(content: string, sourcePath: string): ParseResult {
  return parseNumIso(content, sourcePath);
}

export function parseBavelloniCut(content: string, sourcePath: string): ParseResult {
  return parseNumIso(content, sourcePath);
}
