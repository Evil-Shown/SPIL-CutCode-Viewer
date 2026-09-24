import { useEffect, useState } from "react";
import { seqClock } from "./seqClock";

/** Subscribe to the shared playback clock so transport / inspector stay live. */
export function useSeqClock() {
  const [, setRev] = useState(0);
  useEffect(() => seqClock.subscribe(() => setRev((n) => n + 1)), []);
  return seqClock;
}

export function formatSimTime(s: number): string {
  const t = Number.isFinite(s) && s > 0 ? s : 0;
  const m = Math.floor(t / 60);
  const rem = t - m * 60;
  const sec = rem.toFixed(1).padStart(4, "0");
  return `${String(m).padStart(2, "0")}:${sec}`;
}
