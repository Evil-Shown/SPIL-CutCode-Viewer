export type CoordinateSemantics = {
  origin: "top-left" | "bottom-left";
  xAxis: "right" | "left";
  yAxis: "down" | "up";
  units: "mm" | "internal-ticks";
  unitsToMm?: number;
};

export type CutPlan = {
  metadata: {
    vendor: string;
    formatVersion?: string;
    machine?: string;
    glassType?: string;
    glassThickness?: number;
    date?: string;
    sourcePath: string;
  };
  sheet: {
    width: number;
    height: number;
    trims?: { top: number; right: number; bottom: number; left: number };
  };
  panes: Array<{
    id: string;
    bounds: { x: number; y: number; width: number; height: number };
    glassInfo?: string;
    label?: string;
  }>;
  cuts: Array<{
    type: "line" | "arc";
    points: Array<{ x: number; y: number }>;
    sequenceIndex: number;
    paneRefs?: string[];
    bockCode?: string;
    rackCode?: string;
  }>;
  laser?: Array<{
    x: number;
    y: number;
    angle?: number;
    mirror?: boolean;
    logo?: boolean;
  }>;
  coordinateSemantics: CoordinateSemantics;
};

export type DetectResult = {
  vendor: string;
  formatId: string;
  confidence: "high" | "medium" | "low" | "unknown";
  matchedSignal?: string;
  version?: string;
};

export type ParseResult = {
  status: "ok" | "partial" | "failed";
  plan?: CutPlan;
  warnings: string[];
  error?: string;
  detected: DetectResult;
};
