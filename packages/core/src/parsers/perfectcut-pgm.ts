import type { Cut, CutDocument, CutPlan, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";
import { arcCenterDirected, sampleArcDirected } from "../geometry/arc.js";

/**
 * Perfect Cut / Lampo-CSM .PGM cutcode ("Ott. <NAME> by Perfect Cut - RO").
 *
 * Used by Lampo CSM, LAMPO-Simple and LAMPO-Curved Shapes jobs. Records:
 *
 *   P010                       plan number
 *   /Ott. <name> by Perfect Cut - RO     free-text comment
 *   N01                        repetitions
 *   H2440.00                   sheet height, millimetres
 *   L3660.00                   sheet length, millimetres
 *   T 6.00                     thickness, millimetres
 *   R 00                       reserved / machine flag
 *   DS 45 … ES                 shape definition (id, optional SX/SY, G-code path)
 *   G X a Y b                  rapid, no cutting head
 *   G1 X a Y b                 straight score, cutting head applied
 *   G2/G3 X a Y b I i J j R r  clockwise / anticlockwise arc
 *   CS<n> X a Y b A<0|90>      place shape <n> at (a,b), rotated by A
 *
 * The coordinates are already the absolute tool path — the G/G1 pairs are the
 * scores themselves, so no guillotine reconstruction is needed. Shape tracks
 * are absolute too and are instanced by the CS records.
 */

const VENDOR = "Perfect Cut";

type ShapeDef = {
  id: number;
  sx?: number;
  sy?: number;
  path: Array<{ kind: "rapid" | "line" | "arc"; to: Point; center?: Point; radius?: number; ccw?: boolean }>;
};

type Placement = { shape: number; x: number; y: number; angle: number };

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function parseMove(text: string): ShapeDef["path"][number] | null {
  // `G X 1.00 Y 499.90` (rapid), `G1 X …` (score), `G2/G3 X … I … J … R …`.
  const m = text.match(
    /^G\s*([0-3])?\s*X\s*(-?[\d.]+)\s*Y\s*(-?[\d.]+)(?:\s*I\s*(-?[\d.]+))?(?:\s*J\s*(-?[\d.]+))?(?:\s*R\s*(-?[\d.]+))?/i
  );
  if (!m) return null;
  const code = m[1] ?? "0";
  const to: Point = { x: parseFloat(m[2]!), y: parseFloat(m[3]!) };
  if (code === "0") return { kind: "rapid", to };
  if (code === "1") return { kind: "line", to };
  const i = num(m[4]) ?? 0;
  const j = num(m[5]) ?? 0;
  const r = num(m[6]) ?? Math.hypot(i, j);
  return { kind: "arc", to, center: { x: i, y: j }, radius: r, ccw: code === "3" };
}

/** True when the content is a Perfect Cut RO / PGM cutcode. */
export function looksLikePgm(content: string): boolean {
  return /^\s*P\d+\s*$/m.test(content) && /^\s*H[\d.]+\s*$/m.test(content) && /^\s*L[\d.]+\s*$/m.test(content) && /by Perfect Cut/i.test(content);
}

/** Strip a trailing `- explanation` comment from a record. */
function withoutComment(text: string): string {
  return text.replace(/\s+-\s+[^-]*$/, "").trim();
}

export function parsePerfectCutPgm(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];

  const shapes = new Map<number, ShapeDef>();
  const cuts: Cut[] = [];
  const placements: Placement[] = [];
  const panes: Pane[] = [];

  let planNumber = "";
  let comment = "";
  let repetitions = 1;
  let height: number | undefined;
  let length: number | undefined;
  let thickness: number | undefined;
  let machineFlag: string | undefined;

  let shape: ShapeDef | null = null;
  let shapeFrom: Point = { x: 0, y: 0 };
  let toolFrom: Point | null = null;
  let seq = 0;

  for (const line of content.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;

    if (/^P\d+$/.test(raw)) {
      planNumber = raw.slice(1);
      continue;
    }
    if (raw.startsWith("/")) {
      comment = raw.slice(1).trim();
      continue;
    }

    const text = withoutComment(raw);

    if (/^N\d+$/.test(text)) {
      repetitions = parseInt(text.slice(1), 10) || 1;
      continue;
    }
    if (/^H[\d.]+$/i.test(text)) {
      height = num(text.slice(1));
      continue;
    }
    if (/^L[\d.]+$/i.test(text)) {
      length = num(text.slice(1));
      continue;
    }
    if (/^T\s*[\d.]+$/i.test(text)) {
      thickness = num(text.slice(1).trim());
      continue;
    }
    if (/^R\s*[\d.]+$/i.test(text)) {
      machineFlag = text.slice(1).trim();
      continue;
    }

    const ds = text.match(/^DS\s*(\d+)$/i);
    if (ds) {
      shape = { id: parseInt(ds[1]!, 10), path: [] };
      shapes.set(shape.id, shape);
      shapeFrom = { x: 0, y: 0 };
      continue;
    }
    if (text === "ES") {
      shape = null;
      continue;
    }

    const cs = text.match(/^CS\s*(\d+)\s*X\s*(-?[\d.]+)\s*Y\s*(-?[\d.]+)\s*A\s*(-?[\d.]+)/i);
    if (cs) {
      placements.push({
        shape: parseInt(cs[1]!, 10),
        x: num(cs[2]) ?? 0,
        y: num(cs[3]) ?? 0,
        angle: num(cs[4]) ?? 0,
      });
      continue;
    }

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
        shape.path.push(move);
        continue;
      }
      if (move.kind === "arc" && move.center) {
        move.center = resolveCenter(shapeFrom, move.to, move.center.x, move.center.y);
      }
      shape.path.push(move);
      shapeFrom = move.to;
      continue;
    }

    /* ---- free tool path outside any DS block ---- */
    const move = parseMove(text);
    if (!move) continue;
    if (move.kind === "rapid") {
      toolFrom = move.to;
      continue;
    }
    const to = move.to;
    const from = toolFrom ?? to;
    if (Math.abs(from.x - to.x) > 1e-6 || Math.abs(from.y - to.y) > 1e-6) {
      if (move.kind === "line") {
        const vertical = Math.abs(to.x - from.x) < 0.01;
        const stage = vertical ? 1 : 2;
        cuts.push({
          type: "line",
          points: [from, to],
          sequenceIndex: seq++,
          stage,
          stageLabel: stageLabel(VENDOR, stage) ?? (vertical ? "X" : "Y"),
        });
      } else {
        cuts.push({
          type: "arc",
          points: [from, to],
          center: move.center ?? { x: from.x, y: from.y },
          radius: move.radius ?? Math.hypot(to.x - from.x, to.y - from.y),
          ccw: move.ccw,
          sequenceIndex: seq++,
          stage: 3,
          stageLabel: stageLabel(VENDOR, 3),
        });
      }
    }
    toolFrom = to;
  }

  /* ---- instanced shapes ---- */
  for (const pl of placements) {
    const def = shapes.get(pl.shape);
    if (!def) {
      warnings.push(`Shape DS${pl.shape} is placed by a CS record but not defined`);
      continue;
    }
    const rotation = ((pl.angle % 360) + 360) % 360;
    const origin = { x: pl.x, y: pl.y };
    const paneId = `s${pl.shape}-${panes.length + 1}`;
    let cursor = origin;
    const polygon: Point[] = [];

    const place = (p: Point): Point => {
      // The DS path is relative to the placement origin recorded by the CS record.
      const r = (rotation * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      return { x: origin.x + p.x * c - p.y * s, y: origin.y + p.x * s + p.y * c };
    };

    for (const el of def.path) {
      const to = place(el.to);
      if (el.kind === "rapid") {
        cursor = to;
        polygon.push(to);
        continue;
      }
      if (el.kind === "line") {
        if (Math.abs(cursor.x - to.x) > 1e-6 || Math.abs(cursor.y - to.y) > 1e-6) {
          cuts.push({
            type: "line",
            points: [cursor, to],
            sequenceIndex: seq++,
            stage: 3,
            stageLabel: stageLabel(VENDOR, 3),
            paneRefs: [paneId],
          });
        }
        polygon.push(to);
      } else {
        const r = el.radius ?? 0;
        const ccw = el.ccw === true;
        const center = arcCenterDirected(cursor, to, r, ccw);
        cuts.push({
          type: "arc",
          points: [cursor, to],
          center,
          radius: r,
          ccw,
          sequenceIndex: seq++,
          stage: 3,
          stageLabel: stageLabel(VENDOR, 3),
          paneRefs: [paneId],
        });
        polygon.push(...sampleArcDirected(cursor, to, r, ccw, 24).slice(1));
      }
      cursor = to;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    panes.push({
      id: paneId,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      polygon: polygon.length > 2 ? polygon : undefined,
      rotated: rotation !== 0 ? true : undefined,
    });
  }

  if (!length || !height) {
    return {
      status: "failed",
      warnings,
      error: "Perfect Cut PGM file is missing the sheet size (H/L records)",
      detected: { vendor: VENDOR, formatId: "perfectcut-pgm", confidence: "high", matchedSignal: "H/L by Perfect Cut" },
    };
  }

  const machine = /\b([A-Z0-9][A-Z0-9 _-]*)\s+by Perfect Cut/i.exec(comment)?.[1]?.trim();
  const document: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine,
      glassThickness: thickness,
      sourcePath,
      formatVersion: machineFlag ? `R${machineFlag}` : undefined,
    },
    sheets: [
      {
        id: "sheet-1",
        label: planNumber || comment,
        sheet: { width: length, height },
        panes,
        cuts,
        coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
      },
    ],
  };

  return {
    status: warnings.length || cuts.length === 0 ? (cuts.length === 0 ? "partial" : "partial") : "ok",
    document,
    warnings: cuts.length === 0 ? [...warnings, "No G/G1 scores found outside a DS block"] : warnings,
    detected: { vendor: VENDOR, formatId: "perfectcut-pgm", confidence: "high", matchedSignal: "H/L by Perfect Cut" },
  };
}

function resolveCenter(from: Point, to: Point, i: number, j: number): Point {
  const rA = Math.hypot(from.x - i, from.y - j);
  const rB = Math.hypot(to.x - i, to.y - j);
  if (rA > 0.1 && Math.abs(rA - rB) <= Math.max(1, rA * 0.02)) return { x: i, y: j };
  return { x: from.x + i, y: from.y + j };
}