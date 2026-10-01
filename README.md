# SPIL CutCode Simulator

Modern desktop simulator for multi-vendor glass cutcode files — the replacement
for the legacy qiewer / Perfect Cut viewer.

## Stack

- **Tauri 2** + **React 19** + **TypeScript** + Tailwind + Zustand
- `@spil/cutcode-core` — parsers, format detection, encoding, normalization
- `@spil/cutcode-cli` — `cutcode-batch` corpus regression tool

## Supported formats

| Vendor | Extension | Status |
|--------|-----------|--------|
| Intermac | `.OTD` | Full parser: multi-sheet, cuttings, guillotine tree, trims |
| Lisec | `.DAT` | Full parser: traverse tree, pane reconstruction, stages |
| Bottero | `.opt` | Hex-token parser (1/16 mm ticks), rack codes |
| Optima | `.r01` | Full parser (OPT_* Intermac family) |
| Optima | `.otv` | OptiTV JSON: multi subProject/layout, rotation |
| Macotech | `.imp` | OPT_* family, `[SHEETS]`/`[PIECES]` stock projects, UTF-16LE |
| Hegla | `.edi` | EDICUT + fixed-width variants, polygon piece outlines |
| Bavelloni | `.cut` / `.cni` | NUM ISO: REV 372 SR, Flexium Plus, SYNCRO |
| Glaston | `.cut` / `.cni` | NUM SYNCRO_LOWE, Low-E grind and last-cut records |
| Turomas | `.r01` | V30 dialect: 10 levels, DS/CS shapes, SC score track, LE grind |
| Turomas | `.json` | V40 dialect: placements, remnants, per-piece shape tracks |
| Perfect Cut | `.pgm` / `.lst` | RO cutcode: absolute score path, DS/CS shapes, program index |
| Bystronic | `.xyz` | PROG.XYZ v6.0: header/comment/data words, subplates, free shape 99 |
| Vetromac | `.iso` | Macro ISO: VN211/VN212, `G201` shape blocks, wheel-gated motion |
| Eagle / Linghua | `.iso` | ISAC ISO: R4081/R4082, M1010/M1011 score path, BOX metadata |
| Disai / HBT | `.dst` / `.sum` | PRJX: `[SCHEME]` levels, `[BREAKLN]` lines, `[DBn]`/`[IBn]` blocks |
| Chaoyang | `.src` | SCR NC: `LIMITS`, `#RECT`, `#REM`, `LINE`, `ARC2C`/`ARC3C` |
| Perfect Cut | `.xml` | Job report XML (statistics only) |
| DXF | `.dxf` | Native import: LINE / LWPOLYLINE / CIRCLE / ARC entities |

Format-by-format notes live in [`docs/formats`](docs/formats): `turomas.md`,
`bystronic-xyz.md`, `machine-iso.md`, `perfectcut-ro.md`,
`intermac-family.md`, `bottero-opt.md`, `hegla-edi.md`, `lisec-dat.md`,
`optima-otv.md`.

Encodings: UTF-8, UTF-16LE/BE (BOM + NUL-heuristic, both byte orders),
Windows-1252 fallback — files are read as bytes and decoded before parsing.

When detection is weak or a shared extension is ambiguous (`.iso`, `.r01`,
`.json`, `.imp`, `.cut`), the parser retries the other candidates and keeps the
best outcome, so a mislabelled file still opens. A *confident* format that
reports a specific error (e.g. "this `.IMP` is a glass-family config") is never
overridden. `DetectResult.attempts` records what was tried.

## Simulator features

- **Canvas**: pan (drag), cursor-anchored zoom (0.35×–3.5×), double-click
  fit, adaptive rulers + grid (50/250 mm), trim zone, sheet dimensions
- **Multi-sheet**: sheet tabs for multi-pattern files
- **Selection**: click cuts (full-polyline hit testing) and panes
  (rect + polygon); hover highlighting
- **Layers**: grid, rulers, labels, direction arrows, stage colors (X/Y/Z/W…),
  pane dimensions
- **Arcs & shapes**: Intermac `[Shape]` arcs (L= radius / C= side) render as
  true curves on canvas, minimap, PNG and SVG
- **Cut-sequence playback**: sim console with play/pause, cut stepping, scrubber, cycle time, yield/waste, and head phase
  (1×/2×/4×/8×/16×), loops until paused. `Space` play · `[` `]` step · `Home` reset
- **Measure tool**: click two points for live distance in mm
- **Laser marks**: Lisec `[LASER]` / `[RLASER]` marks render on the sheet
- **Validation panel**: zero-length cuts, out-of-bounds (±0.5 mm), cuts running
  into the trim border, duplicate cuts, crossing cuts, kerf proximity, invalid
   arcs and open pane contours — grouped by severity and code, with a
  per-vendor kerf minimum, click to zoom to the issue. Crossings between
  *different work processes* (`CUT` vs `LE`/Low-E) are not reported: those
  tracks overlap on purpose.
- **Minimap (RADAR)**: overview + viewport rectangle, click to navigate
- **Status bar**: live cursor position in mm, zoom level, pane/cut counts
- **Inspector**: file metadata, sheet info, searchable pane list, per-stage
  cut/length breakdown, cut details (stage, bock code, coordinates, process),
  parser warnings
- **Exports**
  - PNG and SVG (stage-coloured, trim border, laser marks, pane labels)
  - printable sheet report with the full pane list
  - **DXF R12** — sheet + trim on `SHEET`/`TRIM`, panes on `PANES`, cuts on
    `CUT_<stage>` layers, laser marks as `POINT`
  - **Cut schedule CSV** — one row per cut in machine order, with stage,
    length and endpoints
  - **Pane list CSV** and **stage breakdown CSV**
  - **JSON** — full document plus the derived schedule
- **Theme**: light (default) + dark, persisted
- Drag & drop file open, recent files, bundled sample fixtures
  (work in browser dev mode and in the packaged app)
- Keyboard: `Space` play/pause · `[`/`]` or arrows step cut · `Home` reset · `F` fit · `+`/`−` zoom · `Esc` deselect
- **Graphics**: high-end GPUs start at full 3D quality. Low-end PCs paint the first 3D frame at ~70% (no AA, 1.4× DPR, 1024 shadows), then immediately rebuild at 100% — same look as a high-end PC.

## Development

```powershell
npm install
npm test            # core test suite (122 tests)
npm run typecheck   # all workspaces
npm run build       # core + cli + desktop
npm run dev         # desktop app in browser (Vite)
```

### Tauri desktop

```powershell
npm run tauri dev     # dev app window
npm run tauri build   # packaged installer
```

### Batch corpus regression

```powershell
npm run batch -- --root .\fixtures --out report.json --format table
npm run batch -- --root .\fixtures --out report.json --baseline report.json --strict
```

`--baseline` compares against a previous report and exits non-zero on
regressions (status downgrades, lost panes/cuts) — use it as a CI gate.

Additional passes:

```powershell
# run the geometry validator over every file and print issue counts
npm run batch -- --root .\fixtures --out report.json --validate

# fail the run when any sheet has a validation error
npm run batch -- --root .\fixtures --out report.json --validate-strict

# check every sheet against a machine bed (4200 × 2700 mm)
npm run batch -- --root .\fixtures --out report.json --bed 4200x2700

# re-export the corpus for downstream tools
npm run batch -- --root .\fixtures --out report.json --dxf out\dxf --schedule out\csv --panes out\panes
```

Formats: `--format json|csv|table` (json always written to `--out`).

## Project layout

```
apps/desktop/       Tauri + React UI (canvas, inspector, validation, exports)
packages/core/      CutDocument model, parsers, detector, encoding, normalize,
                    validation, simulation (kinematics/timeline/yield/bed),
                    reporting (cut schedule, stage summary, DXF)
packages/cli/       cutcode-batch (corpus regression, validation, re-export)
fixtures/           Golden + regression test files (incl. UTF-16LE)
docs/formats/       Curated field maps per format
```

## Arc geometry

When a format writes the arc centre (ISO `I`/`J`, Turomas `i`/`j`,
`ARC3C`), that centre decides which side of the chord the arc bulges to.
`geometry/arc.ts` therefore exposes `sampleArcAbout(center, …)` for those cases;
re-deriving the centre from radius + direction silently picks the mirror
solution and traces the long way round the circle. `sim/timeline.ts` and
`validation/spatial.ts` both sample through `cutPathPoints`, so the timeline,
the validator and the exports all measure the same path the parser produced.

## Reference material

- Legacy engine decompile: `C:\Users\TUF\Downloads\PERF-Clean` (Perfect Cut
  6, per-vendor drivers — e.g. Bottero `ConvUnit` for tick scale)
- Surviving production corpus: `C:\Users\TUF\Downloads\PERFECT6`
  (`CutFiles/`, `CNC/`, `dati/`)
- Product guides: `SPIL DOC\CutCode Visualizer Documentation` (User Guide +
  QA Test Guide; stage tables per machine come from there)
