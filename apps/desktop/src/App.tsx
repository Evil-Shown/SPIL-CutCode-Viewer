import { useCallback, useEffect, useRef, useState } from "react";
import type { ParseResult } from "@spil/cutcode-core";
import { CutCanvas } from "./CutCanvas";
import { CutStage3D } from "./CutStage3D";
import { Inspector } from "./Inspector";
import { Landing } from "./Landing";
import { PlaybackDriver } from "./PlaybackDriver";
import { Sidebar } from "./Sidebar";
import { ErrorBoundary } from "./ErrorBoundary";
import { machineAccepts, machineById } from "./machines";
import { useAppStore, type LayerToggles } from "./store";
import { isTauri, openFileDialog, openFileFromBrowser, saveDialog, writeBinaryFile } from "./fileIO";
import { renderPng, renderSvg, dataUrlToBytes, downloadBytes, triggerPrint } from "./exporters";

const TOOL_BTN =
  "rounded-md border px-2 py-1.5 text-xs shadow-sm border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
const TOOL_BTN_ACTIVE =
  "rounded-md border px-2 py-1.5 text-xs shadow-sm border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/50 dark:text-blue-200";

type Toast = { kind: "error" | "info"; message: string };

export default function App() {
  const doc = useAppStore((s) => s.document);
  const parseResult = useAppStore((s) => s.parseResult);
  const filePath = useAppStore((s) => s.filePath);
  const loadError = useAppStore((s) => s.loadError);
  const activeSheetIndex = useAppStore((s) => s.activeSheetIndex);
  const layers = useAppStore((s) => s.layers);
  const theme = useAppStore((s) => s.theme);
  const statusMessage = useAppStore((s) => s.statusMessage);
  const seqPlaying = useAppStore((s) => s.seqPlaying);
  const seqSpeed = useAppStore((s) => s.seqSpeed);
  const measureMode = useAppStore((s) => s.measureMode);
  const machineId = useAppStore((s) => s.machineId);
  const viewMode = useAppStore((s) => s.viewMode);
  const setSeqPlaying = useAppStore((s) => s.setSeqPlaying);
  const cycleSeqSpeed = useAppStore((s) => s.cycleSeqSpeed);
  const toggleMeasure = useAppStore((s) => s.toggleMeasure);
  const setFromParse = useAppStore((s) => s.setFromParse);
  const setLoadError = useAppStore((s) => s.setLoadError);
  const setActiveSheet = useAppStore((s) => s.setActiveSheet);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const setTheme = useAppStore((s) => s.setTheme);
  const requestFit = useAppStore((s) => s.requestFit);
  const setMachine = useAppStore((s) => s.setMachine);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const machine = machineById(machineId);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((kind: Toast["kind"], message: string) => {
    setToast({ kind, message });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  // Apply persisted theme class on mount
  useEffect(() => {
    document.documentElement.classList.toggle("dark", useAppStore.getState().theme === "dark");
  }, []);

  const openResult = useCallback(
    async (path: string, resultPromise: Promise<ParseResult>) => {
      try {
        const result = await resultPromise;
        const selected = machineById(useAppStore.getState().machineId);
        if (selected?.importReady && result.detected.formatId !== "unknown" && !machineAccepts(selected, result.detected.formatId)) {
          const accepted = selected.extensions.map((ext) => `.${ext.toUpperCase()}`).join(", ");
          const message = `This file is ${result.detected.vendor} (${result.detected.formatId}). ${selected.brand} ${selected.model} accepts ${accepted}.`;
          setLoadError(message);
          showToast("error", message);
          return;
        }
        setFromParse(path, result);
        if (result.status === "failed") {
          showToast("error", result.error ?? "Parse failed");
        } else if (result.status === "partial") {
          showToast("info", `Parsed with ${result.warnings.length} warning(s)`);
        }
      } catch (e) {
        setLoadError(String((e as Error).message ?? e));
        showToast("error", String((e as Error).message ?? e));
      }
    },
    [setFromParse, setLoadError, showToast]
  );

  const handleOpen = useCallback(async () => {
    try {
      const opened = await openFileDialog();
      if (opened) await openResult(opened.path, Promise.resolve(opened.result));
    } catch (e) {
      showToast("error", `Could not open file: ${(e as Error).message}`);
    }
  }, [openResult, showToast]);

  const handleBrowserFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await openResult(file.name, openFileFromBrowser(file));
      e.target.value = "";
    },
    [openResult]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      await openResult(file.name, openFileFromBrowser(file));
    },
    [openResult]
  );

  const sheet = doc?.sheets[activeSheetIndex];
  const baseName = (filePath ?? "cutplan").replace(/\.[^.]+$/, "");
  const accept = machine?.extensions.length
    ? machine.extensions.map((ext) => `.${ext}`).join(",")
    : ".otd,.dat,.opt,.r01,.imp,.edi,.otv,.dxf,.xml,.cut,.cni,.json";

  if (!machine) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
        <Landing onSelect={(m) => setMachine(m.id)} />
      </div>
    );
  }

  const handleExportPng = async () => {
    if (!sheet) return;
    const dataUrl = renderPng(sheet, 2);
    const savedPath = await saveDialog(`${baseName}.png`);
    if (savedPath) {
      await writeBinaryFile(savedPath, dataUrlToBytes(dataUrl));
      showToast("info", `Saved ${savedPath}`);
    } else {
      downloadBytes(dataUrlToBytes(dataUrl), `${baseName}.png`, "image/png");
    }
  };

  const handleExportSvg = async () => {
    if (!sheet) return;
    const svg = renderSvg(sheet);
    const bytes = new TextEncoder().encode(svg);
    const savedPath = await saveDialog(`${baseName}.svg`);
    if (savedPath) {
      await writeBinaryFile(savedPath, bytes);
      showToast("info", `Saved ${savedPath}`);
    } else {
      downloadBytes(bytes, `${baseName}.svg`, "image/svg+xml");
    }
  };

  const layerBtn = (key: keyof LayerToggles, label: string) => (
    <button type="button" onClick={() => toggleLayer(key)} className={layers[key] ? TOOL_BTN_ACTIVE : TOOL_BTN}>
      {label}
    </button>
  );

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <PlaybackDriver />
      <header className="workbench-header">
        <button type="button" onClick={() => setMachine(null)} className="machine-back" title="Choose another machine">
          ← Machines
        </button>
        <div className="machine-identity">
          <span>{machine.brand}</span><strong>{machine.model}</strong><small>{machine.kind}</small>
        </div>

        <div className="import-wrap">
          {isTauri ? (
            <button
              type="button"
              onClick={handleOpen}
              className="import-primary"
            >
              ＋ Import cutcode
            </button>
          ) : (
            <label className="import-primary">
              ＋ Import cutcode
              <input type="file" className="hidden" accept={accept} onChange={handleBrowserFile} />
            </label>
          )
          }
          <small>{machine.extensions.length ? machine.extensions.map((e) => `.${e.toUpperCase()}`).join(" · ") : "Auto-detect supported formats"}</small>
        </div>

        <span className="toolbar-divider" />

        <div className="mode-switch">
          <button type="button" onClick={() => setViewMode("3d")} className={viewMode === "3d" ? "active" : ""}>◇ 3D simulation</button>
          <button type="button" onClick={() => setViewMode("2d")} className={viewMode === "2d" ? "active" : ""}>▦ Cut plan</button>
        </div>

        <button type="button" onClick={requestFit} className={TOOL_BTN} title="Fit sheet (F)">
          Fit
        </button>
        {layerBtn("grid", "Grid")}
        {layerBtn("rulers", "Rulers")}
        {layerBtn("labels", "Labels")}
        {layerBtn("directions", "Arrows")}
        {layerBtn("stages", "Stages")}
        {layerBtn("dimensions", "Dims")}

        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        {sheet && sheet.cuts.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setSeqPlaying(!seqPlaying)}
              className={seqPlaying ? TOOL_BTN_ACTIVE : TOOL_BTN}
              title="Play cut sequence"
            >
              {seqPlaying ? "⏸ Pause" : "▶ Play"}
            </button>
            <button type="button" onClick={cycleSeqSpeed} className={TOOL_BTN} title="Playback speed">
              {seqSpeed}×
            </button>
          </>
        )}
        <button
          type="button"
          onClick={toggleMeasure}
          className={measureMode ? TOOL_BTN_ACTIVE : TOOL_BTN}
          title="Measure distance (click two points, Esc clears)"
        >
          Measure
        </button>

        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        {sheet && (
          <>
            <button type="button" onClick={handleExportPng} className={TOOL_BTN}>
              PNG
            </button>
            <button type="button" onClick={handleExportSvg} className={TOOL_BTN}>
              SVG
            </button>
            <button type="button" onClick={() => triggerPrint(sheet, baseName)} className={TOOL_BTN}>
              Print
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {parseResult && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                parseResult.status === "ok"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : parseResult.status === "partial"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}
            >
              {parseResult.detected.vendor} · {parseResult.detected.formatId} · {parseResult.status}
            </span>
          )}
          <button
            type="button"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            className={TOOL_BTN}
            title="Toggle theme"
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
        </div>
      </header>

      {/* Sheet tabs */}
      {doc && doc.sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-100 px-2 py-1 dark:border-slate-700 dark:bg-slate-900/60">
          {doc.sheets.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${
                i === activeSheetIndex
                  ? "bg-white font-medium text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300"
                  : "text-slate-500 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-800/60"
              }`}
            >
              {s.label ?? `Sheet ${i + 1}`}
              <span className="ml-1 text-[10px] text-slate-400">
                {s.sheet.width}×{s.sheet.height}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main area */}
      <div className="workbench">
        <aside className="workbench-left">
          <div className="panel-machine">
            <span>01 · Selected system</span>
            <strong>{machine.brand} {machine.model}</strong>
            <small>{machine.bed.width} × {machine.bed.height} mm work area</small>
          </div>
          <Sidebar machine={machine} onOpenResult={openResult} />
        </aside>

        <main className="workbench-canvas">
          <ErrorBoundary>
            {viewMode === "3d" ? (
              <CutStage3D
                machine={machine}
                sheet={
                  sheet ?? {
                    id: "bed",
                    sheet: { width: machine.bed.width, height: machine.bed.height },
                    panes: [],
                    cuts: [],
                    coordinateSemantics: { origin: "top-left", xAxis: "right", units: "mm" },
                  }
                }
              />
            ) : sheet ? (
              <CutCanvas sheet={sheet} />
            ) : loadError ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950">
                  <h2 className="mb-2 text-lg font-semibold text-red-800 dark:text-red-200">Could not open file</h2>
                  <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-50">
                  <rect x="3" y="5" width="18" height="14" rx="1" />
                  <path d="M3 12h18M12 5v14" />
                </svg>
                <p className="text-sm">Import a {machine.brand} cutcode file, or switch to 3D cut</p>
                <p className="text-xs opacity-70">You can also drag &amp; drop a file anywhere</p>
              </div>
            )}
            {loadError && viewMode === "3d" && (
              <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                {loadError}
              </div>
            )}
            {!doc && viewMode === "3d" && !loadError && (
              <div className="import-empty">
                <span>01</span>
                <div>
                  <strong>Load a production file</strong>
                  <p>Place the real sheet, scores and cutting sequence on this machine.</p>
                </div>
                {isTauri ? (
                  <button type="button" onClick={handleOpen}>Choose file →</button>
                ) : (
                  <label>Choose file →<input type="file" className="hidden" accept={accept} onChange={handleBrowserFile} /></label>
                )}
              </div>
            )}
          </ErrorBoundary>
        </main>

        <aside className="workbench-right">
          <div className="panel-heading"><span>02</span><strong>Job inspector</strong></div>
          <Inspector />
        </aside>
      </div>

      {/* Status bar */}
      <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        <span className="truncate">{statusMessage ?? (filePath ?? "No file loaded")}</span>
        <span className="shrink-0">
          {doc ? `${doc.sheets.length} sheet${doc.sheets.length > 1 ? "s" : ""} · ${doc.sheets.reduce((n, s) => n + s.panes.length, 0)} panes · ${doc.sheets.reduce((n, s) => n + s.cuts.length, 0)} cuts` : ""}
        </span>
      </footer>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
            toast.kind === "error" ? "bg-red-600" : "bg-slate-800"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
