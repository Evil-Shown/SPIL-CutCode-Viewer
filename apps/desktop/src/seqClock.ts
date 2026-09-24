type Listener = () => void;

/** Shared cut-sequence clock. Mutated by the playback driver; canvases subscribe. */
export const seqClock = {
  /** -1 means the full layout is shown. Otherwise the cut index being scored. */
  progress: -1,
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
};
