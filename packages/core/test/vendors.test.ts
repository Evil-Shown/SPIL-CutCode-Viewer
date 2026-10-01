import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFormat } from "../src/detect/formatDetector.js";
import { parseAndNormalize, parseFileBytes } from "../src/index.js";
import type { CutDocument } from "../src/model/types.js";

const fixtures = join(import.meta.dirname, "../../../fixtures");

function read(...parts: string[]): string {
  return readFileSync(join(fixtures, ...parts), "utf8");
}

function sheet(doc: CutDocument | undefined, i = 0) {
  return doc?.sheets[i];
}

/** Every pane must lie inside the sheet once the file has been normalized. */
function expectOnSheet(doc: CutDocument, tolerance = 1) {
  for (const s of doc.sheets) {
    for (const p of s.panes) {
      expect(p.bounds.x).toBeGreaterThanOrEqual(-tolerance);
      expect(p.bounds.y).toBeGreaterThanOrEqual(-tolerance);
      expect(p.bounds.x + p.bounds.width).toBeLessThanOrEqual(s.sheet.width + tolerance);
      expect(p.bounds.y + p.bounds.height).toBeLessThanOrEqual(s.sheet.height + tolerance);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Turomas V30 (.R01)                                                 */
/* ------------------------------------------------------------------ */

describe("Turomas V30 .R01", () => {
  it("detects Turomas rather than the Optima OPT dialect", () => {
    const d = detectFormat(read("turomas", "LE.R01"), "LE.R01");
    expect(d.formatId).toBe("turomas-r01");
    expect(d.vendor).toBe("Turomas");
    expect(d.confidence).toBe("high");
  });

  it("reads H/L in tenths of a millimetre and reconstructs the guillotine tree", () => {
    const r = parseAndNormalize(read("turomas", "LE.R01"), "LE.R01");
    expect(r.status).toBe("ok");
    expect(r.document?.sheets.length).toBe(1);
    const s = sheet(r.document)!;
    // H20000 / L30000 → 3000 × 2000 mm, x/y trims of 200 tenths → 20 mm.
    expect(s.sheet.width).toBe(3000);
    expect(s.sheet.height).toBe(2000);
    expect(s.sheet.trims?.left).toBeCloseTo(20, 3);

    // LE.R01 cut list: X9400 Y9400 Y9400 X9400 Y9400 Y8000 Z8000 X3500 Y9540
    const first = s.panes.find((p) => Math.abs(p.bounds.width - 940) < 0.5)!;
    expect(first).toBeDefined();
    expect(first.bounds.x).toBeCloseTo(20, 1);
    expect(first.bounds.width).toBeCloseTo(940, 1);
    expect(first.bounds.height).toBeCloseTo(1980, 1);

    const third = s.panes.find((p) => Math.abs(p.bounds.width - 940) < 0.5 && Math.abs(p.bounds.height - 940) < 0.5)!;
    expect(third).toBeDefined();
    expect(third.bounds.y).toBeGreaterThan(1000);

    // The last primitive is 3500 tenths wide by 9540 tenths high.
    const last = s.panes.find((p) => Math.abs(p.bounds.width - 350) < 0.5 && Math.abs(p.bounds.height - 954) < 0.5)!;
    expect(last).toBeDefined();
    expect(last.bounds.x).toBeCloseTo(1900, 0);

    expectOnSheet(r.document!);
  });

  it("places DS shapes on their CS records with rotation", () => {
    const r = parseAndNormalize(read("turomas", "LE.R01"), "LE.R01");
    const s = sheet(r.document)!;
    const shaped = s.panes.filter((p) => p.polygon && p.polygon.length > 2);
    expect(shaped.length).toBeGreaterThanOrEqual(2);
    expect(s.cuts.filter((c) => c.type === "arc").length).toBeGreaterThanOrEqual(2);
    expect(s.cuts.some((c) => c.stage === 3)).toBe(true);
  });

  it("emits one sheet per P-plan block", () => {
    const r = parseAndNormalize(read("turomas", "FERIA_5.R01"), "FERIA_5.R01");
    expect(r.status).toBe("ok");
    expect(r.document!.sheets.length).toBe(6);
    for (const s of r.document!.sheets) {
      // Every plan declares H20000 / L32100.
      expect(s.sheet.width).toBe(3210);
      expect(s.sheet.height).toBe(2000);
    }
    expectOnSheet(r.document!);
  });

  it("reads the Low-E deletion track as stage 6", () => {
    const r = parseAndNormalize(read("turomas", "M0000002.r01"), "M0000002.r01");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(3210);
    expect(s.sheet.height).toBe(2550);
    // LE … EP contains CS1X0Y0Q1 → the general shape grinds round the sheet.
    expect(s.cuts.some((c) => c.stageLabel === "Low-E")).toBe(true);
  });

  it("keeps the score-points track (SC … EP) as stage 4", () => {
    const r = parseAndNormalize(read("turomas", "M0000001.r01"), "M0000001.r01");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(6000);
    expect(s.sheet.height).toBe(3210);
    expect(s.cuts.some((c) => c.stage === 4)).toBe(true);
  });

  it("rejects content with no plan block", () => {
    const r = parseAndNormalize("nothing to see here", "x.r01");
    expect(r.status).toBe("failed");
    expect(r.detected.vendor).toBe("Optima");
    expect(r.error).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  Turomas V40 (JSON)                                                 */
/* ------------------------------------------------------------------ */

describe("Turomas V40 JSON", () => {
  it("detects the V40 layout", () => {
    const d = detectFormat(read("turomas", "LE.json"), "LE.json");
    expect(d.formatId).toBe("turomas-v40");
    expect(d.confidence).toBe("high");
  });

  it("scales dmm units and rebuilds the cut sequence from placements", () => {
    const r = parseAndNormalize(read("turomas", "LE.json"), "LE.json");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    // Plan Xsize / Ysize 30000 in tenths of a millimetre, 200 trim.
    expect(s.sheet.width).toBe(3000);
    expect(s.sheet.height).toBe(2000);
    expect(s.panes.length).toBeGreaterThan(5);
    expect(s.cuts.length).toBeGreaterThan(5);
    expect(s.panes.some((p) => p.label?.includes("TUROMAS"))).toBe(true);
    expect(s.panes.some((p) => p.rackCode)).toBe(true);
    expectOnSheet(r.document!);
  });

  it("reads a print-apply-label-only plan", () => {
    const r = parseAndNormalize(read("turomas", "LPSOPT.json"), "LPSOPT.json");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(1000);
    expect(s.sheet.height).toBe(1000);
    // Two pieces plus two remnants are placed on the sheet.
    expect(s.panes.length).toBe(4);
    expect(s.panes.some((p) => p.id.startsWith("remnant-"))).toBe(true);
  });

  it("reads a multi-plan optimisation", () => {
    const r = parseAndNormalize(read("turomas", "FERIA_5.json"), "FERIA_5.json");
    expect(r.status).toBe("ok");
    expect(r.document!.sheets.length).toBe(6);
    expectOnSheet(r.document!, 3);
  });

  it("rejects JSON that is not a V40 layout", () => {
    const r = parseAndNormalize('{"hello":"world"}', "x.json");
    expect(r.status).toBe("failed");
    expect(r.error).toContain("V40");
  });
});

/* ------------------------------------------------------------------ */
/*  Perfect Cut RO (.PGM) and its .LST index                           */
/* ------------------------------------------------------------------ */

describe("Perfect Cut RO .PGM", () => {
  it("reads the absolute G/G1 score path", () => {
    const r = parseAndNormalize(read("perfectcut", "OPURU001.PGM"), "OPURU001.PGM");
    expect(r.status).toBe("ok");
    expect(r.detected.formatId).toBe("perfectcut-pgm");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(3660);
    expect(s.sheet.height).toBe(2440);
    // T 6.00 - thickness
    expect(r.document!.metadata.glassThickness).toBe(6);
    expect(s.cuts.length).toBe(20);
    // The left-most border score is the vertical line at x = 30.
    const border = s.cuts.find((c) => Math.abs(c.points[0].x - 30) < 0.01)!;
    expect(border).toBeDefined();
    expect(border.stageLabel).toBe("X");
    expectOnSheet(r.document!);
  });

  it("instiates DS shapes at their CS placements", () => {
    const r = parseAndNormalize(read("perfectcut", "LAAKE001.PGM"), "LAAKE001.PGM");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    // Nine `CS1 X … A0` placements plus one rotated 90°.
    expect(s.panes.length).toBe(10);
    expect(s.panes.some((p) => p.rotated === true)).toBe(true);
    // Placements at x = 20, 1020, 2020 in the first band.
    const xs = s.panes.map((p) => Math.round(p.bounds.x));
    expect(xs).toContain(21);
    expect(xs).toContain(1021);
    expect(xs).toContain(2021);
  });

  it("reads curved shapes and keeps them on the sheet", () => {
    const r = parseAndNormalize(read("perfectcut", "LAPES001.PGM"), "LAPES001.PGM");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.cuts.some((c) => c.type === "arc")).toBe(true);
    expect(s.panes.some((p) => p.polygon && p.polygon.length > 2)).toBe(true);
    expectOnSheet(r.document!);
  });

  it("reads a program with mixed shapes and rectangles", () => {
    const r = parseAndNormalize(read("perfectcut", "B4PES010.PGM"), "B4PES010.PGM");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(2140);
    expect(s.sheet.height).toBe(1840);
    expect(s.panes.length).toBe(3);
    expectOnSheet(r.document!);
  });

  it("reports .LST index files as partial and lists the referenced programs", () => {
    const r = parseAndNormalize(read("perfectcut", "OPURU.LST"), "OPURU.LST");
    expect(r.status).toBe("partial");
    expect(r.detected.formatId).toBe("perfectcut-pgm-index");
    expect(r.document?.metadata.operator).toContain("OPURU001.PGM");
  });
});

/* ------------------------------------------------------------------ */
/*  Bystronic PROG.XYZ                                                 */
/* ------------------------------------------------------------------ */

describe("Bystronic PROG.XYZ", () => {
  it("reads the documented sample 1 cutting plan", () => {
    const c = read("bystronic", "sample1.xyz");
    const d = detectFormat(c, "sample1.xyz");
    expect(d.formatId).toBe("bystronic-xyz");

    const r = parseAndNormalize(c, "sample1.xyz");
    expect(r.status).toBe("partial");
    const s = sheet(r.document)!;
    // M3210.0/2550.0
    expect(s.sheet.width).toBe(3210);
    expect(s.sheet.height).toBe(2550);
    // D300 → 3.00 mm thickness
    expect(r.document!.metadata.glassThickness).toBe(3);

    // X1077 X1077 X600 X412 → 3166 mm of subplates
    const widths = new Set(s.panes.map((p) => Math.round(p.bounds.width)));
    expect(widths.has(1077)).toBe(true);
    expect(widths.has(600)).toBe(true);
    expect(widths.has(412)).toBe(true);
    // 3 + 3 + 1 + 4 + 4 = 15 primitives.
    expect(s.panes.length).toBe(15);
    expectOnSheet(r.document!);
  });

  it("stacks Y primitives from the bottom of the subplate", () => {
    const r = parseAndNormalize(read("bystronic", "sample1.xyz"), "sample1.xyz");
    const s = sheet(r.document)!;
    const first = s.panes.find((p) => p.id === "p1")!;
    const third = s.panes.find((p) => p.id === "p3")!;
    const fourth = s.panes.find((p) => p.id === "p4")!;
    expect(first.bounds.width).toBeCloseTo(1077, 3);
    expect(first.bounds.height).toBeCloseTo(828, 3);
    // p3 is the lowest of the three 828 mm primitives of the first subplate.
    expect(third.bounds.y).toBeLessThan(first.bounds.y);
    // The second subplate starts one X-width further along.
    expect(fourth.bounds.x).toBeCloseTo(1077, 3);
  });

  it("records the shape model parameters of a catalogue contour", () => {
    const r = parseAndNormalize(read("bystronic", "sample1.xyz"), "sample1.xyz");
    expect(r.warnings.join(" ")).toContain("F5 rot90 G[300,200] H[300,300] K0");
  });

  it("reconstructs free shape 99 from its S records", () => {
    const r = parseAndNormalize(read("bystronic", "freeshape99.xyz"), "freeshape99.xyz");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.cuts.filter((c) => c.type === "arc").length).toBeGreaterThanOrEqual(6);
    expect(s.panes.some((p) => p.polygon && p.polygon.length > 2)).toBe(true);
  });

  it("rejects a file that is not wrapped in ( )", () => {
    const r = parseAndNormalize("P2N1M100/100X10", "x.xyz");
    expect(r.status).toBe("failed");
    expect(r.error).toContain("`(`");
  });
});

/* ------------------------------------------------------------------ */
/*  Vetromac ISO                                                       */
/* ------------------------------------------------------------------ */

describe("Vetromac ISO", () => {
  it("reads VN211/VN212 as the sheet size", () => {
    const r = parseAndNormalize(read("vetromac", "rectangle.ISO"), "1.ISO");
    expect(r.detected.formatId).toBe("vetromac-iso");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(1000);
    expect(s.sheet.height).toBe(1000);
    expect(s.cuts.length).toBe(4);
    expectOnSheet(r.document!);
  });

  it("scores with the wheel down even on a G0 channel", () => {
    const r = parseAndNormalize(read("vetromac", "rectangle.ISO"), "1.ISO");
    const s = sheet(r.document)!;
    // G1 Y15 Z0 → horizontal score; G1 X515 Y… Z90 → vertical score.
    expect(s.cuts.filter((c) => c.stageLabel === "X").length).toBe(2);
    expect(s.cuts.filter((c) => c.stageLabel === "Y").length).toBe(2);
  });

  it("reads the full circle written as a single G3", () => {
    const r = parseAndNormalize(read("vetromac", "circle.ISO"), "1.ISO");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    const arc = s.cuts.find((c) => c.type === "arc")!;
    expect(arc.radius).toBeCloseTo(250, 1);
    // Canonical space is top-left, so the Y centre is mirrored.
    expect(arc.center?.x).toBeCloseTo(265, 1);
    expect(arc.center?.y).toBeCloseTo(1000 - 265, 1);
    const circle = s.panes.find((p) => p.polygon && p.polygon.length > 20)!;
    expect(circle.bounds.width).toBeCloseTo(500, 0);
  });

  it("reads the rectangle-with-rays program (ground corners)", () => {
    const r = parseAndNormalize(read("vetromac", "rays.ISO"), "1.ISO");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.cuts.filter((c) => c.type === "arc").length).toBeGreaterThanOrEqual(4);
    expectOnSheet(r.document!);
  });
});

/* ------------------------------------------------------------------ */
/*  Eagle / Linghua ISAC ISO                                           */
/* ------------------------------------------------------------------ */

describe("Eagle ISAC ISO", () => {
  it("reads R4081/R4082 and the M1010…M1011 score path", () => {
    const r = parseAndNormalize(read("eagle", "006IND_001.ISO"), "006IND_001.ISO");
    expect(r.detected.formatId).toBe("eagle-isac-iso");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(3660);
    expect(s.sheet.height).toBe(2440);
    expect(r.document!.metadata.glassThickness).toBe(6);
    expect(s.cuts.length).toBeGreaterThan(3);
    expect(s.panes.length).toBeGreaterThan(0);
    expectOnSheet(r.document!);
  });

  it("rebuilds the blanks from the guillotine score sequence", () => {
    const r = parseAndNormalize(read("eagle", "008CFL_003.ISO"), "190723-008CFL_008CFL_003.ISO");
    const s = sheet(r.document)!;
    // Vertical scores at x = 35 and 1024, horizontal scores at y = 35 and 1239:
    // the finished blank is the 989 x 1204 mm piece the optimizer also records.
    const piece = s.panes.find((p) => p.id === "4")!;
    expect(piece).toBeDefined();
    expect(piece.bounds.width).toBeCloseTo(989, 0);
    expect(piece.bounds.height).toBeCloseTo(1204, 0);
    expect(piece.label).toContain("Blitz Glass");
    expectOnSheet(r.document!);
  });

  it("labels the blanks from the optimizer {:BOX} size records", () => {
    // {:BOX} carries width;height;x;y;id;supplier;order — the size matches the
    // score sequence directly even though x/y stay in Perfect Cut's own frame.
    const r = parseAndNormalize(read("eagle", "010CFL_003.ISO"), "010CFL_003.ISO");
    const s = sheet(r.document)!;
    expect(s.panes.length).toBeGreaterThan(3);
    expect(s.panes.filter((p) => p.label).length).toBeGreaterThan(0);
    expect(s.panes.some((p) => p.label?.includes("Glass Projects"))).toBe(true);
    expect(s.panes.some((p) => p.id && p.id !== "blank-1")).toBe(true);
  });

  it("fails clearly without the sheet registers", () => {
    const r = parseAndNormalize('{strNomeProgetto="x"}\nG01 X10 Y10\nM02\n', "x.ISO");
    expect(r.status).toBe("failed");
    expect(r.error).toContain("R4081");
  });
});

/* ------------------------------------------------------------------ */
/*  Disai PRJX                                                         */
/* ------------------------------------------------------------------ */

describe("Disai PRJX", () => {
  it("reads the [PATTERN]/[SCHEME]/[BREAKLN] machine code", () => {
    const r = parseAndNormalize(read("disai", "CLR06_001.dst"), "CLR06_001-001.dst");
    expect(r.detected.formatId).toBe("disai-prjx");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(3660);
    expect(s.sheet.height).toBe(2440);
    expect(r.document!.metadata.glassThickness).toBe(6);
    expect(s.cuts.length).toBe(20);
    expect(s.panes.length).toBeGreaterThan(10);
    expectOnSheet(r.document!);
  });

  it("applies TRIMLEFT/TRIMBOTTOM as the scheme origin", () => {
    const r = parseAndNormalize(read("disai", "CLR06_001.dst"), "CLR06_001-001.dst");
    const s = sheet(r.document)!;
    expect(s.sheet.trims?.left).toBeCloseTo(30, 1);
    // BREAKLN's first line is `30.00 1.00 30.00 2439.00`.
    expect(s.cuts[0]!.points[0].x).toBeCloseTo(30, 1);
  });

  it("labels panes from the IB piece blocks", () => {
    const r = parseAndNormalize(read("disai", "CLR06_001.dst"), "CLR06_001-001.dst");
    const s = sheet(r.document)!;
    expect(s.panes.some((p) => p.label?.includes("Macotec"))).toBe(true);
    // IB1 declares 500 × 1000 mm pieces.
    const ib1 = s.panes.find((p) => Math.abs(p.bounds.width - 500) < 1 && Math.abs(p.bounds.height - 1000) < 1);
    expect(ib1).toBeDefined();
  });

  it("reads a .sum summary as sheet stock without a layout", () => {
    const r = parseAndNormalize(read("disai", "job.sum"), "job.sum");
    expect(r.detected.formatId).toBe("disai-prjx");
    expect(r.status).toBe("partial");
    expect(sheet(r.document)!.sheet.width).toBe(3660);
    expect(r.warnings.join(" ")).toContain("without a cutting layout");
  });
});

/* ------------------------------------------------------------------ */
/*  Chaoyang SCR NC                                                    */
/* ------------------------------------------------------------------ */

describe("Chaoyang SCR NC", () => {
  it("reads LIMITS, #RECT, #REM and LINE records", () => {
    const r = parseAndNormalize(read("chaoyang", "test.src"), "test.src");
    expect(r.detected.formatId).toBe("chaoyang-src");
    expect(r.status).toBe("ok");
    const s = sheet(r.document)!;
    expect(s.sheet.width).toBe(3660);
    expect(s.sheet.height).toBe(2440);
    expect(r.document!.metadata.glassThickness).toBe(5);
    expect(s.panes.length).toBe(2);
    expect(s.cuts.length).toBe(6);
    expectOnSheet(r.document!);
  });

  it("reads #REM nominal sizes and ARC2C/ARC3C arcs", () => {
    const src = [
      "LIMITS 0,0 1000,800",
      "#THICKNESS 6",
      "#RECT 100.00,100.00 500.00,400.00 *1 $2",
      "#REM 400.0*300.0",
      "ARC3C 300.000,200.000 300.000,100.000 300.000,300.000",
      "ARC2C 700.000,200.000 700.000,100.000 700.000,300.000",
    ].join("\r\n");
    const r = parseAndNormalize(src, "x.src");
    const s = sheet(r.document)!;
    expect(s.panes.length).toBe(1);
    expect(s.panes[0]!.glassInfo).toBe("nominal 400×300");
    const arcs = s.cuts.filter((c) => c.type === "arc");
    expect(arcs.length).toBe(2);
    expect(arcs[0]!.radius).toBeCloseTo(100, 1);
    // Normalization flips the Y axis, so the two sweeps trade places.
    expect(arcs[0]!.ccw).not.toBe(arcs[1]!.ccw);
  });

  it("fails without a LIMITS record", () => {
    const r = parseAndNormalize("COUNTS 1\n", "x.src");
    expect(r.status).toBe("failed");
    expect(r.error).toContain("LIMITS");
  });
});

/* ------------------------------------------------------------------ */
/*  Macotech IMP project definition                                    */
/* ------------------------------------------------------------------ */

describe("Macotech IMP project definition", () => {
  it("surfaces the sheet stock when no [Pattern] layout is present", () => {
    // The sample is UTF-16LE, so it must go through the byte decoder.
    const bytes = new Uint8Array(readFileSync(join(fixtures, "macotech", "import-all.imp")));
    const r = parseFileBytes(bytes, "import_all.imp");
    expect(r.detected.formatId).toBe("macotech-imp");
    expect(r.status).toBe("partial");
    expect(r.document!.sheets.length).toBe(3);
    expect(sheet(r.document)!.sheet.width).toBe(3210);
    expect(sheet(r.document)!.sheet.height).toBe(2400);
    expect(sheet(r.document, 1)!.sheet.width).toBe(6000);
    expect(r.warnings.join(" ")).toContain("project definition");
  });

  it("still prefers a real [Pattern] layout when present", () => {
    const r = parseAndNormalize(read("macotech", "sample.imp"), "sample.imp");
    expect(r.status).not.toBe("failed");
    expect(sheet(r.document)!.sheet.width).toBe(3660);
    expect(sheet(r.document)!.cuts.length).toBeGreaterThan(0);
  });
});