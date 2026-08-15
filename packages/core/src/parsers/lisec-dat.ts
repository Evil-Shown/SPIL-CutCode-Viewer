import type { CutPlan, ParseResult } from "../model/types.js";

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
]);

type BlockCut = { kind: "y" | "z" | "w"; value: number; bock?: string };

function inferPanes(
  width: number,
  height: number,
  blocks: Array<{ traverse: number; cuts: BlockCut[] }>
): CutPlan["panes"] {
  const panes: CutPlan["panes"] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const tx = block.traverse;
    for (const cut of block.cuts) {
      if (!cut.bock || seen.has(cut.bock)) continue;
      seen.add(cut.bock);

      if (cut.kind === "y") {
        // Horizontal cut — piece below the cut in Lisec bottom-left coords
        panes.push({
          id: cut.bock,
          bounds: { x: 0, y: 0, width: tx, height: cut.value },
          label: `Bock ${cut.bock}`,
        });
      } else if (cut.kind === "z" || cut.kind === "w") {
        // Vertical cut — piece left of the cut
        panes.push({
          id: cut.bock,
          bounds: { x: 0, y: 0, width: cut.value, height: tx },
          label: `Bock ${cut.bock}`,
        });
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
  const cuts: CutPlan["cuts"] = [];
  let seq = 0;

  const blocks: Array<{ traverse: number; cuts: BlockCut[] }> = [];
  let currentBlock: { traverse: number; cuts: BlockCut[] } | null = null;

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
      currentBlock.cuts.push({
        kind: "y",
        value: parseFloat(yBracket[1]),
        bock: yBracket[2],
      });
      continue;
    }

    const zBracket = line.match(/^\[Z_SCHNITT\]([\d.]+)(?:\s+\[BOCK_CODE\](\d+))?/i);
    if (zBracket && currentBlock) {
      currentBlock.cuts.push({
        kind: "z",
        value: parseFloat(zBracket[1]),
        bock: zBracket[2],
      });
      continue;
    }

    const wBracket = line.match(/^\[W_SCHNITT\]([\d.]+)(?:\s+\[BOCK_CODE\](\d+))?/i);
    if (wBracket && currentBlock) {
      currentBlock.cuts.push({
        kind: "w",
        value: parseFloat(wBracket[1]),
        bock: wBracket[2],
      });
      continue;
    }

    const bracket = line.match(/^\[([^\]]+)\](.*)$/);
    if (bracket) {
      const key = bracket[1].toUpperCase();
      const val = bracket[2].trim();
      switch (key) {
        case "LPL_BREITE":
          width = parseFloat(val);
          break;
        case "LPL_HOEHE":
          height = parseFloat(val);
          break;
        case "LPL_DICKE":
          thickness = parseFloat(val);
          break;
        case "LPL_GLASCODE":
          glassCode = val;
          break;
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

  // Build cuts from traverse blocks (Lisec: bottom-left origin, traverse = X extent of strip)
  for (const block of blocks) {
    const tx = block.traverse;

    // Main traverse cut — vertical line at traverse position, full sheet height
    cuts.push({
      type: "line",
      points: [{ x: tx, y: 0 }, { x: tx, y: height }],
      sequenceIndex: seq++,
    });

    for (const cut of block.cuts) {
      if (cut.kind === "y" || cut.kind === "w") {
        // Horizontal cut across the strip left of traverse
        cuts.push({
          type: "line",
          points: [{ x: 0, y: cut.value }, { x: tx, y: cut.value }],
          sequenceIndex: seq++,
          bockCode: cut.bock,
        });
      } else if (cut.kind === "z") {
        // Vertical cut within strip; Lisec Z cuts span from bottom to traverse height
        cuts.push({
          type: "line",
          points: [{ x: cut.value, y: 0 }, { x: cut.value, y: tx }],
          sequenceIndex: seq++,
          bockCode: cut.bock,
        });
      }
    }
  }

  const panes = inferPanes(width, height, blocks);

  const plan: CutPlan = {
    metadata: {
      vendor: "Lisec",
      glassType: glassCode,
      glassThickness: thickness,
      sourcePath,
    },
    sheet: { width, height },
    panes,
    cuts,
    coordinateSemantics: {
      origin: "bottom-left",
      xAxis: "right",
      yAxis: "down",
      units: "mm",
    },
  };

  return {
    status: warnings.length ? "partial" : "ok",
    plan,
    warnings,
    detected: { vendor: "Lisec", formatId: "lisec-dat", confidence: "high", matchedSignal: "[LPL_BREITE]" },
  };
}
