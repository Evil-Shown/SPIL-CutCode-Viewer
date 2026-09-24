import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFormat } from "../src/detect/formatDetector.js";
import { parseAndNormalize } from "../src/index.js";
import { parseFileBytes } from "../src/index.js";
import type { CutDocument } from "../src/model/types.js";

const fixtures = join(import.meta.dirname, "../../../fixtures");

function sheet(doc: CutDocument | undefined, i = 0) {
  return doc?.sheets[i];
}

/* ------------------------------------------------------------------ */
/*  Format detector                                                     */
/* ------------------------------------------------------------------ */

describe("formatDetector", () => {
  it("detects Intermac OTD by content", () => {
    const c = readFileSync(join(fixtures, "intermac/sample.otd"), "utf8");
    const d = detectFormat(c, "x.otd");
    expect(d.formatId).toBe("intermac-otd");
    expect(d.confidence).toBe("high");
  });

  it("detects Lisec DAT by content", () => {
    const c = readFileSync(join(fixtures, "lisec/sample.dat"), "utf8");
    const d = detectFormat(c, "x.dat");
    expect(d.formatId).toBe("lisec-dat");
  });

  it("detects Bottero OPT by content", () => {
    const c = readFileSync(join(fixtures, "bottero/sample.opt"), "utf8");
    const d = detectFormat(c, "x.opt");
    expect(d.formatId).toBe("bottero-opt");
  });

  it("detects Optima R01 by content", () => {
    const c = readFileSync(join(fixtures, "optima/sample.r01"), "utf8");
    const d = detectFormat(c, "x.r01");
    expect(d.formatId).toBe("optima-r01");
  });

  it("detects Optima OTV JSON", () => {
    const c = readFileSync(join(fixtures, "optima/sample.otv"), "utf8");
    const d = detectFormat(c, "x.otv");
    expect(d.formatId).toBe("optima-otv");
  });

  it("detects Hegla EDI by content", () => {
    const c = readFileSync(join(fixtures, "hegla/sample.edi"), "utf8");
    const d = detectFormat(c, "x.edi");
    expect(d.formatId).toBe("hegla-edi");
  });

  it("detects Macotech IMP by content", () => {
    const c = readFileSync(join(fixtures, "macotech/sample.imp"), "utf8");
    const d = detectFormat(c, "x.imp");
    expect(d.formatId).toBe("macotech-imp");
  });

  it("falls back to extension for Hegla .edi without EDICUT header", () => {
    const c = readFileSync(join(fixtures, "hegla/regression/KASUNEST.EDI"), "utf8");
    const d = detectFormat(c, "KASUNEST.EDI");
    expect(d.formatId).toBe("hegla-edi");
    expect(d.confidence).toBe("medium");
  });

  it("returns unknown for unrecognised content without extension", () => {
    const d = detectFormat("hello world", "");
    expect(d.formatId).toBe("unknown");
    expect(d.confidence).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ */
/*  Parser correctness                                                  */
/* ------------------------------------------------------------------ */

describe("parsers", () => {
  it("parses Lisec sheet dimensions and cuts", () => {
    const c = readFileSync(join(fixtures, "lisec/sample.dat"), "utf8");
    const r = parseAndNormalize(c, "PL001.DAT");
    expect(r.status).not.toBe("failed");
    expect(r.document).toBeDefined();
    expect(r.document!.sheets.length).toBe(1);
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(321);
    expect(s?.sheet.height).toBe(225);
    expect(s?.cuts.length).toBeGreaterThan(0);
  });

  it("parses real production Lisec layouts with exact guillotine geometry", () => {
    // From SPIL Opti output: ESL rezanje ct260814, Float 4mm
    const c = readFileSync(join(fixtures, "lisec/regression/PL001.DAT"), "utf8");
    const r = parseAndNormalize(c, "PL001.DAT");
    expect(r.status).toBe("ok");
    expect(r.warnings.length).toBe(0);
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(600);
    expect(s?.sheet.height).toBe(321);
    expect(s?.panes.length).toBe(11);

    // B34: strip 1 [0,144.2], bottom band 0..149.9 (bottom-left origin)
    const b34 = s?.panes.find((p) => p.id === "34");
    expect(b34?.bounds.width).toBeCloseTo(144.2, 2);
    expect(b34?.bounds.height).toBeCloseTo(149.9, 2);
    // B160: strip 3, second piece in top band — 128.7 + 116.4 = 245.1 strip width
    const b160 = s?.panes.find((p) => p.id === "160");
    expect(b160?.bounds.width).toBeCloseTo(116.4, 2);
    expect(b160?.bounds.x).toBeCloseTo(347.9 + 128.7, 2);
    // All panes on-sheet
    for (const pane of s?.panes ?? []) {
      expect(pane.bounds.x).toBeGreaterThanOrEqual(-0.01);
      expect(pane.bounds.y).toBeGreaterThanOrEqual(-0.01);
      expect(pane.bounds.x + pane.bounds.width).toBeLessThanOrEqual(s!.sheet.width + 0.01);
      expect(pane.bounds.y + pane.bounds.height).toBeLessThanOrEqual(s!.sheet.height + 0.01);
    }
  });

  it("parses Intermac multi-sheet file (FULL fixture, no truncation)", () => {
    const c = readFileSync(join(fixtures, "intermac/sample.otd"), "utf8");
    const r = parseAndNormalize(c, "sample.OTD");
    expect(r.status).not.toBe("failed");
    expect(r.document).toBeDefined();
    expect(r.document!.sheets.length).toBeGreaterThanOrEqual(2); // multi-sheet

    // First sheet should have correct dims
    const s0 = sheet(r.document, 0);
    expect(s0?.sheet.width).toBe(2440);
    expect(s0?.sheet.height).toBe(1830);
    expect(s0?.cuts.length).toBeGreaterThan(5);
    expect(s0?.panes.length).toBeGreaterThan(0);
  });

  it("parses Intermac pane 60 bounds from full file", () => {
    const c = readFileSync(join(fixtures, "intermac/sample.otd"), "utf8");
    const r = parseAndNormalize(c, "test.OTD");
    const s = sheet(r.document, 0);
    const pane60 = s?.panes.find((p) => p.id === "60");
    expect(pane60).toBeDefined();
    expect(pane60?.bounds.width).toBe(808.5);
    expect(pane60?.bounds.height).toBe(320.5);
  });

  it("parses Optima R01 cuttings with stages", () => {
    const c = readFileSync(join(fixtures, "optima/sample.r01"), "utf8");
    const r = parseAndNormalize(c, "CLR03_4.r01");
    expect(r.status).not.toBe("failed");
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(3660);
    expect(s?.cuts.length).toBeGreaterThan(10);
    // Some cuts should have stages assigned from Levcut
    const staged = s?.cuts.filter((c) => c.stage !== undefined);
    expect(staged?.length).toBeGreaterThan(0);
  });

  it("parses Optima OTV JSON layout", () => {
    const c = readFileSync(join(fixtures, "optima/sample.otv"), "utf8");
    const r = parseAndNormalize(c, "o1.otv");
    expect(r.status).not.toBe("failed");
    const s = sheet(r.document);
    expect(s?.panes.length).toBeGreaterThan(0);
    expect(s?.cuts.length).toBeGreaterThan(10);
  });

  it("parses Hegla EDI and produces panes from polygon blocks", () => {
    const c = readFileSync(join(fixtures, "hegla/sample.edi"), "utf8");
    const r = parseAndNormalize(c, "sample.EDI");
    expect(r.status).not.toBe("failed");
    const s = sheet(r.document);
    // The fixture has parenthesized polygon blocks → should produce panes now
    expect(s?.panes.length).toBeGreaterThan(0);
    expect(s?.cuts.length).toBeGreaterThan(5);
  });

  it("parses Hegla KASUN regression fixture via extension fallback", () => {
    const c = readFileSync(join(fixtures, "hegla/regression/KASUNEST.EDI"), "utf8");
    const r = parseAndNormalize(c, "KASUNEST.EDI");
    // May be partial or ok — the fixture has only 2 body lines
    expect(r.document).toBeDefined();
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(3660);
    expect(s?.sheet.height).toBe(2440);
  });

  it("parses Macotech IMP", () => {
    const c = readFileSync(join(fixtures, "macotech/sample.imp"), "utf8");
    const r = parseAndNormalize(c, "CLR10_1.imp");
    expect(r.status).not.toBe("failed");
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(3660);
    expect(s?.cuts.length).toBeGreaterThan(0);
  });

  it("decodes UTF-16LE Macotech IMP regression fixture (full pipeline)", () => {
    const bytes = new Uint8Array(readFileSync(join(fixtures, "macotech/regression/utf16-layout.imp")));
    const r = parseFileBytes(bytes, "utf16-layout.imp");
    expect(r.status).not.toBe("failed");
    expect(r.document).toBeDefined();
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(3660);
    expect(s?.cuts.length).toBeGreaterThan(0);
  });

  it("parses Intermac [Shape] arcs (L= radius, C= side) as arc cuts", () => {
    const c = readFileSync(join(fixtures, "intermac/regression/CIRCLEPERFCUT.OTD"), "utf8");
    const r = parseAndNormalize(c, "CIRCLEPERFCUT.OTD");
    const s = sheet(r.document);
    const arcs = s?.cuts.filter((cut) => cut.type === "arc") ?? [];
    expect(arcs.length).toBeGreaterThanOrEqual(2);
    // The two L=214.5 arcs form a full circle: (479,264.5)→(50,264.5)
    const a = arcs[0];
    expect(a?.radius).toBe(214.5);
    expect(a?.center).toBeDefined();
    expect(a?.center?.x).toBeCloseTo(264.5, 1);
    expect(a?.center?.y).toBeCloseTo(264.5, 1);
  });

  it("parses DXF LINE/LWPOLYLINE/CIRCLE/ARC entities", () => {
    const c = readFileSync(join(fixtures, "dxf/sample.dxf"), "utf8");
    const r = parseAndNormalize(c, "sample.dxf");
    expect(r.status).toBe("ok");
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(600);
    expect(s?.sheet.height).toBe(400);
    expect(s?.cuts.length).toBe(8); // 2 lines + 4 closed polyline segs + circle + arc
    const arcs = s?.cuts.filter((cut) => cut.type === "arc") ?? [];
    expect(arcs.length).toBe(2);
    expect(arcs[0]?.radius).toBe(50);
    // DXF is Y-up; normalization flips to top-left
    expect(arcs[0]?.center?.y).toBeCloseTo(200, 0);
  });

  it("parses Lisec [LASER] marks", () => {
    const c = [
      "[BATCH]",
      "[LPL_BREITE]600",
      "[LPL_HOEHE]400",
      "[TRAVERE]300",
      "[LASER] X=100 Y=50 LSR_ANGLE=90 LSR_MIRROR=0",
      "[RLASER] X=200 Y=80 LSR_MIRROR=1",
    ].join("\r\n");
    const r = parseAndNormalize(c, "laser.dat");
    const s = sheet(r.document);
    expect(s?.laser?.length).toBe(2);
    expect(s?.laser?.[0]).toMatchObject({ x: 100, angle: 90 });
    expect(s?.laser?.[1]?.mirror).toBe(true);
  });

  it("parses Perfect Cut XML job report (UTF-16LE fixture)", () => {
    const bytes = new Uint8Array(readFileSync(join(fixtures, "perfectcut/regression/B19598.xml")));
    const r = parseFileBytes(bytes, "B19598.xml");
    expect(r.status).toBe("partial"); // statistics-only
    expect(r.detected.formatId).toBe("perfectcut-xml");
    expect(r.document?.sheets.length).toBeGreaterThanOrEqual(1);
    expect(r.document?.sheets[0]?.sheet.width).toBe(3660);
    expect(r.document?.metadata.machine).toContain("INTERMAC");
    expect(r.warnings.some((w) => w.includes("Statistics-only"))).toBe(true);
  });

  it("reports Macotech family configs clearly (no layout)", () => {
    const bytes = new Uint8Array(readFileSync(join(fixtures, "macotech/regression/family-config.imp")));
    const r = parseFileBytes(bytes, "family-config.imp");
    expect(r.status).toBe("failed");
    expect(r.detected.formatId).toBe("macotech-family");
    expect(r.error).toContain("family configuration");
  });

  it("parses NUM ISO .CUT programs (sheet, scores, shaped piece)", () => {
    const c = readFileSync(join(fixtures, "intermac/2_01.CUT"), "utf8");
    const d = detectFormat(c, "2_01.CUT");
    expect(d.formatId).toBe("bavelloni-cut");
    expect(d.vendor).toBe("Bavelloni");
    expect(d.confidence).toBe("high");

    const r = parseAndNormalize(c, "2_01.CUT");
    expect(r.status).toBe("ok");
    expect(r.document?.metadata.machine).toContain("SYNCRO");
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(3660);
    expect(s?.sheet.height).toBe(2440);
    expect(r.document?.metadata.glassThickness).toBe(12);
    expect(r.document?.metadata.glassType).toContain("CLR");

    const scores = s?.cuts.filter((cut) => cut.stage === 1 || cut.stage === 2) ?? [];
    expect(scores.length).toBe(2);
    const vertical = scores.find((cut) => cut.stage === 1);
    expect(vertical?.points.every((p) => p.x === 640)).toBe(true);

    const pane = s?.panes[0];
    expect(pane?.polygon?.length).toBeGreaterThan(4);
    expect(s?.cuts.some((cut) => cut.type === "arc")).toBe(true);
    for (const p of pane?.polygon ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.y).toBeGreaterThanOrEqual(-0.5);
      expect(p.x).toBeLessThanOrEqual(3660.5);
      expect(p.y).toBeLessThanOrEqual(2440.5);
    }
  });

  it("always reads E30000 as tenths of a millimetre", () => {
    const c = [
      "%1",
      "N1(SMALL_001)",
      "N2E30000=8000E30001=1200E30002=0004",
      "N5(MON             )",
      "(NUM SYNCRO)",
      "L6=0L7=0L8=0L13=100L14=0G77H9030",
    ].join("\n");
    const r = parseAndNormalize(c, "small.CUT");
    expect(r.document?.sheets[0]?.sheet.width).toBe(800);
    expect(r.document?.sheets[0]?.sheet.height).toBe(1200);
  });

  it("reuses shape blocks by L13/L14 N-labels (SYNCRO G77N8N9)", () => {
    const c = readFileSync(join(fixtures, "bavelloni/syncro-two-shapes.CUT"), "utf8");
    const r = parseAndNormalize(c, "syncro-two-shapes.CUT");
    expect(r.status).toBe("ok");
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(1500);
    expect(s?.sheet.height).toBe(1500);
    expect(s?.panes.length).toBe(4);
    const scores = s?.cuts.filter((cut) => cut.stage === 1 || cut.stage === 2) ?? [];
    expect(scores.length).toBe(1);
    const large = s?.panes.filter((p) => Math.abs(p.bounds.width - 1000) < 1) ?? [];
    const small = s?.panes.filter((p) => Math.abs(p.bounds.width - 400) < 1) ?? [];
    expect(large.length).toBe(3);
    expect(small.length).toBe(1);
  });

  it("parses REV 372 SR Low-E grind paths (G77H9666)", () => {
    const c = readFileSync(join(fixtures, "bavelloni/rev372-lowe.CUT"), "utf8");
    const d = detectFormat(c, "rev372-lowe.CUT");
    expect(d.formatId).toBe("bavelloni-cut");
    expect(d.vendor).toBe("Bavelloni");

    const r = parseAndNormalize(c, "rev372-lowe.CUT");
    expect(r.status).toBe("ok");
    expect(r.document?.metadata.machine).toContain("REV 372");
    const s = sheet(r.document);
    expect(s?.sheet.width).toBe(1200);
    const grind = s?.cuts.filter((cut) => cut.stageLabel === "Low-E") ?? [];
    expect(grind.length).toBe(4);
  });

  it("detects Flexium Plus and reads jumbo E30000 tenths", () => {
    const c = readFileSync(join(fixtures, "bavelloni/flexium-plus.CUT"), "utf8");
    const d = detectFormat(c, "flexium-plus.CUT");
    expect(d.formatId).toBe("bavelloni-cut");
    const r = parseAndNormalize(c, "flexium-plus.CUT");
    expect(r.document?.metadata.machine).toContain("Flexium");
    expect(r.document?.sheets[0]?.sheet.width).toBe(3210);
    expect(r.document?.sheets[0]?.sheet.height).toBe(2100);
    expect(r.document?.sheets[0]?.cuts.length).toBe(3);
  });

  it("splits multi-program NUM files into one sheet per %n", () => {
    const c = [
      "%1",
      "N1(SHEET_A)",
      "N2E30000=15000E30001=1500E30002=0004",
      "(NUM SYNCRO)",
      "L6=0L7=0L8=0L13=100L14=0G77H9030",
      "%2",
      "N1(SHEET_B)",
      "N2E30000=20000E30001=1000E30002=0004",
      "(NUM SYNCRO)",
      "L6=0L7=0L8=0L13=200L14=0G77H9030",
    ].join("\n");
    const r = parseAndNormalize(c, "multi.CUT");
    expect(r.document?.sheets.length).toBe(2);
    expect(r.document?.sheets[0]?.sheet.width).toBe(1500);
    expect(r.document?.sheets[1]?.sheet.width).toBe(2000);
  });

  it("reports encrypted .ot5 archives clearly", () => {
    const r = parseAndNormalize("binary garbage \x00\x01\x02", "archive.OT5");
    expect(r.status).toBe("failed");
    expect(r.detected.formatId).toBe("perfectcut-ot5");
    expect(r.error).toContain("Encrypted");
  });
});

/* ------------------------------------------------------------------ */
/*  Coordinate normalization                                           */
/* ------------------------------------------------------------------ */

describe("coordinate normalization", () => {
  it("normalizes Lisec bottom-left origin so panes are on-sheet", () => {
    const c = readFileSync(join(fixtures, "lisec/sample.dat"), "utf8");
    const r = parseAndNormalize(c, "PL001.DAT");
    const s = sheet(r.document);
    // After normalization (bottom-left → top-left flip), panes should
    // have y >= 0 and y + height <= sheetHeight
    for (const pane of s?.panes ?? []) {
      expect(pane.bounds.y).toBeGreaterThanOrEqual(0);
      expect(pane.bounds.y + pane.bounds.height).toBeLessThanOrEqual(s!.sheet.height + 0.5);
    }
  });

  it("Intermac top-left origin is unchanged by normalization", () => {
    const c = readFileSync(join(fixtures, "intermac/sample.otd"), "utf8");
    const r = parseAndNormalize(c, "test.OTD");
    const s = sheet(r.document, 0);
    const pane60 = s?.panes.find((p) => p.id === "60");
    // Pane 60 is at (0,0) — should stay at (0,0) since already top-left
    expect(pane60?.bounds.x).toBe(0);
    expect(pane60?.bounds.y).toBe(0);
  });
});
