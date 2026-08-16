# Intermac-family formats (Intermac OTD, Optima R01, Macotech IMP)

Shared INI-style layout engine (`intermac-family.ts`) configured per vendor:

| Format | Sections | Version key |
|--------|----------|-------------|
| Intermac OTD | `[Header] [Signature] [Pattern] [Cuttings] [Info] [Shape]` | `OTDCutVersion` |
| Optima R01 | `[OPT_Header] [OPT_Signature] [OPT_Pattern] [Cuttings] [Info] [Shape]` | `OPTCutVersion` |
| Macotech IMP | `[PARAMETERS] [FAM_*] [SHEETS] [PIECES] + OPT_* pattern sections` | `OPTCutVersion` |

`[OPT_*]` prefixes are stripped, so both share one code path.

## Per-[Pattern] sheets

Every `[Pattern]` / `[OPT_Pattern]` block is one sheet (`CutPlan`). A file
with 10 patterns produces a 10-sheet `CutDocument`. Each pattern carries its
own `Width`/`Height`/`Trim*` header and cut data.

## Cut sources (in priority order)

1. **`[Cuttings]`** — explicit segments `x= y=` (start, lowercase) `X= Y=`
   (end, uppercase). `Levcut=n` maps to stage n; when absent, stage is
   inferred from orientation (vertical → 1/X, horizontal → 2/Y).
2. **Guillotine tree** (fallback when no `[Cuttings]`) — indented
   `X=` / `Y=` / `Z=` / `W=` lines under `[Pattern]`, where `Info=n` marks a
   piece. The tree is walked with a remaining-space stack: X/Z take from the
   left of the remaining area, Y/W from the bottom; nodes with `Info` emit
   pane rectangles and cut lines with stage 1–4.

## Pane sources (in priority order)

1. **`XO= YO= Width= Height= [Info=] [IndPiece=]`** lines in `[Cuttings]`.
2. Guillotine tree nodes with `Info=` (also fills in when `[Cuttings]`
   exists but produced no panes).
3. **`[Info]` blocks** — `Id=`, `SheetWidth=`, `SheetHeight=` (piece sizes;
   placed at origin as a last resort). Keys arrive on separate lines, so the
   parser persists them across lines within a block.

## Encoding

Macotech `.IMP` files in the wild are frequently **UTF-16LE** (Perfect Cut 6
`dati/` corpus). All files must be read as bytes and passed through
`decodeCutcodeBytes`.
