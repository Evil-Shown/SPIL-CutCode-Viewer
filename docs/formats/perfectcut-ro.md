# Perfect Cut RO (`.PGM`, `.LST`) and Macotech/Perfect Cut `.IMP`

## `.PGM` — `perfectcut-pgm`

Used by Lampo CSM and the LAMPO Simple / Curved Shapes jobs, written by Perfect
Cut's RO (Ricerca Operativa) post-processor. Line-oriented, millimetres, origin
bottom-left, with trailing `- explanation` comments allowed on any record.

```text
P010                                  plan number
/Ott. LAMPES  by Perfect Cut - RO     comment
N01                                   repetitions
H2440.00 - height                    sheet height
L3660.00 - width                     sheet length
T 6.00 - thickness                   glass thickness
R 00 - ambiguous                     machine flag
DS 1                                  shape definition
G X 629.81 Y 1.00                    rapid, no cutting head
G1 X 999.00 Y 400.10                  straight score
ES
G X 20.00 Y 1.00                      free tool path outside any shape
G1 X 20.00 Y 2439.00
CS1 X 300.00 Y 420.00 A90             place shape 1, rotated 90°
```

- `G` is positioning, `G1` a straight score, `G2`/`G3` arcs with `I`/`J`/`R`.
- Coordinates outside a `DS` block are the absolute tool path — the scores
  themselves, so no guillotine reconstruction is needed.
- `DS <n>` … `ES` holds a shape path in coordinates local to the shape; optional
  `SX`/`SY` give the enclosing rectangle.
- `CS<n> X <x> Y <y> A<0|90>` instances that shape, with the angle applied
  about the placement point.

## `.LST` — `perfectcut-pgm-index`

```text
PGM LAAKE001
PGM B4071_4CLFL001
```

An index of the sibling `.PGM` programs. It carries no geometry, so it parses as
`partial` and lists the referenced files in `metadata.operator`.

## `.IMP` — `macotech-imp`

Doc: `IMPORT_RO_ENG` (R.O. Srl / Perfect Cut "Import ASCII File"). Two flavours
exist:

1. **Program files** with `[Pattern]` layouts, `[Cuttings]`, `[Shape]` and
   `[Info]` sections. Handled by the shared Intermac-family reader.
2. **Project definitions** with `[PARAMETERS]`, `[FAM_<xxx>]`, `[SHEETS]` and
   `[PIECES]` and **no** layout at all. `Only the PIECES section is essential.`

For the second flavour the parser surfaces the sheet stock and warns:

```text
[PARAMETERS]
MODO_MISURA=1

[FAM_F4]
SPESSORE=4
DESCRIZIONE=FLOATING 4

[SHEETS]
N1=FAM=F4;B=3210;H=2400;RX=10;RY=10;BX=10;BY=10;DZ=10;DISP=100;AV=0

[PIECES]
N1=;N=10;B=700;H=600;CL=CAIO;ORD=433;FAM=F4/12/FL5;MOL=0-0-0-1
N2=SAG=C:\…\FIORE.DXF[OFFSET=1|BORDER=10,10,10,10];N=10;B=800;H=450
```

`MODO_MISURA` is the unit: `1` mm, `0` inch, `3` Taiwan inch, `5` cm, `6` foot,
`7` Taiwan foot. `[PIECES]` fields are positional and `;`-separated, and the
`_COMPONENT<m>` lines add staggered double-glazing components.

Grinding is selected with `MOL` (`""` all sides, `B` the two bases, `H` the two
heights, `UB`/`UH` one base/height, `UBH`, `BBH`, `BHH`), shapes with `SAG` plus
`[...]` method parameters (`SHAPE_NAME`, `MIRROR`, `OFFSET`, `BORDER`, `TRIM`,
`SCALE`).