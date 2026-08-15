# Lisec DAT

## Detection
- `[LPL_BREITE]`, `[Y_SCHNITT]`, `[BOCK_CODE]`

## coordinateSemantics (native → viewer)
- Lisec native: **bottom-left** origin, Y increases upward
- Normalized to viewer: top-left, Y down, mm

## Traverse blocks
Each `[TRAVERE]` starts a cut sequence:
- **TRAVERE** = X position of the main traverse (vertical) cut; also the width of the active strip `[0, traverse]`
- **Y_SCHNITT** / **W_SCHNITT** = horizontal cut at Y across the strip
- **Z_SCHNITT** = vertical cut at X from bottom to traverse height
- **BOCK_CODE** = rack/piece identifier for the offcut below or left of that cut

## Key header fields
| Key | Meaning |
|-----|---------|
| LPL_BREITE / LPL_HOEHE | Sheet width / height (mm) |
| LPL_DICKE | Glass thickness |
| BATCH | Batch number |
| TRAVERE | Traverse strip width / traverse cut X |
| Y_SCHNITT | Horizontal cut at Y |
| Z_SCHNITT | Vertical cut at X |
| BOCK_CODE | Rack code |
