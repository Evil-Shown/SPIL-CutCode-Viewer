import type { Cut, CutDocument, CutPlan, Pane, ParseResult } from "../model/types.js";
import { stageLabel } from "../model/types.js";

const KNOWN_HEADER_KEYS = new Set([
  "BATCH",
  "LPL_AUF",
  "LPL_BREITE",
  "LPL_HOEHE",
  "LPL_DICKE",
  "LPL_TYPE",
  "LPL_GLASCODE",
  "LPL_BV",
  "LPL_BU",
  "LPL_SORTE",
  "LPL_BOCK",
  "SCHLEIFMODUS",
  "SFORM",
  "SF_ID",
  "SF_B",
  "SF_H",
]);

type BlockCut = { kind: "y" | "z" | "w"; value: number; bock?: string };

/**
 * Reconstruct pane rectangles from the Lisec guillotine tree.
 *
 * Lisec uses bottom-left origin, Y-up:
 *   - TRAVERE = vertical cross-cut at X = traverse (full sheet height)
 *   - Y_SCHNITT = horizontal cut within strip left of traverse
 *   - Z_SCHNITT = vertical cut within strip (from bottom to traverse height)
 *   - W_SCHNITT = horizontal cut within Z-sub-strip
 *
 * Panes are the glass pieces defined by adjacent cuts sharing a bock code.
 */
function rebuildPanes(
  sheetW: number,
  sheetH: number,
  blocks: Array<{ traverse: number; cuts: BlockCut[] }>
): Pane[] {
  // Collect all cut positions sorted
  const traverses = [0, ...blocks.map((b) => b.traverse), sheetW];
  const panes: Pane[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const left = traverses[bi]!;
    const right = traverses[bi + 1]!;
    const stripWidth = right - left;

    // Collect horizontal cut positions within this strip
    const yCuts = block.cuts
      .filter((c) => c.kind === "y" || c.kind === "w")
      .map((c) => c.value)
      .sort((a, b) => a - b);

    const yPositions = [0, ...yCuts, sheetH];

    for (let yi = 0; yi < yCuts.length; yi++) {
      const yBot = yPositions[yi]!;
      const yTop = yPositions[yi + 1]!;
      const bandHeight = yTop - yBot;

      // Find bock codes associated with this horizontal band
      const bandCuts = block.cuts.filter(
        (c) => (c.kind === "y" || c.kind === "w") && Math.abs(c.value - yTop) < 0.01 && c.bock
      );
      if (bandCuts.length > 0) {
        const bock = bandCuts[0]!.bock!;
        panes.push({
          id: bock,
          bounds: { x: left, y: yBot, width: stripWidth, height: bandHeight },
          label: `Bock ${bock}`,
        });
      }

      // Z cuts within this band — split into vertical sub-panes
      const zCuts = block.cuts
        .filter((c) => c.kind === "z" && c.bock)
        .sort((a, b) => a.value - b.value);
      if (zCuts.length > 0) {
        const zPositions = [left, ...zCuts.map((z) => z.value), right];
        for (let zi = 0; zi < zCuts.length; zi++) {
          const zLeft = zPositions[zi]!;
          const zRight = zPositions[zi + 1]!;
          panes.push({
            id: zCuts[zi]!.bock!,
            bounds: { x: zLeft, y: yBot, width: zRight - zLeft, height: bandHeight },
            label: `Bock ${zCuts[zi]!.bock}`,
          });
        }
      }
    }
  }

  return panes;
}

export function parseLisecDat(content: string, sourcePath: string): ParseResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  let width = 0;
  let height = 0;
  let thickness: number | undefined;
  let glassCode: string | undefined;
  const cuts: Cut[] = [];
  let seq = 0;

  const blocks: Array<{ traverse: number; cuts: BlockCut[] }> = [];
  let currentBlock: { traverse: number; cuts: BlockCut[] } | null = null;
  const laser: CutPlan["laser"] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const travereBracket = line.match(/^\[TRAVERE\]([\d.]+)$/i);
    if (travereBracket) {
      currentBlock = { traverse: parseFloat(travereBracket[1]), cuts: [] };
      blocks.push(currentBlock);
      continue;
    }

    const yBracket = line.match(/^\[Y_SCHNITT\]([\d.]+)(?:\s+\[BOCK_CODE\](\d+))?/i);
    if (yBracket && currentBlock) {
      currentBlock.cuts.push({ kind: "y", value: parseFloat(yBracket[1]), bock: yBracket[2] });
      continue;
    }

    const zBracket = line.match(/^\[Z_SCHNITT\]([\d.]+)(?:\s+\[BOCK_CODE\](\d+))?/i);
    if (zBracket && currentBlock) {
      currentBlock.cuts.push({ kind: "z", value: parseFloat(zBracket[1]), bock: zBracket[2] });
      continue;
    }

    const wBracket = line.match(/^\[W_SCHNITT\]([\d.]+)(?:\s+\[BOCK_CODE\](\d+))?/i);
    if (wBracket && currentBlock) {
      currentBlock.cuts.push({ kind: "w", value: parseFloat(wBracket[1]), bock: wBracket[2] });
      continue;
    }

    const bracket = line.match(/^\[([^\]]+)\](.*)$/);
    if (bracket) {
      const key = bracket[1].toUpperCase();
      const val = bracket[2].trim();
      switch (key) {
        case "LPL_BREITE": width = parseFloat(val); break;
        case "LPL_HOEHE": height = parseFloat(val); break;
        case "LPL_DICKE": thickness = parseFloat(val); break;
        case "LPL_GLASCODE": glassCode = val; break;
        case "LASER":
        case "RLASER": {
          // Laser mark: [LASER] X=100 Y=50 [LSR_ANGLE=0] [LSR_MIRROR=0] ...
          const lx = parseFloat(val.match(/\bX=([\d.]+)/)?.[1] ?? "");
          const ly = parseFloat(val.match(/\bY=([\d.]+)/)?.[1] ?? "");
          const la = parseFloat(val.match(/LSR_ANGLE=(-?[\d.]+)/)?.[1] ?? "");
          if (Number.isFinite(lx) && Number.isFinite(ly)) {
            laser.push({
              x: lx,
              y: ly,
              angle: Number.isFinite(la) ? la : undefined,
              mirror: /LSR_MIRROR=1/.test(val),
            });
          }
          break;
        }
        default:
          if (!KNOWN_HEADER_KEYS.has(key)) {
            warnings.push(`Unknown Lisec key: ${key}`);
          }
      }
      continue;
    }
  }

  if (!width || !height) {
    return {
      status: "failed",
      warnings,
      error: "Missing LPL_BREITE / LPL_HOEHE",
      detected: { vendor: "Lisec", formatId: "lisec-dat", confidence: "high" },
    };
  }

  // Build cuts from traverse blocks (Lisec native: bottom-left origin, Y-up)
  for (const block of blocks) {
    const tx = block.traverse;

    // Main traverse cut — vertical at traverse position, full sheet height
    cuts.push({
      type: "line",
      points: [{ x: tx, y: 0 }, { x: tx, y: height }],
      sequenceIndex: seq++,
      stage: 1,
      stageLabel: stageLabel("LISEC", 1),
    });

    for (const cut of block.cuts) {
      if (cut.kind === "y" || cut.kind === "w") {
        cuts.push({
          type: "line",
          points: [{ x: 0, y: cut.value }, { x: tx, y: cut.value }],
          sequenceIndex: seq++,
          stage: 2,
          stageLabel: stageLabel("LISEC", 2),
          bockCode: cut.bock,
        });
      } else if (cut.kind === "z") {
        cuts.push({
          type: "line",
          points: [{ x: cut.value, y: 0 }, { x: cut.value, y: tx }],
          sequenceIndex: seq++,
          stage: 3,
          stageLabel: stageLabel("LISEC", 3),
          bockCode: cut.bock,
        });
      }
    }
  }

  const panes = rebuildPanes(width, height, blocks);

  return {
    status: warnings.length ? "partial" : "ok",
    document: {
      metadata: { vendor: "Lisec", glassType: glassCode, glassThickness: thickness, sourcePath },
      sheets: [{
        id: "sheet-1",
        laser: laser.length > 0 ? laser : undefined,
        sheet: { width, height },
        panes,
        cuts,
        coordinateSemantics: { origin: "bottom-left", xAxis: "right", units: "mm" },
      }],
    },
    warnings,
    detected: { vendor: "Lisec", formatId: "lisec-dat", confidence: "high", matchedSignal: "[LPL_BREITE]" },
  };
}
