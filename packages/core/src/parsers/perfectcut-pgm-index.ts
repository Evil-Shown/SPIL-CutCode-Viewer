import type { ParseResult } from "../model/types.js";

/**
 * Perfect Cut `.LST` index files (`LAAKE.LST`, `B4071_4CLFL.LST`, `OPURU.LST`).
 * They contain no geometry, only the names of the sibling `.PGM` programs:
 *
 *   PGM LAAKE001
 *   PGM B4071_4CLFL001
 *
 * The simulator surfaces the referenced programs so the user can open the real
 * cutcode instead of an empty index.
 */
export function parsePerfectCutPgmIndex(content: string, sourcePath: string): ParseResult {
  const programs = [...content.matchAll(/^\s*PGM\s+(\S+)\s*$/gim)]
    .map((m) => m[1]!)
    .filter(Boolean);

  if (programs.length === 0) {
    return {
      status: "failed",
      warnings: [],
      error: "No `PGM <name>` records found in the Perfect Cut index file",
      detected: { vendor: "Perfect Cut", formatId: "perfectcut-pgm-index", confidence: "high", matchedSignal: "PGM <name>" },
    };
  }

  const dir = sourcePath.replace(/[/\\][^/\\]*$/, "");
  const list = programs.map((p) => `${dir.replace(/\\/g, "/")}/${p}.PGM`);

  return {
    status: "partial",
    warnings: [
      `Index file listing ${programs.length} program${programs.length === 1 ? "" : "s"}. Open one of the referenced .PGM files.`,
    ],
    document: {
      metadata: {
        vendor: "Perfect Cut",
        sourcePath,
        operator: `Referenced programs: ${list.join(", ")}`,
      },
      sheets: [],
    },
    detected: { vendor: "Perfect Cut", formatId: "perfectcut-pgm-index", confidence: "high", matchedSignal: "PGM <name>" },
  };
}