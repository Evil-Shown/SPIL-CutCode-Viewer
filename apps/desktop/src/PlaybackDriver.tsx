import { useEffect } from "react";
import { useAppStore } from "./store";
import { seqClock } from "./seqClock";

/** Advances the shared cut clock so 2D and 3D views stay in step. */
export function PlaybackDriver() {
  const doc = useAppStore((s) => s.document);
  const activeSheetIndex = useAppStore((s) => s.activeSheetIndex);
  const seqPlaying = useAppStore((s) => s.seqPlaying);
  const seqSpeed = useAppStore((s) => s.seqSpeed);
  const sheet = doc?.sheets[activeSheetIndex];
  const cutCount = sheet?.cuts.length ?? 0;

  useEffect(() => {
    if (!seqPlaying || cutCount < 2) {
      seqClock.progress = -1;
      seqClock.notify();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const maxSeq = Math.max(1, cutCount - 1);
      if (seqClock.progress < 0) seqClock.progress = 0;
      seqClock.progress += dt * 6 * seqSpeed;
      if (seqClock.progress > maxSeq) seqClock.progress = 0;
      seqClock.notify();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seqPlaying, seqSpeed, cutCount]);

  return null;
}
