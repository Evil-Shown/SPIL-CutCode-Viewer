export type ThemeName = "light" | "dark";

export interface Theme {
  bg: string;
  panel: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  sheetFill: string;
  sheetStroke: string;
  gridMinor: string;
  gridMajor: string;
  rulerBg: string;
  rulerText: string;
  rulerTick: string;
  cutColor: string;
  cutDim: string;
  cutSelected: string;
  cutHover: string;
  paneStrokes: string[];
  paneFillAlpha: number;
  rotatedPane: string;
  laserColor: string;
  viewportRect: string;
  minimapBg: string;
  errorSev: string;
  warnSev: string;
  okSev: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  light: {
    bg: "#f1f5f9",
    panel: "#ffffff",
    border: "#e2e8f0",
    text: "#1e293b",
    textDim: "#64748b",
    accent: "#2563eb",
    sheetFill: "#f8fafc",
    sheetStroke: "#334155",
    gridMinor: "#e2e8f0",
    gridMajor: "#cbd5e1",
    rulerBg: "#ffffff",
    rulerText: "#64748b",
    rulerTick: "#94a3b8",
    cutColor: "#ea580c",
    cutDim: "#cbd5e1",
    cutSelected: "#f59e0b",
    cutHover: "#f97316",
    paneStrokes: ["#2563eb", "#7c3aed", "#0891b2", "#059669", "#d97706", "#db2777", "#4f46e5", "#65a30d"],
    paneFillAlpha: 0.12,
    rotatedPane: "#0d9488",
    laserColor: "#dc2626",
    viewportRect: "#2563eb",
    minimapBg: "#ffffff",
    errorSev: "#dc2626",
    warnSev: "#d97706",
    okSev: "#059669",
  },
  dark: {
    bg: "#0f172a",
    panel: "#1e293b",
    border: "#334155",
    text: "#e2e8f0",
    textDim: "#94a3b8",
    accent: "#3b82f6",
    sheetFill: "#162032",
    sheetStroke: "#94a3b8",
    gridMinor: "#1e293b",
    gridMajor: "#334155",
    rulerBg: "#162032",
    rulerText: "#94a3b8",
    rulerTick: "#475569",
    cutColor: "#fb923c",
    cutDim: "#334155",
    cutSelected: "#fbbf24",
    cutHover: "#fdba74",
    paneStrokes: ["#60a5fa", "#a78bfa", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#818cf8", "#a3e635"],
    paneFillAlpha: 0.15,
    rotatedPane: "#2dd4bf",
    laserColor: "#f87171",
    viewportRect: "#60a5fa",
    minimapBg: "#162032",
    errorSev: "#f87171",
    warnSev: "#fbbf24",
    okSev: "#34d399",
  },
};

/** Stage colors (1-10) used when stage overlay is on. */
export const STAGE_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#6366f1",
];
