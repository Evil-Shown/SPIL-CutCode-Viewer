# Vetromac ISO, Eagle / Linghua ISAC ISO, Disai PRJX and Chaoyang SCR NC

Four macro / CNC dialects that post-process an optimization straight to machine
code, so they carry a tool path rather than a cut list.

---

## Vetromac ISO (`.ISO`) — `vetromac-iso`

Samples: `ISO`, `ISO_Circle`, `ISO_Rectangle`, `ISO_Rectangle with rays`.

Macro-oriented ISO with two header styles that assign the same registers
(`M94` legacy, `G290` current):

| Register | Meaning | Unit |
|---|---|---|
| `VN210` | sheet number | — |
| `VN211` | sheet X | mm |
| `VN212` | sheet Y | mm |
| `VN215` | thickness | mm |
| `VN216` | wheel / tool selection | — |
| `VN230`, `VN231` | registration offsets | — |
| `VB2300` | orientation flag for the following `G0`/`G1` pair | — |
| `VB1401` | shape program selector | — |
| `VQ37`, `VQ38`, `VN90` | arc radius, angular parameter, direction | — |

```text
%
M12
{ Lastra L1 }
G290 VN211=1000
G290 VN212=1000
M5
{ TAGLIO }
M15
G201 VB1401 == 1 J L39      open a shape block
M13                       head select (scoring)
G290 VB2300=1
G0X3.000Y15.000Z0.000     positioning
M3                        cutting wheel down
G1X997.000Y15.000Z0.000    score
M5                        cutting wheel up
G201 VB1401 == 1 J L17     close the block
M6
M11
M2
```

`M3`/`M5` gate the wheel rather than the motion type, so a `G0` issued while the
wheel is down is itself a score. `M9` is the grinding wheel, `M13`/`M14` select
the head. A full circle is one `G2`/`G3` whose end point equals its start; the
centre then comes from `I`/`J` and the radius from `VQ37`.

---

## Eagle / Linghua ISAC ISO (`.ISO`) — `eagle-isac-iso`

Doc: `Instruction.pdf` v1.1.0. Perfect Cut with the ISAC post-processor.

```text
%
{strNomeProgetto="M:\Projects\190723-006CFL.OT5"}
{strFamiglia="006CFL"}
{:BOX=989;1204;530;637;4;Blitz Glass;313182 - 1;}
G59 X0 Y0                 reset translation origin
R4081=3660                sheet X
R4082=2440                sheet Y
R4083=8                   glass thickness
F60000                    feed rate, mm/min
R5056=1000                head pressure, millibar
L ROTOTRSON               roto-translation macro
M1011                     raise head
G00 X35.0 Y1.0 C(90.00+R1199)
M1010                     lower head
G01 X35.0 Y2439.0         score
M1011                     raise head
M02
```

`C(angle)` is the theoretical head angle and `R1199` the offset the
`ROTOTRSON` macro computes. Every `G01`/`G02`/`G03` bracketed by `M1010`…`M1011`
is a score; `G00` is always positioning.

`{:BOX=width;height;x;y;id;supplier;order}` — the first two fields are the
finished blank size, which matches the score sequence directly; `x`/`y` stay in
Perfect Cut's own frame and are only kept for reference.

Because the G-code carries no blank rectangles, the blanks are rebuilt from the
score sequence (`geometry/guillotine.ts` · `panesFromScoreSegments`), which
consumes the scores in machine order and splits the sheet wherever a line runs
edge to edge.

---

## Disai PRJX (`.sum` + `.dst`) — `disai-prjx`

Doc: `PRJX Machine Code Specification`, HBT Studio, Ver 2023.5.17.

A job is a folder `name.prjx` holding `name.sum` and one `name-00x.dst` per
pattern.

`name.sum`: `[SUMINFO]` (`CVERSION`, `DIMENSION`, `DATE`, `VONDER`),
`[PRJXINFO]` (`QUANTITY`, `DIMENX`, `PATTERNX`) and `[DIMEN1..n]`
(`WIDTH`, `HEIGHT`, `THICK`, `GCLR`, `QNTY`, `OTHERS`).

`name-00x.dst`:

- `[PATTERN]` `GID`, `PTNORDER`, `GDESCRIPTION`, `GSTRUCTURED`, `GCOATED`,
  `REPEAT`, `GCLR`, `GTHICKNESS`, `WIDTH`, `HEIGHT`, `TRIMLEFT`, `TRIMBOTTOM`,
  `BORDERTOP`, `BORDERRIGHT`
- `[SCHEME]` cut levels, each optionally followed by `C` (continuous),
  `D` (discontinuous), `DBx` (shape data) or `IBx` (piece block). Levels are
  `X Y Z U V W R S T`, alternating vertical/horizontal. Positions are relative
  to the previous cut of the same level and referenced to the pattern's zero
  point (`TRIMLEFT`, `TRIMBOTTOM`).
- `[BREAKLN]` `x1 y1 x2 y2` — the explicit break lines in absolute sheet
  coordinates. When present they are used directly, otherwise the `[SCHEME]`
  walk supplies the geometry.
- `[DBn]` shape details relative to the round box's lower-left corner:
  `x1 y1 x2 y2 C LS` line segment, `x1 y1 OX OY A R C CR` arc (`A > 0` is
  counter-clockwise), `OX OY R D CO` full circle.
- `[IBn]` piece detail: `ID`, `ORDER`, `PRJNAME`, `CUSTOMER`, `BARCODE`,
  `CLASSIFY` (1 product, 0 residue), `CTIMES`, `WIDTH`, `HEIGHT`, `ROTATE`,
  `DESCRIBE`, `RACK`, `GRIND*`, `NOTE1..9`.

> The specification states tenths of a millimetre, but the sample programs are
> plain millimetres (a 3660 × 2440 sheet with 500 mm pieces and `X2500.0` for the
> first subplate). The parser reads millimetres.

---

## Chaoyang SCR NC (`.src`) — `chaoyang-src`

Doc: `CHAOYANG SCR NC File Format 2016-1-12 - EN`.

```text
LIMITS 0,0 3660,2440      original sheet size, lower-left / upper-right
ZOOM A                    view command
COUNTS 30                 number of pieces after optimisation
#THICKNESS 5              glass thickness, mm
#PER 0.9797               utilisation ratio
#RECT 10.00,10.00 1010.00,1010.00 *1 $2.2   enclosing rectangle
#REM 1000.0*1000.0 CHAOYANG A23456B        nominal size, customer, order
#GRINDING 1.0             grind amount
#REM1 … #REM20 <text>     per-piece notes
LINE 500.000,2.000 500.000,2439.000         straight cut
ARC3C cx,cy sx,sy ex,ey                      counter-clockwise circle/arc
ARC2C cx,cy sx,sy ex,ey                      clockwise circle/arc
```

Coordinates are millimetres with the origin at the bottom-left corner named by
`LIMITS`. The optional position marker after `#RECT` is `*` (single piece),
`+n` (first of a specification), `-n` (last) or `n` (middle), and `$` introduces
the rack.

All four dialects declare `origin: "bottom-left"`, so `normalizeCutDocument`
flips them into the canonical top-left viewer space.