import { describe, expect, it } from "vitest";
import { decodeCutcodeBytes } from "../src/decode/encoding.js";
import { normalizePoint, normalizeRect } from "../src/normalize/coordinates.js";

function ascii(s: string): Uint8Array {
  return new Uint8Array(s.split("").map((c) => c.charCodeAt(0)));
}

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2 + 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out;
}

function utf16be(s: string, bom = true): Uint8Array {
  const start = bom ? 2 : 0;
  const out = new Uint8Array(s.length * 2 + start);
  if (bom) {
    out[0] = 0xfe;
    out[1] = 0xff;
  }
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[start + i * 2] = code >> 8;
    out[start + i * 2 + 1] = code & 0xff;
  }
  return out;
}

describe("decodeCutcodeBytes", () => {
  it("decodes plain ASCII/UTF-8", () => {
    expect(decodeCutcodeBytes(ascii("[Pattern]\r\nWidth=600\r\n"))).toBe("[Pattern]\r\nWidth=600\r\n");
  });

  it("decodes UTF-8 with multi-byte characters", () => {
    const bytes = new TextEncoder().encode("Width=600;Desc=Glas dünn ✓");
    expect(decodeCutcodeBytes(bytes)).toBe("Width=600;Desc=Glas dünn ✓");
  });

  it("decodes UTF-16LE with BOM", () => {
    expect(decodeCutcodeBytes(utf16le("[FAMILY1]\r\nNAME=CLR10"))).toBe("[FAMILY1]\r\nNAME=CLR10");
  });

  it("decodes UTF-16LE without BOM via NUL heuristic", () => {
    const withBom = utf16le("[Pattern]\r\nWidth=225\r\nHeight=321");
    const noBom = withBom.subarray(2); // strip BOM
    expect(decodeCutcodeBytes(noBom)).toBe("[Pattern]\r\nWidth=225\r\nHeight=321");
  });

  it("decodes UTF-16BE with BOM", () => {
    expect(decodeCutcodeBytes(utf16be("[FAMILY1]\r\nNAME=CLR10"))).toBe("[FAMILY1]\r\nNAME=CLR10");
  });

  it("decodes BOM-less UTF-16BE via NUL heuristic", () => {
    const bytes = utf16be("[Pattern]\r\nWidth=225\r\nHeight=321", false);
    expect(decodeCutcodeBytes(bytes)).toBe("[Pattern]\r\nWidth=225\r\nHeight=321");
  });

  it("does not mistake UTF-16LE for UTF-16BE", () => {
    const le = utf16le("[Pattern]\r\nWidth=225").subarray(2);
    const be = utf16be("[Pattern]\r\nWidth=225", false);
    expect(decodeCutcodeBytes(le)).toBe("[Pattern]\r\nWidth=225");
    expect(decodeCutcodeBytes(be)).toBe("[Pattern]\r\nWidth=225");
  });

  it("falls back to windows-1252 for legacy ANSI bytes", () => {
    // 0xE4 is ä in cp1252 but invalid as a UTF-8 start of a 2-byte sequence alone
    const bytes = new Uint8Array([0x57, 0x69, 0x64, 0x74, 0x68, 0x3d, 0xe4]); // Width=ä
    expect(decodeCutcodeBytes(bytes)).toBe("Width=ä");
  });

  it("handles empty input", () => {
    expect(decodeCutcodeBytes(new Uint8Array(0))).toBe("");
  });
});

describe("coordinate normalization", () => {
  const bottomLeft = { origin: "bottom-left" as const, xAxis: "right" as const, units: "mm" as const };
  const topLeft = { origin: "top-left" as const, xAxis: "right" as const, units: "mm" as const };

  it("flips a point from bottom-left origin", () => {
    expect(normalizePoint(10, 30, bottomLeft, 100)).toEqual({ x: 10, y: 70 });
  });

  it("leaves top-left points unchanged", () => {
    expect(normalizePoint(10, 30, topLeft, 100)).toEqual({ x: 10, y: 30 });
  });

  it("flips a rect by its full extent (regression: panes off-sheet)", () => {
    // A pane at y=0 with height 70 on a 225mm sheet must land at y=155, not y=225
    const r = normalizeRect(0, 0, 100, 70, bottomLeft, 225);
    expect(r).toEqual({ x: 0, y: 155, width: 100, height: 70 });
    expect(r.y + r.height).toBe(225);
  });

  it("scales internal ticks", () => {
    const ticks = { origin: "top-left" as const, xAxis: "right" as const, units: "internal-ticks" as const, unitsToMm: 1 / 16 };
    const p = normalizePoint(160, 320, ticks, 1000);
    expect(p).toEqual({ x: 10, y: 20 });
  });

  it("negates x for left-pointing axes", () => {
    const left = { origin: "top-left" as const, xAxis: "left" as const, units: "mm" as const };
    expect(normalizePoint(10, 30, left, 100)).toEqual({ x: -10, y: 30 });
  });
});
