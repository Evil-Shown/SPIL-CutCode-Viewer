import type { ParseResult } from "../model/types.js";

/**
 * Macotech/Perfect Cut machine family configuration (`dati/*.IMP`).
 * These define glass families (NAME, SPESSORE, tolerances) — no cut layouts.
 * Detected and reported clearly instead of failing as a malformed layout.
 */
export function parseMacotechFamily(content: string, sourcePath: string): ParseResult {
  const names = [...content.matchAll(/^\[FAMILY(\d+)\]\s*$/gim)].map((m) => m[1]);
  const nameM = content.match(/^NAME\s*=\s*(.+)$/m);
  const thM = content.match(/^SPESSORE\s*=\s*([\d.]+)/m);

  return {
    status: "failed",
    warnings: [],
    error:
      `This is a machine family configuration file (${names.length || 1} famil${names.length === 1 ? "y" : "ies"}` +
      `${nameM ? `, glass "${nameM[1].trim()}"${thM ? ` ${thM[1]}mm` : ""}` : ""}) — ` +
      "it contains no sheet layout or cuts. Open a layout file (.otd/.opt/.imp pattern/.dat/.edi) instead.",
    detected: { vendor: "Macotech", formatId: "macotech-family", confidence: "high", matchedSignal: "[FAMILYn] config" },
  };
}
