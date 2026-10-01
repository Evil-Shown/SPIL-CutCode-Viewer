import type { Cut, CutDocument, CutPlan, Pane, ParseResult, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";
import { arcCenterDirected, sampleArcDirected } from "../geometry/arc.js";

/**
 * Bystronic PROG.XYZ — doc PROG.XYZ.SOFT.V06.EN (September 2005, version 6.0),
 * valid for SMF(R), VGS and Smart'cut.
 *
 * ASCII and word-oriented. CR/LF/TAB/SP are ignorable (Tab. 3), so records are
 * recovered with a tokenizer rather than by line:
 *
 *   (P2N1M3210.0/2550.0L20.0U20.0K20.0                       start char + header
 *   [Bystronic Maschinen[R1P5Q10000003D300B2C3W01332404]]    comment
 *   Y828.0B116C1001                                           data records
 *   Y760.0B177C1001F5DK0H300.0H300.0G300.0G200.0{[ESonder]}
 *   F99S0X80Y50S50S1X320Y50S2X350Y80R30S51S10X250Y100S99     free shape 99
 *   )                                                         end char
 *
 * Header addresses (Tab. 4): Q rack, A cutting speed (m/min), P program number,
 * M raw material X/Y as `M6000/3210`, N repetitions, U Y edge cut, L X edge
 * cut, K shape edge cut, T unused.
 *
 * Comment addresses (Tab. 5): P optimisation number, Q material number,
 * D glass thickness in 1/100 mm, B pattern number, C pattern count,
 * R edge-deletion device, W carriage changeover, F load remaining sheet,
 * S save remaining sheet, M remaining sheet dimension.
 *
 * Data-record addresses (Tab. 6): X subplate width, Y primitive height,
 * Z X-direction after-cut, V Y-direction after-cut, W further X-direction
 * after-cut, `*nn` repetition factor, B rack number, C auxiliary number,
 * F shape number, D rotate 90Â°, K edge-cut side flags, G/H/R sub-dimensions
 * and radii, S record type inside free shape 99.
 *
 * X, Z and W are X-direction dimensions; Y and V are Y-direction dimensions.
 * Values are relative — "the zero point of a dimension is the end point of the
 * preceding dimension" (Fig. 2) — so the walk below advances a cursor. An X
 * word closes the running subplate and declares the next one's width; Y words
 * subdivide the open subplate from the bottom up.
 */

const VENDOR = "Bystronic";
const MODEL = "Bystronic glass cutting line";

type Word = { address: string; value: string };

/** Split into words (`A1`, `*2`), bracketed blocks and lone braces. */
function tokenize(body: string): Array<{ text: string }> {
  const out: Array<{ text: string }> = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch === "}") {
      out.push({ text: ch });
      i += 1;
      continue;
    }
    if (ch === "{" || ch === "[") {
      const close = ch === "{" ? "}" : "]";
      let depth = 1;
      let j = i + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === ch) depth++;
        else if (body[j] === close) depth--;
        if (depth > 0) j += 1;
      }
      out.push({ text: body.slice(i, Math.min(j + 1, body.length)) });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z*]/.test(ch)) {
      let j = i + 1;
      while (j < body.length && /[0-9."]/.test(body[j]!)) j += 1;
      // The raw-material size is written `M6000/3210`, so the slash belongs to
      // the M word's value rather than being a separator.
      if ((ch === "M" || ch === "m") && body[j] === "/") {
        j += 1;
        while (j < body.length && /[0-9."]/.test(body[j]!)) j += 1;
      }
      out.push({ text: body.slice(i, j) });
      i = j;
      continue;
    }
    i += 1;
  }
  return out;
}

function asWord(text: string): Word | undefined {
  const m = text.match(/^([A-Za-z*])([0-9."/]*)$/);
  return m ? { address: m[1]!.toUpperCase(), value: m[2]! } : undefined;
}

function num(raw: string | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/"/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Addresses that only ever appear in the data-record section. */
const DATA_ADDRESS = new Set(["X", "Y", "Z", "V", "W", "F", "S", "B", "C", "G", "H", "R", "D"]);

/* ------------------------------------------------------------------ */
/*  Free shape 99                                                      */
/* ------------------------------------------------------------------ */

type ShapeStep =
  | { s: 0 | 1; to: Point }
  | { s: 2 | 3; to: Point; radius: number };

type StandardShape = {
  f: number;
  g: number[];
  h: number[];
  r: number[];
  k: string;
  rotate: boolean;
};

export function parseBystronicXyz(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];

  const open = content.indexOf("(");
  const close = content.lastIndexOf(")");
  if (open === -1 || close === -1 || close < open) {
    return {
      status: "failed",
      warnings,
      error: "Bystronic PROG.XYZ must be wrapped in `(` … `)`",
      detected: { vendor: VENDOR, formatId: "bystronic-xyz", confidence: "high", matchedSignal: "( … )" },
    };
  }

  const inner = content.slice(open + 1, close);

  /* ---------------- comment ---------------- */
  let commentText: string | undefined;
  let commentWords: Word[] = [];
  let body = inner;
  const cStart = inner.indexOf("[");
  if (cStart !== -1) {
    let depth = 0;
    let end = cStart;
    for (; end < inner.length; end++) {
      if (inner[end] === "[") depth += 1;
      else if (inner[end] === "]") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    commentText = inner.slice(cStart + 1, end);
    const iStart = commentText.indexOf("[");
    const iEnd = commentText.lastIndexOf("]");
    if (iStart !== -1 && iEnd > iStart) {
      commentWords = tokenize(commentText.slice(iStart + 1, iEnd))
        .map((t) => asWord(t.text))
        .filter((w): w is Word => w !== undefined);
    }
    body = inner.slice(0, cStart) + inner.slice(end + 1);
  }

  const words = tokenize(body)
    .map((t) => asWord(t.text))
    .filter((w): w is Word => w !== undefined);

  const firstData = words.findIndex((w) => DATA_ADDRESS.has(w.address));
  const headerWords = firstData === -1 ? words : words.slice(0, firstData);

  /* ---------------- header ---------------- */
  let sheetW = 0;
  let sheetH = 0;
  let edgeX = 0;
  let edgeY = 0;
  let shapeEdge = 0;
  let speedMmMin: number | undefined;
  let programNumber: string | undefined;
  let repetitions = 1;
  let thicknessTenths: number | undefined;
  let materialNumber: string | undefined;
  let patternNumber: string | undefined;
  let patternCount: string | undefined;
  let edgeDeletion: string | undefined;
  let remainingSheet: string | undefined;

  for (const w of headerWords) {
    switch (w.address) {
      case "M": {
        const [x, y] = w.value.split("/");
        sheetW = num(x);
        sheetH = num(y);
        break;
      }
      case "L":
        edgeX = num(w.value);
        break;
      case "U":
        edgeY = num(w.value);
        break;
      case "K":
        shapeEdge = num(w.value);
        break;
      case "A":
        speedMmMin = num(w.value);
        break;
      case "P":
        programNumber = w.value;
        break;
      case "N":
        repetitions = Math.max(1, parseInt(w.value, 10) || 1);
        break;
      default:
        break;
    }
  }

  for (const w of commentWords) {
    switch (w.address) {
      case "D":
        thicknessTenths = num(w.value);
        break;
      case "Q":
        materialNumber = w.value;
        break;
      case "B":
        patternNumber = w.value;
        break;
      case "C":
        patternCount = w.value;
        break;
      case "R":
        edgeDeletion = w.value;
        break;
      case "M":
        remainingSheet = w.value;
        break;
      default:
        break;
    }
  }

  if (!sheetW || !sheetH) {
    return {
      status: "failed",
      warnings,
      error: "Bystronic PROG.XYZ header is missing the raw-material size (`M<X>/<Y>`)",
      detected: { vendor: VENDOR, formatId: "bystronic-xyz", confidence: "high", matchedSignal: "( … )" },
    };
  }

  /* ---------------- data records ---------------- */
  const cuts: Cut[] = [];
  const panes: Pane[] = [];
  let seq = 0;
  const nextSeq = () => seq++;

  const freeShapes = new Map<number, FreeShape>();

  const pushLine = (a: Point, b: Point, stage: number, paneRefs?: string[], rackCode?: string): void => {
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) return;
    cuts.push({
      type: "line",
      points: [a, b],
      sequenceIndex: nextSeq(),
      stage,
      stageLabel: stageLabel(VENDOR, stage),
      paneRefs,
      rackCode,
    });
  };

  const emitFreeShape = (
    shape: FreeShape,
    region: { x: number; y: number; width: number; height: number },
    paneId: string,
    rackCode: string | undefined
  ): Point[] | null => {
    const stage = 3;
    const label = stageLabel(VENDOR, 3) ?? "Shape";
    const outline: Point[] = [];
    let cursor: Point | null = null;
    for (const step of shape.steps) {
      const to: Point = { x: region.x + step.to.x, y: region.y + step.to.y };
      if (step.s === 0) {
        cursor = to;
        outline.push(to);
        continue;
      }
      if (!cursor) {
        cursor = to;
        outline.push(to);
        continue;
      }
      if (step.s === 1) {
        pushLine(cursor, to, stage, [paneId], rackCode);
        outline.push(to);
      } else {
        const r = step.s === 2 || step.s === 3 ? step.radius : 0;
        const ccw = step.s === 3;
        const center = arcCenterDirected(cursor, to, r, ccw);
        cuts.push({
          type: "arc",
          points: [cursor, to],
          center,
          radius: r,
          ccw,
          sequenceIndex: nextSeq(),
          stage,
          stageLabel: label,
          paneRefs: [paneId],
          rackCode,
        });
        outline.push(...sampleArcDirected(cursor, to, r, ccw, 24).slice(1));
      }
      cursor = to;
    }
    return outline.length > 2 ? outline : null;
  };

  /* ---- walk state ---- */
  let subplateX = 0;
  let subplateW = 0;
  let primitiveY = 0;
  let primitiveH = 0;
  let primitiveRack: string | undefined;
  let primitiveShapes: StandardShape[] = [];
  let primitiveIndex = 0;
  let afterX = 0;
  let freeCursor = 0;
  let pendingShape: StandardShape | undefined;
  let pendingRack: string | undefined;

  const commitPrimitive = (): void => {
    if (pendingShape) {
      primitiveShapes.push(pendingShape);
      pendingShape = undefined;
    }
    if (subplateW <= 0 || primitiveH <= 0) {
      primitiveH = 0;
      primitiveRack = undefined;
      primitiveShapes = [];
      return;
    }
    primitiveIndex += 1;
    const id = `p${primitiveIndex}`;
    const bounds = { x: subplateX, y: primitiveY, width: subplateW, height: primitiveH };
    const pane: Pane = { id, bounds, rackCode: primitiveRack };

    for (const spec of primitiveShapes) {
      if (spec.f === 99) {
        const shape = freeShapes.get(freeCursor);
        freeCursor += 1;
        if (!shape) {
          warnings.push(`Primitive ${id} uses free shape 99 but no S0…S99 block preceded it`);
          continue;
        }
        const polygon = emitFreeShape(shape, bounds, id, primitiveRack);
        if (polygon) pane.polygon = polygon;
        continue;
      }
      const note =
        `F${spec.f}${spec.rotate ? " rot90" : ""}` +
        (spec.g.length ? ` G[${spec.g.join(",")}]` : "") +
        (spec.h.length ? ` H[${spec.h.join(",")}]` : "") +
        (spec.r.length ? ` R[${spec.r.join(",")}]` : "") +
        (spec.k ? ` K${spec.k}` : "");
      warnings.push(`Shape model ${note} is a catalogue model (FORMEN); PROG.XYZ carries its parameters, not the contour`);
    }

    panes.push(pane);

    pushLine({ x: bounds.x, y: bounds.y }, { x: bounds.x, y: bounds.y + bounds.height }, 1, [id], primitiveRack);
    pushLine({ x: bounds.x, y: bounds.y + bounds.height }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, 2, [id], primitiveRack);
    pushLine({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x + bounds.width, y: bounds.y }, 1, [id], primitiveRack);
    pushLine({ x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x, y: bounds.y }, 2, [id], primitiveRack);

    primitiveY += primitiveH;
    primitiveH = 0;
    primitiveRack = undefined;
    primitiveShapes = [];
    afterX = 0;
  };

  const closeSubplate = (): void => {
    // Only a subplate that actually received Y records consumes bed space.
    const hadContent = primitiveH > 0 || primitiveY > 0;
    commitPrimitive();
    if (hadContent && subplateW > 0) subplateX += subplateW;
    subplateW = 0;
    primitiveY = 0;
  };

  /* ---- scan ---- */
  let inFree = false;
  let freeSteps: ShapeStep[] = [];
  let freeX = 0;
  let freeY = 0;
  let freeRadius = 0;

  // An X word terminates the subplate whose Y words precede it and declares that
  // subplate's width ("A further X cut specifies the width of the first
  // subplate"), so the widths are collected first (skipping free-shape 99
  // blocks, whose S records carry X/Y words of their own) and the walk then
  // consumes them one subplate at a time.
  const dataWords = words.slice(firstData === -1 ? words.length : firstData);

  const subplateWidths: number[] = [];
  {
    let inFreeShape = false;
    for (const { address, value } of dataWords) {
      if (inFreeShape) {
        if (address === "S" && parseInt(value, 10) === 99) inFreeShape = false;
        continue;
      }
      if (address === "X") {
        subplateWidths.push(num(value));
        continue;
      }
      if (address === "F" && Math.round(num(value)) === 99) inFreeShape = true;
    }
  }

  if (subplateWidths.length === 0) {
    warnings.push("PROG.XYZ contains no X subplate records");
  }
  let widthCursor = 0;
  subplateW = subplateWidths[0] ?? 0;

  for (const { address, value } of dataWords) {
    if (inFree) {
      switch (address) {
        case "S": {
          const s = parseInt(value, 10);
          if (s === 99) {
            freeShapes.set(freeShapes.size, { steps: freeSteps });
            inFree = false;
            freeSteps = [];
          } else if (s === 0 || s === 1) {
            freeSteps.push({ s: s as 0 | 1, to: { x: freeX, y: freeY } });
          } else if (s === 2 || s === 3) {
            freeSteps.push({ s: s as 2 | 3, to: { x: freeX, y: freeY }, radius: freeRadius });
          }
          break;
        }
        case "X":
          freeX = num(value);
          break;
        case "Y":
          freeY = num(value);
          break;
        case "R":
          freeRadius = num(value);
          break;
        default:
          break;
      }
      continue;
    }

    switch (address) {
      case "X":
        // An X word closes the subplate whose Y records precede it and declares
        // the width of the next one.
        closeSubplate();
        widthCursor += 1;
        subplateW = subplateWidths[widthCursor] ?? 0;
        break;
case "Y": {
          // A Y word closes the running primitive and opens the next one.
          commitPrimitive();
          if (subplateW <= 0) {
            warnings.push(
              "Y records appear before any X subplate width; this primitive cannot be sized (PROG.XYZ declares a subplate's width after its Y records)"
            );
          }
          primitiveH = num(value);
          primitiveRack = pendingRack;
          if (pendingShape) primitiveShapes.push(pendingShape);
          pendingShape = undefined;
          pendingRack = undefined;
          break;
        }
      case "Z": {
        const zx = subplateX + afterX + num(value);
        afterX += num(value);
        pushLine({ x: zx, y: primitiveY }, { x: zx, y: primitiveY + primitiveH }, 3, undefined, primitiveRack);
        break;
      }
      case "V": {
        const vy = primitiveY + num(value);
        pushLine({ x: subplateX, y: vy }, { x: subplateX + subplateW, y: vy }, 3, undefined, primitiveRack);
        break;
      }
      case "W": {
        const wx = subplateX + subplateW - num(value);
        pushLine({ x: wx, y: primitiveY }, { x: wx, y: primitiveY + primitiveH }, 4, undefined, primitiveRack);
        break;
      }
      case "F": {
        const f = Math.round(num(value));
        if (pendingShape) primitiveShapes.push(pendingShape);
        pendingShape = { f, g: [], h: [], r: [], k: "", rotate: false };
        if (f === 99 && !inFree) {
          inFree = true;
          freeSteps = [];
          freeX = 0;
          freeY = 0;
          freeRadius = 0;
        }
        break;
      }
      case "G":
        pendingShape?.g.push(num(value));
        break;
      case "H":
        pendingShape?.h.push(num(value));
        break;
      case "R":
        pendingShape?.r.push(num(value));
        break;
      case "K":
        if (pendingShape) pendingShape.k += value;
        break;
      case "D":
        if (pendingShape) pendingShape.rotate = true;
        break;
      case "B":
        pendingRack = value;
        break;
      default:
        break;
    }
  }
  if (inFree) {
    freeShapes.set(freeShapes.size, { steps: freeSteps });
    warnings.push("Free shape 99 block is not terminated by S99");
  }
  closeSubplate();

  if (cuts.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Bystronic PROG.XYZ contains no cut records",
      detected: { vendor: VENDOR, formatId: "bystronic-xyz", confidence: "high", matchedSignal: "( … )" },
    };
  }

  const sheet: CutPlan = {
    id: "sheet-1",
    label: programNumber ? `Program ${programNumber}` : undefined,
    sheet: { width: sheetW, height: sheetH, trims: { top: edgeY, right: shapeEdge, bottom: edgeY, left: edgeX } },
    panes,
    cuts,
    coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
  };

  const document: CutDocument = {
    metadata: {
      vendor: VENDOR,
      machine: MODEL,
      formatVersion: "PROG.XYZ v6.0",
      glassType: materialNumber ? `Material ${materialNumber}` : undefined,
      glassThickness: thicknessTenths !== undefined ? thicknessTenths / 100 : undefined,
      date: commentText?.slice(0, 64) || undefined,
      operator: remainingSheet ? `Remaining sheet ${remainingSheet}` : undefined,
      sourcePath,
    },
    sheets: [sheet],
  };

  void speedMmMin;
  void repetitions;
  void edgeDeletion;
  void patternNumber;
  void patternCount;

  return {
    status: warnings.length ? "partial" : "ok",
    document,
    warnings,
    detected: { vendor: VENDOR, formatId: "bystronic-xyz", confidence: "high", matchedSignal: "( … )" },
  };
}

type FreeShape = { steps: ShapeStep[] };