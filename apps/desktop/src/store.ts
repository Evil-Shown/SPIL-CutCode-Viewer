import { create } from "zustand";
import type { CutDocument, ParseResult } from "@spil/cutcode-core";
import type { ThemeName } from "./theme";

export interface LayerToggles {
  grid: boolean;
  rulers: boolean;
  labels: boolean;
  directions: boolean;
  stages: boolean;
  dimensions: boolean;
}

export interface FocusTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  nonce: number;
}

interface AppState {
  document: CutDocument | null;
  parseResult: ParseResult | null;
  filePath: string | null;
  loadError: string | null;

  activeSheetIndex: number;
  selectedCutIndex: number | null;
  selectedPaneId: string | null;

  layers: LayerToggles;
  theme: ThemeName;
  recents: string[];

  seqPlaying: boolean;
  seqSpeed: number;
  measureMode: boolean;

  fitRequest: number;
  focusTarget: FocusTarget | null;
  statusMessage: string | null;

  setFromParse: (path: string, result: ParseResult) => void;
  setLoadError: (msg: string) => void;
  setActiveSheet: (i: number) => void;
  selectCut: (i: number | null) => void;
  selectPane: (id: string | null) => void;
  toggleLayer: (key: keyof LayerToggles) => void;
  setTheme: (t: ThemeName) => void;
  toggleTheme: () => void;
  pushRecent: (path: string) => void;
  requestFit: () => void;
  focusOn: (target: Omit<FocusTarget, "nonce">) => void;
  setStatus: (msg: string | null) => void;
  setSeqPlaying: (playing: boolean) => void;
  cycleSeqSpeed: () => void;
  toggleMeasure: () => void;
}

function loadStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  document: null,
  parseResult: null,
  filePath: null,
  loadError: null,

  activeSheetIndex: 0,
  selectedCutIndex: null,
  selectedPaneId: null,

  layers: { grid: true, rulers: true, labels: true, directions: false, stages: false, dimensions: false },
  theme: loadStored<ThemeName>("ccv.theme", "light"),
  recents: loadStored<string[]>("ccv.recents", []),

  seqPlaying: false,
  seqSpeed: 1,
  measureMode: false,

  fitRequest: 0,
  focusTarget: null,
  statusMessage: null,

  setFromParse: (path, result) => {
    set({
      document: result.document ?? null,
      parseResult: result,
      filePath: path,
      loadError: null,
      activeSheetIndex: 0,
      selectedCutIndex: null,
      selectedPaneId: null,
      fitRequest: Date.now(),
    });
    get().pushRecent(path);
  },

  setLoadError: (msg) =>
    set({ loadError: msg, document: null, parseResult: null, filePath: null, selectedCutIndex: null, selectedPaneId: null }),

  setActiveSheet: (i) => set({ activeSheetIndex: i, selectedCutIndex: null, selectedPaneId: null, fitRequest: Date.now() }),

  selectCut: (i) => set({ selectedCutIndex: i, selectedPaneId: null }),
  selectPane: (id) => set({ selectedPaneId: id, selectedCutIndex: null }),

  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),

  setTheme: (t) => {
    store("ccv.theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
    set({ theme: t });
  },

  toggleTheme: () => get().setTheme(get().theme === "light" ? "dark" : "light"),

  pushRecent: (path) =>
    set((s) => {
      const recents = [path, ...s.recents.filter((p) => p !== path)].slice(0, 8);
      store("ccv.recents", recents);
      return { recents };
    }),

  requestFit: () => set({ fitRequest: Date.now() }),

  focusOn: (target) => set({ focusTarget: { ...target, nonce: Date.now() } }),

  setStatus: (msg) => set({ statusMessage: msg }),

  setSeqPlaying: (playing) => set({ seqPlaying: playing }),

  cycleSeqSpeed: () =>
    set((s) => {
      const speeds = [1, 2, 4, 8];
      const idx = speeds.indexOf(s.seqSpeed);
      return { seqSpeed: speeds[(idx + 1) % speeds.length] ?? 1 };
    }),

  toggleMeasure: () => set((s) => ({ measureMode: !s.measureMode })),
}));
