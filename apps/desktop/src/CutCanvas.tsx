import { useCallback, useEffect, useRef } from "react";
import type { Cut, CutPlan, Point } from "@spil/cutcode-core";
import { sampleArc } from "@spil/cutcode-core";
import { seqClock } from "./seqClock";
import { useAppStore } from "./store";
import { THEMES, STAGE_COLORS } from "./theme";

const RULER_SIZE = 22;
const MINIMAP_SIZE = 180;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3.5;
const MAX_MINIMAP_LINES = 1000;

/** Distance from point to segment (screen px). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function CutCanvas({ sheet }: { sheet: CutPlan }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const viewRef = useRef({ scale: 1, baseScale: 1, tx: RULER_SIZE + 8, ty: RULER_SIZE + 8, zoom: 1 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const panState = useRef<{ panning: boolean; lastX: number; lastY: number; moved: boolean }>({ panning: false, lastX: 0, lastY: 0, moved: false });
  const hoverRef = useRef<{ type: "cut" | "pane"; index: number } | null>(null);
  const measurePts = useRef<Point[]>([]);

  const layers = useAppStore((s) => s.layers);
  const themeName = useAppStore((s) => s.theme);
  const selectedCutIndex = useAppStore((s) => s.selectedCutIndex);
  const selectedPaneId = useAppStore((s) => s.selectedPaneId);
  const fitRequest = useAppStore((s) => s.fitRequest);
  const focusTarget = useAppStore((s) => s.focusTarget);
  const seqSpeed = useAppStore((s) => s.seqSpeed);
  const measureMode = useAppStore((s) => s.measureMode);
  const selectCut = useAppStore((s) => s.selectCut);
  const selectPane = useAppStore((s) => s.selectPane);
  const setStatus = useAppStore((s) => s.setStatus);

  const theme = THEMES[themeName];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const view = viewRef.current;
    const S = view.scale; // px per mm (incl. zoom)
    const w2s = (x: number, y: number): [number, number] => [view.tx + x * S, view.ty + y * S];

    /* ---------- background ---------- */
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    const sx0 = view.tx;
    const sy0 = view.ty;
    const sheetPxW = sheet.sheet.width * S;
    const sheetPxH = sheet.sheet.height * S;

    /* ---------- grid (adaptive minor 50mm / major 250mm) ---------- */
    if (layers.grid) {
      const drawGrid = (stepMm: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let gx = 0; gx <= sheet.sheet.width + 0.1; gx += stepMm) {
          const px = sx0 + gx * S;
          ctx.moveTo(px, Math.max(sy0, 0));
          ctx.lineTo(px, Math.min(sy0 + sheetPxH, h));
        }
        for (let gy = 0; gy <= sheet.sheet.height + 0.1; gy += stepMm) {
          const py = sy0 + gy * S;
          ctx.moveTo(Math.max(sx0, 0), py);
          ctx.lineTo(Math.min(sx0 + sheetPxW, w), py);
        }
        ctx.stroke();
      };
      if (50 * S > 7) drawGrid(50, theme.gridMinor);
      drawGrid(250, theme.gridMajor);
    }

    /* ---------- sheet ---------- */
    ctx.fillStyle = theme.sheetFill;
    ctx.strokeStyle = theme.sheetStroke;
    ctx.lineWidth = 2;
    ctx.fillRect(sx0, sy0, sheetPxW, sheetPxH);
    ctx.strokeRect(sx0, sy0, sheetPxW, sheetPxH);

    // trim zone
    const tr = sheet.sheet.trims;
    if (tr && (tr.left || tr.top || tr.right || tr.bottom)) {
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        sx0 + tr.left * S, sy0 + tr.top * S,
        (sheet.sheet.width - tr.left - tr.right) * S,
        (sheet.sheet.height - tr.top - tr.bottom) * S
      );
      ctx.setLineDash([]);
    }

    /* ---------- panes ---------- */
    sheet.panes.forEach((pane, i) => {
      const isSelected = selectedPaneId === pane.id;
      const isHover = hoverRef.current?.type === "pane" && hoverRef.current.index === i;
      const color = pane.rotated ? theme.rotatedPane : theme.paneStrokes[i % theme.paneStrokes.length];
      const [px, py] = w2s(pane.bounds.x, pane.bounds.y);
      ctx.fillStyle = color;
      ctx.globalAlpha = theme.paneFillAlpha + (isSelected || isHover ? 0.13 : 0);
      ctx.fillRect(px, py, pane.bounds.width * S, pane.bounds.height * S);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = isSelected || isHover ? theme.accent : color;
      ctx.lineWidth = isSelected || isHover ? 2 : 1;
      if (pane.polygon && pane.polygon.length >= 3) {
        ctx.beginPath();
        pane.polygon.forEach((p, j) => {
          const [vx, vy] = w2s(p.x, p.y);
          if (j === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        });
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(px, py, pane.bounds.width * S, pane.bounds.height * S);
      }
      if (layers.labels && pane.bounds.width * S > 26 && pane.bounds.height * S > 13) {
        ctx.fillStyle = color;
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(pane.id, px + 3, py + 12);
      }
    });

    /* ---------- cuts ---------- */
    const drawCutPath = (cut: Cut) => {
      ctx.beginPath();
      if (cut.type === "arc" && cut.center && cut.radius) {
        const a0 = Math.atan2(cut.points[0].y - cut.center.y, cut.points[0].x - cut.center.x);
        const a1 =
          cut.points.length > 1 && (cut.points[0].x !== cut.points[1].x || cut.points[0].y !== cut.points[1].y)
            ? Math.atan2(cut.points[1].y - cut.center.y, cut.points[1].x - cut.center.x)
            : a0 + Math.PI * 2;
        ctx.arc(cut.center.x * S + view.tx, cut.center.y * S + view.ty, cut.radius * S, a0, a1, cut.ccw ?? false);
      } else {
        cut.points.forEach((p, j) => {
          const px = view.tx + p.x * S;
          const py = view.ty + p.y * S;
          if (j === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
      }
    };

    sheet.cuts.forEach((cut, i) => {
      const isSelected = selectedCutIndex === i;
      const isHover = hoverRef.current?.type === "cut" && hoverRef.current.index === i;
      const seqPos = seqClock.progress;
      const dimmed = seqPos >= 0 && cut.sequenceIndex > seqPos;
      ctx.strokeStyle = isSelected
        ? theme.cutSelected
        : isHover
          ? theme.cutHover
          : layers.stages && cut.stage
            ? STAGE_COLORS[(cut.stage - 1) % STAGE_COLORS.length]
            : theme.cutColor;
      ctx.globalAlpha = dimmed ? 0.15 : 1;
      ctx.lineWidth = isSelected || isHover ? 3 : 1.5;
      drawCutPath(cut);
      ctx.stroke();

      if (layers.directions && cut.points.length === 2) {
        const a = cut.points[0];
        const b = cut.points[1];
        const [ax, ay] = w2s(a.x, a.y);
        const [bx, by] = w2s(b.x, b.y);
        const len = Math.hypot(bx - ax, by - ay);
        if (len > 34) {
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          const ux = (bx - ax) / len;
          const uy = (by - ay) / len;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(mx - ux * 6 - uy * 4, my - uy * 6 + ux * 4);
          ctx.lineTo(mx, my);
          ctx.lineTo(mx - ux * 6 + uy * 4, my - uy * 6 - ux * 4);
          ctx.stroke();
        }
      }

      if (layers.labels && isSelected && cut.points.length >= 2) {
        const a = cut.points[0];
        const b = cut.points[cut.points.length - 1];
        const [mx, my] = w2s((a.x + b.x) / 2, (a.y + b.y) / 2);
        ctx.fillStyle = theme.cutSelected;
        ctx.font = "bold 11px system-ui, sans-serif";
        ctx.fillText(`#${cut.sequenceIndex}${cut.stageLabel ? ` (${cut.stageLabel})` : ""}`, mx + 6, my - 6);
      }
    });
    ctx.globalAlpha = 1;

    /* ---------- pane dimension annotations ---------- */
    if (layers.dimensions) {
      ctx.font = "10px system-ui, sans-serif";
      for (const pane of sheet.panes) {
        if (pane.bounds.width * S > 44 && pane.bounds.height * S > 18) {
          const [cx, cy] = w2s(pane.bounds.x + pane.bounds.width / 2, pane.bounds.y + pane.bounds.height / 2);
          ctx.fillStyle = theme.textDim;
          ctx.textAlign = "center";
          ctx.fillText(`${pane.bounds.width.toFixed(0)}×${pane.bounds.height.toFixed(0)}`, cx, cy + 3);
          ctx.textAlign = "left";
        }
      }
    }

    /* ---------- measure overlay ---------- */
    if (measurePts.current.length > 0) {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      measurePts.current.forEach((p, j) => {
        const [px, py] = w2s(p.x, p.y);
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of measurePts.current) {
        const [px, py] = w2s(p.x, p.y);
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (measurePts.current.length === 2) {
        const [a, b] = measurePts.current as [Point, Point];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const [mx, my] = w2s((a.x + b.x) / 2, (a.y + b.y) / 2);
        const label = `${dist.toFixed(1)} mm`;
        ctx.font = "bold 11px system-ui, sans-serif";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = theme.panel;
        ctx.fillRect(mx + 6, my - 18, tw + 8, 15);
        ctx.fillStyle = theme.accent;
        ctx.fillText(label, mx + 10, my - 7);
      }
    }

    /* ---------- playback progress readout ---------- */
    if (seqClock.progress >= 0) {
      const maxSeq = sheet.cuts.length - 1;
      ctx.fillStyle = theme.panel;
      ctx.fillRect(RULER_SIZE + 8, h - 28, 130, 20);
      ctx.fillStyle = theme.text;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(`cut ${Math.round(Math.min(seqClock.progress, maxSeq))}/${maxSeq} · ${seqSpeed}×`, RULER_SIZE + 14, h - 14);
    }

    /* ---------- laser marks ---------- */
    sheet.laser?.forEach((l) => {
      const [px, py] = w2s(l.x, l.y);
      ctx.strokeStyle = theme.laserColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 5, py - 5);
      ctx.lineTo(px + 5, py + 5);
      ctx.moveTo(px + 5, py - 5);
      ctx.lineTo(px - 5, py + 5);
      ctx.stroke();
    });

    /* ---------- sheet dimension text ---------- */
    ctx.fillStyle = theme.textDim;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`${sheet.sheet.width} × ${sheet.sheet.height} mm`, sx0 + sheetPxW + 8, sy0 + sheetPxH / 2);

    /* ---------- rulers (top + left, adaptive ticks) ---------- */
    if (layers.rulers) {
      const stepsMm = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
      const stepMm = stepsMm.find((s) => s * S >= 55) ?? 2000;

      ctx.fillStyle = theme.rulerBg;
      ctx.fillRect(0, 0, w, RULER_SIZE);
      ctx.fillRect(0, 0, RULER_SIZE, h);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, RULER_SIZE + 0.5);
      ctx.lineTo(w, RULER_SIZE + 0.5);
      ctx.moveTo(RULER_SIZE + 0.5, RULER_SIZE);
      ctx.lineTo(RULER_SIZE + 0.5, h);
      ctx.stroke();

      ctx.fillStyle = theme.rulerText;
      ctx.strokeStyle = theme.rulerTick;
      ctx.font = "9px system-ui, sans-serif";
      ctx.beginPath();
      for (let gx = 0; gx <= sheet.sheet.width + 0.1; gx += stepMm) {
        const px = sx0 + gx * S;
        if (px < RULER_SIZE || px > w) continue;
        ctx.moveTo(px, RULER_SIZE - 5);
        ctx.lineTo(px, RULER_SIZE);
        ctx.fillText(String(Math.round(gx)), px + 2, 10);
      }
      for (let gy = 0; gy <= sheet.sheet.height + 0.1; gy += stepMm) {
        const py = sy0 + gy * S;
        if (py < RULER_SIZE || py > h) continue;
        ctx.moveTo(RULER_SIZE - 5, py);
        ctx.lineTo(RULER_SIZE, py);
        ctx.save();
        ctx.translate(10, py - 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(Math.round(gy)), 0, 0);
        ctx.restore();
      }
      ctx.stroke();
    }

    /* ---------- minimap (RADAR, bottom-right) ---------- */
    const mmW = sheet.sheet.width;
    const mmH = sheet.sheet.height;
    const ms = Math.min((MINIMAP_SIZE - 8) / mmW, (MINIMAP_SIZE - 8) / mmH);
    const mmX = w - mmW * ms - 12;
    const mmY = h - mmH * ms - 12;
    ctx.fillStyle = theme.minimapBg;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(mmX, mmY, mmW * ms, mmH * ms);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmW * ms, mmH * ms);

    const miniCuts = sheet.cuts.slice(0, MAX_MINIMAP_LINES);
    ctx.strokeStyle = theme.cutColor;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const cut of miniCuts) {
      const pts = cutPolyline(cut);
      pts.forEach((p, j) => {
        const vx = mmX + p.x * ms;
        const vy = mmY + p.y * ms;
        if (j === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      });
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // viewport rect
    const vx0 = (RULER_SIZE - view.tx) / S;
    const vy0 = (RULER_SIZE - view.ty) / S;
    const vw = (w - RULER_SIZE - view.tx) / S - vx0;
    const vh = (h - RULER_SIZE - view.ty) / S - vy0;
    const rvx = mmX + Math.max(0, vx0) * ms;
    const rvy = mmY + Math.max(0, vy0) * ms;
    const rvw = Math.min(mmW - Math.max(0, vx0), Math.max(0, vw)) * ms;
    const rvh = Math.min(mmH - Math.max(0, vy0), Math.max(0, vh)) * ms;
    ctx.fillStyle = theme.viewportRect;
    ctx.globalAlpha = 0.1;
    ctx.fillRect(rvx, rvy, rvw, rvh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.viewportRect;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rvx, rvy, rvw, rvh);
  }, [sheet, layers, theme, selectedCutIndex, selectedPaneId, seqSpeed]);

  const fit = useCallback(() => {
    const view = viewRef.current;
    const { w, h } = sizeRef.current;
    const availW = w - RULER_SIZE - 48;
    const availH = h - RULER_SIZE - 48;
    if (availW <= 0 || availH <= 0 || !sheet.sheet.width) return;
    view.baseScale = Math.min(availW / sheet.sheet.width, availH / sheet.sheet.height);
    view.zoom = 1;
    view.scale = view.baseScale;
    view.tx = RULER_SIZE + (availW - sheet.sheet.width * view.scale) / 2 + 8;
    view.ty = RULER_SIZE + (availH - sheet.sheet.height * view.scale) / 2 + 8;
    draw();
  }, [sheet, draw]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    const view = viewRef.current;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * factor));
    const newScale = view.baseScale * newZoom;
    view.tx = cx - ((cx - view.tx) * newScale) / view.scale;
    view.ty = cy - ((cy - view.ty) * newScale) / view.scale;
    view.zoom = newZoom;
    view.scale = newScale;
    draw();
    setStatus(`zoom ${(newZoom * 100).toFixed(0)}%`);
  }, [draw, setStatus]);

  /* ---------- resize handling ---------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      sizeRef.current = { w: container.clientWidth, h: container.clientHeight };
      draw();
    });
    ro.observe(container);
    sizeRef.current = { w: container.clientWidth, h: container.clientHeight };
    return () => ro.disconnect();
  }, [draw]);

  /* ---------- fit on new sheet / request ---------- */
  useEffect(() => {
    fit();
  }, [fit, fitRequest, sheet]);

  /* ---------- focus target (zoom to issue) ---------- */
  useEffect(() => {
    if (!focusTarget) return;
    const view = viewRef.current;
    const { w, h } = sizeRef.current;
    const availW = w - RULER_SIZE - 60;
    const availH = h - RULER_SIZE - 60;
    view.scale = Math.min(availW / Math.max(focusTarget.width, 1), availH / Math.max(focusTarget.height, 1), view.baseScale * 4);
    view.zoom = Math.min(ZOOM_MAX, view.scale / view.baseScale);
    view.tx = RULER_SIZE + (availW - focusTarget.width * view.scale) / 2 + 8 - focusTarget.x * view.scale;
    view.ty = RULER_SIZE + (availH - focusTarget.height * view.scale) / 2 + 8 - focusTarget.y * view.scale;
    draw();
  }, [focusTarget, draw]);

  /* ---------- redraw on state changes ---------- */
  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => seqClock.subscribe(() => draw()), [draw]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") fit();
      else if (e.key === "+" || e.key === "=") zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, 1.25);
      else if (e.key === "-") zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, 0.8);
      else if (e.key === "Escape") { selectCut(null); selectPane(null); measurePts.current = []; draw(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoomAt, selectCut, selectPane]);

  /* ---------- helpers + mouse handlers ---------- */
  const s2w = useCallback((px: number, py: number): Point => {
    const view = viewRef.current;
    return { x: (px - view.tx) / view.scale, y: (py - view.ty) / view.scale };
  }, []);

  const cutPolyline = useCallback((cut: Cut): Point[] => {
    if (cut.type === "arc" && cut.center && cut.radius) {
      return sampleArc(
        { start: cut.points[0], end: cut.points[1] ?? cut.points[0], radius: cut.radius, side: cut.ccw ? -1 : 1 },
        20
      );
    }
    return cut.points;
  }, []);

  const hitTest = useCallback((wx: number, wy: number): { type: "cut" | "pane"; index: number } | null => {
    const view = viewRef.current;
    let best: { type: "cut" | "pane"; index: number; dist: number } | null = null;
    sheet.cuts.forEach((cut, i) => {
      const pts = cutPolyline(cut);
      for (let j = 0; j < pts.length - 1; j++) {
        const a = pts[j];
        const b = pts[j + 1];
        const d = distToSegment(wx, wy, a.x, a.y, b.x, b.y) * view.scale;
        if (d < 10 && (!best || d < best.dist)) best = { type: "cut", index: i, dist: d };
      }
    });
    if (best) return best;
    for (let i = sheet.panes.length - 1; i >= 0; i--) {
      const p = sheet.panes[i];
      const b = p.bounds;
      const inside = p.polygon?.length
        ? pointInPolygon({ x: wx, y: wy }, p.polygon)
        : wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.height;
      if (inside) return { type: "pane", index: i };
    }
    return null;
  }, [sheet, cutPolyline]);

  const minimapRect = useCallback(() => {
    const mmW = sheet.sheet.width;
    const mmH = sheet.sheet.height;
    const ms = Math.min((MINIMAP_SIZE - 8) / mmW, (MINIMAP_SIZE - 8) / mmH);
    return { ms, mmX: sizeRef.current.w - mmW * ms - 12, mmY: sizeRef.current.h - mmH * ms - 12, mmW: mmW * ms, mmH: mmH * ms };
  }, [sheet]);

  const inMinimap = useCallback((px: number, py: number) => {
    const r = minimapRect();
    return px >= r.mmX && px <= r.mmX + r.mmW && py >= r.mmY && py <= r.mmY + r.mmH;
  }, [minimapRect]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panState.current = { panning: true, lastX: e.clientX, lastY: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (panState.current.panning) {
      const view = viewRef.current;
      const dx = e.clientX - panState.current.lastX;
      const dy = e.clientY - panState.current.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) panState.current.moved = true;
      view.tx += dx;
      view.ty += dy;
      panState.current.lastX = e.clientX;
      panState.current.lastY = e.clientY;
      draw();
      return;
    }

    const wpt = s2w(px, py);
    setStatus(`${wpt.x.toFixed(1)}, ${wpt.y.toFixed(1)} mm · zoom ${(viewRef.current.zoom * 100).toFixed(0)}% · ${sheet.panes.length} panes · ${sheet.cuts.length} cuts`);
    if (inMinimap(px, py)) return;
    const hit = hitTest(wpt.x, wpt.y);
    const newHover = hit ? { type: hit.type, index: hit.index } : null;
    const changed = hoverRef.current?.type !== newHover?.type || hoverRef.current?.index !== newHover?.index;
    hoverRef.current = newHover;
    if (changed) draw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasPanning = panState.current.panning;
    const moved = panState.current.moved;
    panState.current.panning = false;
    if (!wasPanning || moved) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // minimap click → jump viewport
    if (inMinimap(px, py)) {
      const r = minimapRect();
      const wx = (px - r.mmX) / r.ms;
      const wy = (py - r.mmY) / r.ms;
      const view = viewRef.current;
      view.tx = sizeRef.current.w / 2 - wx * view.scale;
      view.ty = sizeRef.current.h / 2 - wy * view.scale;
      draw();
      return;
    }

    const wpt = s2w(px, py);

    // measure mode: collect up to 2 points, then restart on next click
    if (measureMode) {
      if (measurePts.current.length >= 2) measurePts.current = [];
      measurePts.current.push(wpt);
      if (measurePts.current.length === 2) {
        const [a, b] = measurePts.current as [Point, Point];
        setStatus(`distance: ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)} mm (Δx ${Math.abs(b.x - a.x).toFixed(2)}, Δy ${Math.abs(b.y - a.y).toFixed(2)}) — Esc to clear`);
      } else {
        setStatus("measure: click second point…");
      }
      draw();
      return;
    }

    const hit = hitTest(wpt.x, wpt.y);
    if (hit?.type === "cut") selectCut(hit.index);
    else if (hit?.type === "pane") selectPane(sheet.panes[hit.index].id);
    else { selectCut(null); selectPane(null); }
  };

  const onDoubleClick = () => fit();

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none select-none"
        style={{ width: "100%", height: "100%", cursor: "grab" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
