# Bottero OPT (hex token stream)

One bracketed line per piece; coordinates are **hex ticks × 1/16 mm**
(verify against `PERF-Clean` decompile `bottero/CCNBottero` `ConvUnit` if
renders drift).

```
[P1H1R8EF8R5F50t5x258y258X1BE4Y47FEYFB4ZC62...]
```

## Token grammar (heuristic, case-sensitive)

- `P<n>` piece number, `H<n>` height class, `R<code>` rack id
  (short — parsed non-greedily up to the next lowercase command).
- `t<n>` tilt/quality marker; after it `x<dec>y<dec>` are **decimal mm**
  piece dimensions — deliberately excluded from the hex token class.
- `X` / `Z` + hex → x-axis tick; `Y` / `W` + hex → y-axis tick. Successive
  X/Y pairs form the cut polyline.
- `C` (arc), `Q`, `R` tokens are recognized but skipped (arcs not decoded
  in v0.2).

## Notes (`bottero-opt.ts`)

- Token regex is **uppercase-only** `[XYZWQRC][0-9A-F]+` — the old
  case-insensitive regex ate the lowercase decimal dims as bogus hex points.
- Sheet size = max decoded coordinate (or the first `xNyN` decimal pair).
- Each piece yields a pane at origin (the format carries no sheet-space
  placement) plus its polyline cuts with `rackCode`/`paneRefs`.
