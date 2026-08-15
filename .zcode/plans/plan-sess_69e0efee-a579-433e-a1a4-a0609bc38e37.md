# SPIL CutCode Viewer — Full Upgrade Plan (qiewer 2 replacement)

## Context from exploration

Your original `C:\Users\TUF\Downloads\Cutcode` corpus is **deleted**, but the repo's `fixtures/` (7 formats) survives, and `C:\Users\TUF\Downloads\PERFECT6` (legacy app install) contains a real surviving corpus — `CutFiles/` (OTD, EDI, DAT, XML…), `CNC/` (one OPT), `dati/` (609 IMP files, **UTF-16LE encoded**). `C:\Users\TUF\Downloads\PERF-Clean` is the Ghidra decompile of the legacy engine (343 C files, per-vendor drivers) — usable to verify the Bottero scale. I will copy a curated subset of PERFECT6 files into `fixtures/` as regression fixtures.

Known broken things the plan fixes: Hegla polygon parsing is **dead code** (regex requires `=` that the format doesn't have → zero panes ever); Lisec panes are mispositioned (rect flip bug in `normalize/coordinates.ts`); Intermac multi-sheet files merge all sheets into one (tests truncate the 40KB fixture to hide it); Bottero decoder injects bogus points from case-insensitive regex; Optima OTV ignores `rotated` and only reads the first subProject/sheet; everything assumes UTF-8 (real corpus has UTF-16LE); canvas is blurry on HiDPI, zoom isn't cursor-anchored, hit-testing only checks the first segment; sidebar hardcodes deleted paths; failed parses show a blank screen; CLI crashes on missing dir and can't do regression diffing; repo has zero commits and no .gitignore.

---

## Phase 0 — Hygiene & build foundation
1. Add `.gitignore` (node_modules, dist, target, tsbuildinfo, report*.json); make the **initial git commit** (baseline before changes), commit after each phase.
2. Fix build wiring: `vite.config.ts` → `strictPort: true` (Tauri pins port 1420); remove unused deps (`@tauri-apps/api`, Cargo `serde`/`serde_json`); include `test/` in core tsconfig typecheck; root scripts `typecheck` + `test` covering all workspaces.
3. Curated regression fixtures copied from PERFECT6 (`B19598.OTD`, `KASUNEST.EDI`, a UTF-16LE IMP, one more OPT) into `fixtures/*/regression/`.

## Phase 1 — Core: encoding, multi-sheet model, geometry correctness
4. **Encoding layer** (`decodeCutcode(Uint8Array)`): BOM sniff UTF-8 / UTF-16LE / UTF-16BE, Windows-1252 fallback; used by CLI and desktop (Tauri `readFile` binary instead of `readTextFile`).
5. **Model v2**: `CutDocument { metadata, sheets: CutPlan[] }` — one `ParseResult.document`, multi-sheet first-class (Intermac 10-pattern files become 10 sheets). Add `stage`/`stageLabel` to cuts (X,Y,Z,W,V… per machine per your QA guide CL-01..CL-08), arc cut type (`center`, `radius`, `ccw`), keep laser field.
6. **Fix `normalize/coordinates.ts`**: correct rectangle flip for bottom-left origins (current code puts panes off-sheet), eliminate the double-flip hazard, unit tests for both.

## Phase 2 — Parser correctness (all 7 formats)
7. **Intermac family** (OTD/R01/IMP): split per-`[Pattern]` into sheets; parse the X/Y/Z/W guillotine hierarchy with `Info` ids into real pane rectangles; capture all 4 trims; delete dead code; emit honest partial/warnings.
8. **Lisec DAT**: rebuild pane geometry from the TRAVERE/Y/Z/W cut tree (proper guillotine reconstruction instead of overlapping rects at origin); handle `SFORM`/`SF_*` shape keys; distinct W_SCHNITT handling; fix coordinate-semantics declaration.
9. **Hegla EDI**: fix polygon parser for bare `X30.000 Y0.000` coords (no `=`), produce real polygon panes + segments, handle `L` arc tokens, support both header variants (`EDICUT021` and `[4CLR KASUNTX…@@3660.02440.0`).
10. **Bottero OPT**: case-sensitive token grammar (stop eating decimal dims as hex), non-greedy rackCode, handle `C` arc tokens, verify 1/16 mm scale against `PERF-Clean` Bottero decompile (`ConvUnit`).
11. **Optima OTV**: apply `rotated` (w/h swap), iterate all subProjects/layouts/sheets → multi-sheet, honest statuses, laser data if present.
12. **Macotech IMP**: verify via new decoder (UTF-16LE corpus files), fix the dead B=/H= fallback branch.
13. Detector: confidence scoring cleanup, extension fallbacks unchanged, tests for negative cases.

## Phase 3 — Desktop app v2 (light default + dark toggle)
14. **Canvas engine rewrite**: devicePixelRatio-sharp rendering, ResizeObserver, cursor-anchored wheel zoom (0.35×–3.5×, per your guide), double-click fit, adaptive rulers (top/left) and major/minor grid (50/250mm), proper arc rendering, cut direction arrows, stage-colored cuts with legend/layer toggles (grid, rulers, labels, directions, stages), pane + cut selection with **full-polyline** hit testing, hover highlight, **RADAR minimap** (viewport rect, click/drag to navigate, 1000-line cap per guide), status bar (cursor mm coords, zoom %, pane/cut counts), keyboard shortcuts (F fit, +/− zoom, Esc deselect), React error boundary.
15. **Multi-sheet tabs** in the toolbar.
16. **Validation issues panel** (frontend, from your guide's issue list): `ZERO_LENGTH_CUT`, `CUT_OUT_OF_BOUNDS` (0.5mm epsilon), `DUPLICATE_CUT_LINE`, `KERF_PROXIMITY` (3mm) — grouped by severity, click → zoom to entity + beacon highlight.
17. **Inspector v2**: file/sheet metadata, searchable scrollable pane list (click to select+zoom), cut details (type, stage, length, bock code), warnings — no more 20-pane cap; proper error state for failed parses (no more blank screen).
18. **fileIO v2**: friendly error toasts (no unhandled rejections), drag & drop file open, **recent files list persisted**, sidebar samples bundled from `fixtures/` via Vite `?raw` imports (works in browser AND Tauri — no more hardcoded deleted paths), remember last directory for the open dialog.
19. **Exports**: fixed PNG (Tauri save dialog where available), new **SVG vector export**, PDF via print stylesheet (sheet image + metadata + pane/cut counts).
20. **Theme**: light default, dark toggle, persisted preference (Tailwind `dark:` classes).
21. **Tauri hardening**: CSP set (no longer null), `strictPort`, window min-size, deps cleanup; capabilities scoped to dialog-opened files where feasible.

## Phase 4 — CLI v2, tests, docs
22. **CLI**: `--help`/usage, friendly missing-dir error, `--format json|csv|table`, **`--baseline` regression diff mode** (compare new report vs previous, exit non-zero on regressions — makes it a true corpus regression tool), remove hardcoded default root, add shebang.
23. **Tests**: golden tests on FULL fixtures (remove the `.slice(0, 12000)` hack), multi-sheet assertions, per-bug regression tests (Hegla panes, Lisec pane geometry, Bottero tokens, OTV rotation, normalize rect flip, UTF-16 decoding), unit tests for decoder/detector/coordinates. Target: 60+ tests green.
24. **Docs**: `docs/formats/` for all 7 formats, README rewrite (accurate feature table, dev/build instructions).

## Verification
- `npm run build` + `npm test` green at every phase; `cutcode-batch` run over fixtures + PERFECT6 subset with 0 failed.
- Visual check of the running app in browser dev mode (open each fixture, verify sheet/panes/cuts/minimap/issues/export) before finishing.

## Out of scope (per your decision)
G-code parsing/import, timeline playback, cut-code generation/approval workflow (belongs to spil-opti).