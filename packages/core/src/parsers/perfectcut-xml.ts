import type { CutDocument, ParseResult } from "../model/types.js";

/**
 * Perfect Cut job report XML (`<CUT><FAMILY …><SHEET …><PIECE … />`).
 *
 * These files are optimization *statistics* summaries: family yield
 * (USED/WASTE), sheet dimensions/quantity, and piece order lines — they carry
 * no cut geometry. We parse them into an informative document (metadata +
 * sheet dims + piece count) and report a clear warning instead of failing.
 */

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_]+)\s*=\s*"([^"]*)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

export function parsePerfectCutXml(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];

  const families = content.match(/<FAMILY\b[^>]*>/gi) ?? [];
  const sheets = content.match(/<SHEET\b[^>]*\/?>/gi) ?? [];
  const pieces = content.match(/<PIECE\b[^>]*\/?>/gi) ?? [];

  if (families.length === 0 && sheets.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "XML has no FAMILY/SHEET elements (not a Perfect Cut job report)",
      detected: { vendor: "Perfect Cut", formatId: "perfectcut-xml", confidence: "high" },
    };
  }

  const fam = families[0] ? attrs(families[0]) : {};
  const num = (v: string | undefined) => (v !== undefined && Number.isFinite(parseFloat(v)) ? parseFloat(v) : undefined);

  // One sheet entry per FAMILY/SHEET group (reports usually have one per family)
  const sheetPlans: CutDocument["sheets"] = [];
  for (const sTag of sheets) {
    const s = attrs(sTag);
    const w = num(s.WIDTH);
    const h = num(s.HEIGHT);
    if (!w || !h) continue;
    sheetPlans.push({
      id: `sheet-${sheetPlans.length + 1}`,
      label: [fam.NAME, s.QTY && s.QTY !== "1" ? `×${s.QTY}` : ""].filter(Boolean).join(" ") || undefined,
      sheet: { width: w, height: h },
      panes: [],
      cuts: [],
      coordinateSemantics: { origin: "top-left", xAxis: "right", units: "mm" },
    });
  }

  if (sheetPlans.length === 0 && pieces.length === 0 && Object.keys(fam).length === 0) {
    return {
      status: "failed",
      warnings,
      error: "Job report has no FAMILY/SHEET/PIECE data",
      detected: { vendor: "Perfect Cut", formatId: "perfectcut-xml", confidence: "high" },
    };
  }

  warnings.push(
    `Statistics-only job report: ${pieces.length} piece entries${sheetPlans.length === 0 ? ", no sheet data" : ""}, no cut geometry`,
    ...(fam.USED !== undefined ? [`Yield used ${fam.USED}% / waste ${fam.WASTE ?? "?"}%`] : [])
  );

  return {
    status: "partial",
    document: {
      metadata: {
        vendor: "Perfect Cut",
        machine: fam.CN,
        glassType: fam.NAME,
        sourcePath,
        // store project path via machine field is taken; keep operator for project
        operator: fam.PROJECT,
      },
      sheets: sheetPlans,
    },
    warnings,
    detected: { vendor: "Perfect Cut", formatId: "perfectcut-xml", confidence: "high", matchedSignal: "<CUT>/<FAMILY>" },
  };
}
