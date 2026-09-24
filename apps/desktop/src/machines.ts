export type Machine = {
  id: string;
  brand: string;
  model: string;
  kind: string;
  origin: string;
  bed: { width: number; height: number };
  summary: string;
  extensions: string[];
  formatIds: string[];
  importReady: boolean;
  accent: string;
};

export type MachineVisual = {
  frame: string;
  bed: string;
  gantry: string;
  layout: "single" | "split" | "laminated";
  loadingArms: boolean;
  pedestal: "left" | "right";
};

/** Recognisable visual language used by each manufacturer's real tables. */
export function machineVisual(machine: Machine): MachineVisual {
  const brand = machine.brand.toLowerCase();
  if (brand === "turomas") return { frame: "#e86f19", bed: "#20282a", gantry: "#d8dde0", layout: "single", loadingArms: true, pedestal: "left" };
  if (brand === "bavelloni") return { frame: "#738286", bed: "#17292b", gantry: "#b9c4c7", layout: "split", loadingArms: false, pedestal: "left" };
  if (brand === "intermac") return { frame: "#d5d9d8", bed: "#26383a", gantry: "#20292b", layout: machine.kind.includes("Laminated") ? "laminated" : "single", loadingArms: machine.model.includes("Pro"), pedestal: "right" };
  if (brand === "lisec") return { frame: "#cad0d0", bed: "#253332", gantry: "#63a144", layout: "single", loadingArms: true, pedestal: "left" };
  if (brand === "bottero") return { frame: "#dd302e", bed: "#202a2b", gantry: "#b8c0c0", layout: "single", loadingArms: true, pedestal: "right" };
  if (brand === "hegla") return { frame: "#1b78b5", bed: "#253638", gantry: "#d8dcdb", layout: machine.kind.includes("Laminated") ? "laminated" : "single", loadingArms: true, pedestal: "left" };
  if (brand === "macotec") return { frame: "#e39b22", bed: "#233234", gantry: "#c8cece", layout: "single", loadingArms: true, pedestal: "right" };
  if (brand === "optima") return { frame: "#356ca8", bed: "#273538", gantry: "#d4d8d8", layout: "single", loadingArms: false, pedestal: "right" };
  return { frame: machine.accent, bed: "#263638", gantry: "#c9cece", layout: "single", loadingArms: false, pedestal: "right" };
}

export const MACHINES: Machine[] = [
  {
    id: "intermac-genius-ct",
    brand: "Intermac",
    model: "Genius CT",
    kind: "Float cutting table",
    origin: "Italy",
    bed: { width: 6100, height: 3350 },
    summary: "Straight and shaped scoring for jumbo float. Opens OTD layouts and ISO .CUT programs.",
    extensions: ["otd", "cut", "cni"],
    formatIds: ["intermac-otd", "intermac-cut"],
    importReady: true,
    accent: "#38bdf8",
  },
  {
    id: "intermac-genius-lm",
    brand: "Intermac",
    model: "Genius LM",
    kind: "Laminated line",
    origin: "Italy",
    bed: { width: 4600, height: 2800 },
    summary: "Laminated score, break-out and PVB separation. Same Intermac OTD and ISO cutcode.",
    extensions: ["otd", "cut", "cni"],
    formatIds: ["intermac-otd", "intermac-cut"],
    importReady: true,
    accent: "#22d3ee",
  },
  {
    id: "intermac-cut-pro",
    brand: "Intermac",
    model: "Cut Pro",
    kind: "Combi line",
    origin: "Italy",
    bed: { width: 3710, height: 2760 },
    summary: "Monolithic table plus laminated break-out. Import Intermac OTD or .CUT.",
    extensions: ["otd", "cut", "cni"],
    formatIds: ["intermac-otd", "intermac-cut"],
    importReady: true,
    accent: "#67e8f9",
  },
  {
    id: "lisec-esl",
    brand: "Lisec",
    model: "ESL / sprintCut",
    kind: "Cutting line",
    origin: "Austria",
    bed: { width: 6000, height: 3300 },
    summary: "High-speed float lines. Import Lisec .DAT traverse layouts.",
    extensions: ["dat"],
    formatIds: ["lisec-dat"],
    importReady: true,
    accent: "#34d399",
  },
  {
    id: "bottero-bcs",
    brand: "Bottero",
    model: "BCS",
    kind: "Cutting table",
    origin: "Italy",
    bed: { width: 6100, height: 3350 },
    summary: "Bottero cutting system. Import .OPT hex-token programs.",
    extensions: ["opt"],
    formatIds: ["bottero-opt"],
    importReady: true,
    accent: "#fbbf24",
  },
  {
    id: "bottero-363",
    brand: "Bottero",
    model: "363 BCS",
    kind: "Jumbo table",
    origin: "Italy",
    bed: { width: 6100, height: 3300 },
    summary: "Jumbo float and shape cutting. Same Bottero .OPT cutcode.",
    extensions: ["opt"],
    formatIds: ["bottero-opt"],
    importReady: true,
    accent: "#f59e0b",
  },
  {
    id: "hegla-galactic",
    brand: "Hegla",
    model: "Galactic",
    kind: "Cutting table",
    origin: "Germany",
    bed: { width: 6000, height: 3300 },
    summary: "Hegla float cutting. Import EDICUT and fixed-width .EDI files.",
    extensions: ["edi"],
    formatIds: ["hegla-edi"],
    importReady: true,
    accent: "#a78bfa",
  },
  {
    id: "hegla-prolam",
    brand: "Hegla",
    model: "ProLam",
    kind: "Laminated line",
    origin: "Germany",
    bed: { width: 4600, height: 2800 },
    summary: "Laminated cutting and separation. Uses Hegla .EDI cutcode.",
    extensions: ["edi"],
    formatIds: ["hegla-edi"],
    importReady: true,
    accent: "#c4b5fd",
  },
  {
    id: "macotec-star",
    brand: "Macotec",
    model: "Star Cut",
    kind: "Cutting table",
    origin: "Italy",
    bed: { width: 6100, height: 3300 },
    summary: "Macotec tables driven by Perfect Cut. Import .IMP layouts.",
    extensions: ["imp"],
    formatIds: ["macotech-imp", "macotech-family"],
    importReady: true,
    accent: "#fb7185",
  },
  {
    id: "optima",
    brand: "Optima",
    model: "CNC",
    kind: "Optimization output",
    origin: "Italy",
    bed: { width: 6000, height: 3210 },
    summary: "Optima pattern files. Import .R01 cuttings and OptiTV .OTV JSON.",
    extensions: ["r01", "otv", "json"],
    formatIds: ["optima-r01", "optima-otv"],
    importReady: true,
    accent: "#60a5fa",
  },
  {
    id: "perfect-cut",
    brand: "Perfect Cut",
    model: "Job report",
    kind: "Optimization software",
    origin: "Italy",
    bed: { width: 6000, height: 3210 },
    summary: "Perfect Cut job XML. Geometry exports still go out as OTD, OPT, IMP, DAT or EDI.",
    extensions: ["xml", "ot5"],
    formatIds: ["perfectcut-xml", "perfectcut-ot5"],
    importReady: true,
    accent: "#f472b6",
  },
  {
    id: "dxf-generic",
    brand: "CAD",
    model: "DXF nest",
    kind: "Generic geometry",
    origin: "Universal",
    bed: { width: 6000, height: 3210 },
    summary: "LINE, LWPOLYLINE, CIRCLE and ARC entities from any CAD nest.",
    extensions: ["dxf"],
    formatIds: ["dxf"],
    importReady: true,
    accent: "#94a3b8",
  },
  {
    id: "bavelloni-rev",
    brand: "Bavelloni",
    model: "REV",
    kind: "Cutting table",
    origin: "Italy",
    bed: { width: 6100, height: 3300 },
    summary: "Bavelloni REV float tables. Cutcode import for this control is not in the viewer yet.",
    extensions: [],
    formatIds: [],
    importReady: false,
    accent: "#2dd4bf",
  },
  {
    id: "turomas-rubi",
    brand: "Turomas",
    model: "RUBI",
    kind: "Cutting table",
    origin: "Spain",
    bed: { width: 6100, height: 3300 },
    summary: "Turomas RUBI monolithic tables. Native cutcode import is not available yet.",
    extensions: [],
    formatIds: [],
    importReady: false,
    accent: "#fb923c",
  },
  {
    id: "cms-brembana",
    brand: "CMS",
    model: "Brembana",
    kind: "Cutting center",
    origin: "Italy",
    bed: { width: 3800, height: 2600 },
    summary: "CMS Brembana cutting centers. A dedicated post is not wired up yet.",
    extensions: [],
    formatIds: [],
    importReady: false,
    accent: "#818cf8",
  },
  {
    id: "bystronic-glass",
    brand: "Bystronic",
    model: "glass cutting",
    kind: "Cutting line",
    origin: "Switzerland",
    bed: { width: 6000, height: 3300 },
    summary: "Bystronic glass lines. Cutcode import is not available yet.",
    extensions: [],
    formatIds: [],
    importReady: false,
    accent: "#4ade80",
  },
  {
    id: "glaston",
    brand: "Glaston",
    model: "cutting",
    kind: "Cutting line",
    origin: "Finland",
    bed: { width: 6000, height: 3300 },
    summary: "Glaston cutting equipment. Cutcode import is not available yet.",
    extensions: [],
    formatIds: [],
    importReady: false,
    accent: "#38bdf8",
  },
  {
    id: "northglass",
    brand: "North Glass",
    model: "cutting line",
    kind: "Cutting line",
    origin: "China",
    bed: { width: 6100, height: 3300 },
    summary: "North Glass cutting lines. Cutcode import is not available yet.",
    extensions: [],
    formatIds: [],
    importReady: false,
    accent: "#f87171",
  },
  {
    id: "pannkoke",
    brand: "Pannkoke",
    model: "cutting",
    kind: "Cutting table",
    origin: "Germany",
    bed: { width: 3700, height: 2600 },
    summary: "Pannkoke handling and cutting. Cutcode import is not available yet.",
    extensions: [],
    formatIds: [],
    importReady: false,
    accent: "#eab308",
  },
];

export function machineById(id: string | null): Machine | null {
  if (!id) return null;
  return MACHINES.find((m) => m.id === id) ?? null;
}

export function machineAccepts(machine: Machine, formatId: string): boolean {
  return machine.formatIds.includes(formatId);
}
