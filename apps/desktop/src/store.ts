import { create } from "zustand";
import type { CutPlan, ParseResult } from "@spil/cutcode-core";

type AppState = {
  plan: CutPlan | null;
  parseResult: ParseResult | null;
  filePath: string | null;
  selectedCutIndex: number | null;
  showLabels: boolean;
  showGrid: boolean;
  showCutSequence: boolean;
  cutSequenceLimit: number | null;
  fitRequest: number;
  setFromParse: (path: string, result: ParseResult) => void;
  setSelectedCut: (index: number | null) => void;
  toggleLabels: () => void;
  toggleGrid: () => void;
  toggleCutSequence: () => void;
  setCutSequenceLimit: (limit: number | null) => void;
  requestFit: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  plan: null,
  parseResult: null,
  filePath: null,
  selectedCutIndex: null,
  showLabels: true,
  showGrid: true,
  showCutSequence: false,
  cutSequenceLimit: null,
  fitRequest: 0,
  setFromParse: (path, result) =>
    set({
      filePath: path,
      parseResult: result,
      plan: result.plan ?? null,
      selectedCutIndex: null,
      cutSequenceLimit: null,
      fitRequest: Date.now(),
    }),
  setSelectedCut: (index) => set({ selectedCutIndex: index }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleCutSequence: () => set((s) => ({ showCutSequence: !s.showCutSequence })),
  setCutSequenceLimit: (limit) => set({ cutSequenceLimit: limit }),
  requestFit: () => set({ fitRequest: Date.now() }),
}));
