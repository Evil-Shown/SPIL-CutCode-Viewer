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
  opts: { labels: boolean; stages: boolean; margin: number }
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
      ctx.fillStyle = color;
      ctx.font = `${Math.max(9, Math.min(12, scale * 4))}px sans-serif`;
      ctx.fillText(pane.id, pane.bounds.x * scale + 3, pane.bounds.y * scale + 11);
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

export function renderPng(sheet: CutPlan, pxPerMm = 2): string {
  const margin = 24;
  const W = Math.ceil(sheet.sheet.width * pxPerMm) + margin * 2;
  const H = Math.ceil(sheet.sheet.height * pxPerMm) + margin * 2;
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  drawSheetToCtx(ctx, sheet, pxPerMm, { labels: true, stages: false, margin });
  return off.toDataURL("image/png");
}

export function renderSvg(sheet: CutPlan, pxPerMm = 0.5): string {
  const margin = 10;
  const W = sheet.sheet.width * pxPerMm + margin * 2;
  const H = sheet.sheet.height * pxPerMm + margin * 2;
  const f = (n: number) => (n * pxPerMm).toFixed(2);
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="sans-serif">`
  );
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  parts.push(
    `<g transform="translate(${margin},${margin})"><rect x="0" y="0" width="${f(sheet.sheet.width)}" height="${f(sheet.sheet.height)}" fill="#f8fafc" stroke="#334155" stroke-width="1"/>`
  );

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
  });

  sheet.cuts.forEach((cut) => {
    const pts = cutPolyline(cut).map((p) => `${f(p.x)},${f(p.y)}`).join(" ");
    parts.push(`<polyline points="${pts}" fill="none" stroke="#ea580c" stroke-width="0.8"/>`);
  });

  parts.push(`</g></svg>`);
  return parts.join("\n");
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

export function triggerPrint(sheet: CutPlan, title: string): void {
  const png = renderPng(sheet, 1.5);
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #1e293b; }
    img { max-width: 100%; border: 1px solid #cbd5e1; }
    table { border-collapse: collapse; margin-bottom: 16px; }
    td { padding: 4px 16px 4px 0; }
  </style></head><body>
  <h2>${title}</h2>
  <table>
    <tr><td><b>Sheet</b></td><td>${sheet.sheet.width} × ${sheet.sheet.height} mm</td></tr>
    <tr><td><b>Panes</b></td><td>${sheet.panes.length}</td></tr>
    <tr><td><b>Cuts</b></td><td>${sheet.cuts.length}</td></tr>
  </table>
  <img src="${png}" onload="window.print()" />
  </body></html>`);
  w.document.close();
}
