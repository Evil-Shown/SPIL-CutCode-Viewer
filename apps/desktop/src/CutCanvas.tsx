import { useEffect, useRef } from "react";
import type { CutPlan } from "@spil/cutcode-core";
import { useAppStore } from "./store";

type Props = {
  plan: CutPlan;
};

const PANE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0d9488"];

const THEME = {
  canvasBg: "#f1f5f9",
  sheetFill: "#ffffff",
  sheetStroke: "#64748b",
  grid: "#e2e8f0",
  dimLabel: "#64748b",
  paneLabel: "#334155",
  cut: "#ea580c",
  cutSelected: "#ca8a04",
  cutDimmed: "#cbd5e1",
  seqLabel: "#b45309",
};

export function CutCanvas({ plan }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showGrid = useAppStore((s) => s.showGrid);
  const showLabels = useAppStore((s) => s.showLabels);
  const showCutSequence = useAppStore((s) => s.showCutSequence);
  const cutSequenceLimit = useAppStore((s) => s.cutSequenceLimit);
  const selectedCutIndex = useAppStore((s) => s.selectedCutIndex);
  const fitRequest = useAppStore((s) => s.fitRequest);
  const setSelectedCut = useAppStore((s) => s.setSelectedCut);

  const transformRef = useRef({ scale: 1, offsetX: 40, offsetY: 40 });
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  function fitToSheet() {
    transformRef.current.scale = 1;
    transformRef.current.offsetX = 48;
    transformRef.current.offsetY = 48;
    draw();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const resize = () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      fitToSheet();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [plan]);

  useEffect(() => {
    if (fitRequest) fitToSheet();
    else draw();
  }, [showGrid, showLabels, showCutSequence, cutSequenceLimit, selectedCutIndex, fitRequest]);

  function worldToScreen(x: number, y: number, w: number, h: number) {
    const canvas = canvasRef.current!;
    const pad = 48;
    const sx = (canvas.width - pad * 2) / w;
    const sy = (canvas.height - pad * 2) / h;
    const baseScale = Math.min(sx, sy);
    const scale = baseScale * transformRef.current.scale;
    const ox = transformRef.current.offsetX;
    const oy = transformRef.current.offsetY;
    return { x: ox + x * scale, y: oy + y * scale, scale };
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = plan.sheet;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = THEME.canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const origin = worldToScreen(0, 0, width, height);
    const corner = worldToScreen(width, height, width, height);
    const sheetW = corner.x - origin.x;
    const sheetH = corner.y - origin.y;

    ctx.fillStyle = THEME.sheetFill;
    ctx.strokeStyle = THEME.sheetStroke;
    ctx.lineWidth = 2;
    ctx.fillRect(origin.x, origin.y, sheetW, sheetH);
    ctx.strokeRect(origin.x, origin.y, sheetW, sheetH);

    ctx.fillStyle = THEME.dimLabel;
    ctx.font = "11px system-ui";
    ctx.fillText(`${width} mm`, origin.x + sheetW / 2 - 20, origin.y - 8);
    ctx.fillText(`${height} mm`, origin.x - 36, origin.y + sheetH / 2);

    if (showGrid) {
      ctx.strokeStyle = THEME.grid;
      ctx.lineWidth = 1;
      const step = 100 * origin.scale;
      for (let x = origin.x; x <= origin.x + sheetW; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, origin.y);
        ctx.lineTo(x, origin.y + sheetH);
        ctx.stroke();
      }
      for (let y = origin.y; y <= origin.y + sheetH; y += step) {
        ctx.beginPath();
        ctx.moveTo(origin.x, y);
        ctx.lineTo(origin.x + sheetW, y);
        ctx.stroke();
      }
    }

    plan.panes.forEach((pane, i) => {
      const p0 = worldToScreen(pane.bounds.x, pane.bounds.y, width, height);
      const p1 = worldToScreen(
        pane.bounds.x + pane.bounds.width,
        pane.bounds.y + pane.bounds.height,
        width,
        height
      );
      ctx.fillStyle = PANE_COLORS[i % PANE_COLORS.length] + "33";
      ctx.strokeStyle = PANE_COLORS[i % PANE_COLORS.length];
      ctx.lineWidth = 1.5;
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      if (showLabels) {
        ctx.fillStyle = THEME.paneLabel;
        ctx.font = "11px system-ui";
        ctx.fillText(pane.id, p0.x + 4, p0.y + 14);
      }
    });

    plan.cuts.forEach((cut, idx) => {
      if (cut.points.length < 2) return;
      const seq = cut.sequenceIndex ?? idx;
      const dimmed = cutSequenceLimit !== null && seq > cutSequenceLimit;

      const selected = idx === selectedCutIndex;
      ctx.strokeStyle = dimmed ? THEME.cutDimmed : selected ? THEME.cutSelected : THEME.cut;
      ctx.lineWidth = selected ? 3 : dimmed ? 1 : 1.5;
      ctx.beginPath();
      const start = worldToScreen(cut.points[0].x, cut.points[0].y, width, height);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < cut.points.length; i++) {
        const p = worldToScreen(cut.points[i].x, cut.points[i].y, width, height);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      if (showCutSequence && !dimmed && cut.points.length >= 2) {
        const mid = worldToScreen(
          (cut.points[0].x + cut.points[1].x) / 2,
          (cut.points[0].y + cut.points[1].y) / 2,
          width,
          height
        );
        ctx.fillStyle = THEME.seqLabel;
        ctx.font = "10px system-ui";
        ctx.fillText(String(seq), mid.x + 2, mid.y - 2);
      }
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    transformRef.current.scale = Math.max(0.2, Math.min(8, transformRef.current.scale * factor));
    draw();
  }

  function onMouseDown(e: React.MouseEvent) {
    draggingRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!draggingRef.current) return;
    transformRef.current.offsetX += e.clientX - lastPosRef.current.x;
    transformRef.current.offsetY += e.clientY - lastPosRef.current.y;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    draw();
  }

  function onMouseUp() {
    draggingRef.current = false;
  }

  function onClick(e: React.MouseEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { width, height } = plan.sheet;
    let best = -1;
    let bestDist = 12;
    plan.cuts.forEach((cut, idx) => {
      if (cut.points.length < 2) return;
      const a = worldToScreen(cut.points[0].x, cut.points[0].y, width, height);
      const b = worldToScreen(cut.points[1].x, cut.points[1].y, width, height);
      const d = distToSegment(mx, my, a.x, a.y, b.x, b.y);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    });
    setSelectedCut(best >= 0 ? best : null);
    draw();
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onClick={onClick}
    />
  );
}

export function exportCanvasPng(plan: CutPlan, canvas: HTMLCanvasElement): string {
  const off = document.createElement("canvas");
  const pad = 48;
  const scale = 2;
  off.width = plan.sheet.width * scale + pad * 2;
  off.height = plan.sheet.height * scale + pad * 2;
  const ctx = off.getContext("2d")!;
  ctx.fillStyle = THEME.canvasBg;
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.fillStyle = THEME.sheetFill;
  ctx.strokeStyle = THEME.sheetStroke;
  ctx.fillRect(pad, pad, plan.sheet.width * scale, plan.sheet.height * scale);
  ctx.strokeRect(pad, pad, plan.sheet.width * scale, plan.sheet.height * scale);

  plan.panes.forEach((pane, i) => {
    const color = PANE_COLORS[i % PANE_COLORS.length];
    ctx.fillStyle = color + "33";
    ctx.strokeStyle = color;
    ctx.fillRect(
      pad + pane.bounds.x * scale,
      pad + pane.bounds.y * scale,
      pane.bounds.width * scale,
      pane.bounds.height * scale
    );
    ctx.strokeRect(
      pad + pane.bounds.x * scale,
      pad + pane.bounds.y * scale,
      pane.bounds.width * scale,
      pane.bounds.height * scale
    );
  });

  plan.cuts.forEach((cut) => {
    if (cut.points.length < 2) return;
    ctx.strokeStyle = THEME.cut;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad + cut.points[0].x * scale, pad + cut.points[0].y * scale);
    for (let i = 1; i < cut.points.length; i++) {
      ctx.lineTo(pad + cut.points[i].x * scale, pad + cut.points[i].y * scale);
    }
    ctx.stroke();
  });

  return off.toDataURL("image/png");
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
