import { useAppStore } from "./store";

export function Inspector() {
  const plan = useAppStore((s) => s.plan);
  const parseResult = useAppStore((s) => s.parseResult);
  const filePath = useAppStore((s) => s.filePath);
  const selectedCutIndex = useAppStore((s) => s.selectedCutIndex);

  if (!plan || !parseResult) {
    return (
      <div className="p-4 text-sm text-slate-500">
        Open a cutcode file to inspect sheet, panes, and cuts.
      </div>
    );
  }

  const cut = selectedCutIndex != null ? plan.cuts[selectedCutIndex] : null;

  return (
    <div className="p-4 space-y-4 text-sm overflow-y-auto h-full">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">File</h2>
        <p className="text-slate-800 break-all">{filePath}</p>
        <p className="text-slate-600 mt-1">
          {parseResult.detected.vendor} · {parseResult.detected.formatId}
          {parseResult.detected.version ? ` v${parseResult.detected.version}` : ""}
        </p>
        <p className="text-slate-500 capitalize">{parseResult.status}</p>
      </section>

      {parseResult.warnings.length > 0 && (
        <section className="rounded-lg bg-amber-50 border border-amber-200 p-3">
          <h2 className="text-xs font-semibold text-amber-800 mb-1">Warnings</h2>
          <ul className="text-amber-900/80 space-y-1 text-xs">
            {parseResult.warnings.slice(0, 8).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {parseResult.warnings.length > 8 && (
              <li>…and {parseResult.warnings.length - 8} more</li>
            )}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Sheet</h2>
        <dl className="grid grid-cols-2 gap-1 text-slate-800">
          <dt className="text-slate-500">Size</dt>
          <dd>{plan.sheet.width} × {plan.sheet.height} mm</dd>
          {plan.metadata.glassThickness != null && (
            <>
              <dt className="text-slate-500">Thickness</dt>
              <dd>{plan.metadata.glassThickness} mm</dd>
            </>
          )}
          {plan.metadata.machine && (
            <>
              <dt className="text-slate-500">Machine</dt>
              <dd>{plan.metadata.machine}</dd>
            </>
          )}
        </dl>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Panes ({plan.panes.length})
        </h2>
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {plan.panes.slice(0, 20).map((p) => (
            <li key={p.id} className="text-slate-600 text-xs">
              {p.id}: {p.bounds.width}×{p.bounds.height} @ ({p.bounds.x}, {p.bounds.y})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Cuts ({plan.cuts.length})
        </h2>
        {cut ? (
          <dl className="grid grid-cols-2 gap-1 text-slate-800 text-xs">
            <dt className="text-slate-500">Index</dt>
            <dd>{selectedCutIndex}</dd>
            <dt className="text-slate-500">Seq</dt>
            <dd>{cut.sequenceIndex}</dd>
            {cut.bockCode && (
              <>
                <dt className="text-slate-500">Bock</dt>
                <dd>{cut.bockCode}</dd>
              </>
            )}
            <dt className="text-slate-500">From</dt>
            <dd>
              ({cut.points[0].x.toFixed(1)}, {cut.points[0].y.toFixed(1)})
            </dd>
            <dt className="text-slate-500">To</dt>
            <dd>
              ({cut.points[1]?.x.toFixed(1)}, {cut.points[1]?.y.toFixed(1)})
            </dd>
          </dl>
        ) : (
          <p className="text-slate-500 text-xs">Click a cut line on the canvas.</p>
        )}
      </section>
    </div>
  );
}
