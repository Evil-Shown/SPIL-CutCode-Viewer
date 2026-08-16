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

  // Build cuts + panes from the traverse blocks.
  //
  // Verified semantics (bottom-left origin, Y-up) — validated against real
  // production files where piece widths sum exactly to strip widths:
  //   TRAVERSE w  = strip WIDTH; strips accumulate from x = 0
  //   Y_SCHNITT h = band HEIGHT; bands stack from y = 0 within the strip.
  //                 A BOCK on the Y line = one full-strip-width piece.
  //   Z_SCHNITT w = piece WIDTH within the band, laid left→right from the
  //                 strip's left edge. A BOCK identifies the piece.
  //   W_SCHNITT h = height of a horizontal sub-cut inside the current piece.
  const panes: Pane[] = [];
  let xCursor = 0;

  for (const block of blocks) {
    const stripLeft = xCursor;
    const stripRight = xCursor + block.traverse;
    xCursor = stripRight;

    // Traverse cross-cut: vertical, full sheet height
    if (stripRight < width - 0.01 || Math.abs(stripRight - width) < 0.01) {
      cuts.push({
        type: "line",
        points: [{ x: stripRight, y: 0 }, { x: stripRight, y: height }],
        sequenceIndex: seq++,
        stage: 1,
        stageLabel: stageLabel("LISEC", 1),
      });
    }

    let bandBottom = 0;
    let bandHeight = 0;
    let zCursor = stripLeft;
    let curPiece: { left: number; width: number; bottom: number; height: number } | null = null;

    for (const cut of block.cuts) {
      if (cut.kind === "y") {
        bandBottom += bandHeight; // close previous band
        bandHeight = cut.value;
        zCursor = stripLeft;
        curPiece = null;
        const yTop = bandBottom + bandHeight;
        if (yTop < height - 0.01) {
          cuts.push({
            type: "line",
            points: [{ x: stripLeft, y: yTop }, { x: stripRight, y: yTop }],
            sequenceIndex: seq++,
            stage: 2,
            stageLabel: stageLabel("LISEC", 2),
            bockCode: cut.bock,
          });
        }
        if (cut.bock) {
          // Bock on the Y line: a full-strip-width piece in this band
          panes.push({
            id: cut.bock,
            bounds: { x: stripLeft, y: bandBottom, width: block.traverse, height: cut.value },
            label: `Bock ${cut.bock}`,
          });
        }
      } else if (cut.kind === "z") {
        const pieceLeft = zCursor;
        zCursor += cut.value;
        const bandTop = bandBottom + bandHeight;
        if (zCursor < stripRight - 0.01) {
          cuts.push({
            type: "line",
            points: [{ x: zCursor, y: bandBottom }, { x: zCursor, y: bandTop }],
            sequenceIndex: seq++,
            stage: 3,
            stageLabel: stageLabel("LISEC", 3),
            bockCode: cut.bock,
          });
        }
        if (cut.bock) {
          panes.push({
            id: cut.bock,
            bounds: { x: pieceLeft, y: bandBottom, width: cut.value, height: bandHeight },
            label: `Bock ${cut.bock}`,
          });
        }
        curPiece = { left: pieceLeft, width: cut.value, bottom: bandBottom, height: bandHeight };
      } else if (cut.kind === "w") {
        // Horizontal sub-cut inside the current piece
        if (curPiece) {
          const y = curPiece.bottom + cut.value;
          if (y < curPiece.bottom + curPiece.height - 0.01) {
            cuts.push({
              type: "line",
              points: [{ x: curPiece.left, y }, { x: curPiece.left + curPiece.width, y }],
              sequenceIndex: seq++,
              stage: 4,
              stageLabel: stageLabel("LISEC", 4),
              bockCode: cut.bock,
            });
          }
          if (cut.bock) {
            panes.push({
              id: cut.bock,
              bounds: { x: curPiece.left, y: curPiece.bottom, width: curPiece.width, height: cut.value },
              label: `Bock ${cut.bock}`,
            });
          }
        }
      }
    }
  }

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
