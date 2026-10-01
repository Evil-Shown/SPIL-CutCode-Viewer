import type { Cut, CutDocument, CutPlan, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";
import { arcCenterDirected, sampleArcDirected } from "../geometry/arc.js";

/**
 * Vetromac ISO (.ISO).
 *
 * Samples: Vetromac `ISO`, `ISO_Circle`, `ISO_Rectangle` and
 * `ISO_Rectangle with rays`.
 *
 * Macro-oriented ISO with two header styles, both assigning the same registers:
 *
 *   M94 VN210=1 / M94 VN211=3660 / M94 VN212=2440 / M94 VN215=1   (legacy)
 *   G290 VN210=1 / G290 VN211=1000 / G290 VN212=1000 / G290 VN215=1   (current)
 *
 *   VN210  sheet number
 *   VN211  sheet X, millimetres
 *   VN212  sheet Y, millimetres
 *   VN215  thickness, millimetres
 *   VN216  wheel / tool selection
 *   VN230, VN231  registration offsets
 *   VB2300  orientation flag for the following G0/G1 pair
 *   VB1401  shape program selector
 *   VQ37    arc radius, VQ38 angular parameter, VN90 arc direction
 *
 * Motion:
 *   `G201 VB1401 == 1 J L39` … `L49`   open / close a shape block
 *   `G201 VB1401 == 1 J L17`           closes the program block
 *   `M3` / `M5`   cutting wheel down / up
 *   `M9`          grinding wheel down
 *   `M13` / `M14` head select for scoring / grinding
 *   `G0` positioning, `G1` linear, `G2`/`G3` arcs (I/J absolute centre).
 *
 * With the cutting wheel engaged a G1 is a score; with the grinding wheel
 * engaged a G2/G3 is a Low-E deletion pass; everything else is positioning.
 */

const VENDOR = "Vetromac";

type Seg =
  | { kind: "line"; from: Point; to: Point }
  | { kind: "arc"; from: Point; to: Point; center: Point; radius: number; ccw: boolean };

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function vn(content: string, name: string): number | undefined {
  const m = content.match(new RegExp(`VN${name}\\s*=\\s*(-?[\\d.]+)`, "i"));
  return num(m?.[1]);
}

export function parseVetromacIso(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];

  const sheetW = vn(content, "211");
  const sheetH = vn(content, "212");
  const thickness = vn(content, "215");
  const sheetNo = vn(content, "210");

  if (!sheetW || !sheetH) {
    return {
      status: "failed",
      warnings,
      error: "Vetromac ISO program is missing the sheet size (VN211 / VN212)",
      detected: { vendor: VENDOR, formatId: "vetromac-iso", confidence: "high", matchedSignal: "VN211 / VN212" },
    };
  }

  const cuts: Cut[] = [];
  const panes: Pane[] = [];
  let seq = 0;

  let wheel = false;
  let grind = false;
  let pos: Point | null = null;
  let radius = 0;

  /* shape block state */
  const SHAPE_OPEN = /G201\b.*\bL\s*(?:17|39|49|61)\b/i;
  let block: { id: number; segs: Seg[] } | null = null;
  let shapeIndex = 0;

  const pushLine = (from: Point, to: Point, stage: number, label: string, paneId?: string): void => {
    if (Math.abs(from.x - to.x) < 1e-6 && Math.abs(from.y - to.y) < 1e-6) return;
    cuts.push({
      type: "line",
      points: [from, to],
      sequenceIndex: seq++,
      stage,
      stageLabel: label,
      paneRefs: paneId ? [paneId] : undefined,
    });
  };

  const pushArc = (
    from: Point,
    to: Point,
    center: Point,
    r: number,
    ccw: boolean,
    stage: number,
    label: string,
    paneId?: string
  ): void => {
    cuts.push({
      type: "arc",
      points: [from, to],
      center,
      radius: r,
      ccw,
      sequenceIndex: seq++,
      stage,
      stageLabel: label,
      paneRefs: paneId ? [paneId] : undefined,
    });
  };

  const closeBlock = (): void => {
    if (!block) return;
    if (block.segs.length > 0) {
      const paneId = `shape-${block.id}`;
      const outline: Point[] = [];
      for (const seg of block.segs) {
        if (outline.length === 0) outline.push(seg.from);
        if (seg.kind === "line") outline.push(seg.to);
        else outline.push(...sampleArcDirected(seg.from, seg.to, seg.radius, seg.ccw, 24).slice(1));
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of outline) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      panes.push({
        id: paneId,
        bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        polygon: outline.length > 2 ? outline : undefined,
      });
    }
    block = null;
  };

  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\{[^}]*\}/g, " ").trim();
    if (!line) continue;

    const vq = line.match(/VQ37\s*=\s*(-?[\d.]+)/i);
    if (vq) radius = num(vq[1]) ?? 0;

    if (/^G201\b/i.test(line)) {
      if (block) closeBlock();
      shapeIndex += 1;
      block = { id: shapeIndex, segs: [] };
      continue;
    }

    /* wheel / spindle state */
    if (/^M3\b/i.test(line)) {
      wheel = true;
      continue;
    }
    if (/^M5\b/i.test(line)) {
      wheel = false;
      grind = false;
      continue;
    }
    if (/^M9\b/i.test(line)) {
      grind = true;
      continue;
    }

    // `G0X3.000` / `G1 X997.000` / `G290 VN210=1` (a macro assignment, not motion)
    const motion = line.match(/^G0*([0-3])?\s*(?=[A-Z(])/i);
    if (!motion) continue;
    const kind = (motion[1] === undefined ? "0" : motion[1]) as "0" | "1" | "2" | "3";
    const rest = line.slice(motion[0].length);
    const xm = rest.match(/X(-?[\d.]+)/i);
    const ym = rest.match(/Y(-?[\d.]+)/i);
    if (!xm && !ym) continue;

    const from = pos ?? { x: 0, y: 0 };
    const to: Point = { x: xm ? num(xm[1])! : from.x, y: ym ? num(ym[1])! : from.y };
    const paneId = block ? `shape-${block.id}` : undefined;
    // In this dialect M3/M5 gates the wheel, not the motion type: a G0 issued
    // while the wheel is down is itself a score (see Vetromac ISO\ISO\1.ISO).
    const scoring = wheel || grind;

    if (kind === "0" && !scoring) {
      pos = to;
      continue;
    }

    if (kind === "1") {
      const vertical = Math.abs(to.x - from.x) < 0.01;
      const stage = vertical ? 1 : 2;
      const label = stageLabel(VENDOR, stage) ?? (vertical ? "X" : "Y");
      if (grind && !wheel) {
        pushLine(from, to, 6, "Low-E", paneId);
      } else {
        pushLine(from, to, stage, label, paneId);
        block?.segs.push({ kind: "line", from, to });
      }
    } else {
      const i = num(rest.match(/I(-?[\d.]+)/i)?.[1]) ?? 0;
      const j = num(rest.match(/J(-?[\d.]+)/i)?.[1]) ?? 0;
      const r = radius > 0 ? radius : Math.hypot(i, j);
      const ccw = kind === "3";
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const d = Math.hypot(dx, dy);
      // A full circle is written as one G2/G3 whose end point equals its start;
      // the centre then comes straight from I/J and the radius from VQ37.
      const center: Point =
        d < 1e-9 && Math.abs(Math.hypot(from.x - i, from.y - j) - r) <= Math.max(1, r * 0.05)
          ? { x: i, y: j }
          : arcCenterDirected(from, to, r, ccw);
      // Inside a shape block the arcs belong to the contour; the grinding wheel
      // is only a Low-E pass when the program is not cutting a shape.
      const lowE = grind && !wheel && !block;
      if (lowE) {
        pushArc(from, to, center, r, ccw, 6, "Low-E", paneId);
      } else {
        pushArc(from, to, center, r, ccw, 3, stageLabel(VENDOR, 3) ?? "Shape", paneId);
        block?.segs.push({ kind: "arc", from, to, center, radius: r, ccw });
      }
    }

    pos = to;
  }
  closeBlock();

  if (cuts.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Vetromac ISO program contains no G1/G2/G3 motion with a wheel engaged",
      detected: { vendor: VENDOR, formatId: "vetromac-iso", confidence: "high", matchedSignal: "VN211 / VN212" },
    };
  }

  const document: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine: "Vetromac",
      glassThickness: thickness,
      sourcePath,
      formatVersion: /G290/i.test(content) ? "G290 macro dialect" : "M94 macro dialect",
    },
    sheets: [
      {
        id: "sheet-1",
        label: sheetNo !== undefined ? `Sheet ${sheetNo}` : undefined,
        sheet: { width: sheetW, height: sheetH },
        panes,
        cuts,
        coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
      },
    ],
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document,
    warnings,
    detected: { vendor: VENDOR, formatId: "vetromac-iso", confidence: "high", matchedSignal: "VN211 / VN212" },
  };
}