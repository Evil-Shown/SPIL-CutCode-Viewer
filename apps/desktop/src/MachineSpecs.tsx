import { analyzeYield, bedFitWarning } from "@spil/cutcode-core";
import { kinematicsFor, type Machine } from "./machines";
import { useAppStore } from "./store";

function mmSToMmin(mmS: number): number {
  return (mmS * 60) / 1000;
}

type Props = { machine: Machine };

export function MachineSpecs({ machine }: Props) {
  const doc = useAppStore((s) => s.document);
  const activeSheetIndex = useAppStore((s) => s.activeSheetIndex);
  const sheet = doc?.sheets[activeSheetIndex];
  const k = kinematicsFor(machine);
  const yieldReport = sheet ? analyzeYield(sheet) : null;
  const fitWarning = sheet ? bedFitWarning(sheet, machine.bed) : undefined;
  const extensions = machine.extensions.length
    ? machine.extensions.map((ext) => `.${ext.toUpperCase()}`).join(" · ")
    : "none yet";

  return (
    <div className="machine-specs">
      <dl>
        <div>
          <dt>Brand</dt>
          <dd>{machine.brand}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{machine.model}</dd>
        </div>
        <div>
          <dt>Origin</dt>
          <dd>{machine.origin}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{machine.kind}</dd>
        </div>
        <div>
          <dt>Bed</dt>
          <dd>
            {machine.bed.width} × {machine.bed.height} mm
          </dd>
        </div>
        <div>
          <dt>Rapid</dt>
          <dd>{mmSToMmin(k.rapidSpeedMmS).toFixed(0)} m/min</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{mmSToMmin(k.scoreSpeedMmS).toFixed(0)} m/min</dd>
        </div>
        <div>
          <dt>Accel</dt>
          <dd>{(k.accelMmS2 / 1000).toFixed(1)} m/s²</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{extensions}</dd>
        </div>
        {sheet && (
          <>
            <div>
              <dt>Fit</dt>
              <dd className={fitWarning ? "is-warn" : "is-ok"}>{fitWarning ? "OVERSIZE" : "OK"}</dd>
            </div>
            <div>
              <dt>Yield</dt>
              <dd>{yieldReport ? `${yieldReport.yieldPct.toFixed(1)}%` : "—"}</dd>
            </div>
          </>
        )}
      </dl>
      {fitWarning && <p className="machine-specs-warn">{fitWarning}</p>}
    </div>
  );
}
