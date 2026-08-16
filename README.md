# SPIL CutCode Viewer

Modern desktop viewer for multi-vendor glass cutcode files — the replacement
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
| Macotech | `.imp` | OPT_* family + `[SHEETS]` fallback, UTF-16LE support |
| Hegla | `.edi` | EDICUT + fixed-width variants, polygon piece outlines |

Encodings: UTF-8, UTF-16LE/BE (BOM + heuristic), Windows-1252 fallback —
files are read as bytes and decoded before parsing.

## Viewer features

- **Canvas**: pan (drag), cursor-anchored zoom (0.35×–3.5×), double-click
  fit, adaptive rulers + grid (50/250 mm), trim zone, sheet dimensions
- **Multi-sheet**: sheet tabs for multi-pattern files
- **Selection**: click cuts (full-polyline hit testing) and panes
  (rect + polygon); hover highlighting
- **Layers**: grid, rulers, labels, direction arrows, stage colors (X/Y/Z/W…)
- **Validation panel**: zero-length cuts, out-of-bounds (±0.5 mm),
  duplicate cuts, kerf proximity (<3 mm) — grouped by severity,
  click to zoom to the issue
- **Minimap (RADAR)**: overview + viewport rectangle, click to navigate
- **Status bar**: live cursor position in mm, zoom level, pane/cut counts
- **Inspector**: file metadata, sheet info, searchable pane list,
  cut details (stage, bock code, coordinates), parser warnings
- **Exports**: PNG, SVG, printable sheet report
- **Theme**: light (default) + dark, persisted
- Drag & drop file open, recent files, bundled sample fixtures
  (work in browser dev mode and in the packaged app)
- Keyboard: `F` fit · `+`/`−` zoom · `Esc` deselect

## Development

```powershell
cd "C:\Users\TUF\Downloads\SPIL CutCode Viewer"
npm install
npm test            # core test suite (31 tests)
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
regressions (status downgrades, lost panes/cuts) — use it as a CI gate:

```powershell
node packages\cli\dist\cli.js --root .\fixtures --out report-new.json
node packages\cli\dist\cli.js --root .\fixtures --out report.json --baseline report-prev.json --strict
```

Formats: `--format json|csv|table` (json always written to `--out`).

## Project layout

```
apps/desktop/       Tauri + React UI (canvas, inspector, validation, exports)
packages/core/      CutDocument model, parsers, detector, encoding, normalize
packages/cli/       cutcode-batch (corpus regression with baseline diffing)
fixtures/           Golden + regression test files (incl. UTF-16LE)
docs/formats/       Curated field maps per format
```

## Reference material

- Legacy engine decompile: `C:\Users\TUF\Downloads\PERF-Clean` (Perfect Cut
  6, per-vendor drivers — e.g. Bottero `ConvUnit` for tick scale)
- Surviving production corpus: `C:\Users\TUF\Downloads\PERFECT6`
  (`CutFiles/`, `CNC/`, `dati/`)
- Product guides: `SPIL DOC\CutCode Visualizer Documentation` (User Guide +
  QA Test Guide; stage tables per machine come from there)
