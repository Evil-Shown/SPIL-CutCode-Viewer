import { stageLabel } from "../model/types.js";
import { sampleArc } from "../geometry/arc.js";
import { cutPathPoints } from "../sim/timeline.js";
import type { Cut, CutDocument, CutPlan, Point } from "../model/types.js";

/**
 * DXF R12 is the lingua franca for handing a layout to CAD, nesting or CAM
 * downstream. We only emit what a 2D reader needs: the sheet outline as
 * LWPOLYLINE on layer SHEET, every cut on its own layer per stage, panes on
 * PANES, plus laser marks as POINT entities.
 */

const HEADER = [
  "999",
  "SPIL CutCode Simulator export",
  "0",
  "SECTION",
  "2",
  "HEADER",
  "9",
  "$ACADVER",
  "1",
  "AC1009",
  "0",
  "ENDSEC",
];

type Entity = string[];

function g(code: number, value: string | number): string[] {
  return [String(code), String(value)];
}

function lwpolyline(pts: Point[], layer: string, closed: boolean): Entity {
  const e: Entity = [
    ...g(0, "LWPOLYLINE"),
    ...g(8, layer),
    ...g(90, pts.length),
    ...g(70, closed ? 1 : 0),
  ];
  for (const p of pts) e.push(...g(10, p.x.toFixed(4)), ...g(20, p.y.toFixed(4)));
  return e;
}

function pointEntity(p: Point, layer: string): Entity {
  return [...g(0, "POINT"), ...g(8, layer), ...g(10, p.x.toFixed(4)), ...g(20, p.y.toFixed(4)), ...g(30, 0)];
}

function cutPoints(cut: Cut): Point[] {
  if (cut.type === "arc" && cut.center && cut.radius && cut.radius > 0) {
    return sampleArc({ start: cut.points[0]!, end: cut.points[1] ?? cut.points[0]!, radius: cut.radius, side: cut.ccw ? -1 : 1 }, 48);
  }
  return cut.points;
}

/** Stage index → layer name, keeping the R12 31-char limit in mind. */
function stageLayer(stage: number | undefined, vendor = ""): string {
  if (!stage) return "CUT";
  const label = stageLabel(vendor, stage);
  return `CUT_${label ?? stage}`;
}

function sheetEntities(sheet: CutPlan, vendor: string): Entity[] {
  const out: Entity[] = [];
  const w = sheet.sheet.width;
  const h = sheet.sheet.height;

  out.push(lwpolyline([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], "SHEET", true));

  const t = sheet.sheet.trims;
  if (t && (t.left || t.right || t.top || t.bottom)) {
    out.push(
      lwpolyline(
        [
          { x: t.left, y: t.top },
          { x: w - t.right, y: t.top },
          { x: w - t.right, y: h - t.bottom },
          { x: t.left, y: h - t.bottom },
        ],
        "TRIM",
        true
      )
    );
  }

  for (const pane of sheet.panes) {
    if (pane.polygon && pane.polygon.length >= 3) out.push(lwpolyline(pane.polygon, "PANES", true));
    else if (pane.bounds.width > 0 && pane.bounds.height > 0) {
      const b = pane.bounds;
      out.push(
        lwpolyline(
          [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
            { x: b.x, y: b.y + b.height },
          ],
          "PANES",
          true
        )
      );
    }
  }

  for (const cut of sheet.cuts) {
    const pts = cutPoints(cut);
    if (pts.length >= 2) out.push(lwpolyline(pts, stageLayer(cut.stage, vendor), false));
  }

  for (const mark of sheet.laser ?? []) {
    out.push(pointEntity({ x: mark.x, y: mark.y }, "LASER"));
  }

  return out;
}

/** Full ASCII DXF R12 document for one cut plan. */
export function planToDxf(plan: CutPlan, vendor = ""): string {
  const lines: string[] = [...HEADER, ...g(0, "SECTION"), ...g(2, "ENTITIES")];
  for (const e of sheetEntities(plan, vendor)) lines.push(...e);
  lines.push(...g(0, "ENDSEC"), ...g(0, "EOF"));
  return lines.join("\r\n") + "\r\n";
}

/** Multi-sheet DXF: sheets are offset in +Y so they never overlap. */
export function documentToDxf(doc: CutDocument, gapMm = 200): string {
  const vendor = doc.metadata.vendor;
  const lines: string[] = [...HEADER, ...g(0, "SECTION"), ...g(2, "ENTITIES")];
  let offsetY = 0;
  for (const plan of doc.sheets) {
    const shift = (p: Point): Point => ({ x: p.x, y: p.y + offsetY });
    const w = plan.sheet.width;
    const h = plan.sheet.height;

    lines.push(
      ...lwpolyline([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }].map(shift), "SHEET", true)
    );
    const t = plan.sheet.trims;
    if (t && (t.left || t.right || t.top || t.bottom)) {
      lines.push(
        ...lwpolyline(
          [
            { x: t.left, y: t.top },
            { x: w - t.right, y: t.top },
            { x: w - t.right, y: h - t.bottom },
            { x: t.left, y: h - t.bottom },
          ].map(shift),
          "TRIM",
          true
        )
      );
    }
    for (const pane of plan.panes) {
      const pts =
        pane.polygon && pane.polygon.length >= 3
          ? pane.polygon
          : [
              { x: pane.bounds.x, y: pane.bounds.y },
              { x: pane.bounds.x + pane.bounds.width, y: pane.bounds.y },
              { x: pane.bounds.x + pane.bounds.width, y: pane.bounds.y + pane.bounds.height },
              { x: pane.bounds.x, y: pane.bounds.y + pane.bounds.height },
            ];
      if (pts.length >= 3) lines.push(...lwpolyline(pts.map(shift), "PANES", true));
    }
    for (const cut of plan.cuts) {
      const pts = cutPathPoints(cut);
      if (pts.length >= 2) lines.push(...lwpolyline(pts.map(shift), stageLayer(cut.stage, vendor), false));
    }
    for (const mark of plan.laser ?? []) {
      lines.push(...pointEntity(shift({ x: mark.x, y: mark.y }), "LASER"));
    }

    offsetY += h + gapMm;
  }
  lines.push(...g(0, "ENDSEC"), ...g(0, "EOF"));
  return lines.join("\r\n") + "\r\n";
}