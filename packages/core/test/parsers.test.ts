import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFormat } from "../src/detect/formatDetector.js";
import { parseAndNormalize } from "../src/index.js";

const fixtures = join(import.meta.dirname, "../../../fixtures");

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

  it("detects Hegla EDI", () => {
    const c = readFileSync(join(fixtures, "hegla/sample.edi"), "utf8");
    const d = detectFormat(c, "x.edi");
    expect(d.formatId).toBe("hegla-edi");
  });

  it("detects Macotech IMP", () => {
    const c = readFileSync(join(fixtures, "macotech/sample.imp"), "utf8");
    const d = detectFormat(c, "x.imp");
    expect(d.formatId).toBe("macotech-imp");
  });
});

describe("parsers", () => {
  it("parses Lisec sheet dimensions", () => {
    const c = readFileSync(join(fixtures, "lisec/sample.dat"), "utf8");
    const r = parseAndNormalize(c, "PL001.DAT");
    expect(r.status).not.toBe("failed");
    expect(r.plan?.sheet.width).toBe(321);
    expect(r.plan?.sheet.height).toBe(225);
    expect(r.plan?.cuts.length).toBeGreaterThan(0);
  });

  it("parses Intermac sheet and cuttings", () => {
    const c = readFileSync(join(fixtures, "intermac/sample.otd"), "utf8").slice(0, 12000);
    const r = parseAndNormalize(c, "test.OTD");
    expect(r.status).not.toBe("failed");
    expect(r.plan?.sheet.width).toBe(2440);
    expect(r.plan?.sheet.height).toBe(1830);
    expect(r.plan?.cuts.length).toBeGreaterThan(5);
  });

  it("parses Intermac pane XO line coordinates", () => {
    const c = readFileSync(join(fixtures, "intermac/sample.otd"), "utf8").slice(0, 12000);
    const r = parseAndNormalize(c, "test.OTD");
    const pane60 = r.plan?.panes.find((p) => p.id === "60");
    expect(pane60?.bounds.width).toBe(808.5);
    expect(pane60?.bounds.height).toBe(320.5);
  });

  it("parses Optima R01 cuttings", () => {
    const c = readFileSync(join(fixtures, "optima/sample.r01"), "utf8");
    const r = parseAndNormalize(c, "CLR03_4.r01");
    expect(r.status).not.toBe("failed");
    expect(r.plan?.sheet.width).toBe(3660);
    expect(r.plan?.cuts.length).toBeGreaterThan(10);
  });

  it("parses Optima OTV JSON layout", () => {
    const c = readFileSync(join(fixtures, "optima/sample.otv"), "utf8");
    const r = parseAndNormalize(c, "o1.otv");
    expect(r.status).toBe("ok");
    expect(r.plan?.panes.length).toBeGreaterThan(0);
    expect(r.plan?.cuts.length).toBeGreaterThan(10);
  });

  it("parses Hegla EDI polygons", () => {
    const c = readFileSync(join(fixtures, "hegla/sample.edi"), "utf8");
    const r = parseAndNormalize(c, "3981.EDI");
    expect(r.status).not.toBe("failed");
    expect(r.plan?.cuts.length).toBeGreaterThan(5);
  });

  it("parses Macotech IMP sheet and shapes", () => {
    const c = readFileSync(join(fixtures, "macotech/sample.imp"), "utf8");
    const r = parseAndNormalize(c, "CLR10_1.imp");
    expect(r.status).not.toBe("failed");
    expect(r.plan?.sheet.width).toBe(3660);
    expect(r.plan?.cuts.length).toBeGreaterThan(0);
  });
});
