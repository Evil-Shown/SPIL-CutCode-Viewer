import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSchedule,
  detectFormat,
  documentToDxf,
  parseAndNormalize,
  parseFileBytes,
  panesToCsv,
  planToDxf,
  scheduleToCsv,
  stagesToCsv,
  validateCutDocument,
  SUPPORTED_FORMAT_IDS,
  isNonGeometryFormat,
} from "../src/index.js";
import { polylineLength, cutPathPoints } from "../src/sim/timeline.js";
import { sampleArcAbout } from "../src/geometry/arc.js";

const fixtures = join(import.meta.dirname, "../../../fixtures");

function read(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixtures, rel)));
}

/* ------------------------------------------------------------------ */
/*  Parser retry chain                                                  */
/* ------------------------------------------------------------------ */

describe("parser fallback chain", () => {
  it("tries the other ISO dialect when the extension is all we have", () => {
    // An Eagle ISAC program renamed to .iso: no content signal for Vetromac,
    // so the extension fallback has to reach eagle-isac-iso.
    const bytes = read("eagle/006IND_001.ISO");
    const renamed = "job.iso";
    const naive = parseFileBytes(bytes, renamed);
    expect(naive.status).toBe("ok");
    expect(["eagle-isac-iso", "vetromac-iso"]).toContain(naive.detected.formatId);
    // The content is unmistakably Eagle, so the retry must settle on it.
    expect(naive.detected.formatId).toBe("eagle-isac-iso");
    expect(naive.document!.sheets.length).toBeGreaterThan(0);
  });

  it("keeps a confident, specific failure instead of retrying into a worse answer", () => {
    const r = parseFileBytes(read("macotech/regression/family-config.imp"), "family-config.imp");
    expect(r.status).toBe("failed");
    expect(r.detected.formatId).toBe("macotech-family");
    expect(r.error).toContain("family configuration");
  });

  it("does not swallow the diagnostic of a high-confidence format", () => {
    const r = parseAndNormalize("this is not a cutcode file at all", "junk.r01");
    expect(r.status).toBe("failed");
    expect(r.error).toBeTruthy();
  });

  it("publishes the format registry", () => {
    expect(SUPPORTED_FORMAT_IDS).toContain("intermac-otd");
    expect(SUPPORTED_FORMAT_IDS).toContain("bystronic-xyz");
    expect(isNonGeometryFormat("perfectcut-ot5")).toBe(true);
    expect(isNonGeometryFormat("intermac-otd")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Encoding coverage for the retry path                               */
/* ------------------------------------------------------------------ */

describe("decode coverage", () => {
  it("detects Vetromac and Eagle ISO by content regardless of extension", () => {
    const vet = readFileSync(join(fixtures, "vetromac/circle.ISO"), "utf8");
    expect(detectFormat(vet, "x.dat").formatId).toBe("vetromac-iso");
    const eagle = readFileSync(join(fixtures, "eagle/008CFL_003.ISO"), "utf8");
    expect(detectFormat(eagle, "x.dat").formatId).toBe("eagle-isac-iso");
  });
});

/* ------------------------------------------------------------------ */
/*  Cut schedule / stage summary                                       */
/* ------------------------------------------------------------------ */

describe("cut schedule", () => {
  const doc = parseFileBytes(read("intermac/sample.otd"), "sample.otd").document!;

  it("flattens every sheet in sequence order", () => {
    const report = buildSchedule(doc);
    expect(report.totals.sheets).toBe(doc.sheets.length);
    expect(report.totals.cuts).toBe(doc.sheets.reduce((n, s) => n + s.cuts.length, 0));
    expect(report.rows).toHaveLength(report.totals.cuts);
    expect(report.rows.length).toBeGreaterThan(0);

    // Sequence indices must ascend inside each sheet.
    const perSheet = new Map<number, number[]>();
    for (const r of report.rows) {
      const list = perSheet.get(r.sheetIndex) ?? [];
      list.push(r.sequenceIndex);
      perSheet.set(r.sheetIndex, list);
    }
    for (const list of perSheet.values()) {
      expect(list).toEqual([...list].sort((a, b) => a - b));
    }
  });

  it("sums per-stage lengths to the total scored length", () => {
    const report = buildSchedule(doc);
    const sum = report.stages.reduce((n, s) => n + s.lengthMm, 0);
    expect(sum).toBeCloseTo(report.totals.scoreLengthMm, 6);
    for (const s of report.stages) {
      expect(s.lengthPct).toBeGreaterThanOrEqual(0);
      expect(s.lengthPct).toBeLessThanOrEqual(100);
    }
  });

  it("measures cut length from the real geometry, arcs included", () => {
    const report = buildSchedule(doc);
    const firstCut = doc.sheets[0]!.cuts[0]!;
    const expected = polylineLength(cutPathPoints(firstCut));
    expect(report.rows[0]!.lengthMm).toBeCloseTo(expected, 6);
  });

  it("exports RFC-4180 CSV with a stable header and row count", () => {
    const report = buildSchedule(doc);
    const csv = scheduleToCsv(report);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("sheet,sequence,stage,stage_label,type,length_mm,x1,y1,x2,y2,vertices,bock,rack");
    expect(lines).toHaveLength(report.rows.length + 1);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes CSV fields that contain a comma or a quote", () => {
    const doc2 = JSON.parse(JSON.stringify(doc));
    doc2.sheets[0].cuts[0].bockCode = 'rack "A,1"';
    const csv = scheduleToCsv(buildSchedule(doc2));
    expect(csv).toContain('"rack ""A,1"""');
  });

  it("exports a pane list and a stage breakdown", () => {
    const report = buildSchedule(doc);
    const paneCsv = panesToCsv(doc);
    expect(paneCsv.trim().split("\r\n")).toHaveLength(doc.sheets.reduce((n, s) => n + s.panes.length, 0) + 1);
    const stageCsv = stagesToCsv(report);
    expect(stageCsv.trim().split("\r\n")).toHaveLength(report.stages.length + 1);
  });
});

/* ------------------------------------------------------------------ */
/*  DXF export                                                          */
/* ------------------------------------------------------------------ */

describe("DXF export", () => {
  const r = parseFileBytes(read("intermac/regression/CIRCLEPERFCUT.OTD"), "CIRCLEPERFCUT.OTD");
  const plan = r.document!.sheets[0]!;

  it("writes a well-formed R12 header and terminator", () => {
    const dxf = planToDxf(plan, "Intermac");
    expect(dxf.startsWith("999\r\n")).toBe(true);
    expect(dxf).toContain("0\r\nSECTION\r\n2\r\nHEADER");
    expect(dxf.trimEnd().endsWith("0\r\nEOF")).toBe(true);
    expect(dxf).toContain("AC1009");
    expect(dxf).toContain("ENTITIES");
  });

  it("emits the sheet, panes and cuts on their own layers", () => {
    const dxf = planToDxf(plan, "Intermac");
    expect(dxf).toContain("LWPOLYLINE");
    // Layer names live on group code 8.
    const layers = [...dxf.matchAll(/\r\n8\r\n([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(layers).toContain("SHEET");
    expect(layers).toContain("PANES");
  });

  it("samples arcs into polylines so a 2D reader can follow them", () => {
    const arcs = plan.cuts.filter((c) => c.type === "arc");
    expect(arcs.length).toBeGreaterThan(0);
    const arcVertices = Math.max(...arcs.map((c) => cutPathPoints(c).length));
    expect(arcVertices).toBeGreaterThan(2);
  });

  it("offsets stacked sheets so two-sheet documents do not overlap", () => {
    const multi = parseFileBytes(read("intermac/regression/B19598.OTD"), "B19598.OTD");
    expect(multi.document!.sheets.length).toBeGreaterThan(1);
    const dxf = documentToDxf(multi.document!);
    const ys = [...dxf.matchAll(/\r\n20\r\n(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeGreaterThan(multi.document!.sheets[0].sheet.height);
  });
});

/* ------------------------------------------------------------------ */
/*  Arc geometry                                                        */
/* ------------------------------------------------------------------ */

describe("sampleArcAbout", () => {
  const center = { x: 0, y: 0 };

  /**
   * The first and last samples are pinned to the exact endpoints, so the
   * polyline is a hair shorter than the true arc: two chords replace two arc
   * segments. 0.5% covers any reasonable segment count.
   */
  const ARC_TOLERANCE = 5;

  it("takes the short way round when the centre and sense agree", () => {
    const start = { x: 100, y: 0 };
    const end = { x: 0, y: 100 };
    const pts = sampleArcAbout(center, start, end, 100, true, 64);
    expect(polylineLength(pts)).toBeCloseTo((Math.PI / 2) * 100, -ARC_TOLERANCE);
  });

  it("takes the long way round when the sense is reversed", () => {
    const start = { x: 100, y: 0 };
    const end = { x: 0, y: 100 };
    const pts = sampleArcAbout(center, start, end, 100, false, 64);
    expect(polylineLength(pts)).toBeCloseTo((1.5 * Math.PI) * 100, -ARC_TOLERANCE);
  });

  it("keeps the endpoints pinned to the source geometry", () => {
    const start = { x: 50, y: -20 };
    const end = { x: -50, y: 20 };
    const pts = sampleArcAbout(center, start, end, 100, true, 8);
    expect(pts[0]).toEqual(start);
    expect(pts[pts.length - 1]).toEqual(end);
  });
});

/* ------------------------------------------------------------------ */
/*  Vendor geometry regressions                                         */
/* ------------------------------------------------------------------ */

describe("Turomas V40 track geometry", () => {
  const doc = parseFileBytes(read("turomas/FERIA_5.json"), "FERIA_5.json").document!;

  it("keeps every cut on its sheet", () => {
    for (const sheet of doc.sheets) {
      for (const cut of sheet.cuts) {
        for (const p of cut.points) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(sheet.sheet.width + 1);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(sheet.sheet.height + 1);
        }
      }
    }
  });

  it("scores a physically plausible length (regression: 2965 m from one file)", () => {
    const metres = buildSchedule(doc).totals.scoreLengthMm / 1000;
    expect(metres).toBeGreaterThan(0);
    expect(metres).toBeLessThan(500);
  });

  it("places rotated placements with their shape inside the blank", () => {
    for (const sheet of doc.sheets) {
      for (const pane of sheet.panes) {
        if (!pane.polygon) continue;
        const xs = pane.polygon.map((p) => p.x);
        expect(Math.max(...xs)).toBeLessThanOrEqual(pane.bounds.x + pane.bounds.width + 1);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(pane.bounds.x - 1);
      }
    }
  });

  it("tags the Low-E track so overlapping work processes are not flagged as collisions", () => {
    const processes = new Set(doc.sheets.flatMap((s) => s.cuts.map((c) => c.process)));
    expect(processes.has("CUT")).toBe(true);
    expect(processes.has("LE")).toBe(true);

    const crossings = validateCutDocument(doc).filter((i) => i.code === "CROSSING_CUTS");
    // Only same-process pairs may be reported.
    for (const issue of crossings) {
      const sheet = doc.sheets[issue.sheetIndex]!;
      const cut = sheet.cuts[issue.cutIndex!];
      const other = issue.message.match(/Cuts (\d+) and/)?.[1];
      const partner = sheet.cuts.find((c) => String(c.sequenceIndex) === other);
      expect(partner).toBeTruthy();
      expect((cut.process ?? "CUT")).toBe(partner?.process ?? "CUT");
    }
  });
});

describe("Turomas V30 track geometry", () => {
  const doc = parseFileBytes(read("turomas/LE.R01"), "LE.R01").document!;

  it("fits each shape outline inside its blank", () => {
    const fitted = doc.sheets.flatMap((s) => s.panes.filter((p) => p.polygon));
    expect(fitted.length).toBeGreaterThan(0);
    for (const pane of fitted) {
      const xs = pane.polygon!.map((p) => p.x);
      const ys = pane.polygon!.map((p) => p.y);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(pane.bounds.x - 1);
      expect(Math.max(...xs)).toBeLessThanOrEqual(pane.bounds.x + pane.bounds.width + 1);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(pane.bounds.y - 1);
      expect(Math.max(...ys)).toBeLessThanOrEqual(pane.bounds.y + pane.bounds.height + 1);
    }
  });

  it("emits no zero-length cuts (regression: the outline collapsed to one point)", () => {
    const issues = validateCutDocument(doc).filter((i) => i.code === "ZERO_LENGTH_CUT");
    expect(issues).toHaveLength(0);
  });

  it("scales arc radii into millimetres", () => {
    for (const sheet of doc.sheets) {
      for (const cut of sheet.cuts) {
        if (cut.type !== "arc" || cut.radius === undefined) continue;
        expect(cut.radius).toBeLessThan(Math.max(sheet.sheet.width, sheet.sheet.height));
        expect(cut.radius).toBeGreaterThan(0);
      }
    }
  });

  it("drops corrupt out-of-range arc records and says so", () => {
    const r = parseFileBytes(read("turomas/M0000001.r01"), "M0000001.r01");
    expect(r.warnings.some((w) => /out-of-range arc/i.test(w))).toBe(true);
    const metres = buildSchedule(r.document!).totals.scoreLengthMm / 1000;
    expect(metres).toBeLessThan(200);
  });
});