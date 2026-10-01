import type { Point, Cut } from "../model/types.js";
import { cutPathPoints } from "../sim/timeline.js";

/**
 * Spatial hash + segment geometry for validation broad-phase.
 * Ported in spirit from spil-opti's spatialHash.js, adapted to CutDocument.
 */

export interface Seg {
  a: Point;
  b: Point;
  /** Distance between endpoints (0 for degenerate). */
  len: number;
}

export function cutToSegments(cut: Cut): Seg[] {
  const pts = cutPathPoints(cut);
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push({ a: pts[i], b: pts[i + 1], len: Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) });
  }
  return out;
}

/* ---------------- segment geometry ---------------- */

function orient(p: Point, q: Point, r: Point): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

/**
 * Proper intersection test: segments cross at an interior point of both.
 * Endpoint touches (T-junctions, common in guillotine layouts) return false.
 */
export function segmentsCrossProperly(s1: Seg, s2: Seg): boolean {
  const o1 = orient(s1.a, s1.b, s2.a);
  const o2 = orient(s1.a, s1.b, s2.b);
  const o3 = orient(s2.a, s2.b, s1.a);
  const o4 = orient(s2.a, s2.b, s1.b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true; // proper crossing
  }
  // collinear overlaps handled by duplicate detection, not here
  return false;
}

function pointSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Minimum distance between two segments. */
export function segmentDistance(s1: Seg, s2: Seg): number {
  if (segmentsCrossProperly(s1, s2)) return 0;
  return Math.min(
    pointSegDist(s1.a, s2.a, s2.b),
    pointSegDist(s1.b, s2.a, s2.b),
    pointSegDist(s2.a, s1.a, s1.b),
    pointSegDist(s2.b, s1.a, s1.b)
  );
}

/** Angle between segments in radians (0 = parallel). */
export function segmentAngle(s1: Seg, s2: Seg): number {
  const a1 = Math.atan2(s1.b.y - s1.a.y, s1.b.x - s1.a.x);
  const a2 = Math.atan2(s2.b.y - s2.a.y, s2.b.x - s2.a.x);
  let d = Math.abs(a1 - a2) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/** Projection overlap of s2 onto s1's direction (>= 0). 0 = perpendicular ends only. */
export function projectionOverlap(s1: Seg, s2: Seg): number {
  const dx = s1.b.x - s1.a.x;
  const dy = s1.b.y - s1.a.y;
  const l = Math.hypot(dx, dy);
  if (l === 0) return 0;
  const ux = dx / l;
  const uy = dy / l;
  const t1 = (s2.a.x - s1.a.x) * ux + (s2.a.y - s1.a.y) * uy;
  const t2 = (s2.b.x - s1.a.x) * ux + (s2.b.y - s1.a.y) * uy;
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  // overlap with [0, l]
  return Math.max(0, Math.min(hi, l) - Math.max(lo, 0));
}

/* ---------------- spatial hash broad-phase ---------------- */

export interface IndexedSeg {
  seg: Seg;
  cutIndex: number;
  segIndex: number;
}

export function hashSegs(segs: IndexedSeg[], cellSize: number): Map<string, IndexedSeg[]> {
  const grid = new Map<string, IndexedSeg[]>();
  for (const item of segs) {
    const { a, b } = item.seg;
    const x0 = Math.floor(Math.min(a.x, b.x) / cellSize);
    const x1 = Math.floor(Math.max(a.x, b.x) / cellSize);
    const y0 = Math.floor(Math.min(a.y, b.y) / cellSize);
    const y1 = Math.floor(Math.max(a.y, b.y) / cellSize);
    // insert into every cell the segment's bbox touches (cap for very long segs)
    const stride = x1 - x0 > 64 || y1 - y0 > 64 ? Math.max(x1 - x0, y1 - y0) : 1;
    for (let gx = x0; gx <= x1; gx += stride) {
      for (let gy = y0; gy <= y1; gy += stride) {
        const key = `${gx},${gy}`;
        const list = grid.get(key);
        if (list) list.push(item);
        else grid.set(key, [item]);
      }
    }
  }
  return grid;
}

/**
 * Candidate pairs: every unordered pair of segments that share at least one grid
 * cell. Pairs that only share a cell can still be far apart, so callers must
 * apply the real distance / angle tests afterwards.
 */
export function* candidatePairs(grid: Map<string, IndexedSeg[]>): Generator<[IndexedSeg, IndexedSeg]> {
  const seen = new Set<string>();
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        if (A.cutIndex === B.cutIndex && A.segIndex === B.segIndex) continue;
        const key = A.cutIndex < B.cutIndex
          ? `${A.cutIndex}:${A.segIndex}|${B.cutIndex}:${B.segIndex}`
          : `${B.cutIndex}:${B.segIndex}|${A.cutIndex}:${A.segIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        yield [A, B];
      }
    }
  }
}
