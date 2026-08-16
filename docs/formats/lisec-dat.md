# Lisec DAT

## Detection
- `[LPL_BREITE]`, `[Y_SCHNITT]`, `[BOCK_CODE]`

## coordinateSemantics (native → viewer)
- Lisec native: **bottom-left** origin, Y increases upward
- Normalized to viewer: top-left, Y down, mm

## Guillotine model (verified against SPIL Opti production output)

Validated with real files where piece widths sum exactly to strip widths
(e.g. `128.7 + 116.4 = 245.1` — a full strip):

- **`[TRAVERE] w`** — strip **width**; strips accumulate from x = 0. The
  traverse cut is a vertical cross-cut at the strip's right edge, full sheet
  height. (Stage 1 / X.)
- **`[Y_SCHNITT] h`** — band **height**; bands stack from y = 0 (bottom)
  within the strip. The Y cut is horizontal across the strip at the band's
  top edge. A `[BOCK_CODE]` on the Y line marks a **full-strip-width piece**
  in that band. (Stage 2 / Y.)
- **`[Z_SCHNITT] w`** — piece **width** within the current band, laid
  left → right from the strip's left edge. The Z cut is vertical at the
  piece's right edge, spanning the band height. Bock = piece id. (Stage 3 / Z.)
- **`[W_SCHNITT] h`** — horizontal sub-cut inside the current Z piece, at
  height h above the band bottom. (Stage 4 / W.)

## Example

```
[TRAVERE]245.100          ; strip 3 = [347.9, 593.1]
[Y_SCHNITT]145.700        ; band 1 = y 0..145.7
[Z_SCHNITT]121.400 [BOCK_CODE]70   ; piece 70: x 347.9..469.3
[Z_SCHNITT]121.400 [BOCK_CODE]71   ; piece 71: x 469.3..590.7
[Y_SCHNITT]61.400         ; band 3 = y 254.0..315.4
[Z_SCHNITT]128.700 [BOCK_CODE]51   ; piece 51: x 347.9..476.6
[Z_SCHNITT]116.400 [BOCK_CODE]160  ; piece 160: x 476.6..593.0 (fills strip)
```

## Other sections

- `[LPL_BREITE]/[LPL_HOEHE]/[LPL_DICKE]/[LPL_GLASCODE]` — sheet/glass header
- `[LASER]` / `[RLASER]` — laser marks (`X=`, `Y=`, `LSR_ANGLE`, `LSR_MIRROR`)
- Unknown header keys emit a warning (partial status); `SFORM`/`SF_*` shape
  geometry is not yet extracted.
