import { CutCanvas, exportCanvasPng } from "./CutCanvas";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";
import { openFileDialog, openFileFromBrowser, readCutcodeFile } from "./fileIO";
import { useAppStore } from "./store";

async function loadPath(path: string, setFromParse: ReturnType<typeof useAppStore.getState>["setFromParse"]) {
  const result = await readCutcodeFile(path);
  setFromParse(path, result);
}

const TOOL_BTN =
  "px-2 py-1.5 rounded-md text-xs border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm";
const TOOL_BTN_ACTIVE = "px-2 py-1.5 rounded-md text-xs border border-blue-200 bg-blue-50 text-blue-800 shadow-sm";

export default function App() {
  const plan = useAppStore((s) => s.plan);
  const parseResult = useAppStore((s) => s.parseResult);
  const filePath = useAppStore((s) => s.filePath);
  const showLabels = useAppStore((s) => s.showLabels);
  const showGrid = useAppStore((s) => s.showGrid);
  const showCutSequence = useAppStore((s) => s.showCutSequence);
  const cutSequenceLimit = useAppStore((s) => s.cutSequenceLimit);
  const toggleLabels = useAppStore((s) => s.toggleLabels);
  const toggleGrid = useAppStore((s) => s.toggleGrid);
  const toggleCutSequence = useAppStore((s) => s.toggleCutSequence);
  const setCutSequenceLimit = useAppStore((s) => s.setCutSequenceLimit);
  const requestFit = useAppStore((s) => s.requestFit);
  const setFromParse = useAppStore((s) => s.setFromParse);

  async function handleOpen() {
    const opened = await openFileDialog();
    if (opened) setFromParse(opened.path, opened.result);
  }

  async function handleBrowserFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await openFileFromBrowser(file);
    setFromParse(file.name, result);
  }

  function handleExportPng() {
    if (!plan) return;
    const off = document.createElement("canvas");
    const dataUrl = exportCanvasPng(plan, off);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = (filePath ?? "cutplan").replace(/\.[^.]+$/, "") + ".png";
    a.click();
  }

  const maxSeq = plan?.cuts.reduce((m, c, i) => Math.max(m, c.sequenceIndex ?? i), 0) ?? 0;
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      <aside className="w-52 shrink-0">
        <Sidebar onOpenPath={(p) => loadPath(p, setFromParse).catch(() => alert("Open samples in Tauri app or use file picker in browser dev"))} />
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 bg-white shrink-0 flex-wrap shadow-sm">
          {isTauri ? (
            <button
              type="button"
              onClick={handleOpen}
              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm"
            >
              Open file…
            </button>
          ) : (
            <label className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer shadow-sm">
              Open file…
              <input type="file" className="hidden" accept=".otd,.dat,.opt,.r01,.imp,.edi,.otv,.cut,.xml,.json" onChange={handleBrowserFile} />
            </label>
          )}
          <button type="button" onClick={requestFit} className={TOOL_BTN}>
            Fit sheet
          </button>
          <button type="button" onClick={toggleGrid} className={showGrid ? TOOL_BTN_ACTIVE : TOOL_BTN}>
            Grid
          </button>
          <button type="button" onClick={toggleLabels} className={showLabels ? TOOL_BTN_ACTIVE : TOOL_BTN}>
            Labels
          </button>
          <button type="button" onClick={toggleCutSequence} className={showCutSequence ? TOOL_BTN_ACTIVE : TOOL_BTN}>
            Sequence
          </button>
          {plan && (
            <button type="button" onClick={handleExportPng} className={TOOL_BTN}>
              Export PNG
            </button>
          )}
          {plan && maxSeq > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-500 ml-1">
              Step
              <input
                type="range"
                min={0}
                max={maxSeq}
                value={cutSequenceLimit ?? maxSeq}
                onChange={(e) => setCutSequenceLimit(parseInt(e.target.value, 10))}
                className="w-24 accent-blue-600"
              />
              <span className="text-slate-700">{cutSequenceLimit ?? maxSeq}/{maxSeq}</span>
            </label>
          )}
          {parseResult && (
            <span
              className={`text-xs ml-1 font-medium ${
                parseResult.status === "ok"
                  ? "text-emerald-700"
                  : parseResult.status === "partial"
                    ? "text-amber-700"
                    : "text-red-700"
              }`}
            >
              {parseResult.detected.vendor} · {parseResult.detected.formatId} · {parseResult.status}
            </span>
          )}
        </header>

        <main className="flex-1 min-h-0 relative bg-slate-100">
          {plan ? (
            <CutCanvas plan={plan} />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              Open a cutcode file or pick a sample from the sidebar
            </div>
          )}
        </main>
      </div>

      <aside className="w-72 shrink-0 border-l border-slate-200 bg-white">
        <Inspector />
      </aside>
    </div>
  );
}
