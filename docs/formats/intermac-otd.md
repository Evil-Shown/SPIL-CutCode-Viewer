# Intermac OTD

## Detection
- `OTDCutVersion=` in header
- `[Pattern]` section with Width/Height

## coordinateSemantics
- Origin: top-left
- X: right, Y: down
- Units: mm (from `Dimension=mm` when present)

## Key fields
| Key | Meaning |
|-----|---------|
| Width / Height | Sheet size mm |
| X/Y/Z/W in [Cuttings] | Cut line endpoints |
| XO/YO/Width/Height | Pane rectangles |
| Info / IndPiece | Pane/piece ids |

## Version
- Branch on `OTDCutVersion` (v1 targets 2.8)
