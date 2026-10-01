import { DEFAULT_KINEMATICS, type MachineKinematics } from "@spil/cutcode-core";

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
  kinematics?: MachineKinematics;
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
  if (brand === "glaston") return { frame: "#4a7c9b", bed: "#1a2c32", gantry: "#c5d0d4", layout: "single", loadingArms: true, pedestal: "right" };
  if (brand === "intermac") return { frame: "#d5d9d8", bed: "#26383a", gantry: "#20292b", layout: machine.kind.includes("Laminated") ? "laminated" : "single", loadingArms: machine.model.includes("Pro"), pedestal: "right" };
  if (brand === "lisec") return { frame: "#cad0d0", bed: "#253332", gantry: "#63a144", layout: "single", loadingArms: true, pedestal: "left" };
  if (brand === "bottero") return { frame: "#dd302e", bed: "#202a2b", gantry: "#b8c0c0", layout: "single", loadingArms: true, pedestal: "right" };
  if (brand === "hegla") return { frame: "#1b78b5", bed: "#253638", gantry: "#d8dcdb", layout: machine.kind.includes("Laminated") ? "laminated" : "single", loadingArms: true, pedestal: "left" };
  if (brand === "macotec") return { frame: "#e39b22", bed: "#233234", gantry: "#c8cece", layout: "single", loadingArms: true, pedestal: "right" };
  if (brand === "optima") return { frame: "#356ca8", bed: "#273538", gantry: "#d4d8d8", layout: "single", loadingArms: false, pedestal: "right" };
  if (brand === "bystronic") return { frame: "#8aa0a6", bed: "#1f2f33", gantry: "#cdd6d8", layout: "single", loadingArms: true, pedestal: "left" };
  if (brand === "vetromac") return { frame: "#7c8b90", bed: "#21302f", gantry: "#b6c2c0", layout: "single", loadingArms: true, pedestal: "left" };
  if (brand === "eagle" || brand === "linghua") return { frame: "#c1443f", bed: "#282a2c", gantry: "#cfd3d4", layout: "single", loadingArms: true, pedestal: "right" };
  if (brand === "disai") return { frame: "#2f7f9e", bed: "#1d2b30", gantry: "#c2cdd1", layout: "single", loadingArms: false, pedestal: "left" };
  if (brand === "chaoyang") return { frame: "#4b6d3f", bed: "#232a24", gantry: "#c8d2c6", layout: "single", loadingArms: true, pedestal: "left" };
  if (brand === "lampo") return { frame: "#d08b2c", bed: "#28241c", gantry: "#d6cbb4", layout: "single", loadingArms: false, pedestal: "right" };
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
    formatIds: ["intermac-otd", "intermac-cut", "bavelloni-cut"],
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
    formatIds: ["intermac-otd", "intermac-cut", "bavelloni-cut"],
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
    formatIds: ["intermac-otd", "intermac-cut", "bavelloni-cut"],
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
    id: "bavelloni-rev-372",
    brand: "Bavelloni",
    model: "REV 372 SR",
    kind: "Cutting table",
    origin: "Italy",
    bed: { width: 3700, height: 2600 },
    summary: "NUM 1040 ISO .CUT / .CNI. E30000 tenths-mm sheet, G77H9030 scores, G77N8N9 shapes, G77H9666 Low-E.",
    extensions: ["cut", "cni"],
    formatIds: ["bavelloni-cut", "intermac-cut"],
    importReady: true,
    accent: "#2dd4bf",
  },
  {
    id: "bavelloni-rev-372-flexium",
    brand: "Bavelloni",
    model: "REV 372 SR Flexium Plus",
    kind: "Cutting table",
    origin: "Italy",
    bed: { width: 3700, height: 2600 },
    summary: "NUM Flexium Plus piece programs. Same ISO dialect as REV 372 SR, including Low-E grind paths.",
    extensions: ["cut", "cni"],
    formatIds: ["bavelloni-cut", "intermac-cut"],
    importReady: true,
    accent: "#14b8a6",
  },
  {
    id: "bavelloni-syncro",
    brand: "Bavelloni",
    model: "SYNCRO",
    kind: "Cutting table",
    origin: "Italy",
    bed: { width: 6100, height: 3300 },
    summary: "NUM SYNCRO ISO. Left- or right-bottom reference, shaped inserts via G77N8N9 (L6/L7 = square centre).",
    extensions: ["cut", "cni"],
    formatIds: ["bavelloni-cut", "intermac-cut"],
    importReady: true,
    accent: "#5eead4",
  },
  {
    id: "turomas-rubi",
    brand: "Turomas",
    model: "RUBI",
    kind: "Cutting table",
    origin: "Spain",
    bed: { width: 6100, height: 3300 },
    summary:
      "Turomas File Format V30 (.R01) and V40 (JSON). Ten-level guillotine X/Y/Z/V/W/Q/R/S/T/U, DS shape blocks placed by CS<n>Q<1|2>, SC score track and LE low-E deletion track.",
    extensions: ["r01", "json"],
    formatIds: ["turomas-r01", "turomas-v40"],
    importReady: true,
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
    model: "SMF / VGS / Smart'cut",
    kind: "Cutting line",
    origin: "Switzerland",
    bed: { width: 6000, height: 3300 },
    summary:
      "PROG.XYZ v6.0 cutting plans: ( … ) envelope, M<x>/<y> raw-material size, X subplates / Y primitives / Z·V·W after-cuts, F1…F98 catalogue models and the F99 free-shape S records.",
    extensions: ["xyz"],
    formatIds: ["bystronic-xyz"],
    importReady: true,
    accent: "#4ade80",
  },
  {
    id: "vetromac-evo",
    brand: "Vetromac",
    model: "EVO / EXC",
    kind: "Cutting table",
    origin: "Italy",
    bed: { width: 6000, height: 3300 },
    summary:
      "Vetromac macro ISO (.ISO). VN210/211/212 give sheet number and size, G201 L39…L17 open and close shape blocks, M3/M5 gate the cutting wheel and G0/G1/G2/G3 carry the scores and ground contours.",
    extensions: ["iso"],
    formatIds: ["vetromac-iso"],
    importReady: true,
    accent: "#94a3b8",
  },
  {
    id: "eagle-isac",
    brand: "Eagle",
    model: "Linghua ISAC",
    kind: "Cutting table",
    origin: "China",
    bed: { width: 3700, height: 2600 },
    summary:
      "Linghua ISAC ISO driven by Perfect Cut. R4081/R4082 are the sheet size, R4083 the thickness, M1010/M1011 lower and raise the head and every G01 between them is a score.",
    extensions: ["iso"],
    formatIds: ["eagle-isac-iso"],
    importReady: true,
    accent: "#f87171",
  },
  {
    id: "disai-hbt",
    brand: "Disai",
    model: "HBT Studio PRJX",
    kind: "Cutting line",
    origin: "China",
    bed: { width: 3660, height: 2440 },
    summary:
      "PRJX machine code: a .sum stock summary plus one .dst per pattern with [PATTERN], [SCHEME] levels X/Y/Z/U/V/W/R/S/T, [BREAKLN] cut lines, [DBn] shapes and [IBn] piece blocks.",
    extensions: ["dst", "sum", "prjx"],
    formatIds: ["disai-prjx"],
    importReady: true,
    accent: "#2f7f9e",
  },
  {
    id: "chaoyang-src",
    brand: "Chaoyang",
    model: "SCR NC",
    kind: "Cutting line",
    origin: "China",
    bed: { width: 3660, height: 2440 },
    summary:
      "Chaoyang SCR NC (.src): LIMITS gives the sheet size, #RECT the enclosing rectangles, #REM the nominal sizes and customer/order, LINE the straight scores and ARC2C/ARC3C the circles.",
    extensions: ["src"],
    formatIds: ["chaoyang-src"],
    importReady: true,
    accent: "#4b6d3f",
  },
  {
    id: "lampo-csm",
    brand: "Lampo",
    model: "CSM",
    kind: "Cutting table",
    origin: "Italy",
    bed: { width: 3660, height: 2440 },
    summary:
      "Perfect Cut RO cutcode (.PGM) plus its .LST index. G/G1 pairs are the absolute score path, DS blocks the shapes and CS<n> X Y A<0|90> the placements.",
    extensions: ["pgm", "lst"],
    formatIds: ["perfectcut-pgm", "perfectcut-pgm-index"],
    importReady: true,
    accent: "#d08b2c",
  },
  {
    id: "glaston",
    brand: "Glaston",
    model: "UC 200 / 500 / 1000",
    kind: "Cutting line",
    origin: "Finland / Tianjin",
    bed: { width: 3700, height: 2600 },
    summary: "Glaston UC NUM SYNCRO_LOWE programs. Same Bavelloni-family ISO, plus Low-E grind and last-cut E30009/E30010.",
    extensions: ["cut", "cni"],
    formatIds: ["bavelloni-cut", "intermac-cut"],
    importReady: true,
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

function kine(rapidMmin: number, scoreMmin: number, accelMS2: number, headS: number): MachineKinematics {
  return {
    rapidSpeedMmS: (rapidMmin * 1000) / 60,
    scoreSpeedMmS: (scoreMmin * 1000) / 60,
    accelMmS2: accelMS2 * 1000,
    headDownS: headS,
    headUpS: headS,
  };
}

/** Typical table speeds from public spec sheets / product literature, converted to mm/s. */
const BRAND_KINEMATICS: Record<string, MachineKinematics> = {
  Intermac: kine(200, 120, 8, 0.15),
  Lisec: kine(240, 150, 10, 0.12),
  Bottero: kine(185, 110, 7.5, 0.16),
  Hegla: kine(210, 135, 9, 0.13),
  Macotec: kine(190, 115, 8, 0.14),
  Optima: kine(160, 100, 6, 0.18),
  Turomas: kine(250, 160, 12, 0.1),
  Bavelloni: kine(175, 105, 7, 0.17),
  CMS: kine(150, 90, 5.5, 0.2),
  Bystronic: kine(205, 125, 8.5, 0.14),
  Vetromac: kine(195, 120, 8, 0.15),
  Eagle: kine(165, 100, 6.5, 0.18),
  Disai: kine(160, 100, 6, 0.18),
  Chaoyang: kine(150, 95, 5.5, 0.2),
  Lampo: kine(145, 90, 5, 0.2),
  Glaston: kine(180, 110, 7, 0.16),
  "North Glass": kine(155, 95, 5.5, 0.2),
  Pannkoke: kine(140, 85, 5, 0.22),
};

for (const m of MACHINES) {
  const k = BRAND_KINEMATICS[m.brand];
  if (k) m.kinematics = k;
}

export function kinematicsFor(machine: Machine | null | undefined): MachineKinematics {
  return machine?.kinematics ?? DEFAULT_KINEMATICS;
}
