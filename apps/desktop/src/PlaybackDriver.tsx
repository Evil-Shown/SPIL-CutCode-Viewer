import { useEffect, useMemo } from "react";
import { buildTimeline } from "@spil/cutcode-core";
import { kinematicsFor, machineById } from "./machines";
import { seqClock } from "./seqClock";
import { useAppStore } from "./store";

/** Advances the shared clock in simulated seconds so 2D and 3D views stay in step. */
export function PlaybackDriver() {
  const doc = useAppStore((s) => s.document);
  const activeSheetIndex = useAppStore((s) => s.activeSheetIndex);
  const seqPlaying = useAppStore((s) => s.seqPlaying);
  const seqSpeed = useAppStore((s) => s.seqSpeed);
  const machineId = useAppStore((s) => s.machineId);
  const sheet = doc?.sheets[activeSheetIndex];
  const machine = machineById(machineId);
  const k = kinematicsFor(machine);

  const timeline = useMemo(() => (sheet ? buildTimeline(sheet, k) : null), [sheet, k]);

  useEffect(() => {
    seqClock.timeline = timeline;
    seqClock.timeS = -1;
    seqClock.progress = -1;
    seqClock.notify();
  }, [timeline]);

  useEffect(() => {
    if (!seqPlaying || !timeline || timeline.totalS <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (seqClock.timeS < 0 || seqClock.timeS >= timeline.totalS) seqClock.timeS = 0;
      seqClock.timeS += dt * seqSpeed;
      if (seqClock.timeS > timeline.totalS) seqClock.timeS = 0;
      seqClock.syncProgress();
      seqClock.notify();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seqPlaying, seqSpeed, timeline]);

  return null;
}
