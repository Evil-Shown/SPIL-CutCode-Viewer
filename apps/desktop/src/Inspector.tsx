import { useMemo, useState } from "react";
import { analyzeYield, buildTimeline } from "@spil/cutcode-core";
import { useAppStore } from "./store";
import { validateDocument, type ValidationIssue } from "./validation";
import { kinematicsFor, machineById } from "./machines";
import { seqClock } from "./seqClock";
import { formatSimTime, useSeqClock } from "./useSeqClock";

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        {title}
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function IssuesPanel({ issues }: { issues: ValidationIssue[] }) {
  const setActiveSheet = useAppStore((s) => s.setActiveSheet);
  const focusOn = useAppStore((s) => s.focusOn);
  const selectCut = useAppStore((s) => s.selectCut);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (issues.length === 0) {
    return (
      <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        ✓ No validation issues
      </div>
    );
  }

  const group = (label: string, list: ValidationIssue[], color: string) =>
    list.length > 0 && (
      <div className="mb-2">
        <div className={`mb-1 text-xs font-semibold ${color}`}>
          {label} ({list.length})
        </div>
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {list.slice(0, 20).map((issue, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setActiveSheet(issue.sheetIndex);
                selectCut(issue.cutIndex ?? null);
                requestAnimationFrame(() => focusOn(issue.focus));
              }}
              className="block w-full rounded px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Click to zoom to this issue"
            >
              {issue.message}
            </button>
          ))}
          {list.length > 20 && <div className="px-2 text-[11px] text-slate-400">…and {list.length - 20} more</div>}
        </div>
      </div>
    );

  return (
    <div>
      {group("Errors", errors, "text-red-600 dark:text-red-400")}
      {group("Warnings", warnings, "text-amber-600 dark:text-amber-400")}
    </div>
  );
}

export function Inspector() {
  const document = useAppStore((s) => s.document);
  const parseResult = useAppStore((s) => s.parseResult);
  const filePath = useAppStore((s) => s.filePath);
  const activeSheetIndex = useAppStore((s) => s.activeSheetIndex);
  const selectedCutIndex = useAppStore((s) => s.selectedCutIndex);
  const selectedPaneId = useAppStore((s) => s.selectedPaneId);
  const machineId = useAppStore((s) => s.machineId);
  const focusOn = useAppStore((s) => s.focusOn);
  const selectPane = useAppStore((s) => s.selectPane);
  const [paneFilter, setPaneFilter] = useState("");
  useSeqClock();

  const issues = useMemo(() => (document ? validateDocument(document) : []), [document]);

  const sheet = document?.sheets[activeSheetIndex];
  const selectedCut = selectedCutIndex !== null ? sheet?.cuts[selectedCutIndex] : undefined;
  const selectedPane = sheet?.panes.find((p) => p.id === selectedPaneId);

  if (!document || !parseResult || !sheet) {
    return (
      <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
        Open a cutcode file to inspect sheets, panes, and cuts.
      </div>
    );
  }

  const meta = document.metadata;
  const filteredPanes = paneFilter
    ? sheet.panes.filter((p) => p.id.toLowerCase().includes(paneFilter.toLowerCase()))
    : sheet.panes;
  const yieldReport = analyzeYield(sheet);
  const cycle = seqClock.timeline ?? buildTimeline(sheet, kinematicsFor(machineById(machineId)));

  return (
    <div className="flex h-full flex-col overflow-y-auto text-sm">
      <Section title="File">
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Path</dt>
            <dd className="truncate text-right font-medium" title={filePath ?? ""}>{filePath}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Vendor</dt>
            <dd className="font-medium">{meta.vendor}</dd>
          </div>
          {parseResult.detected.formatId && (
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Format</dt>
              <dd className="font-medium">{parseResult.detected.formatId}</dd>
            </div>
          )}
          {parseResult.detected.version && (
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Version</dt>
              <dd className="font-medium">{parseResult.detected.version}</dd>
            </div>
          )}
          {meta.machine && (
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Machine</dt>
              <dd className="font-medium">{meta.machine}</dd>
            </div>
          )}
          {meta.glassThickness !== undefined && (
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Thickness</dt>
              <dd className="font-medium">{meta.glassThickness} mm</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">Status</dt>
            <dd className={`font-medium ${parseResult.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : parseResult.status === "partial" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
              {parseResult.status}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title={`Issues (${issues.length})`}>
        <IssuesPanel issues={issues} />
      </Section>

      {parseResult.warnings.length > 0 && (
        <Section title={`Parser Warnings (${parseResult.warnings.length})`}>
          <ul className="max-h-32 space-y-1 overflow-y-auto text-[11px] text-amber-700 dark:text-amber-300">
            {parseResult.warnings.slice(0, 12).map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
            {parseResult.warnings.length > 12 && <li>…and {parseResult.warnings.length - 12} more</li>}
          </ul>
        </Section>
      )}

      <Section title="Sheet">
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Size</dt>
            <dd className="font-medium">{sheet.sheet.width} × {sheet.sheet.height} mm</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Panes</dt>
            <dd className="font-medium">{sheet.panes.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Cuts</dt>
            <dd className="font-medium">{sheet.cuts.length}</dd>
          </div>
          {sheet.sheet.trims && (sheet.sheet.trims.left || sheet.sheet.trims.right || sheet.sheet.trims.top || sheet.sheet.trims.bottom) && (
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Trims L/R/T/B</dt>
              <dd className="font-medium">{sheet.sheet.trims.left}/{sheet.sheet.trims.right}/{sheet.sheet.trims.top}/{sheet.sheet.trims.bottom}</dd>
            </div>
          )}
        </dl>
      </Section>

      {yieldReport && (
        <Section title="Yield">
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Yield</dt>
              <dd className="font-medium">{yieldReport.yieldPct.toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Pane area</dt>
              <dd className="font-medium">{(yieldReport.paneAreaMm2 / 1e6).toFixed(3)} m²</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Waste</dt>
              <dd className="font-medium">{(yieldReport.wasteAreaMm2 / 1e6).toFixed(3)} m²</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Panes</dt>
              <dd className="font-medium">{yieldReport.paneCount}</dd>
            </div>
          </dl>
        </Section>
      )}

      {cycle && (
        <Section title="Cycle">
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Cycle time</dt>
              <dd className="font-medium">{formatSimTime(cycle.totalS)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Score</dt>
              <dd className="font-medium">{(cycle.cuttingLengthMm / 1000).toFixed(2)} m</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Rapid</dt>
              <dd className="font-medium">{(cycle.rapidLengthMm / 1000).toFixed(2)} m</dd>
            </div>
          </dl>
        </Section>
      )}

      {selectedPane && (
        <Section title="Selected Pane">
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">ID</dt><dd className="font-medium">{selectedPane.id}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Position</dt><dd className="font-medium">{selectedPane.bounds.x.toFixed(1)}, {selectedPane.bounds.y.toFixed(1)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Size</dt><dd className="font-medium">{selectedPane.bounds.width.toFixed(1)} × {selectedPane.bounds.height.toFixed(1)} mm</dd></div>
            {selectedPane.label && <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Label</dt><dd className="font-medium">{selectedPane.label}</dd></div>}
          </dl>
        </Section>
      )}

      {selectedCut && (
        <Section title="Selected Cut">
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Index</dt><dd className="font-medium">{selectedCutIndex}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Sequence</dt><dd className="font-medium">#{selectedCut.sequenceIndex}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Stage</dt><dd className="font-medium">{selectedCut.stageLabel ?? selectedCut.stage ?? "—"}</dd></div>
            {selectedCut.bockCode && <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Bock code</dt><dd className="font-medium">{selectedCut.bockCode}</dd></div>}
            {selectedCut.rackCode && <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Rack code</dt><dd className="font-medium">{selectedCut.rackCode}</dd></div>}
            <div className="pt-1">
              <dt className="mb-1 text-slate-500 dark:text-slate-400">Points</dt>
              <dd className="max-h-28 overflow-y-auto rounded bg-slate-50 p-2 font-mono text-[10px] dark:bg-slate-800">
                {selectedCut.points.map((p, i) => (
                  <div key={i}>{p.x.toFixed(2)}, {p.y.toFixed(2)}</div>
                ))}
              </dd>
            </div>
          </dl>
        </Section>
      )}

      <Section title={`Panes (${filteredPanes.length})`}>
        <input
          type="text"
          value={paneFilter}
          onChange={(e) => setPaneFilter(e.target.value)}
          placeholder="Filter pane IDs…"
          className="mb-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {filteredPanes.map((pane) => (
            <button
              key={pane.id}
              type="button"
              onClick={() => {
                selectPane(pane.id);
                focusOn({
                  x: pane.bounds.x - 20,
                  y: pane.bounds.y - 20,
                  width: pane.bounds.width + 40,
                  height: pane.bounds.height + 40,
                });
              }}
              className={`block w-full rounded px-2 py-0.5 text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800 ${
                selectedPaneId === pane.id ? "bg-blue-50 dark:bg-blue-900/40" : ""
              }`}
            >
              <span className="font-medium">{pane.id}</span>{" "}
              <span className="text-slate-500 dark:text-slate-400">
                {pane.bounds.width.toFixed(0)}×{pane.bounds.height.toFixed(0)} @ ({pane.bounds.x.toFixed(0)}, {pane.bounds.y.toFixed(0)})
              </span>
            </button>
          ))}
        </div>
      </Section>

      <div className="mt-auto px-3 py-2 text-[10px] text-slate-400">
        Shortcuts: Space play · [ ] step · Home reset · F fit · +/− zoom · Esc deselect
      </div>
    </div>
  );
}
