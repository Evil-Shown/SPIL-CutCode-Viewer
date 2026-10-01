import type { Cut, Pane, Point } from "../model/types.js";
import { stageLabel } from "../model/types.js";

/**
 * Shared guillotine (guillotine-break) reconstruction.
 *
 * Most optimization post-processors emit a nested cut list rather than a list
 * of finished pieces. Each record names a cut *level* (a letter) and the size
 * of the blank that the cut detaches from the remaining space of its parent
 * container. Replaying that walk reproduces the exact rectangles the optimizer
 * intended, which is what the simulator needs for panes, stages and yield.
 *
 * Rules implemented (identical across Turomas V30, Perfect Cut `[Pattern]`,
 * Disai PRJX `[SCHEME]`, Bystronic PROG.XYZ and R.O. `[Pattern]`):
 *  - a node subdivides the rectangle left over by its parent container,
 *  - consecutive nodes on the same level are siblings inside that rectangle,
 *  - the detached blank is the parent rectangle's leading edge strip.
 */

export type GuillotineAxis = "X" | "Y";

export type GuillotineLevel = {
  /** Level letter as written in the file. */
  letter: string;
  /** X = vertical cut (consumes width), Y = horizontal cut (consumes height). */
  axis: GuillotineAxis;
};

export type GuillotineNode = {
  letter: string;
  /** Size of the detached blank, in the file's own unit. */
  value: number;
  /** Piece / Info / IB identifier when the file supplies one. */
  id?: string;
  label?: string;
  rack?: string;
  /** Shape index resolved later by the calling parser (CS#Q#). */
  shapeIndex?: number;
  /** 1 = as described, 2 = rotated 90° clockwise. */
  shapeOrientation?: 1 | 2;
};

export type GuillotineRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GuillotinePiece = {
  node: GuillotineNode;
  depth: number;
  region: GuillotineRegion;
  /** Index into `cuts` of the separation line that freed this blank. */
  cutIndex: number;
};

export type GuillotineResult = {
  pieces: GuillotinePiece[];
  cuts: Cut[];
  warnings: string[];
};

const EPS = 0.01;
/** A cut may over-run the band by this much before it counts as an error. */
const OVERSIZE_TOLERANCE = 0.5;

export function walkGuillotine(
  nodes: readonly GuillotineNode[],
  levels: readonly GuillotineLevel[],
  sheet: { width: number; height: number },
  vendor: string,
  origin: { x: number; y: number } = { x: 0, y: 0 },
  startSeq = 0
): GuillotineResult {
  const pieces: GuillotinePiece[] = [];
  const cuts: Cut[] = [];
  const warnings: string[] = [];

  const depthOf = new Map<string, number>();
  levels.forEach((l, i) => depthOf.set(l.letter, i));

  const sheetRegion: GuillotineRegion = { x: origin.x, y: origin.y, width: sheet.width, height: sheet.height };
  /** Space still available at each depth. */
  const remaining: GuillotineRegion[] = [{ ...sheetRegion }];
  /** Blank detached at each depth — children subdivide this rectangle. */
  const taken: GuillotineRegion[] = [];

  let seq = startSeq;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const depth = depthOf.get(node.letter);
    if (depth === undefined) {
      warnings.push(`Unknown cut level "${node.letter}" on record ${i + 1}`);
      continue;
    }

    while (remaining.length <= depth) {
      const parent = taken.length > 0 ? taken[taken.length - 1]! : sheetRegion;
      remaining.push({ ...parent });
      taken.push({ ...parent });
    }
    remaining.length = depth + 1;
    taken.length = depth + 1;

    const rem = remaining[depth]!;
    const vertical = levels[depth]!.axis === "X";

    if (!(node.value > EPS)) {
      warnings.push(`Cut level ${node.letter} on record ${i + 1} has size ${node.value}`);
      continue;
    }
    // Optimizers are allowed to over-declare the last strip of a band (the cut
    // then lands exactly on the container edge), so only a real overflow is
    // reported.
    const limit = vertical ? rem.width : rem.height;
    if (node.value > limit + OVERSIZE_TOLERANCE) {
      warnings.push(
        `Cut level ${node.letter} on record ${i + 1} (${node.value}) exceeds the remaining ${vertical ? "width" : "height"} ${limit.toFixed(1)}`
      );
    }

    const piece: GuillotineRegion = vertical
      ? { x: rem.x, y: rem.y, width: Math.min(node.value, rem.width), height: rem.height }
      : { x: rem.x, y: rem.y, width: rem.width, height: Math.min(node.value, rem.height) };

    // Separation line: the trailing edge of the detached blank.
    const cut: Cut = vertical
      ? {
          type: "line",
          points: [
            { x: piece.x + piece.width, y: rem.y },
            { x: piece.x + piece.width, y: rem.y + rem.height },
          ],
          sequenceIndex: seq++,
          stage: depth + 1,
          stageLabel: stageLabel(vendor, depth + 1),
        }
      : {
          type: "line",
          points: [
            { x: rem.x, y: piece.y + piece.height },
            { x: rem.x + rem.width, y: piece.y + piece.height },
          ],
          sequenceIndex: seq++,
          stage: depth + 1,
          stageLabel: stageLabel(vendor, depth + 1),
        };
    cuts.push(cut);

    if (vertical) {
      rem.x += piece.width;
      rem.width -= piece.width;
    } else {
      rem.y += piece.height;
      rem.height -= piece.height;
    }
    taken.push(piece);

    pieces.push({ node, depth, region: piece, cutIndex: cuts.length - 1 });
  }

  return { pieces, cuts, warnings };
}

/* ------------------------------------------------------------------ */
/*  Rect-set → guillotine decomposition                                 */
/* ------------------------------------------------------------------ */

export type RectInput = {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  rackCode?: string;
  polygon?: Point[];
  rotated?: boolean;
};

export type RectDecomposition = {
  cuts: Cut[];
  panes: Pane[];
  warnings: string[];
};

/**
 * Recover the guillotine break sequence from a set of placed, non-overlapping
 * rectangles. Used by formats that publish the *result* of an optimization
 * (Turomas V40 `placement`, Chaoyang `#RECT`, Perfect Cut `CS`) instead of the
 * cut list.
 *
 * At each step a full-span vertical or horizontal line is chosen that cleanly
 * separates the remaining rectangles into two non-empty groups; the recursion
 * depth doubles as the cut stage. Rectangles that leave a residual strip get
 * the trimming cuts needed to free them.
 */
export function decomposeRects(
  rects: readonly RectInput[],
  container: { width: number; height: number },
  vendor: string,
  origin: { x: number; y: number } = { x: 0, y: 0 },
  startSeq = 0,
  tolMm = 0.5
): RectDecomposition {
  const cuts: Cut[] = [];
  const panes: Pane[] = [];
  const warnings: string[] = [];
  let seq = startSeq;

  const sheet: GuillotineRegion = { x: origin.x, y: origin.y, width: container.width, height: container.height };

  const pushVertical = (x: number, region: GuillotineRegion, depth: number) => {
    cuts.push({
      type: "line",
      points: [
        { x, y: region.y },
        { x, y: region.y + region.height },
      ],
      sequenceIndex: seq++,
      stage: depth + 1,
      stageLabel: stageLabel(vendor, depth + 1),
    });
  };

  const pushHorizontal = (y: number, region: GuillotineRegion, depth: number) => {
    cuts.push({
      type: "line",
      points: [
        { x: region.x, y },
        { x: region.x + region.width, y },
      ],
      sequenceIndex: seq++,
      stage: depth + 1,
      stageLabel: stageLabel(vendor, depth + 1),
    });
  };

  const emitPane = (r: RectInput, index: number) => {
    panes.push({
      id: r.id ?? `piece-${index + 1}`,
      bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
      polygon: r.polygon,
      label: r.label,
      rackCode: r.rackCode,
      rotated: r.rotated,
    });
  };

  const isolate = (region: GuillotineRegion, r: RectInput, depth: number, index: number) => {
    // Trim the residual strips on the bottom and left, then free the blank.
    if (r.y > region.y + tolMm) pushHorizontal(r.y, region, depth);
    if (r.x > region.x + tolMm) pushVertical(r.x, region, depth);
    emitPane(r, index);
    if (r.x + r.width < region.x + region.width - tolMm) pushVertical(r.x + r.width, region, depth);
    if (r.y + r.height < region.y + region.height - tolMm) pushHorizontal(r.y + r.height, region, depth);
  };

  let paneCount = 0;

  const recurse = (region: GuillotineRegion, pool: RectInput[], depth: number) => {
    if (pool.length === 0) return;
    if (depth > 9) {
      for (const r of pool) isolate(region, r, depth, ++paneCount);
      return;
    }
    if (pool.length === 1) {
      isolate(region, pool[0]!, depth, ++paneCount);
      return;
    }

    // Candidate vertical split lines: every rectangle's left and right edge.
    const xEdges = [...new Set(pool.flatMap((r) => [round(r.x), round(r.x + r.width)]))]
      .filter((v) => v > region.x + tolMm && v < region.x + region.width - tolMm)
      .sort((a, b) => a - b);

    for (const x of xEdges) {
      if (pool.some((r) => r.x < x - tolMm && r.x + r.width > x + tolMm)) continue;
      const left = pool.filter((r) => r.x + r.width <= x + tolMm);
      const right = pool.filter((r) => r.x >= x - tolMm);
      if (left.length === 0 || right.length === 0) continue;
      pushVertical(x, region, depth);
      recurse({ x: region.x, y: region.y, width: x - region.x, height: region.height }, left, depth + 1);
      recurse({ x, y: region.y, width: region.x + region.width - x, height: region.height }, right, depth + 1);
      return;
    }

    const yEdges = [...new Set(pool.flatMap((r) => [round(r.y), round(r.y + r.height)]))]
      .filter((v) => v > region.y + tolMm && v < region.y + region.height - tolMm)
      .sort((a, b) => a - b);

    for (const y of yEdges) {
      if (pool.some((r) => r.y < y - tolMm && r.y + r.height > y + tolMm)) continue;
      const below = pool.filter((r) => r.y + r.height <= y + tolMm);
      const above = pool.filter((r) => r.y >= y - tolMm);
      if (below.length === 0 || above.length === 0) continue;
      pushHorizontal(y, region, depth);
      recurse({ x: region.x, y: region.y, width: region.width, height: y - region.y }, below, depth + 1);
      recurse({ x: region.x, y, width: region.width, height: region.y + region.height - y }, above, depth + 1);
      return;
    }

    // No clean guillotine line (free-form nest): keep the rectangles visible.
    warnings.push(`Could not split a container ${region.width.toFixed(1)}×${region.height.toFixed(1)} mm into guillotine steps; ${pool.length} pieces kept as outlines`);
    for (const r of pool) isolate(region, r, depth, ++paneCount);
  };

  const round = (v: number) => Math.round(v * 1000) / 1000;
  recurse(sheet, rects.map((r) => ({ ...r })), 0);

  return { cuts, panes, warnings };
}

/**
 * Reconstruct panes from a list of score segments that already form a
 * guillotine sequence. Vendors that post-process an optimization straight to
 * machine code (Eagle / Linghua ISAC) write the scores without the blank
 * rectangles, but every score still spans the full width or height of the
 * remaining glass, so the blanks follow from the cut order.
 *
 * Lines are consumed in the machine's own sequence order, which is the order the
 * operator breaks the sheet in.
 */
export function panesFromScoreSegments(
  cuts: readonly Cut[],
  container: { width: number; height: number },
  vendor: string,
  origin: { x: number; y: number } = { x: 0, y: 0 },
  tolMm = 2
): Pane[] {
  type Vert = { x: number; y0: number; y1: number; seq: number };
  type Horz = { y: number; x0: number; x1: number; seq: number };

  const vertical: Vert[] = [];
  const horizontal: Horz[] = [];

  for (const cut of cuts) {
    if (cut.type !== "line" || cut.points.length !== 2) continue;
    const [a, b] = cut.points;
    const seq = cut.sequenceIndex ?? 0;
    if (Math.abs(a.x - b.x) <= tolMm) {
      vertical.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), seq });
    } else if (Math.abs(a.y - b.y) <= tolMm) {
      horizontal.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), seq });
    }
  }

  const panes: Pane[] = [];
  const used = new Set<Vert | Horz>();
  let paneIndex = 0;

  const recurse = (region: GuillotineRegion) => {
    if (region.width <= tolMm || region.height <= tolMm) return;

    // A usable line crosses the whole region, edge to edge.
    const spanV = vertical
      .filter((v) => !used.has(v))
      .filter((v) => v.x > region.x + tolMm && v.x < region.x + region.width - tolMm)
      .filter((v) => v.y0 <= region.y + tolMm && v.y1 >= region.y + region.height - tolMm)
      .sort((a, b) => a.seq - b.seq)[0];

    if (spanV) {
      used.add(spanV);
      recurse({ x: region.x, y: region.y, width: spanV.x - region.x, height: region.height });
      recurse({ x: spanV.x, y: region.y, width: region.x + region.width - spanV.x, height: region.height });
      return;
    }

    const spanH = horizontal
      .filter((h) => !used.has(h))
      .filter((h) => h.y > region.y + tolMm && h.y < region.y + region.height - tolMm)
      .filter((h) => h.x0 <= region.x + tolMm && h.x1 >= region.x + region.width - tolMm)
      .sort((a, b) => a.seq - b.seq)[0];

    if (spanH) {
      used.add(spanH);
      recurse({ x: region.x, y: region.y, width: region.width, height: spanH.y - region.y });
      recurse({ x: region.x, y: spanH.y, width: region.width, height: region.y + region.height - spanH.y });
      return;
    }

    // Nothing else crosses this region: it is a finished blank.
    paneIndex += 1;
    panes.push({ id: `blank-${paneIndex}`, bounds: { ...region } });
  };

  recurse({ x: origin.x, y: origin.y, width: container.width, height: container.height });

  void vendor;
  return panes;
}

/** Bounding box of a point list. */
export function boundsOf(points: readonly Point[]): GuillotineRegion {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Build the affine map that takes a local shape path into `region`.
 *
 * The rotation is taken about the path's own **centre** — rotating about its
 * corner would leave a 90° placement in the negative quadrant and push the
 * shape off the sheet. The result is centred in `region`; if the path is larger
 * than the blank it is not scaled down, it simply overhangs.
 *
 * The same map must be applied to arc centres, so return the function itself.
 */
export function shapeTransform(
  local: readonly Point[],
  region: GuillotineRegion,
  rotationDeg: number
): (p: Point) => Point {
  const box = boundsOf(local);
  const swap = rotationDeg === 90 || rotationDeg === 270;
  const w = swap ? box.height : box.width;
  const h = swap ? box.width : box.height;
  // Where the rotated shape's own corner should land.
  const offX = region.x + (region.width - w) / 2;
  const offY = region.y + (region.height - h) / 2;

  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // Rotate about the centre of the path's own bounding box. Rotating about a
  // corner would leave a 90° placement in the negative quadrant.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // After the rotation the shape is centred on the origin with extent w × h,
  // so shifting by half of it puts the rotated box's corner at (offX, offY).
  const tx = offX + w / 2;
  const ty = offY + h / 2;
  return (p: Point) => {
    const rx = p.x - cx;
    const ry = p.y - cy;
    return { x: tx + rx * c - ry * s, y: ty + rx * s + ry * c };
  };
}

/** Translate + rotate a local shape path into the given blank rectangle. */
export function placeShape(
  local: readonly Point[],
  region: GuillotineRegion,
  rotationDeg: number
): Point[] {
  const map = shapeTransform(local, region, rotationDeg);
  return local.map(map);
}