import type { Cut, CutDocument, CutPlan, LaserMark, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";
import { panesFromScoreSegments } from "../geometry/guillotine.js";

/**
 * Eagle / ISAC ISO (.ISO) — Linghua Automation glass cutting system,
 * "Instruction.pdf" v1.1.0, driven by Perfect Cut with the ISAC post.
 *
 * Structure of a program:
 *
 *   %
 *   {strNomeProgetto="M:\Projects\190723-006CFL.OT5"}
 *   {strFamiglia="006CFL"}
 *   {wNumeroSchema=1}
 *   {:COMMENT=006CFL}
 *   {:BOX=1784;2049;912;1045;45;Australia Glass Brisbane;313150 - 1;}
 *   { RESET TRANSL. }
 *   G59 X0 Y0                 reset translation origin
 *   L INITANG                 load macro
 *   R4081=3660                LX sheet length
 *   R4082=2440                LY sheet width
 *   R4083=6                   glass thickness
 *   M6T1                      work with head 1
 *   F60000                    feed rate, mm/min
 *   R5056=1000                head pressure, millibar
 *   L ROTOTRSON               roto-translation macro
 *   M1011                     F.A. subroutine, raise head
 *   G00 X20.0 Y1.0 C(90.00+R1199)     rapid, C = theoretical angle
 *   M1010                     F.A. subroutine, lower head
 *   G01 X20.0 Y2439.0                linear score
 *   M1011                     raise head
 *   …
 *   M02
 *
 * The `{:BOX=…}` records carry the optimizer's piece rectangles (x; y; w; h;
 * piece id; supplier; order), and `M1010` / `M1011` bracket every scoring move,
 * so the cut sequence is exactly the tool path.
 */

const VENDOR = "Eagle";

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function reg(content: string, name: string): number | undefined {
  const m = content.match(new RegExp(`\\b${name}\\s*=\\s*(-?[\\d.]+)`, "i"));
  return num(m?.[1]);
}

type BoxRec = {
  /** Blank width, mm. */
  width: number;
  /** Blank height, mm. */
  height: number;
  /** Blank position as written by the optimizer (its own frame). */
  x: number;
  y: number;
  id?: string;
  supplier?: string;
  order?: string;
};

/**
 * `{:BOX=w;h;x;y;id;supplier;order}` — the first two fields are the blank's
 * size, which matches the score sequence directly; x/y stay in Perfect Cut's
 * own frame and are only kept for reference.
 */
function parseBoxes(content: string): BoxRec[] {
  const out: BoxRec[] = [];
  const re = /\{:\s*BOX\s*=\s*([^}]*)\}/gi;
  for (const m of content.matchAll(re)) {
    const fields = m[1]!.split(";").map((s) => s.trim());
    if (fields.length < 4) continue;
    const width = num(fields[0]);
    const height = num(fields[1]);
    const x = num(fields[2]);
    const y = num(fields[3]);
    if (width === undefined || height === undefined || x === undefined || y === undefined) continue;
    out.push({ width, height, x, y, id: fields[4], supplier: fields[5], order: fields[6] });
  }
  return out;
}

export function parseEagleIso(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];

  const sheetW = reg(content, "R4081");
  const sheetH = reg(content, "R4082");
  const thickness = reg(content, "R4083");

  if (!sheetW || !sheetH) {
    return {
      status: "failed",
      warnings,
      error: "Eagle/ISAC ISO program is missing the sheet size (R4081 = LX, R4082 = LY)",
      detected: { vendor: VENDOR, formatId: "eagle-isac-iso", confidence: "high", matchedSignal: "R4081 / R4082" },
    };
  }

  const project = content.match(/strNomeProgetto\s*=\s*"([^"]*)"/i)?.[1];
  const family = content.match(/strFamiglia\s*=\s*"([^"]*)"/i)?.[1];

  const cuts: Cut[] = [];
  const laser: LaserMark[] = [];
  let seq = 0;

  let headDown = false;
  let pos: Point | null = null;
  let feed: number | undefined;

  const pushLine = (from: Point, to: Point, paneRefs?: string[]): void => {
    if (Math.abs(from.x - to.x) < 1e-6 && Math.abs(from.y - to.y) < 1e-6) return;
    const vertical = Math.abs(to.x - from.x) < 0.01;
    const stage = vertical ? 1 : 2;
    cuts.push({
      type: "line",
      points: [from, to],
      sequenceIndex: seq++,
      stage,
      stageLabel: stageLabel(VENDOR, stage) ?? (vertical ? "X" : "Y"),
      paneRefs,
    });
  };

  for (const raw of content.split(/\r?\n/)) {
    // Braces carry comments and BOX metadata, never motion.
    const stripped = raw.replace(/\{[^}]*\}/g, " ");
    const line = stripped.trim();
    if (!line) continue;

    if (/^M1010\b/i.test(line)) {
      headDown = true;
      continue;
    }
    if (/^M1011\b/i.test(line)) {
      headDown = false;
      continue;
    }
    if (/^F\d+/i.test(line)) {
      feed = num(line.slice(1));
      continue;
    }

    const motion = line.match(/^G0*([0-3])?\s*(?=[A-Z(])/i);
    if (!motion) continue;
    const kind = (motion[1] === undefined ? "0" : motion[1]) as "0" | "1" | "2" | "3";
    const rest = line.slice(motion[0].length);
    const xm = rest.match(/X(-?[\d.]+)/i);
    const ym = rest.match(/Y(-?[\d.]+)/i);
    if (!xm && !ym) continue;

    const from = pos ?? { x: 0, y: 0 };
    const to: Point = { x: xm ? num(xm[1])! : from.x, y: ym ? num(ym[1])! : from.y };

    if (kind === "0") {
      pos = to;
      continue;
    }
    if (!headDown) {
      pos = to;
      continue;
    }

    if (kind === "1") {
      pushLine(from, to);
    } else {
      const i = num(rest.match(/I(-?[\d.]+)/i)?.[1]) ?? 0;
      const j = num(rest.match(/J(-?[\d.]+)/i)?.[1]) ?? 0;
      const r = Math.hypot(i, j);
      const ccw = kind === "3";
      const side = ccw ? -1 : 1;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const d = Math.hypot(dx, dy);
      let center = from;
      if (d > 1e-9) {
        const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
        const ux = -dy / d;
        const uy = dx / d;
        const s = side >= 0 ? 1 : -1;
        center = { x: (from.x + to.x) / 2 + s * ux * h, y: (from.y + to.y) / 2 + s * uy * h };
      }
      cuts.push({
        type: "arc",
        points: [from, to],
        center,
        radius: r,
        ccw,
        sequenceIndex: seq++,
        stage: 3,
        stageLabel: stageLabel(VENDOR, 3) ?? "Shape",
      });
      if (ccw) {
        laser.push({ x: from.x, y: from.y, angle: Math.round((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI) });
      }
    }
    pos = to;
  }

  /* ---- pieces ---- */
  // The G-code carries no blank rectangles, so they are reconstructed from the
  // score sequence itself; the optimiser's {:BOX=...} records then supply the
  // piece number, supplier and order for whichever blank contains their centre.
  const panes = panesFromScoreSegments(cuts, { width: sheetW, height: sheetH }, VENDOR);

const boxes = parseBoxes(content);
  // Match by size: the optimizer's x/y are in its own frame, but the blank's
  // width and height are the real thing.
  const usedBoxes = new Set<BoxRec>();
  for (const p of panes) {
    // The reconstructed blank carries the trim strips, so its size may exceed
    // the optimizer's finished size by the trim on each edge.
    const tolW = Math.max(3, p.bounds.width * 0.03);
    const tolH = Math.max(3, p.bounds.height * 0.06);
    const box = boxes.find(
      (b) =>
        !usedBoxes.has(b) &&
        Math.abs(b.width - p.bounds.width) <= tolW &&
        Math.abs(b.height - p.bounds.height) <= tolH
    );
    if (!box) continue;
    usedBoxes.add(box);
    const label = [box.supplier, box.order].filter((v) => v && v.length > 0).join(" · ");
    if (box.id) p.id = box.id;
    if (label) p.label = label;
  }

  if (cuts.length === 0) {
    return {
      status: panes.length > 0 ? "partial" : "failed",
      warnings: panes.length > 0 ? ["No M1010…M1011 scoring moves found"] : warnings,
      error: panes.length > 0 ? undefined : "Eagle/ISAC ISO program contains no M1010…M1011 scoring moves",
      document:
        panes.length > 0
          ? {
              metadata: { vendor: VENDOR, machine: "Eagle / Linghua ISAC", glassThickness: thickness, glassType: family, sourcePath },
              sheets: [
                {
                  id: "sheet-1",
                  label: family,
                  sheet: { width: sheetW, height: sheetH },
                  panes,
                  cuts,
                  coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
                },
              ],
            }
          : undefined,
      detected: { vendor: VENDOR, formatId: "eagle-isac-iso", confidence: "high", matchedSignal: "R4081 / R4082" },
    };
  }

  void feed;
  void project;

  const document: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine: "Eagle / Linghua ISAC",
      glassThickness: thickness,
      glassType: family,
      date: project,
      sourcePath,
    },
    sheets: [
      {
        id: "sheet-1",
        label: family,
        sheet: { width: sheetW, height: sheetH },
        panes,
        cuts,
        laser: laser.length > 0 ? laser : undefined,
        coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
      },
    ],
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document,
    warnings,
    detected: { vendor: VENDOR, formatId: "eagle-isac-iso", confidence: "high", matchedSignal: "R4081 / R4082" },
  };
}

export type { CutPlan };