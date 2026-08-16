import type { Cut, CutDocument, CutPlan, Pane, ParseResult } from "../model/types.js";
import { stageLabel } from "../model/types.js";
import { arcCenter } from "../geometry/arc.js";

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s.trim());
  return Number.isFinite(n) ? n : undefined;
}

/* ------------------------------------------------------------------ */
/*  Guillotine tree → panes + cuts (fallback when no [Cuttings])      */
/* ------------------------------------------------------------------ */

interface TreeNode {
  indent: number;
  axis: "X" | "Y" | "Z" | "W";
  value: number;
  info?: number;
}

interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function buildFromTree(
  nodes: TreeNode[],
  sheetW: number,
  sheetH: number,
  vendor: string
): { panes: Pane[]; cuts: Cut[] } {
  const panes: Pane[] = [];
  const cuts: Cut[] = [];
  let seq = 0;

  // At each depth we track the remaining available space.
  // A node takes from the left (X/Z) or bottom (Y/W) of the remaining space.
  // Children subdivide the *piece* just taken.
  const stack: Array<{ remaining: Bounds; piece: Bounds }> = [];

  function ensureDepth(d: number): { remaining: Bounds; piece: Bounds } {
    while (stack.length <= d) {
      const parent = stack.length > 0 ? stack[stack.length - 1]!.piece : { left: 0, top: 0, width: sheetW, height: sheetH };
      stack.push({ remaining: { ...parent }, piece: { ...parent } });
    }
    return stack[d]!;
  }

  const STAGE_MAP: Record<string, number> = { X: 1, Y: 2, Z: 3, W: 4 };

  for (const node of nodes) {
    const depth = node.indent / 2;
    const slot = ensureDepth(depth);
    const rem = slot.remaining;

    let pb: Bounds | undefined;
    const isVert = node.axis === "X" || node.axis === "Z";

    if (isVert) {
      pb = { left: rem.left, top: rem.top, width: node.value, height: rem.height };
      rem.left += node.value;
      rem.width -= node.value;
    } else {
      pb = { left: rem.left, top: rem.top, width: rem.width, height: node.value };
      rem.top += node.value;
      rem.height -= node.value;
    }

    if (pb) {
      slot.piece = { ...pb };
      // truncate deeper levels when we return here
      stack.length = depth + 1;

      if (node.info !== undefined) {
        panes.push({
          id: String(node.info),
          bounds: { x: pb.left, y: pb.top, width: pb.width, height: pb.height },
          label: `Info ${node.info}`,
        });
      }

      const stage = STAGE_MAP[node.axis];
      if (stage !== undefined) {
        const cx = isVert ? pb.left + pb.width : pb.left;
        const cy = isVert ? pb.top : pb.top + pb.height;
        const cx2 = isVert ? cx : pb.left + pb.width;
        const cy2 = isVert ? pb.top + pb.height : cy;
        cuts.push({
          type: "line",
          points: [{ x: cx, y: cy }, { x: cx2, y: cy2 }],
          sequenceIndex: seq++,
          stage,
          stageLabel: stageLabel(vendor, stage),
        });
      }
    }
  }

  return { panes, cuts };
}

/* ------------------------------------------------------------------ */
/*  Per-pattern data collected during first pass                        */
/* ------------------------------------------------------------------ */

interface PatternData {
  header: Record<string, string>;
  tree: TreeNode[];
  cuttings: Array<{
    x1: number; y1: number; x2: number; y2: number;
    levcut: number;
    indPiece?: number;
    wcut?: number;
  }>;
  xoPanes: Array<{
    x: number; y: number; w: number; h: number;
    info?: string;
    indPiece?: string;
  }>;
  shapes: Array<{
    points: Array<{ x: number; y: number }>;
    info?: number;
  }>;
  shapeArcs: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    radius: number;
    side: number;
    info?: number;
  }>;
}

export type FamilyConfig = {
  patternKey: string;
  cuttingsKey: string;
  versionKey: string;
  vendor: string;
  formatId: string;
};

export function parseIntermacFamily(
  content: string,
  sourcePath: string,
  config: FamilyConfig
): ParseResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  let formatVersion: string | undefined;
  const patterns: PatternData[] = [];
  let cur: PatternData | null = null;
  let section = "";
  let shapeId: number | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      const name = sec[1].toLowerCase().replace(/^opt_/, "");
      section = name;

      if (name === config.patternKey || name === "pattern") {
        cur = { header: {}, tree: [], cuttings: [], xoPanes: [], shapes: [], shapeArcs: [] };
        patterns.push(cur);
      }
      continue;
    }

    // Global header (before any [Pattern])
    if (section === "header" && !cur) {
      const v = line.match(new RegExp(`^${config.versionKey}\\s*=\\s*(.+)$`, "i"));
      if (v) formatVersion = v[1].trim();
      continue;
    }

    if (!cur) continue;

    /* ---- within a [Pattern] / [OPT_Pattern] section ---- */
    if (section === config.patternKey || section === "pattern") {
      const kv = line.match(/^([A-Za-z]\w*)\s*=\s*(.*)$/);
      if (kv) {
        const key = kv[1];
        const val = kv[2].trim();
        cur.header[key] = val;

        // Single-letter axis → guillotine tree node
        if (key.length === 1 && "XYZW".includes(key)) {
          const v = num(val);
          if (v !== undefined) {
            const infoM = val.match(/Info=(\d+)/);
            cur.tree.push({
              indent: raw.length - raw.trimStart().length,
              axis: key as "X" | "Y" | "Z" | "W",
              value: v,
              info: infoM ? parseInt(infoM[1], 10) : undefined,
            });
          }
        }
        continue;
      }
      // Bare tree line (just "X=123" without multi-char key)
      const bare = line.match(/^([XYZW])=([\d.]+)/);
      if (bare) {
        const infoM = line.match(/Info=(\d+)/);
        cur.tree.push({
          indent: raw.length - raw.trimStart().length,
          axis: bare[1] as "X" | "Y" | "Z" | "W",
          value: parseFloat(bare[2]),
          info: infoM ? parseInt(infoM[1], 10) : undefined,
        });
      }
      continue;
    }

    /* ---- [Cuttings] / [OPT_Cuttings] ---- */
    if (section === config.cuttingsKey || section === "cuttings") {
      // XO/YO pane placement lines
      const xo = line.match(
        /^XO=([\d.]+)\s+YO=([\d.]+)\s+Width=([\d.]+)\s+Height=([\d.]+)(?:\s+Info=(\S+))?(?:\s+IndPiece=(\S+))?/i
      );
      if (xo) {
        cur.xoPanes.push({
          x: parseFloat(xo[1]),
          y: parseFloat(xo[2]),
          w: parseFloat(xo[3]),
          h: parseFloat(xo[4]),
          info: xo[5],
          indPiece: xo[6],
        });
        continue;
      }

      // Explicit cut coordinates (lowercase start, UPPERCASE end)
      const x1 = num(line.match(/\bx=([\d.]+)/)?.[1]);
      const y1 = num(line.match(/\by=([\d.]+)/)?.[1]);
      const x2 = num(line.match(/\bX=([\d.]+)/)?.[1]);
      const y2 = num(line.match(/\bY=([\d.]+)/)?.[1]);
      if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
        cur.cuttings.push({
          x1, y1, x2, y2,
          levcut: parseInt(line.match(/Levcut=(\d+)/)?.[1] ?? "0", 10),
          indPiece: line.match(/IndPiece=(\d+)/)?.[1] !== undefined
            ? parseInt(line.match(/IndPiece=(\d+)/)![1], 10) : undefined,
          wcut: line.match(/Wcut=(\d+)/)?.[1] !== undefined
            ? parseInt(line.match(/Wcut=(\d+)/)![1], 10) : undefined,
        });
      }
      continue;
    }

    /* ---- [Shape] ---- */
    if (section === "shape") {
      const idM = line.match(/^Id=(\d+)/i);
      if (idM) {
        shapeId = parseInt(idM[1], 10);
        continue;
      }
      // Coordinate line: x=<start> y=<start> X=<end> Y=<end> [L=<radius>] [C=<side>]
      const x1 = num(line.match(/^x=([\d.]+)/i)?.[1]);
      const y1 = num(line.match(/(?:^|\s)y=([\d.]+)/i)?.[1]);
      const x2 = num(line.match(/\bX=([\d.]+)/)?.[1]);
      const y2 = num(line.match(/\bY=([\d.]+)/)?.[1]);
      if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
        const radius = num(line.match(/\bL=([\d.]+)/)?.[1]);
        const side = num(line.match(/\bC=(-?[\d.]+)/)?.[1]);
        if (radius !== undefined && radius > 0) {
          cur.shapeArcs.push({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            radius,
            side: side === undefined ? 1 : side >= 0 ? 1 : -1,
            info: shapeId,
          });
        } else {
          cur.shapes.push({
            points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            info: shapeId,
          });
        }
      }
    }
  }

  // Second pass: also scan [Info] blocks for IMP/R01-style pane fallback
  const infoPanes = new Map<string, { w: number; h: number }>();
  let inInfo = false;
  let infoId: string | undefined;
  let infoW: number | undefined;
  let infoH: number | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      if (infoId && infoW !== undefined && infoH !== undefined) infoPanes.set(infoId, { w: infoW, h: infoH });
      inInfo = sec[1].toLowerCase() === "info";
      infoId = undefined; infoW = undefined; infoH = undefined;
      continue;
    }
    if (!inInfo) continue;
    const idM = line.match(/^Id=(\d+)/i);
    if (idM) {
      if (infoId && infoW !== undefined && infoH !== undefined) infoPanes.set(infoId, { w: infoW, h: infoH });
      infoId = idM[1]; infoW = undefined; infoH = undefined;
    }
    const sw = num(line.match(/^SheetWidth=([\d.]+)/i)?.[1]);
    const sh = num(line.match(/^SheetHeight=([\d.]+)/i)?.[1]);
    if (sw !== undefined) infoW = sw;
    if (sh !== undefined) infoH = sh;
    if (infoId && infoW !== undefined && infoH !== undefined) {
      infoPanes.set(infoId, { w: infoW, h: infoH });
      infoId = undefined; infoW = undefined; infoH = undefined;
    }
  }
  if (infoId && infoW !== undefined && infoH !== undefined) infoPanes.set(infoId, { w: infoW, h: infoH });

  /* ---------------------------------------------------------------- */
  /*  Build CutDocument from collected pattern blocks                   */
  /* ---------------------------------------------------------------- */

  const metadata = {
    vendor: config.vendor,
    formatVersion,
    sourcePath,
  };

  const sheets: CutPlan[] = [];
  let globalSeq = 0;

  for (let pi = 0; pi < patterns.length; pi++) {
    const pat = patterns[pi];
    const hdr = pat.header;

    const sheetWidth = num(hdr["Width"]) ?? 0;
    const sheetHeight = num(hdr["Height"]) ?? 0;

    if (!sheetWidth || !sheetHeight) {
      warnings.push(`Pattern ${pi + 1}: missing sheet dimensions`);
      continue;
    }

    const panes: Pane[] = [];
    const cuts: Cut[] = [];
    const seen = new Set<string>();

    // 1) Panes from XO/YO (primary, most reliable)
    for (const xo of pat.xoPanes) {
      const id = xo.info ?? xo.indPiece ?? `pane-${panes.length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      panes.push({
        id,
        bounds: { x: xo.x, y: xo.y, width: xo.w, height: xo.h },
        label: xo.info ? `Info ${xo.info}` : undefined,
      });
    }

    // 2) Cuts from [Cuttings] (primary)
    if (pat.cuttings.length > 0) {
      for (const c of pat.cuttings) {
        const stage = c.levcut > 0
          ? c.levcut
          : Math.abs(c.x1 - c.x2) < 0.01
            ? 1 // vertical cut = X level
            : Math.abs(c.y1 - c.y2) < 0.01
              ? 2 // horizontal cut = Y level
              : undefined;
        cuts.push({
          type: "line",
          points: [{ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }],
          sequenceIndex: globalSeq++,
          stage,
          stageLabel: stage ? stageLabel(config.vendor, stage) : undefined,
          paneRefs: c.indPiece !== undefined ? [String(c.indPiece)] : undefined,
        });
      }
    } else {
      // No [Cuttings]: guillotine tree → cuts + panes
      const tree = buildFromTree(pat.tree, sheetWidth, sheetHeight, config.vendor);
      for (const p of tree.panes) {
        if (!seen.has(p.id)) { seen.add(p.id); panes.push(p); }
      }
      cuts.push(...tree.cuts.map((c) => ({ ...c, sequenceIndex: globalSeq++ })));
      if (tree.cuts.length === 0 && tree.panes.length === 0) {
        warnings.push(`Pattern ${pi + 1}: no cut segments from guillotine tree`);
      }
    }

    // 2b) Tree panes also fill gaps when [Cuttings] exists but no XO/Info panes
    if (pat.cuttings.length > 0 && panes.length === 0 && pat.tree.length > 0) {
      const tree = buildFromTree(pat.tree, sheetWidth, sheetHeight, config.vendor);
      for (const p of tree.panes) {
        if (!seen.has(p.id)) { seen.add(p.id); panes.push(p); }
      }
    }

    // 3) Cuts from [Shape] sections
    for (const shape of pat.shapes) {
      for (let i = 0; i < shape.points.length - 1; i++) {
        cuts.push({
          type: "line",
          points: [shape.points[i], shape.points[i + 1]],
          sequenceIndex: globalSeq++,
          paneRefs: shape.info ? [String(shape.info)] : undefined,
        });
      }
    }

    // 3b) Arc cuts from [Shape] sections (L= radius, C= curvature side)
    for (const arc of pat.shapeArcs) {
      const center = arcCenter(arc);
      cuts.push({
        type: "arc",
        points: [arc.start, arc.end],
        center: center ?? undefined,
        radius: arc.radius,
        ccw: arc.side < 0,
        sequenceIndex: globalSeq++,
        paneRefs: arc.info !== undefined ? [String(arc.info)] : undefined,
      });
    }

    // 4) [Info] fallback panes (IMP files without XO/YO)
    for (const [id, dims] of infoPanes) {
      if (!seen.has(id)) {
        seen.add(id);
        panes.push({ id, bounds: { x: 0, y: 0, width: dims.w, height: dims.h } });
      }
    }

    sheets.push({
      id: `sheet-${pi + 1}`,
      label: hdr["GlassID"] || undefined,
      sheet: {
        width: sheetWidth,
        height: sheetHeight,
        trims: {
          top: num(hdr["TrimTop"]) ?? 0,
          right: num(hdr["TrimRight"]) ?? 0,
          bottom: num(hdr["TrimBottom"]) ?? 0,
          left: num(hdr["TrimLeft"]) ?? 0,
        },
      },
      panes,
      cuts,
      coordinateSemantics: {
        origin: "top-left",
        xAxis: "right",
        units: "mm",
      },
    });
  }

  if (sheets.length === 0) {
    return {
      status: "failed",
      warnings,
      error: "No valid pattern blocks found",
      detected: { vendor: config.vendor, formatId: config.formatId, confidence: "high", version: formatVersion },
    };
  }

  return {
    status: warnings.length ? "partial" : "ok",
    document: { metadata, sheets },
    warnings,
    detected: { vendor: config.vendor, formatId: config.formatId, confidence: "high", version: formatVersion },
  };
}
