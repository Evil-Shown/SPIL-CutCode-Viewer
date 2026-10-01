import { useMemo, useState } from "react";
import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import {
  buildSchedule,
  buildTimeline,
  documentToDxf,
  panesToCsv,
  scheduleToCsv,
  stagesToCsv,
} from "@spil/cutcode-core";
import type { ParseResult } from "@spil/cutcode-core";
import { CutCanvas } from "./CutCanvas";
import { Inspector } from "./Inspector";
import { Landing } from "./Landing";
import { MachineSpecs } from "./MachineSpecs";
import { PlaybackDriver } from "./PlaybackDriver";
import { Sidebar } from "./Sidebar";
import { SimConsole } from "./SimConsole";
import { ErrorBoundary } from "./ErrorBoundary";
import { prefetchStage3D } from "./graphicsProfile";
import { machineAccepts, machineById, kinematicsFor } from "./machines";
import { seqClock } from "./seqClock";
import { useAppStore, type LayerToggles } from "./store";
import { isTauri, openFileDialog, openFileFromBrowser, saveDialog, writeBinaryFile } from "./fileIO";
import {
  renderPng,
  renderSvg,
  dataUrlToBytes,
  downloadBytes,
  triggerPrint,
  textToBytes,
} from "./exporters";

const CutStage3D = lazy(() => import("./CutStage3D").then((m) => ({ default: m.CutStage3D })));

const TOOL_BTN =
  "rounded-[10px] border border-[#d8cdb8] bg-[#f5eedc] px-2.5 py-1.5 text-xs font-semibold text-[#0b2545] hover:border-[#0b2545]";
const TOOL_BTN_ACTIVE =
  "rounded-[10px] border border-[#d75c2a] bg-[#d75c2a] px-2.5 py-1.5 text-xs font-semibold text-white";

type Toast = { kind: "error" | "info"; message: string };

/** Write text to a user-chosen file, falling back to a browser download. */
async function saveText(text: string, filename: string, mime: string, onDone: (msg: string) => void) {
  const bytes = textToBytes(text);
  const savedPath = await saveDialog(filename);
  if (savedPath) {
    await writeBinaryFile(savedPath, bytes);
    onDone(`Saved ${savedPath}`);
  } else {
    downloadBytes(bytes, filename, mime);
    onDone(`Downloaded ${filename}`);
  }
}

export default function App() {
  const doc = useAppStore((s) => s.document);
  const parseResult = useAppStore((s) => s.parseResult);
  const filePath = useAppStore((s) => s.filePath);
  const loadError = useAppStore((s) => s.loadError);
  const activeSheetIndex = useAppStore((s) => s.activeSheetIndex);
  const layers = useAppStore((s) => s.layers);
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
  const requestFit = useAppStore((s) => s.requestFit);
  const setMachine = useAppStore((s) => s.setMachine);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const machine = machineById(machineId);

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((kind: Toast["kind"], message: string) => {
    setToast({ kind, message });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  // Apply persisted theme class on mount
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    prefetchStage3D();
  }, []);

  // Close the export dropdown on outside click or Escape.
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exportWrapRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
      || (t instanceof HTMLElement && t.isContentEditable);

    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const st = useAppStore.getState();
      if (!st.machineId) return;
      if (e.code === "Space") {
        e.preventDefault();
        st.setSeqPlaying(!st.seqPlaying);
        return;
      }
      if (e.key === "[" || e.key === "ArrowLeft") {
        e.preventDefault();
        seqClock.stepCut(-1);
        return;
      }
      if (e.key === "]" || e.key === "ArrowRight") {
        e.preventDefault();
        seqClock.stepCut(1);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        st.setSeqPlaying(false);
        seqClock.seek(0);
        return;
      }
      if (e.key === "1") st.setSeqSpeed(1);
      else if (e.key === "2") st.setSeqSpeed(2);
      else if (e.key === "3") st.setSeqSpeed(4);
      else if (e.key === "4") st.setSeqSpeed(8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  const schedule = useMemo(() => (doc ? buildSchedule(doc) : null), [doc]);
  const cycle = useMemo(
    () => (sheet ? buildTimeline(sheet, kinematicsFor(machine)) : null),
    [sheet, machine]
  );

  const accept = machine?.extensions.length
    ? machine.extensions.map((ext) => `.${ext}`).join(",")
    : ".otd,.dat,.opt,.r01,.imp,.edi,.otv,.dxf,.xml,.cut,.cni,.json,.xyz,.pgm,.lst,.dst,.prjx,.sum,.src,.iso";

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
      showToast("info", `Downloaded ${baseName}.png`);
    }
  };

  const handleExportSvg = async () => {
    if (!sheet) return;
    await saveText(renderSvg(sheet), `${baseName}.svg`, "image/svg+xml", showToast.bind(null, "info"));
  };

  const handleExportDxf = async () => {
    if (!doc) return;
    const dxf = documentToDxf(doc);
    await saveText(dxf, `${baseName}.dxf`, "image/vnd.dxf", (m) => showToast("info", m));
  };

  const handleExportSchedule = async () => {
    if (!doc || !schedule) return;
    await saveText(scheduleToCsv(schedule), `${baseName}-cuts.csv`, "text/csv", (m) => showToast("info", m));
  };

  const handleExportPanes = async () => {
    if (!doc) return;
    await saveText(panesToCsv(doc), `${baseName}-panes.csv`, "text/csv", (m) => showToast("info", m));
  };

  const handleExportStages = async () => {
    if (!schedule) return;
    await saveText(stagesToCsv(schedule), `${baseName}-stages.csv`, "text/csv", (m) => showToast("info", m));
  };

  const handleExportJson = async () => {
    if (!doc) return;
    const payload = {
      metadata: doc.metadata,
      schedule: schedule
        ? {
            totals: schedule.totals,
            stages: schedule.stages,
            cuts: schedule.rows,
          }
        : undefined,
      sheets: doc.sheets,
    };
    await saveText(JSON.stringify(payload, null, 2), `${baseName}.json`, "application/json", (m) => showToast("info", m));
  };

  const handlePrint = () => {
    if (!sheet) return;
    triggerPrint(sheet, baseName, {
      vendor: doc?.metadata.vendor,
      format: parseResult?.detected.formatId,
      cycleTimeS: cycle?.totalS,
      scoreMetres: cycle ? cycle.cuttingLengthMm / 1000 : undefined,
    });
  };

  const layerBtn = (key: keyof LayerToggles, label: string) => (
    <button type="button" onClick={() => toggleLayer(key)} className={layers[key] ? TOOL_BTN_ACTIVE : TOOL_BTN}>
      {label}
    </button>
  );

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-[#f4f0e8] text-[#0b2545]"
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
            <button type="button" onClick={handleExportPng} className={TOOL_BTN} title="Raster image of the cut plan (stages coloured)">
              PNG
            </button>
            <button type="button" onClick={handleExportSvg} className={TOOL_BTN} title="Vector image of the cut plan">
              SVG
            </button>
            <button type="button" onClick={handlePrint} className={TOOL_BTN} title="Printable sheet report with pane list">
              Print
            </button>
            <div className="export-wrap" ref={exportWrapRef}>
            <button type="button" onClick={() => setExportOpen((v) => !v)} className={exportOpen ? TOOL_BTN_ACTIVE : TOOL_BTN} title="Export data for downstream tools">
              Export ▾
            </button>
            {exportOpen && (
              <div className="export-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); handleExportDxf(); }}>
                  DXF <span>R12 · CAD / CAM / nesting</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); handleExportSchedule(); }}>
                  Cut schedule CSV <span>one row per cut, in order</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); handleExportPanes(); }}>
                  Pane list CSV <span>id, size, position, area</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); handleExportStages(); }}>
                  Stage breakdown CSV <span>cuts and metres per stage</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); handleExportJson(); }}>
                  JSON <span>full document + schedule</span>
                </button>
              </div>
            )}
          </div>
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
            <small>{machine.origin} · {machine.kind}</small>
          </div>
          <MachineSpecs machine={machine} />
          <Sidebar machine={machine} onOpenResult={openResult} />
        </aside>

        <main className="workbench-canvas">
          <ErrorBoundary>
            {viewMode === "3d" ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading 3D…</div>}>
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
              </Suspense>
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

      <SimConsole />

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
