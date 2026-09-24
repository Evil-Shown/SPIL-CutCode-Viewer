import { analyzeYield, headAt, type HeadState } from "@spil/cutcode-core";
import { seqClock } from "./seqClock";
import { useAppStore } from "./store";
import { formatSimTime, useSeqClock } from "./useSeqClock";

function phaseBadge(phase: HeadState["phase"] | "idle"): string {
  if (phase === "rapid") return "RAPID";
  if (phase === "score") return "SCORE";
  if (phase === "toolDown") return "DOWN";
  if (phase === "toolUp") return "UP";
  return "READY";
}

function dash(n: number | undefined, digits = 2, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
}

export function SimConsole() {
  useSeqClock();
  const doc = useAppStore((s) => s.document);
  const activeSheetIndex = useAppStore((s) => s.activeSheetIndex);
  const seqPlaying = useAppStore((s) => s.seqPlaying);
  const seqSpeed = useAppStore((s) => s.seqSpeed);
  const setSeqPlaying = useAppStore((s) => s.setSeqPlaying);
  const cycleSeqSpeed = useAppStore((s) => s.cycleSeqSpeed);

  const sheet = doc?.sheets[activeSheetIndex];
  const tl = seqClock.timeline;
  const armed = Boolean(tl && tl.totalS > 0);
  const timeS = seqClock.timeS < 0 ? 0 : seqClock.timeS;
  const totalS = tl?.totalS ?? 0;
  const remaining = Math.max(0, totalS - timeS);
  const yieldReport = sheet ? analyzeYield(sheet) : null;
  const head =
    tl && seqClock.timeS >= 0 ? headAt(tl, seqClock.timeS) : null;
  const phase = phaseBadge(head?.phase ?? "idle");

  const reset = () => {
    setSeqPlaying(false);
    if (tl) seqClock.seek(0);
  };

  const onScrub = (value: number) => {
    setSeqPlaying(false);
    seqClock.seek(value);
  };

  return (
    <div className={`sim-console${armed ? "" : " is-empty"}`}>
      <div className="sim-console-transport">
        <button type="button" title="Reset (Home)" disabled={!armed} onClick={reset}>
          ↺
        </button>
        <button type="button" title="Previous cut ([)" disabled={!armed} onClick={() => seqClock.stepCut(-1)}>
          ⏮
        </button>
        <button
          type="button"
          className={seqPlaying ? "is-active" : ""}
          title="Play / Pause (Space)"
          disabled={!armed}
          onClick={() => setSeqPlaying(!seqPlaying)}
        >
          {seqPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" title="Next cut (])" disabled={!armed} onClick={() => seqClock.stepCut(1)}>
          ⏭
        </button>
        <button type="button" title="Playback speed" onClick={cycleSeqSpeed}>
          {seqSpeed}×
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(totalS, 0.001)}
          step={0.01}
          value={Math.min(timeS, totalS)}
          disabled={!armed}
          aria-label="Cycle time"
          onPointerDown={() => setSeqPlaying(false)}
          onInput={(e) => onScrub(Number((e.target as HTMLInputElement).value))}
        />
        <span className={`sim-phase sim-phase-${phase.toLowerCase()}`}>{phase}</span>
      </div>
      <div className="sim-console-telemetry">
        <span className="sim-console-time">
          {armed ? `${formatSimTime(timeS)} / ${formatSimTime(totalS)}` : "00:00.0 / 00:00.0"}
        </span>
        <span>rem {armed ? formatSimTime(remaining) : "—"}</span>
        <span>score {armed ? dash((tl?.cuttingLengthMm ?? 0) / 1000, 2, " m") : "—"}</span>
        <span>rapid {armed ? dash((tl?.rapidLengthMm ?? 0) / 1000, 2, " m") : "—"}</span>
        <span>yield {yieldReport ? `${yieldReport.yieldPct.toFixed(1)}%` : "—"}</span>
        <span>waste {yieldReport ? dash(yieldReport.wasteAreaMm2 / 1e6, 3, " m²") : "—"}</span>
        <span>
          {yieldReport ? `${yieldReport.paneCount} panes · ${yieldReport.cutCount} cuts` : "0 panes · 0 cuts"}
        </span>
      </div>
    </div>
  );
}
