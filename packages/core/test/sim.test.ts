import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAndNormalize } from "../src/index.js";
import { DEFAULT_KINEMATICS, moveTimeS, type MachineKinematics } from "../src/sim/kinematics.js";
import { buildTimeline, headAt } from "../src/sim/timeline.js";
import type { CutPlan, Point } from "../src/model/types.js";

const fixtures = join(import.meta.dirname, "../../../fixtures");

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

function onPolyline(p: Point, path: Point[], tol = 1e-3): boolean {
  for (let i = 1; i < path.length; i++) {
    if (distToSeg(p, path[i - 1]!, path[i]!) <= tol) return true;
  }
  return false;
}

function straightPlan(lengthMm: number): CutPlan {
  return {
    id: "t",
    sheet: { width: Math.max(lengthMm, 100), height: 100 },
    panes: [],
    cuts: [
      {
        type: "line",
        points: [
          { x: 0, y: 0 },
          { x: lengthMm, y: 0 },
        ],
        sequenceIndex: 0,
      },
    ],
    coordinateSemantics: { origin: "top-left", xAxis: "right", units: "mm" },
  };
}

const kTest: MachineKinematics = {
  rapidSpeedMmS: 2000,
  scoreSpeedMmS: 2000,
  accelMmS2: 8000,
  headDownS: 0,
  headUpS: 0,
};

describe("moveTimeS", () => {
  it("uses a triangular profile when the cut is too short to reach vmax", () => {
    const d = 200;
    const v = 2000;
    const a = 8000;
    expect(d).toBeLessThan((v * v) / a);
    expect(moveTimeS(d, v, a)).toBeCloseTo(2 * Math.sqrt(d / a), 6);
  });

  it("uses a trapezoidal profile when the cut reaches cruise speed", () => {
    const d = 2000;
    const v = 2000;
    const a = 8000;
    expect(d).toBeGreaterThan((v * v) / a);
    expect(moveTimeS(d, v, a)).toBeCloseTo(d / v + v / a, 6);
  });
});

describe("buildTimeline", () => {
  it("matches triangular vs trapezoidal score duration on a single straight cut", () => {
    const triLen = 200;
    const trapLen = 2000;
    const tri = buildTimeline(straightPlan(triLen), kTest);
    const trap = buildTimeline(straightPlan(trapLen), kTest);
    const triScore = tri.segments.find((s) => s.kind === "score");
    const trapScore = trap.segments.find((s) => s.kind === "score");
    expect(triScore).toBeDefined();
    expect(trapScore).toBeDefined();
    if (triScore?.kind !== "score" || trapScore?.kind !== "score") return;
    expect(triScore.endS - triScore.startS).toBeCloseTo(moveTimeS(triLen, kTest.scoreSpeedMmS, kTest.accelMmS2), 6);
    expect(trapScore.endS - trapScore.startS).toBeCloseTo(moveTimeS(trapLen, kTest.scoreSpeedMmS, kTest.accelMmS2), 6);
    expect(tri.totalS).toBeCloseTo(triScore.endS, 6);
    expect(trap.totalS).toBeCloseTo(trapScore.endS, 6);
  });

  it("builds a timed cycle from an Intermac .CUT fixture", () => {
    const c = readFileSync(join(fixtures, "intermac/2_01.CUT"), "utf8");
    const r = parseAndNormalize(c, "2_01.CUT");
    const plan = r.document?.sheets[0];
    expect(plan).toBeDefined();
    const tl = buildTimeline(plan!, DEFAULT_KINEMATICS);
    expect(tl.cuttingLengthMm).toBeGreaterThan(0);
    expect(tl.totalS).toBeGreaterThan(0);
    let t = 0;
    for (const seg of tl.segments) {
      expect(seg.startS).toBeGreaterThanOrEqual(t - 1e-9);
      expect(seg.endS).toBeGreaterThanOrEqual(seg.startS);
      t = seg.endS;
    }
    expect(t).toBeCloseTo(tl.totalS, 6);
    expect(headAt(tl, tl.totalS).phase).toBe("done");
  });

  it("places the head on the active score at mid-cut time", () => {
    const c = readFileSync(join(fixtures, "intermac/2_01.CUT"), "utf8");
    const r = parseAndNormalize(c, "2_01.CUT");
    const plan = r.document?.sheets[0];
    expect(plan).toBeDefined();
    const tl = buildTimeline(plan!, DEFAULT_KINEMATICS);
    const score = tl.segments.find((s) => s.kind === "score");
    expect(score).toBeDefined();
    if (score?.kind !== "score") return;
    const mid = (score.startS + score.endS) / 2;
    const h = headAt(tl, mid);
    expect(h.phase).toBe("score");
    expect(h.activeCutIndex).toBe(score.cutIndex);
    expect(h.cutProgress).toBeGreaterThan(0);
    expect(h.cutProgress).toBeLessThan(1);
    expect(onPolyline(h.pos, score.path, 0.05)).toBe(true);
  });
});
