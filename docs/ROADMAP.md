# SPIL CutCode Simulator — Roadmap

Goal: the tool a glass plant opens before sending a program to the table.
It must answer: *Will this file cut correctly on this machine, how long will
it take, how much glass is wasted, and what exactly will the head do?*

Ground rules for every phase:

- Parsers live in `packages/core` and stay UI-free. Every new format or
  analysis ships with a fixture in `fixtures/` and a test in
  `packages/core/test/`.
- UI lives in `apps/desktop`. Keep the cream blueprint visual language
  (`index.css`: Space Grotesk / Newsreader / JetBrains Mono, ink `#0b2545`,
  orange `#d75c2a`, green `#2a7553`).
- `npm test`, `npx tsc -p apps/desktop/tsconfig.json`, and
  `npm run build -w @spil/cutcode-desktop` must pass at the end of each phase.
- One commit per phase.

## Phase 1 — Simulation engine (physics-based timing)

Today playback advances a fixed 6 cuts/second. Replace it with a real
motion model.

- `packages/core/src/sim/`: machine kinematics profile per machine
  (max speed m/min, acceleration m/s², score speed, rapid speed, head-down /
  head-up time, break-out time per stage).
- Compute a timeline from a `CutPlan`: rapid moves between cuts, scoring
  moves, trapezoidal velocity profile per segment, arc length for arcs.
- Output: total cycle time, per-cut start/end time, head position at time t.
- Drive `seqClock` by simulated time (seconds), with speed 1×/2×/4×/8×/16×,
  a scrubber, step-to-next-cut, and step-back.
- Show rapid (head-up) travel as a dashed path in 3D and 2D.
- Readouts: cycle time, cutting length (m), rapid length (m), time left.

## Phase 2 — Yield and job analytics

- Sheet area, used area (sum of panes), waste %, remnant rectangles.
- Cutting length per stage (X/Y/Z/W), cut count per stage.
- Per-sheet and per-file summary; multi-sheet totals.
- Inspector "Analytics" tab with bars per stage and a yield gauge.
- Export a job report PDF / printable page: layout, piece list, yield, time.

## Phase 3 — Machine-aware validation

- Extend `validation/dialects.ts` into full machine profiles: bed limits,
  min piece size, min trim, min shape radius, max glass thickness, kerf.
- Flag: sheet larger than bed, pieces below min size, radii below the
  machine's min, cuts outside trims, missing break-out order.
- Validation panel groups issues by severity and zooms to them (existing
  UI), now scoped to the selected machine.

## Phase 4 — Richer 3D machine simulation

- Break-out animation: after scoring, pieces separate along X then Y stages.
- Low-E edge deletion visualization when the file carries it.
- Laminated lines: second head underneath, heating bar, PVB separation step.
- Camera presets: operator view, overhead, follow-head.
- Shadow/lighting quality toggle for slower machines.

## Phase 5 — Workflow features

- Compare two files (A/B): overlay layouts, diff yield and cycle time.
- Batch queue: open a folder, list every job with status, time, yield.
- Search pieces by ID / order across all loaded sheets.
- Convert between formats where geometry allows (e.g. DXF → OTD export).
- Session restore: last machine, last files, camera.

## Phase 6 — Production hardening

- Code-split Three.js (bundle is ~900 kB); lazy-load the 3D stage.
- Web worker for parsing large files.
- Performance budget: 10 000 cuts render at 60 fps in 2D, 30 fps in 3D.
- Tauri packaging, file associations for all supported extensions.
