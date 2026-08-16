# Hegla EDI (EDICUT)

Two variants in the wild:

1. **EDICUT** (`EDICUT021` first line): sheet dims from the `@@6000.03210.0`
   header (`@@<width>.0<height>.0`).
2. **Fixed-width / KASUN** (`[4CLR KASUNTX3660Y2440P01 …`): dims from
   `KASUNTX<w>Y<h>` in the first line; body lines `X… Y… Z…*n B…` are travel
   moves and Z cuts.

## Polygon blocks (piece outlines)

A block starts with a line beginning `(` and **continues on following lines
without the paren prefix** until a blank/non-segment line:

```
(X30.000000 Y0.000000 x630.000000 y0.000000
X630.000000 Y0.000000 x630.000000 y700.000000
X30.000000 Y700.000000 x30.000000 y0.000000
```

- Uppercase `X/Y` = segment **start** (absolute), lowercase `x/y` = **end**
  (absolute). Consecutive segments chain into the piece outline; repeated
  endpoints are arc/tessellation joins and are deduplicated for the polygon.
- A leading `L<radius>` token marks an arc segment (approximated as a line
  segment in v0.2).
- Each block yields one pane (bounding box + `polygon`) plus its outline cut
  segments.

## Travel moves

`X… Y… [F#] [B#]` lines outside polygons chain into cut segments; identical
consecutive points are skipped.
