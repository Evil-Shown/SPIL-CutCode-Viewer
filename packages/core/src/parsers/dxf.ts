import type { Cut, CutDocument, ParseResult, Point } from "../model/types.js";

/**
 * Minimal DXF importer for cut-pattern verification: reads the ENTITIES
 * section and converts LINE, LWPOLYLINE, CIRCLE and ARC entities into cuts.
 * Sheet size derives from the drawing extents (rounded up to mm).
 *
 * DXF coordinates are Y-up (bottom-left origin) — normalized on parse.
 * qiewer needs an external converter (.qdxf); we read .dxf directly.
 */

interface DxfEntity {
  type: "LINE" | "CIRCLE" | "ARC" | "LWPOLYLINE";
  pts: Point[];
  end?: Point;
  radius?: number;
  startAngle?: number; // degrees, CCW from +X
  endAngle?: number; // degrees
  closed?: boolean;
}

const ENTITY_TYPES = ["LINE", "CIRCLE", "ARC", "LWPOLYLINE"];

/** Tokenize the whole file into (group code, value) pairs. */
function tokenize(lines: string[]): Array<[number, string]> {
  const pairs: Array<[number, string]> = [];
  for (let k = 0; k + 1 < lines.length; k += 2) {
    const code = parseInt(lines[k]!.trim(), 10);
    if (Number.isFinite(code)) {
      pairs.push([code, lines[k + 1]!.trim()]);
    } else {
      k -= 1; // resync on misaligned pair (e.g. leading blank line)
    }
  }
  return pairs;
}

function parseEntities(pairs: Array<[number, string]>): DxfEntity[] {
  const entities: DxfEntity[] = [];
  let inEntities = false;
  let i = 0;

  while (i < pairs.length) {
    const [code, value] = pairs[i]!;

    if (code === 0 && value === "SECTION") {
      inEntities = pairs[i + 1]?.[0] === 2 && pairs[i + 1]![1].trim() === "ENTITIES";
      i++;
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      inEntities = false;
      i++;
      continue;
    }

    if (inEntities && code === 0 && ENTITY_TYPES.includes(value)) {
      // Gather this entity's group pairs until the next code 0.
      const coords: Point[] = [];
      const endPts: Point[] = [];
      let radius: number | undefined;
      let a0: number | undefined;
      let a1: number | undefined;
      let flag70 = 0;
      let pendingX: number | undefined;
      let pendingEndX: number | undefined;

      let j = i + 1;
      while (j < pairs.length && pairs[j]![0] !== 0) {
        const [c, v] = pairs[j]!;
        if (c === 10) {
          pendingX = parseFloat(v);
        } else if (c === 20 && pendingX !== undefined) {
          coords.push({ x: pendingX, y: parseFloat(v) });
          pendingX = undefined;
        } else if (c === 11) {
          pendingEndX = parseFloat(v);
        } else if (c === 21 && pendingEndX !== undefined) {
          endPts.push({ x: pendingEndX, y: parseFloat(v) });
          pendingEndX = undefined;
        } else if (c === 40) {
          radius = parseFloat(v);
        } else if (c === 50) {
          a0 = parseFloat(v);
        } else if (c === 51) {
          a1 = parseFloat(v);
        } else if (c === 70) {
          flag70 = parseInt(v, 10);
        }
        j++;
      }

      if (value === "LINE" && coords.length >= 1 && endPts.length >= 1) {
        entities.push({ type: "LINE", pts: [coords[0]!], end: endPts[0]! });
      } else if (value === "LWPOLYLINE" && coords.length >= 2) {
        entities.push({ type: "LWPOLYLINE", pts: coords, closed: (flag70 & 1) === 1 });
      } else if (value === "CIRCLE" && coords.length >= 1) {
        entities.push({ type: "CIRCLE", pts: [coords[0]!], radius });
      } else if (value === "ARC" && coords.length >= 1) {
        entities.push({ type: "ARC", pts: [coords[0]!], radius, startAngle: a0, endAngle: a1 });
      }
      i = j;
      continue;
    }

    i++;
  }
  return entities;
}

export function parseDxf(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];

  const entities = parseEntities(tokenize(content.split(/\r?\n/)));
  if (entities.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "No LINE/LWPOLYLINE/CIRCLE/ARC entities found in DXF",
      detected: { vendor: "DXF", formatId: "dxf", confidence: "high", matchedSignal: "DXF ENTITIES" },
    };
  }

  const cuts: Cut[] = [];
  let seq = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const track = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };

  for (const e of entities) {
    if (e.type === "LINE" && e.end) {
      track(e.pts[0]!.x, e.pts[0]!.y);
      track(e.end.x, e.end.y);
      cuts.push({ type: "line", points: [e.pts[0]!, e.end], sequenceIndex: seq++ });
    } else if (e.type === "LWPOLYLINE") {
      e.pts.forEach((p) => track(p.x, p.y));
      for (let k = 0; k < e.pts.length - 1; k++) {
        cuts.push({ type: "line", points: [e.pts[k]!, e.pts[k + 1]!], sequenceIndex: seq++ });
      }
      if (e.closed && e.pts.length >= 3) {
        cuts.push({ type: "line", points: [e.pts[e.pts.length - 1]!, e.pts[0]!], sequenceIndex: seq++ });
      }
    } else if (e.type === "CIRCLE" || e.type === "ARC") {
      const c = e.pts[0]!;
      const r = e.radius ?? 0;
      if (r <= 0) {
        warnings.push(`Skipped ${e.type} with radius ${r}`);
        continue;
      }
      track(c.x - r, c.y - r);
      track(c.x + r, c.y + r);
      const deg0 = ((e.startAngle ?? 0) * Math.PI) / 180;
      const deg1 = ((e.endAngle ?? 360) * Math.PI) / 180;
      const start = { x: c.x + r * Math.cos(deg0), y: c.y + r * Math.sin(deg0) };
      const end = { x: c.x + r * Math.cos(deg1), y: c.y + r * Math.sin(deg1) };
      cuts.push({
        type: "arc",
        points: e.type === "CIRCLE" ? [start, start] : [start, end],
        center: c,
        radius: r,
        ccw: true, // DXF arcs are CCW by definition
        sequenceIndex: seq++,
      });
    }
  }

  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);
  if (width <= 0 || height <= 0) {
    return {
      status: "failed",
      warnings,
      error: "DXF has no drawable extents",
      detected: { vendor: "DXF", formatId: "dxf", confidence: "high" },
    };
  }

  // Shift so drawing starts at (0,0); keep native Y-up via bottom-left semantics
  const shift = (p: Point): Point => ({ x: p.x - minX, y: p.y - minY });

  const document: CutDocument = {
    metadata: { vendor: "DXF", sourcePath },
    sheets: [{
      id: "sheet-1",
      sheet: { width, height },
      panes: [],
      cuts: cuts.map((c) => ({
        ...c,
        points: c.points.map(shift),
        center: c.center ? shift(c.center) : undefined,
      })),
      coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
    }],
  };

  return {
    status: warnings.length ? "partial" : "ok",
    document,
    warnings,
    detected: { vendor: "DXF", formatId: "dxf", confidence: "high", matchedSignal: "DXF ENTITIES" },
  };
}
