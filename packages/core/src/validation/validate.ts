import type { CutDocument, CutPlan } from "../model/types.js";
import { arcCenter } from "../geometry/arc.js";
import { dialectFor, type MachineDialect } from "./dialects.js";
import {
  candidatePairs,
  cutToSegments,
  hashSegs,
  projectionOverlap,
  segmentAngle,
  segmentDistance,
  segmentsCrossProperly,
  type IndexedSeg,
} from "./spatial.js";

export type IssueCode =
  | "ZERO_LENGTH_CUT"
  | "CUT_OUT_OF_BOUNDS"
  | "CUT_IN_TRIM"
  | "DUPLICATE_CUT_LINE"
  | "CROSSING_CUTS"
  | "KERF_PROXIMITY"
  | "INVALID_ARC"
  | "OPEN_CONTOUR";

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  code: IssueCode;
  severity: Severity;
  message: string;
  sheetIndex: number;
  sheetLabel?: string;
  cutIndex?: number;
  paneId?: string;
  focus: { x: number; y: number; width: number; height: number };
}

export interface IssueGroup {
  code: IssueCode;
  severity: Severity;
  count: number;
  issues: ValidationIssue[];
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function groupIssues(issues: ValidationIssue[]): IssueGroup[] {
  const map = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    let g = map.get(key);
    if (!g) {
      g = { code: issue.code, severity: issue.severity, count: 0, issues: [] };
      map.set(key, g);
    }
    g.count++;
    if (g.issues.length < 50) g.issues.push(issue);
  }
  return [...map.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);
}

function cutFocus(sheet: CutPlan, cutIndex: number): { x: number; y: number; width: number; height: number } {
  const cut = sheet.cuts[cutIndex];
  if (!cut) return { x: 0, y: 0, width: sheet.sheet.width, height: sheet.sheet.height };
  const xs = cut.points.map((p) => p.x);
  const ys = cut.points.map((p) => p.y);
  if (cut.center && cut.radius !== undefined) {
    xs.push(cut.center.x - cut.radius, cut.center.x + cut.radius);
    ys.push(cut.center.y - cut.radius, cut.center.y + cut.radius);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: x - 10, y: y - 10, width: Math.max(...xs) - x + 20, height: Math.max(...ys) - y + 20 };
}

function validateSheet(
  sheet: CutPlan,
  sheetIndex: number,
  dialect: MachineDialect,
  issues: ValidationIssue[]
): void {
  const { width, height, trims } = sheet.sheet;
  const EPS = 0.5;

  /* ---- per-cut checks ---- */
  sheet.cuts.forEach((cut, cutIndex) => {
    const pts = cut.points;

    // zero length
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01) {
        issues.push({
          code: "ZERO_LENGTH_CUT",
          severity: "error",
          message: `Cut ${cut.sequenceIndex}: zero-length segment at (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`,
          sheetIndex,
          cutIndex,
          focus: { x: a.x - 10, y: a.y - 10, width: 20, height: 20 },
        });
        break;
      }
    }

    // arc validity
    if (cut.type === "arc") {
      const a = pts[0];
      const b = pts[1] ?? pts[0];
      const r = cut.radius ?? 0;
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const isFullCircle = chord < 0.01;
      if (!cut.center || !Number.isFinite(r) || r <= 0) {
        issues.push({
          code: "INVALID_ARC",
          severity: "error",
          message: `Cut ${cut.sequenceIndex}: arc has missing center or non-positive radius`,
          sheetIndex,
          cutIndex,
          focus: cutFocus(sheet, cutIndex),
        });
      } else if (!isFullCircle && chord > 2 * r + 0.01) {
        issues.push({
          code: "INVALID_ARC",
          severity: "error",
          message: `Cut ${cut.sequenceIndex}: arc radius ${r.toFixed(1)}mm too small for chord ${chord.toFixed(1)}mm`,
          sheetIndex,
          cutIndex,
          focus: cutFocus(sheet, cutIndex),
        });
      } else if (cut.center && arcCenter({ start: a, end: b, radius: r, side: cut.ccw ? -1 : 1 }) === null && !isFullCircle) {
        issues.push({
          code: "INVALID_ARC",
          severity: "warning",
          message: `Cut ${cut.sequenceIndex}: arc geometry cannot be resolved`,
          sheetIndex,
          cutIndex,
          focus: cutFocus(sheet, cutIndex),
        });
      }
    }

    // out of bounds (full sheet)
    for (const p of pts) {
      if (p.x < -EPS || p.y < -EPS || p.x > width + EPS || p.y > height + EPS) {
        issues.push({
          code: "CUT_OUT_OF_BOUNDS",
          severity: "error",
          message: `Cut ${cut.sequenceIndex}: point (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) outside sheet ${width}×${height}`,
          sheetIndex,
          cutIndex,
          focus: { x: p.x - 25, y: p.y - 25, width: 50, height: 50 },
        });
        break;
      }
    }

    // cut inside trim margin
    if (trims && (trims.left > 0 || trims.top > 0 || trims.right > 0 || trims.bottom > 0)) {
      const usable = {
        x0: trims.left,
        y0: trims.top,
        x1: width - trims.right,
        y1: height - trims.bottom,
      };
      for (const p of pts) {
        const insideTrim =
          p.x >= usable.x0 - EPS && p.x <= usable.x1 + EPS && p.y >= usable.y0 - EPS && p.y <= usable.y1 + EPS;
        if (!insideTrim) {
          issues.push({
            code: "CUT_IN_TRIM",
            severity: "warning",
            message: `Cut ${cut.sequenceIndex}: runs into the trim border at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`,
            sheetIndex,
            cutIndex,
            focus: { x: p.x - 25, y: p.y - 25, width: 50, height: 50 },
          });
          break;
        }
      }
    }
  });

  /* ---- duplicate detection (exact-ish keys) ---- */
  const segKey = (cut: CutPlan["cuts"][number]): string => {
    // Deletion tracks (Low-E, seal, print) legitimately retrace the outline of
    // the pane they belong to, so they are keyed by process too.
    const proc = cut.process ? `#${cut.process}` : "";
    if (cut.points.length !== 2) return `poly:${proc}${cut.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";")}`;
    const a = cut.points[0];
    const b = cut.points[1];
    const k1 = `${a.x.toFixed(2)},${a.y.toFixed(2)}|${b.x.toFixed(2)},${b.y.toFixed(2)}`;
    const k2 = `${b.x.toFixed(2)},${b.y.toFixed(2)}|${a.x.toFixed(2)},${a.y.toFixed(2)}`;
    return k1 < k2 ? k1 : k2;
  };
  const seen = new Map<string, number>();
  sheet.cuts.forEach((cut, cutIndex) => {
    const key = segKey(cut);
    const prev = seen.get(key);
    if (prev !== undefined) {
      issues.push({
        code: "DUPLICATE_CUT_LINE",
        severity: "error",
        message: `Cut ${cut.sequenceIndex} duplicates cut ${sheet.cuts[prev].sequenceIndex}`,
        sheetIndex,
        cutIndex,
        focus: cutFocus(sheet, cutIndex),
      });
    } else {
      seen.set(key, cutIndex);
    }
  });

  /* ---- spatial checks: crossings + kerf proximity (all orientations) ---- */
  const segs: IndexedSeg[] = [];
  sheet.cuts.forEach((cut, cutIndex) => {
    cutToSegments(cut).forEach((seg, segIndex) => {
      if (seg.len > 0.01) segs.push({ seg, cutIndex, segIndex });
    });
  });

  const kerfMin = dialect.kerfMinDistanceMm;
  const grid = hashSegs(segs, Math.max(kerfMin * 4, 20));
  const flaggedKerf = new Set<string>();

/**
   * Two cuts from *different work processes* overlap by design: a Low-E or
   * seal/deletion track is derived from the cutting outline it runs along, so
   * it necessarily crosses it. An untagged cut counts as the plain `CUT`
   * process, which is what the parsers emit for a cutting outline.
   */
  const processOf = (cutIndex: number): string => sheet.cuts[cutIndex]?.process ?? "CUT";
  const differentProcess = (a: number, b: number): boolean => processOf(a) !== processOf(b);

  for (const [A, B] of candidatePairs(grid)) {
    if (differentProcess(A.cutIndex, B.cutIndex)) continue;

    // crossing cuts (proper interior intersections)
    if (segmentsCrossProperly(A.seg, B.seg)) {
      issues.push({
        code: "CROSSING_CUTS",
        severity: "error",
        message: `Cuts ${sheet.cuts[A.cutIndex].sequenceIndex} and ${sheet.cuts[B.cutIndex].sequenceIndex} cross each other`,
        sheetIndex,
        cutIndex: A.cutIndex,
        focus: cutFocus(sheet, A.cutIndex),
      });
      continue;
    }

    // kerf proximity: near-parallel segments closer than kerfMin with overlap
    const d = segmentDistance(A.seg, B.seg);
    if (d > 0.05 && d < kerfMin) {
      const angle = segmentAngle(A.seg, B.seg);
      if (angle < 0.2 /* ~11° */) {
        const overlap = Math.min(projectionOverlap(A.seg, B.seg), projectionOverlap(B.seg, A.seg));
        if (overlap > 1) {
          const key = A.cutIndex < B.cutIndex ? `${A.cutIndex}|${B.cutIndex}` : `${B.cutIndex}|${A.cutIndex}`;
          if (!flaggedKerf.has(key)) {
            flaggedKerf.add(key);
            issues.push({
              code: "KERF_PROXIMITY",
              severity: "warning",
              message: `Cuts ${sheet.cuts[A.cutIndex].sequenceIndex} and ${sheet.cuts[B.cutIndex].sequenceIndex} run ${d.toFixed(1)}mm apart (< ${kerfMin}mm) for ${overlap.toFixed(0)}mm`,
              sheetIndex,
              cutIndex: A.cutIndex,
              focus: cutFocus(sheet, A.cutIndex),
            });
          }
        }
      }
    }
  }

  /* ---- pane contour checks ---- */
  for (const pane of sheet.panes) {
    if (!pane.polygon || pane.polygon.length === 0) continue;
    const poly = pane.polygon;
    if (poly.length < 3) {
      issues.push({
        code: "OPEN_CONTOUR",
        severity: "warning",
        message: `Pane ${pane.id}: contour has only ${poly.length} points`,
        sheetIndex,
        paneId: pane.id,
        focus: { ...pane.bounds },
      });
      continue;
    }
    // degenerate consecutive duplicates
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01) {
        issues.push({
          code: "OPEN_CONTOUR",
          severity: "warning",
          message: `Pane ${pane.id}: contour has repeated consecutive points`,
          sheetIndex,
          paneId: pane.id,
          focus: { ...pane.bounds },
        });
        break;
      }
    }
  }
}

/** Cap guards against pathological O(n²) blowups. */
const MAX_SEGMENTS = 20000;

export function validateCutDocument(doc: CutDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dialect = dialectFor(doc.metadata.vendor);
  doc.sheets.forEach((sheet, sheetIndex) => {
    const segCount = sheet.cuts.reduce(
      (n, c) => n + Math.max(1, c.points.length - 1) * (c.type === "arc" ? 16 : 1),
      0
    );
    if (segCount > MAX_SEGMENTS) {
      issues.push({
        code: "KERF_PROXIMITY",
        severity: "info",
        message: `Sheet ${sheetIndex + 1}: ${segCount} segments exceed spatial-check cap (${MAX_SEGMENTS}); proximity and crossing checks skipped`,
        sheetIndex,
        focus: { x: 0, y: 0, width: sheet.sheet.width, height: sheet.sheet.height },
      });
      // still run per-cut checks
      const light: ValidationIssue[] = [];
      validateSheetLight(sheet, sheetIndex, issues);
      return;
    }
    validateSheet(sheet, sheetIndex, dialect, issues);
  });
  return issues;
}

/** Per-cut checks only (zero-length, bounds, arcs) for very large sheets. */
function validateSheetLight(sheet: CutPlan, sheetIndex: number, issues: ValidationIssue[]): void {
  const { width, height } = sheet.sheet;
  const EPS = 0.5;
  sheet.cuts.forEach((cut, cutIndex) => {
    for (let i = 0; i < cut.points.length - 1; i++) {
      const a = cut.points[i];
      const b = cut.points[i + 1];
      if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01) {
        issues.push({
          code: "ZERO_LENGTH_CUT",
          severity: "error",
          message: `Cut ${cut.sequenceIndex}: zero-length segment`,
          sheetIndex,
          cutIndex,
          focus: { x: a.x - 10, y: a.y - 10, width: 20, height: 20 },
        });
        break;
      }
    }
    for (const p of cut.points) {
      if (p.x < -EPS || p.y < -EPS || p.x > width + EPS || p.y > height + EPS) {
        issues.push({
          code: "CUT_OUT_OF_BOUNDS",
          severity: "error",
          message: `Cut ${cut.sequenceIndex}: point outside sheet`,
          sheetIndex,
          cutIndex,
          focus: { x: p.x - 25, y: p.y - 25, width: 50, height: 50 },
        });
        break;
      }
    }
  });
}
