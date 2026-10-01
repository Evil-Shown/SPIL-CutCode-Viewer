import type { Cut, CutPlan } from "@spil/cutcode-core";
import { sampleArc } from "@spil/cutcode-core";
import { THEMES, STAGE_COLORS, type ThemeName } from "./theme";

/** Points of a cut as a polyline (arcs are sampled). */
function cutPolyline(cut: Cut): Array<{ x: number; y: number }> {
  if (cut.type === "arc" && cut.center && cut.radius) {
    return sampleArc(
      { start: cut.points[0], end: cut.points[1] ?? cut.points[0], radius: cut.radius, side: cut.ccw ? -1 : 1 },
      32
    );
  }
  return cut.points;
}

/** Render a sheet to a canvas 2D context at the given scale (px per mm). */
export function drawSheetToCtx(
  ctx: CanvasRenderingContext2D,
  sheet: CutPlan,
  scale: number,
  opts: ExportOptions & { margin: number }
): void {
  const theme = THEMES.light;
  const W = sheet.sheet.width * scale + opts.margin * 2;
  const H = sheet.sheet.height * scale + opts.margin * 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(opts.margin, opts.margin);

  // Sheet
  ctx.fillStyle = theme.sheetFill;
  ctx.strokeStyle = theme.sheetStroke;
  ctx.lineWidth = 2;
  ctx.fillRect(0, 0, sheet.sheet.width * scale, sheet.sheet.height * scale);
  ctx.strokeRect(0, 0, sheet.sheet.width * scale, sheet.sheet.height * scale);

  // Trim zone: the usable glass area inside the declared edge strips.
  const t = sheet.sheet.trims;
  if (opts.trims && t && (t.left || t.right || t.top || t.bottom)) {
    ctx.save();
    ctx.strokeStyle = "#eab308";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      t.left * scale,
      t.top * scale,
      (sheet.sheet.width - t.left - t.right) * scale,
      (sheet.sheet.height - t.top - t.bottom) * scale
    );
    ctx.restore();
  }

  // Panes
  sheet.panes.forEach((pane, i) => {
    const color = pane.rotated ? theme.rotatedPane : theme.paneStrokes[i % theme.paneStrokes.length];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(pane.bounds.x * scale, pane.bounds.y * scale, pane.bounds.width * scale, pane.bounds.height * scale);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    if (pane.polygon && pane.polygon.length >= 3) {
      ctx.beginPath();
      pane.polygon.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x * scale, p.y * scale) : ctx.lineTo(p.x * scale, p.y * scale)));
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeRect(pane.bounds.x * scale, pane.bounds.y * scale, pane.bounds.width * scale, pane.bounds.height * scale);
    }
    if (opts.labels && scale * pane.bounds.width > 24 && scale * pane.bounds.height > 12) {
      const fontPx = Math.max(9, Math.min(12, scale * 4));
      ctx.fillStyle = color;
      ctx.font = `${fontPx}px sans-serif`;
      ctx.fillText(pane.id, pane.bounds.x * scale + 3, pane.bounds.y * scale + 11);
      if (opts.dimensions && scale * pane.bounds.height > fontPx * 2.6) {
        ctx.globalAlpha = 0.75;
        ctx.fillText(
          `${pane.bounds.width.toFixed(0)}×${pane.bounds.height.toFixed(0)}`,
          pane.bounds.x * scale + 3,
          pane.bounds.y * scale + 11 + fontPx + 2
        );
        ctx.globalAlpha = 1;
      }
    }
  });

  // Cuts (arcs sampled into smooth polylines)
  sheet.cuts.forEach((cut, i) => {
    ctx.strokeStyle = opts.stages && cut.stage ? STAGE_COLORS[(cut.stage - 1) % STAGE_COLORS.length] : theme.cutColor;
    ctx.lineWidth = i === sheet.cuts.length - 1 ? 1.5 : 1;
    ctx.beginPath();
    cutPolyline(cut).forEach((p, j) => {
      const px = p.x * scale;
      const py = p.y * scale;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });

  ctx.restore();
}

export type ExportOptions = {
  labels: boolean;
  stages: boolean;
  /** Draw the trim border (amber dashed) when the sheet declares trims. */
  trims: boolean;
  /** Draw pane dimensions under each pane id. */
  dimensions: boolean;
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { labels: true, stages: true, trims: true, dimensions: false };

export function renderPng(sheet: CutPlan, pxPerMm = 2, opts: Partial<ExportOptions> = {}): string {
  const o = { ...DEFAULT_EXPORT_OPTIONS, ...opts };
  const margin = 24;
  const W = Math.ceil(sheet.sheet.width * pxPerMm) + margin * 2;
  const H = Math.ceil(sheet.sheet.height * pxPerMm) + margin * 2;
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  drawSheetToCtx(ctx, sheet, pxPerMm, { ...o, margin });
  return off.toDataURL("image/png");
}

export function renderSvg(sheet: CutPlan, pxPerMm = 0.5, opts: Partial<ExportOptions> = {}): string {
  const o = { ...DEFAULT_EXPORT_OPTIONS, ...opts };
  const margin = 10;
  // Extra band under the sheet for the dimension caption.
  const caption = 10;
  const W = sheet.sheet.width * pxPerMm + margin * 2;
  const H = sheet.sheet.height * pxPerMm + margin * 2 + caption;
  const f = (n: number) => (n * pxPerMm).toFixed(2);
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="sans-serif">`
  );
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  parts.push(
    `<g transform="translate(${margin},${margin})"><rect x="0" y="0" width="${f(sheet.sheet.width)}" height="${f(sheet.sheet.height)}" fill="#f8fafc" stroke="#334155" stroke-width="1"/>`
  );

  const t = sheet.sheet.trims;
  if (o.trims && t && (t.left || t.right || t.top || t.bottom)) {
    parts.push(
      `<rect x="${f(t.left)}" y="${f(t.top)}" width="${f(sheet.sheet.width - t.left - t.right)}" height="${f(sheet.sheet.height - t.top - t.bottom)}" fill="none" stroke="#eab308" stroke-width="0.8" stroke-dasharray="3 2"/>`
    );
  }

  sheet.panes.forEach((pane, i) => {
    const color = pane.rotated ? "#0d9488" : THEMES.light.paneStrokes[i % THEMES.light.paneStrokes.length];
    if (pane.polygon && pane.polygon.length >= 3) {
      const pts = pane.polygon.map((p) => `${f(p.x)},${f(p.y)}`).join(" ");
      parts.push(`<polygon points="${pts}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="0.5"/>`);
    } else {
      parts.push(
        `<rect x="${f(pane.bounds.x)}" y="${f(pane.bounds.y)}" width="${f(pane.bounds.width)}" height="${f(pane.bounds.height)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="0.5"/>`
      );
    }
    if (o.labels) {
      parts.push(
        `<text x="${f(pane.bounds.x) + 2}" y="${f(pane.bounds.y) + 8}" font-size="6" fill="${color}">${escapeXml(pane.id)}</text>`
      );
      if (o.dimensions) {
        parts.push(
          `<text x="${f(pane.bounds.x) + 2}" y="${f(pane.bounds.y) + 15}" font-size="5" fill="${color}" fill-opacity="0.8">${pane.bounds.width.toFixed(0)}×${pane.bounds.height.toFixed(0)}</text>`
        );
      }
    }
  });

  sheet.cuts.forEach((cut) => {
    const pts = cutPolyline(cut).map((p) => `${f(p.x)},${f(p.y)}`).join(" ");
    const color =
      o.stages && cut.stage ? STAGE_COLORS[(cut.stage - 1) % STAGE_COLORS.length] : "#ea580c";
    parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="0.8"/>`);
  });

  for (const mark of sheet.laser ?? []) {
    const r = 4;
    parts.push(
      `<g stroke="${THEMES.light.laserColor}" stroke-width="0.7"><line x1="${f(mark.x - r)}" y1="${f(mark.y - r)}" x2="${f(mark.x + r)}" y2="${f(mark.y + r)}"/><line x1="${f(mark.x - r)}" y1="${f(mark.y + r)}" x2="${f(mark.x + r)}" y2="${f(mark.y - r)}"/></g>`
    );
  }

  parts.push(
    `<text x="${f(sheet.sheet.width / 2)}" y="${f(sheet.sheet.height + 6)}" font-size="7" text-anchor="middle" fill="#64748b">${sheet.sheet.width} × ${sheet.sheet.height} mm</text>`
  );
  parts.push(`</g></svg>`);
  return parts.join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

export function textToBytes(text: string): Uint8Array {
  // BOM so Excel picks UTF-8 when a CSV is double-clicked.
  return new TextEncoder().encode(text);
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function triggerPrint(sheet: CutPlan, title: string, extras: { vendor?: string; format?: string; cycleTimeS?: number; scoreMetres?: number } = {}): void {
  const png = renderPng(sheet, 1.5);
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  const rows: string[] = [
    `<tr><td><b>Sheet</b></td><td>${sheet.sheet.width} × ${sheet.sheet.height} mm</td></tr>`,
    `<tr><td><b>Panes</b></td><td>${sheet.panes.length}</td></tr>`,
    `<tr><td><b>Cuts</b></td><td>${sheet.cuts.length}</td></tr>`,
  ];
  if (extras.vendor) rows.push(`<tr><td><b>Source</b></td><td>${escapeXml(extras.vendor)}${extras.format ? ` · ${escapeXml(extras.format)}` : ""}</td></tr>`);
  if (extras.scoreMetres !== undefined) rows.push(`<tr><td><b>Score length</b></td><td>${extras.scoreMetres.toFixed(2)} m</td></tr>`);
  if (extras.cycleTimeS !== undefined) rows.push(`<tr><td><b>Cycle time</b></td><td>${extras.cycleTimeS.toFixed(1)} s</td></tr>`);

  const paneRows = sheet.panes
    .slice(0, 300)
    .map(
      (p) =>
        `<tr><td>${escapeXml(p.id)}</td><td>${p.bounds.width.toFixed(1)} × ${p.bounds.height.toFixed(1)}</td><td>${p.bounds.x.toFixed(1)}, ${p.bounds.y.toFixed(1)}</td><td>${((p.bounds.width * p.bounds.height) / 1e6).toFixed(3)}</td></tr>`
    )
    .join("");

  w.document.write(`<!doctype html><html><head><title>${escapeXml(title)}</title><style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #1e293b; }
    img { max-width: 100%; border: 1px solid #cbd5e1; }
    table { border-collapse: collapse; margin-bottom: 16px; }
    td { padding: 4px 16px 4px 0; }
    .sheet-list { font-size: 11px; width: 100%; }
    .sheet-list th, .sheet-list td { border-bottom: 1px solid #e2e8f0; text-align: left; padding: 3px 8px 3px 0; }
    h3 { font-size: 13px; margin: 18px 0 6px; }
  </style></head><body>
  <h2>${escapeXml(title)}</h2>
  <table>${rows.join("")}</table>
  <img src="${png}" onload="window.print()" />
  <h3>Panes (${sheet.panes.length})</h3>
  <table class="sheet-list">
    <tr><th>ID</th><th>Size mm</th><th>Position mm</th><th>Area m²</th></tr>
    ${paneRows}
  </table>
  ${sheet.panes.length > 300 ? `<p style="font-size:11px">…and ${sheet.panes.length - 300} more</p>` : ""}
  </body></html>`);
  w.document.close();
}
