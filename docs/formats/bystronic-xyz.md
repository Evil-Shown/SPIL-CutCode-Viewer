# Bystronic PROG.XYZ

Doc: `PROG.XYZ.SOFT.V06_EN` (September 2005, version 6.0), valid for SMF(R),
VGS and Smart'cut. `FORMEN.V02_EN` is the printed *model catalogue* — it lists
the F1…F98 shape models and their geometric restrictions, but carries no file
syntax.

## Structure

ASCII and word-oriented. CR/LF/TAB/SP are ignorable (Tab. 3), so records are
recovered with a tokenizer, not by line, and two or three records may share one
physical line.

```text
(P2N1M3210.0/2550.0L20.0U20.0K20.0                        start char + header
[Bystronic Maschinen[R1P5Q10000003D300B2C3W01332404]]     comment
Y828.0B116C1001                                            data records
Y828.0B118C1001X1077.0                                    … two records, one line
Y760.0B177C1001F5DK0H300.0H300.0G300.0G200.0{[ESonder]}
F99S0X80Y50S50S1X320Y50S2X350Y80R30…S51S10X250Y100S99     free shape 99
)                                                          end char
```

A word is `Address` + `Value` (`X104.3`, `*2`, `B5000`). The same address letter
has a different meaning in each of the four namespaces (header, comment, data
record, supplementary text).

### Header (Tab. 4)

| Code | Meaning | Unit |
|---|---|---|
| `Q` | rack number for the store/transport system | `rrss` |
| `A` | maximum cutting speed | m/min |
| `P` | program number | — |
| `M` | raw-material size, X before the slash and Y after (`M6000/3210`) | mm |
| `N` | number of identical programs (`N = 1` in automatic production) | — |
| `U` | Y edge cut | mm |
| `L` | X edge cut | mm |
| `K` | shape edge cut | mm |
| `T` | X breaking dimension (unused) | mm |

### Comment (Tab. 5)

| Code | Meaning |
|---|---|
| `P` | consecutive optimization number |
| `Q` | material number with Bystore |
| `D` | glass thickness (1/100 mm) |
| `B` | pattern number (first is `0001`) |
| `C` | number of patterns in the optimization |
| `R` | edge-deletion device: `0` selectable, `1` always, `2` never |
| `W` | carriage changeover: 8 digits = physical carriage (2) + run (4) + virtual carriage (4) |
| `F` | load remaining sheet from compartment `nn` |
| `S` | save remaining sheet to compartment `nn` |
| `M` | remaining-sheet dimension `M1036.0/2550.0` |

### Data records (Tab. 6)

| Code | Meaning |
|---|---|
| `X` | subplate width (starts a new subplate, glass edge to glass edge) |
| `Y` | primitive height, bounded by the surrounding X cuts |
| `Z` | X-direction after-cut, bounded by the surrounding Y cuts |
| `V` | Y-direction after-cut |
| `W` | second X-direction after-cut |
| `*nn` | repetition factor (max 99) |
| `B` | rack number, 4 digits `d c cc` (destination / carriage / compartment) |
| `C` | auxiliary number, 4 digits `c a pp` (charge / ancillary glass code / positioning edge) |
| `F` | shape number: 1–49 straight models, 50–98 with radii, 99 free shape |
| `D` | rotate the shape 90° |
| `K` | edge-cut side flags: `1`=right `2`=top `3`=left `4`=bottom |
| `G`, `H`, `R` | sub-widths, sub-heights and radii inside a shape, positional (G1, G2, …) |
| `S` | record type inside a free shape 99 |
| `"` | switch to inches |

**X, Z and W are X-direction dimensions; Y and V are Y-direction dimensions, and
all values are relative** — "the zero point of a dimension is the end point of the
preceding dimension". An `X` word therefore terminates the subplate whose `Y`
records precede it and declares the width of the next one.

### Free shape 99 (`S` records)

Coordinates are absolute relative to the **bottom-left corner of the primitive**.

| S | Meaning |
|---|---|
| `S0` | start / new start point |
| `S1` | straight line |
| `S2` | arc counter-clockwise (`≤180°`) with radius `R` |
| `S3` | arc clockwise (`≤180°`) |
| `S10` | filling point for the breaking-diagram display |
| `S11` | glass length specification for sorting |
| `S50` / `S51` | lower / raise the tool head |
| `S54` | wait (brake the cutting bridge to 0) |
| `S56` / `S57` | second grinding speed on / off |
| `S58` / `S59` | breaking-bar gradient definition / completion |
| `S60` / `S61` | lower head, grinding only / cutting only |
| `S99` | end of shape |

Constraints: corners sharper than 2.2° must be split with `S51` + `S50`, arcs
must not exceed 180°, and radii are at least 4 mm. The contour must be closed
(start = end) for BYSHOW 2.

## Parser notes (`bystronic-xyz.ts`)

- Subplate widths are collected in a pre-pass (skipping free-shape blocks) and
  consumed one subplate at a time, because an `X` word declares the *next*
  subplate.
- Catalogue models (F1…F98) only carry their parameters in the file; the parser
  records them and warns instead of inventing a contour.
- Supplementary text `{…}` and the `{`/`}` braces are skipped.
- Stage labels from `STAGE_LABELS.BYSTRONIC`; shapes are stage 3, after-cuts 3–4.