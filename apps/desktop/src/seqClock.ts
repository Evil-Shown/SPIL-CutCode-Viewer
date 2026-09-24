import { headAt, type CutTimeline } from "@spil/cutcode-core";

type Listener = () => void;

function deriveProgress(timeline: CutTimeline | null, timeS: number): number {
  if (!timeline || timeS < 0) return -1;
  const h = headAt(timeline, timeS);
  if (h.phase === "done") {
    let maxSeq = -1;
    for (const seg of timeline.segments) {
      if (seg.kind === "score") maxSeq = Math.max(maxSeq, seg.cutIndex);
    }
    return maxSeq + 1;
  }
  if (h.phase === "score" && h.activeCutIndex != null) {
    return h.activeCutIndex + h.cutProgress;
  }
  let last = -1;
  for (const seg of timeline.segments) {
    if (seg.kind === "score" && seg.endS <= timeS) last = Math.max(last, seg.cutIndex);
  }
  return last < 0 ? 0 : last + 1 - 1e-6;
}

/** Shared cut-sequence clock. Mutated by the playback driver; canvases subscribe. */
export const seqClock = {
  /** -1 means the full layout is shown. Otherwise the cut index being scored. */
  progress: -1,
  /** Simulated seconds. -1 = inactive (show the complete layout). */
  timeS: -1,
  timeline: null as CutTimeline | null,
  listeners: new Set<Listener>(),
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  },
  notify() {
    for (const fn of this.listeners) fn();
  },
  syncProgress() {
    this.progress = deriveProgress(this.timeline, this.timeS);
  },
  seek(tS: number) {
    const tl = this.timeline;
    if (!tl) return;
    this.timeS = Math.min(tl.totalS, Math.max(0, tS));
    this.syncProgress();
    this.notify();
  },
  stepCut(dir: 1 | -1) {
    const tl = this.timeline;
    if (!tl) return;
    const scores = tl.segments.filter((s) => s.kind === "score");
    if (!scores.length) return;
    const t = this.timeS < 0 ? 0 : this.timeS;
    const eps = 1e-4;
    if (dir === 1) {
      const next = scores.find((s) => s.startS > t + eps) ?? scores[0];
      if (next) this.seek(next.startS);
      return;
    }
    const current = scores.find((s) => t >= s.startS && t < s.endS);
    if (current && t > current.startS + 0.05) {
      this.seek(current.startS);
      return;
    }
    const prev = [...scores].reverse().find((s) => s.startS < t - eps) ?? scores[0];
    if (prev) this.seek(prev.startS);
  },
};
