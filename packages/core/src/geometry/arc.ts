import type { Point } from "../model/types.js";

/**
 * Arc geometry shared by parsers and renderers.
 * An arc is defined by start/end points, radius, and a side flag:
 * side > 0 → center on the left of the start→end direction,
 * side < 0 → center on the right. (Intermac [Shape] `C=` flag maps directly.)
 */
export interface ArcParams {
  start: Point;
  end: Point;
  radius: number;
  side: number; // +1 / -1
}

/** Compute the arc center from start/end/radius/side. Returns null when degenerate. */
export function arcCenter({ start, end, radius, side }: ArcParams): Point | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return null; // full circle needs a different encoding
  if (d > 2 * radius + 1e-6) return null; // impossible geometry

  const h = Math.sqrt(Math.max(0, radius * radius - (d / 2) * (d / 2)));
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  // unit perpendicular (left of direction)
  const ux = -dy / d;
  const uy = dx / d;
  const s = side >= 0 ? 1 : -1;
  return { x: mx + s * ux * h, y: my + s * uy * h };
}

/** Start/end angles (radians) of the arc around the computed center. */
export function arcAngles(p: ArcParams): { center: Point; startAngle: number; endAngle: number } | null {
  const center = arcCenter(p);
  if (!center) return null;
  return {
    center,
    startAngle: Math.atan2(p.start.y - center.y, p.start.x - center.x),
    endAngle: Math.atan2(p.end.y - center.y, p.end.x - center.x),
  };
}

/**
 * Whether the arc runs counter-clockwise from start to end.
 * Convention (matches Intermac C flag): side > 0 → clockwise in a
 * Y-down viewer space; we expose ccw for canvas `ctx.arc`.
 */
export function arcIsCcw(side: number): boolean {
  return side < 0;
}

/** Sample an arc into a polyline (for hit testing / minimap / export). */
export function sampleArc(p: ArcParams, segments = 24): Point[] {
  const geo = arcAngles(p);
  if (!geo) return [p.start, p.end];
  const ccw = arcIsCcw(p.side);
  let sweep = geo.endAngle - geo.startAngle;
  if (ccw && sweep < 0) sweep += Math.PI * 2;
  if (!ccw && sweep > 0) sweep -= Math.PI * 2;
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = geo.startAngle + (sweep * i) / segments;
    pts.push({ x: geo.center.x + p.radius * Math.cos(a), y: geo.center.y + p.radius * Math.sin(a) });
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/*  Directed arcs (ISO / post-processor semantics)                     */
/* ------------------------------------------------------------------ */

/**
 * The same geometry expressed the way CNC post-processors mean it:
 * `ccw = true` puts the centre to the **left** of start→end and sweeps the
 * short way counter-clockwise. `arcIsCcw` above uses the legacy `C=` flag
 * convention of the Intermac family, so the two must not be mixed.
 */
export function arcCenterDirected(start: Point, end: Point, radius: number, ccw: boolean): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return start;
  const h = Math.sqrt(Math.max(0, radius * radius - (d / 2) * (d / 2)));
  // Unit normal to the left of start→end.
  const ux = -dy / d;
  const uy = dx / d;
  const s = ccw ? 1 : -1;
  return { x: (start.x + end.x) / 2 + s * ux * h, y: (start.y + end.y) / 2 + s * uy * h };
}

/**
 * Sample an arc around an **explicitly supplied centre**.
 *
 * Use this whenever the source format writes the centre (ISO `I`/`J`, Turomas
 * `i`/`j`, `{:CX/CY}`): the centre then decides which side of the chord the arc
 * bulges to, and re-deriving it from radius + direction would silently pick the
 * mirror solution — the long way round the circle.
 *
 * The sweep follows `ccw` (true = counter-clockwise in a Y-up frame).
 */
export function sampleArcAbout(
  center: Point,
  start: Point,
  end: Point,
  radius: number,
  ccw: boolean,
  segments = 24
): Point[] {
  const r = Math.max(Math.abs(radius), 1e-9);
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(end.y - center.y, end.x - center.x);
  let sweep = a1 - a0;
  if (sweep <= 1e-12) sweep += Math.PI * 2;
  if (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  if (!ccw) sweep -= Math.PI * 2;

  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (sweep * i) / segments;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  // Pin the endpoints so the path stays attached to the source geometry.
  pts[0] = { x: start.x, y: start.y };
  pts[pts.length - 1] = { x: end.x, y: end.y };
  return pts;
}

/** Sample a directed arc, honouring a start point equal to the end point (full circle). */
export function sampleArcDirected(
  start: Point,
  end: Point,
  radius: number,
  ccw: boolean,
  segments = 24
): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);

  // Full circle: start and end coincide and the centre came from I/J.
  if (chord < 1e-9) {
    const center = arcCenterDirected(start, { x: start.x + radius, y: start.y }, radius, ccw);
    const pts: Point[] = [];
    for (let i = 0; i <= segments * 2; i++) {
      const a = (ccw ? 1 : -1) * (Math.PI * 2 * i) / (segments * 2);
      pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
    }
    return pts;
  }

  const center = arcCenterDirected(start, end, radius, ccw);
  let a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let a1 = Math.atan2(end.y - center.y, end.x - center.x);
  let sweep = a1 - a0;
  if (ccw && sweep <= 0) sweep += Math.PI * 2;
  if (!ccw && sweep >= 0) sweep -= Math.PI * 2;

  const pts: Point[] = [];
  for (let i = 1; i <= segments; i++) {
    const a = a0 + (sweep * i) / segments;
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  pts[pts.length - 1] = end;
  return pts;
}
