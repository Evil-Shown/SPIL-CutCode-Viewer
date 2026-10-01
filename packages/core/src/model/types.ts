export type Point = { x: number; y: number };

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * How a parser's native coordinates map to simulator space.
 * The vertical reference is fully described by `origin`:
 *  - "top-left": y grows downward from the sheet's top edge (already canonical)
 *  - "bottom-left": y grows upward from the sheet's bottom edge (needs flip)
 */
export type CoordinateSemantics = {
  origin: "top-left" | "bottom-left";
  xAxis: "right" | "left";
  units: "mm" | "internal-ticks";
  unitsToMm?: number;
};

export type PaneShape =
  | { kind: "rect" }
  | { kind: "polygon"; points: Point[] };

export type Pane = {
  id: string;
  bounds: Rect;
  /** Polygon outline in sheet coordinates, when the pane is not rectangular. */
  polygon?: Point[];
  shape?: PaneShape;
  glassInfo?: string;
  label?: string;
  rotated?: boolean;
  /** Rack / pallet destination as written by the optimizer (B, IB2501, Rack=…). */
  rackCode?: string;
};

export type Cut = {
  id?: string;
  type: "line" | "arc";
  /** Line: polyline of >= 2 points. Arc: [start, end] with center/radius/ccw. */
  points: Point[];
  /** Arc geometry (canonical space after normalization). */
  center?: Point;
  radius?: number;
  ccw?: boolean;
  sequenceIndex: number;
  /** Guillotine level / cut stage, 1-based (X=1, Y=2, Z=3, W=4, V=5 …). */
  stage?: number;
  stageLabel?: string;
  paneRefs?: string[];
  bockCode?: string;
  rackCode?: string;
  /**
   * Work process that produced the cut, when the format publishes one
   * (Turomas V40 `workProcessesTrack[].process`, e.g. `CUT` or `LE`).
   * A pane can carry both a cutting outline and a Low-E deletion track that
   * deliberately overlaps it, so validators must not treat crossings between
   * different processes on the same pane as errors.
   */
  process?: string;
};

export type LaserMark = {
  x: number;
  y: number;
  angle?: number;
  mirror?: boolean;
  logo?: boolean;
};

/** One physical sheet's layout. Multi-sheet files produce several CutPlans. */
export type CutPlan = {
  id: string;
  label?: string;
  sheet: {
    width: number;
    height: number;
    trims?: { top: number; right: number; bottom: number; left: number };
  };
  panes: Pane[];
  cuts: Cut[];
  laser?: LaserMark[];
  coordinateSemantics: CoordinateSemantics;
};

export type DocumentMetadata = {
  vendor: string;
  formatVersion?: string;
  machine?: string;
  glassType?: string;
  glassThickness?: number;
  date?: string;
  operator?: string;
  sourcePath: string;
};

/** A parsed cutcode file: shared metadata plus one CutPlan per sheet. */
export type CutDocument = {
  metadata: DocumentMetadata;
  sheets: CutPlan[];
};

export type DetectResult = {
  vendor: string;
  formatId: string;
  confidence: "high" | "medium" | "low" | "unknown";
  matchedSignal?: string;
  version?: string;
  /** Format ids tried by the parser retry chain, when more than one ran. */
  attempts?: string;
};

export type ParseResult = {
  status: "ok" | "partial" | "failed";
  document?: CutDocument;
  warnings: string[];
  error?: string;
  detected: DetectResult;
};

/** Machine stage tables (from SPIL Opti CutCode QA guide, CL-01..CL-08). */
export const STAGE_LABELS: Record<string, string[]> = {
  OPTIMA: ["X", "Y", "Z", "W", "V", "A", "B", "C", "D", "E"],
  INTERMAC: ["X", "Y", "Z", "W", "V", "A", "B", "C", "D", "E"],
  BAVELLONI: ["X", "Y", "Z", "W", "V", "A", "B", "C", "D", "E"],
  GLASTON: ["X", "Y", "Z", "W", "V", "A", "B", "C", "D", "E"],
  MACOTEC: ["X", "Y", "Z", "W", "V", "A", "B", "C", "D", "E"],
  BOTTERO: ["X", "Y", "Z", "W", "Q", "R"],
  HEGLA: ["X", "Y", "Z", "V", "W"],
  STRON: ["X", "Y", "Z", "V", "W"],
  LISEC: ["X", "Y", "Z", "W"],
  TUROMAS: ["X", "Y", "Z", "V", "W", "Q", "R", "S", "T", "U"],
  "PERFECT CUT": ["X", "Y", "Z", "V", "W", "Q", "R", "S", "T", "U"],
  DISAI: ["X", "Y", "Z", "U", "V", "W", "R", "S", "T"],
  CHAOYANG: ["X", "Y", "Z", "U", "V", "W", "R", "S", "T"],
  BYSTRONIC: ["X", "Y", "Z", "V", "W"],
  VETROMAC: ["X", "Y", "Z", "W"],
  EAGLE: ["X", "Y", "Z", "W"],
};

export function stageLabel(vendor: string, stage: number): string | undefined {
  return STAGE_LABELS[vendor.toUpperCase()]?.[stage - 1];
}
