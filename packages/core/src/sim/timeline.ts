import { sampleArc, sampleArcAbout } from "../geometry/arc.js";
import type { Cut, CutPlan, Point } from "../model/types.js";
import {
  moveDisplacementMm,
  moveTimeS,
  type MachineKinematics,
} from "./kinematics.js";

export type TimelineSegment =
  | { kind: "rapid"; from: Point; to: Point; startS: number; endS: number }
  | { kind: "toolDown" | "toolUp"; at: Point; startS: number; endS: number }
  | { kind: "score"; cutIndex: number; path: Point[]; startS: number; endS: number; lengthMm: number };

export type CutTimeline = {
  totalS: number;
  cuttingLengthMm: number;
  rapidLengthMm: number;
  kinematics: MachineKinematics;
  segments: TimelineSegment[];
};

export type HeadState = {
  pos: Point;
  activeCutIndex: number | null;
  phase: "rapid" | "score" | "toolDown" | "toolUp" | "done";
  cutProgress: number;
};

const EPS_MM = 1e-4;

function clonePt(p: Point): Point {
  return { x: p.x, y: p.y };
}

export function cutPathPoints(cut: Cut): Point[] {
  if (cut.type === "arc" && cut.radius && cut.points.length >= 2) {
    const start = cut.points[0]!;
    const end = cut.points[1]!;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) return [clonePt(start)];
    // A parser that supplied the centre has already resolved which side of the
    // chord the arc bulges to; re-deriving it would trace the mirror solution.
    if (cut.center) {
      return sampleArcAbout(cut.center, start, end, cut.radius, cut.ccw === true, 32).map(clonePt);
    }
    return sampleArc(
      { start, end, radius: cut.radius, side: cut.ccw ? -1 : 1 },
      32
    ).map(clonePt);
  }
  return cut.points.map(clonePt);
}

export function polylineLength(pts: Point[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    n += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return n;
}

export function pointAlongPolyline(pts: Point[], distMm: number): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1 || distMm <= 0) return clonePt(pts[0]!);
  let remain = distMm;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (remain <= len || i === pts.length - 1) {
      const u = len < 1e-12 ? 1 : Math.min(1, remain / len);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    remain -= len;
  }
  return clonePt(pts[pts.length - 1]!);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpMove(
  from: Point,
  to: Point,
  vmax: number,
  accel: number,
  tLocal: number
): Point {
  const d = dist(from, to);
  if (d < EPS_MM) return clonePt(to);
  const s = moveDisplacementMm(d, vmax, accel, tLocal);
  const u = Math.min(1, s / d);
  return { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
}

function pushTimed(
  segments: TimelineSegment[],
  seg: TimelineSegment,
  t: number
): number {
  if (seg.endS - seg.startS <= 1e-12) return t;
  segments.push(seg);
  return seg.endS;
}

export function buildTimeline(plan: CutPlan, k: MachineKinematics): CutTimeline {
  const ordered = [...plan.cuts].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  const segments: TimelineSegment[] = [];
  let t = 0;
  let pos: Point = { x: 0, y: 0 };
  let headDown = false;
  let cuttingLengthMm = 0;
  let rapidLengthMm = 0;

  for (const cut of ordered) {
    const path = cutPathPoints(cut);
    const lengthMm = polylineLength(path);
    if (path.length === 0) continue;
    const start = path[0]!;
    const travel = dist(pos, start);

    if (travel >= EPS_MM) {
      if (headDown && k.headUpS > 0) {
        t = pushTimed(segments, { kind: "toolUp", at: clonePt(pos), startS: t, endS: t + k.headUpS }, t);
        headDown = false;
      }
      const dt = moveTimeS(travel, k.rapidSpeedMmS, k.accelMmS2);
      t = pushTimed(
        segments,
        { kind: "rapid", from: clonePt(pos), to: clonePt(start), startS: t, endS: t + dt },
        t
      );
      rapidLengthMm += travel;
      pos = clonePt(start);
    }

    if (!headDown && k.headDownS > 0) {
      t = pushTimed(segments, { kind: "toolDown", at: clonePt(pos), startS: t, endS: t + k.headDownS }, t);
      headDown = true;
    } else {
      headDown = true;
    }

    if (lengthMm >= EPS_MM) {
      const dt = moveTimeS(lengthMm, k.scoreSpeedMmS, k.accelMmS2);
      t = pushTimed(
        segments,
        {
          kind: "score",
          cutIndex: cut.sequenceIndex,
          path,
          startS: t,
          endS: t + dt,
          lengthMm,
        },
        t
      );
      cuttingLengthMm += lengthMm;
      pos = clonePt(path[path.length - 1]!);
    }
  }

  if (headDown && k.headUpS > 0 && segments.length > 0) {
    t = pushTimed(segments, { kind: "toolUp", at: clonePt(pos), startS: t, endS: t + k.headUpS }, t);
  }

  const totalS = segments.length ? segments[segments.length - 1]!.endS : 0;
  return { totalS, cuttingLengthMm, rapidLengthMm, kinematics: k, segments };
}

function endPos(seg: TimelineSegment): Point {
  if (seg.kind === "rapid") return clonePt(seg.to);
  if (seg.kind === "score") return clonePt(seg.path[seg.path.length - 1] ?? { x: 0, y: 0 });
  return clonePt(seg.at);
}

export function headAt(timeline: CutTimeline, tS: number): HeadState {
  const idle: HeadState = { pos: { x: 0, y: 0 }, activeCutIndex: null, phase: "done", cutProgress: 0 };
  const segs = timeline.segments;
  if (segs.length === 0) return idle;

  if (tS >= timeline.totalS) {
    return { pos: endPos(segs[segs.length - 1]!), activeCutIndex: null, phase: "done", cutProgress: 0 };
  }

  const t = Math.max(0, tS);
  let seg = segs[0]!;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (t < s.endS || i === segs.length - 1) {
      seg = s;
      break;
    }
  }

  const local = t - seg.startS;
  const k = timeline.kinematics;

  if (seg.kind === "rapid") {
    return {
      pos: lerpMove(seg.from, seg.to, k.rapidSpeedMmS, k.accelMmS2, local),
      activeCutIndex: null,
      phase: "rapid",
      cutProgress: 0,
    };
  }

  if (seg.kind === "score") {
    const travelled = moveDisplacementMm(seg.lengthMm, k.scoreSpeedMmS, k.accelMmS2, local);
    const cutProgress = seg.lengthMm < EPS_MM ? 1 : Math.min(1, Math.max(0, travelled / seg.lengthMm));
    return {
      pos: pointAlongPolyline(seg.path, travelled),
      activeCutIndex: seg.cutIndex,
      phase: "score",
      cutProgress,
    };
  }

  return { pos: clonePt(seg.at), activeCutIndex: null, phase: seg.kind, cutProgress: 0 };
}
