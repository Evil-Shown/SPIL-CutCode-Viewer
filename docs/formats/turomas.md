# Turomas File Format V30 (`.R01`) and V40 (JSON)

Two generations of the same optimization output, both produced by Turomas for
its monolithic and laminated tables. Docs: `002_TUROMAS_FILE_FORMAT_V30_V2_EN`,
`001_V40_STRUCTURE_AND_FIELDS_DESCRIPTION_V5_EN`, `002_V40_KEY_FEATURES_V4_EN`
and `003_V40_LOWE_DETAILS_V1_EN`.

## V30 — `.R01` (`turomas-r01`)

Line-oriented ASCII, one plan block per sheet.

```text
P001                                  plan number
/Ott. CNC\M0000022.r01 P.1 N.1 BY OPTIMA  Ver 2.0   comment
N01                                   repetitions
H32100                                sheet height  (tenths of a millimetre)
L60000                                sheet length  (tenths of a millimetre)
MATERIAL:10CLMGUARD_N70               material code
x350.000                              vertical trim
y350.000                              horizontal trim
DS8 … ES                              shape description
X37448.000                            cuts description, level + position
Y30788.000*CS10Q2,"CUST","ORD","RACK","ID","NOTE"
SC … EP                               optional score points (optimised track)
LE … EP                               low-E / TPF deletion track
```

### Cuts description

`Level+Position[,Repetitions]` is a standard cut;
`Level+Position*CS<n>Q<1|2>,"Customer","Order","Rack","Id","Note"` is a
piece-conforming cut. Positions are **tenths of a millimetre**, relative to the
preceding cut of the same level, referenced to the bottom-left of the plan.

Levels are ten deep: `X Y Z V W Q R S T U`, alternating vertical/horizontal.

### Shapes description

`DS<id>` … `SX<w>` `SY<h>` … `ES` with

| Record | Meaning |
|---|---|
| `G <x> <y>` | rapid, no cutting head |
| `G1 <x> <y>` | straight movement, head applied |
| `G2 <x> <y> I<i> J<j> R<r>` | clockwise arc |
| `G3 …` | anticlockwise arc |

Coordinates are local to the shape's enclosing rectangle; `I/J` may be absolute
or relative to the previous point and is resolved geometrically.

`CS<id>Q<1|2>` in the cuts description selects the shape (`1` as described,
`2` rotated 90° clockwise).

### Optional sections

- `SC … EP` — the time-optimised score track in **absolute** sheet coordinates
  (also tenths of a millimetre), including `CS<n>X<x>Y<y>Q<o>` jumps to a placed
  shape. Emitted as stage 4.
- `LE … EP` — Low-E / TPF deletion, one `CS<n>X<x>Y<y>Q<o>` per shape to grind.
  Emitted as stage 6.

## V40 — JSON (`turomas-v40`)

```json
{
  "name": "LE",
  "metadata": { "version": "1.0", "creator": "Turomas", "units": "dmm" },
  "pieces":   [ { "id": 1, "Xsize": 9600, "Ysize": 19000,
                  "workProcessesTrack": [ { "process": "CUT", "track": [] } ],
                  "customer": "…", "order": "…", "rack": "…",
                  "customFields": { "note": "…" } } ],
  "remnants": [ { "id": 3, "Xsize": 6000, "Ysize": 9000, "isReusable": false } ],
  "plans":    [ { "id": 1, "Xsize": 30000, "Ysize": 30000, "thickness": 40,
                  "materialCode": "FL4", "workProcesses": ["CUT"],
                  "Xtrim": 200, "Ytrim": 200,
                  "placement": [ { "id": 1, "type": "piece",
                                   "x": 0, "y": 0, "rotation": 0 } ] } ]
}
```

`units` is `dmm` (tenths of a millimetre, the default) or `mm`. `process` is one
of `CUT`, `LE`, `TPF`, `LAB-PRINT`; `track` items are `G0`, `G1`, `G2`, `G3`
with `x`, `y` and, for arcs, `i`, `j`, `r`.

Unlike V30 the cut sequence is not written out, so the guillotine order is
recovered from the placement rectangles; only shape tracks become real cuts.

## Parser notes

- `geometry/guillotine.ts` · `walkGuillotine` replays the level list; children
  subdivide the rectangle their parent detached.
- `geometry/guillotine.ts` · `decomposeRects` rebuilds the sequence from the
  V40 placements.
- Stage labels come from `STAGE_LABELS.TUROMAS` (`X Y Z V W Q R S T U`).