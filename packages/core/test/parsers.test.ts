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
