# SPIL CutCode Viewer

Modern desktop viewer for multi-vendor glass cutcode files (replaces legacy qiewer).

## Stack

- **Tauri 2** + **React 19** + **TypeScript**
- `@spil/cutcode-core` — parsers, format detection, normalization
- `@spil/cutcode-cli` — `cutcode-batch` corpus regression tool

## Supported formats (v1)

| Vendor | Extension | Status |
|--------|-----------|--------|
| Intermac | `.OTD` | Full parser + canvas |
| Lisec | `.DAT` | Full parser + canvas |
| Bottero | `.opt` | Heuristic hex-token parser |

Reference material: [`qiwerDecompile`](C:\Users\TUF\Downloads\qiwerDecompile) decompilation + sample corpus [`Cutcode`](C:\Users\TUF\Downloads\Cutcode).

## Development

```powershell
cd "C:\Users\TUF\Downloads\SPIL CutCode Viewer"
npm install
npm run build -w @spil/cutcode-core
npm test -w @spil/cutcode-core
npm run dev -w @spil/cutcode-desktop
```

### Tauri desktop

```powershell
cd apps/desktop
npm run tauri dev
```

### Batch corpus report

```powershell
npm run batch -- --root "C:\Users\TUF\Downloads\Cutcode" --out report.json
```

## Project layout

```
apps/desktop/       Tauri + React UI
packages/core/      CutPlan model, parsers, detector
packages/cli/       cutcode-batch
fixtures/           Golden test files
docs/formats/       Curated field maps (from Ghidra / samples)
```

## UI

- Sidebar with sample files
- Canvas: pan (drag), zoom (wheel), pane colors, cut highlight
- Inspector: sheet metadata, panes, selected cut details
- Warning banner for partial parses
