import type { CutDocument, CutPlan, ParseResult } from "@spil/cutcode-core";

export type IssueCode =
  | "ZERO_LENGTH_CUT"
  | "CUT_OUT_OF_BOUNDS"
  | "DUPLICATE_CUT_LINE"
  | "KERF_PROXIMITY";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  code: IssueCode;
  severity: Severity;
  message: string;
  sheetIndex: number;
  sheetLabel?: string;
  cutIndex?: number;
  /** World-space bounds to zoom to. */
  focus: { x: number; y: number; width: number; height: number };
}

const EPS = 0.5; // mm tolerance for bounds checks
const KERF_MIN = 3; // mm minimum parallel cut spacing
const MAX_KERF_CHECK_CUTS = 20000; // skip O(n²) kerf check above this

function cutBounds(cut: CutPlan["cuts"][number]) {
  const xs = cut.points.map((p) => p.x);
  const ys = cut.points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function segKey(cut: CutPlan["cuts"][number]): string {
  if (cut.points.length !== 2) return `poly:${cut.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";")}`;
  const a = cut.points[0];
  const b = cut.points[1];
  const nx = Math.round(a.x * 2) / 2;
  const ny = Math.round(a.y * 2) / 2;
  const mx = Math.round(b.x * 2) / 2;
  const my = Math.round(b.y * 2) / 2;
  // direction-agnostic
  const k1 = `${nx},${ny}|${mx},${my}`;
  const k2 = `${mx},${my}|${nx},${ny}`;
  return k1 < k2 ? k1 : k2;
}

/** Point-to-segment distance in mm. */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function validateDocument(doc: CutDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  doc.sheets.forEach((sheet, sheetIndex) => {
    const { width, height } = sheet.sheet;

    // zero-length + out-of-bounds
    sheet.cuts.forEach((cut, cutIndex) => {
      const pts = cut.points;
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
    });

    // duplicates
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
          focus: cutBounds(cut),
        });
      } else {
        seen.set(key, cutIndex);
      }
    });

    // kerf proximity (two-point cuts only)
    const segs = sheet.cuts
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.points.length === 2);
    if (segs.length <= MAX_KERF_CHECK_CUTS) {
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i].c.points;
        for (let j = i + 1; j < segs.length; j++) {
          const b = segs[j].c.points;
          // quick reject via bounds
          const b1 = cutBounds(segs[i].c);
          const b2 = cutBounds(segs[j].c);
          if (b1.x + b1.width + KERF_MIN < b2.x || b2.x + b2.width + KERF_MIN < b1.x) continue;
          if (b1.y + b1.height + KERF_MIN < b2.y || b2.y + b2.height + KERF_MIN < b1.y) continue;
          // parallel-ish: both vertical or both horizontal
          const aVert = Math.abs(a[0].x - a[1].x) < 0.01;
          const bVert = Math.abs(b[0].x - b[1].x) < 0.01;
          const aHorz = Math.abs(a[0].y - a[1].y) < 0.01;
          const bHorz = Math.abs(b[0].y - b[1].y) < 0.01;
          let minDist = Infinity;
          if (aVert && bVert) minDist = Math.abs(a[0].x - b[0].x);
          else if (aHorz && bHorz) minDist = Math.abs(a[0].y - b[0].y);
          else continue;
          if (minDist > 0.01 && minDist < KERF_MIN) {
            // overlap check along the shared axis
            const overlap =
              aVert || aHorz
                ? Math.min(Math.max(a[0].x, a[1].x, a[0].y, a[1].y), Math.max(b[0].x, b[1].x, b[0].y, b[1].y)) -
                  Math.max(Math.min(a[0].x, a[1].x, a[0].y, a[1].y), Math.min(b[0].x, b[1].x, b[0].y, b[1].y))
                : 0;
            if (overlap > 0) {
              const fb = cutBounds(segs[i].c);
              issues.push({
                code: "KERF_PROXIMITY",
                severity: "warning",
                message: `Cuts ${segs[i].c.sequenceIndex} and ${segs[j].c.sequenceIndex} are ${minDist.toFixed(1)}mm apart (< ${KERF_MIN}mm)`,
                sheetIndex,
                cutIndex: segs[i].i,
                focus: { x: fb.x - 5, y: fb.y - 5, width: fb.width + 10, height: fb.height + 10 },
              });
            }
          }
        }
      }
    }
  });

  return issues;
}
