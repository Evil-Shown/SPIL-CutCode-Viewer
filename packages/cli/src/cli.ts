#!/usr/bin/env node
/**
 * cutcode-batch — corpus regression tool for SPIL CutCode Simulator.
 *
 * Parses every cutcode file under a directory and writes a JSON report.
 * With --baseline, compares the fresh run against a previous report and
 * exits non-zero on regressions (files that got worse or newly failed).
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, extname, relative } from "node:path";
import {
  analyzeYield,
  buildSchedule,
  checkBedFit,
  documentToDxf,
  panesToCsv,
  parseFileBytes,
  planToDxf,
  scheduleToCsv,
  stagesToCsv,
  validateCutDocument,
  groupIssues,
  type BedSize,
} from "@spil/cutcode-core";

type Row = {
  path: string;
  detectedVendor: string;
  formatId: string;
  confidence: string;
  status: string;
  warnings: string[];
  error?: string;
  sheets: number;
  sheet?: string;
  panes?: number;
  cuts?: number;
  /** Total scored length in metres, summed over all sheets. */
  scoreM?: number;
  /** Mean yield percentage across sheets. */
  yieldPct?: number;
  errors?: number;
  warningsCount?: number;
};

type Report = {
  root: string;
  total: number;
  ok: number;
  partial: number;
  failed: number;
  rows: Row[];
};

const EXT = new Set([
  ".otd", ".dat", ".opt", ".r01", ".imp", ".edi", ".otv", ".dxf", ".ot5", ".cut", ".cni",
  ".xml", ".json", ".xyz", ".pgm", ".lst", ".dst", ".prjx", ".sum", ".src", ".iso",
]);

const USAGE = `cutcode-batch — corpus regression tool for SPIL CutCode Simulator

Usage:
  cutcode-batch --root <directory> [options]

Options:
  --root <dir>       Directory to scan recursively for cutcode files (required)
  --out <file>       Output report path (default: report.json)
  --format <fmt>     Report format: json | csv | table (default: json; json is
                     always written to --out regardless)
  --baseline <file>  Compare against a previous report; exit 1 on regressions
  --strict           Exit 1 if any file failed
  --validate         Run the geometry validator on every sheet and report
                     issue counts (errors / warnings)
  --validate-strict  Same as --validate, plus exit 1 when any error is found
  --dxf <dir>        Re-export every parsed sheet as ASCII DXF R12 into <dir>
  --schedule <dir>   Export the cut schedule + stage breakdown CSVs into <dir>
  --panes <dir>      Export the pane list CSV into <dir>
  --bed <WxH>        Check every sheet against a machine bed, e.g. 4200x2700
  --help, -h         Show this help

Exit codes:
  0  success
  1  failed files found (--strict) or regressions vs baseline or validation
     errors (--validate-strict)
  2  usage / IO error
`;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.has(extname(p).toLowerCase())) out.push(p);
  }
  return out;
}

type Options = {
  root: string;
  out: string;
  strict: boolean;
  format: "json" | "csv" | "table";
  baseline: string;
  validate: boolean;
  validateStrict: boolean;
  dxf: string;
  schedule: string;
  panes: string;
  bed: string;
};

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: Options = {
    root: "",
    out: "report.json",
    strict: false,
    format: "json",
    baseline: "",
    validate: false,
    validateStrict: false,
    dxf: "",
    schedule: "",
    panes: "",
    bed: "",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--root") opts.root = args[++i] ?? "";
    else if (a === "--out") opts.out = args[++i] ?? "report.json";
    else if (a === "--strict") opts.strict = true;
    else if (a === "--validate") opts.validate = true;
    else if (a === "--validate-strict") {
      opts.validate = true;
      opts.validateStrict = true;
    } else if (a === "--dxf") opts.dxf = args[++i] ?? "";
    else if (a === "--schedule") opts.schedule = args[++i] ?? "";
    else if (a === "--panes") opts.panes = args[++i] ?? "";
    else if (a === "--bed") opts.bed = args[++i] ?? "";
    else if (a === "--format") {
      const v = args[++i];
      if (v !== "json" && v !== "csv" && v !== "table") {
        console.error(`cutcode-batch: invalid --format "${v}" (use json|csv|table)`);
        process.exit(2);
      }
      opts.format = v;
    } else if (a === "--baseline") opts.baseline = args[++i] ?? "";
    else {
      console.error(`cutcode-batch: unknown option "${a}" (see --help)`);
      process.exit(2);
    }
  }
  return opts;
}

function parseBed(s: string): BedSize | null {
  const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i);
  if (!m) {
    console.error(`cutcode-batch: invalid --bed "${s}" (expected e.g. 4200x2700)`);
    process.exit(2);
  }
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** `a/b/c.ext` → `a-b-c.ext` so the sibling files of a job stay together. */
function exportStem(relativePath: string): string {
  return relativePath.replace(/[\\/]/g, "-").replace(/\.[^.]+$/, "");
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

const opts = parseArgs();
const { root, out, strict, format, baseline } = opts;

if (!root) {
  console.error("cutcode-batch: missing --root <directory>\n");
  console.error(USAGE);
  process.exit(2);
}
if (!existsSync(root)) {
  console.error(`cutcode-batch: directory does not exist: "${root}"`);
  process.exit(2);
}

for (const [flag, dir] of [["--dxf", opts.dxf], ["--schedule", opts.schedule], ["--panes", opts.panes]] as const) {
  if (dir && existsSync(dir) && !statSync(dir).isDirectory()) {
    console.error(`cutcode-batch: ${flag} target is not a directory: "${dir}"`);
    process.exit(2);
  }
}
const bed = opts.bed ? parseBed(opts.bed) : null;
for (const dir of [opts.dxf, opts.schedule, opts.panes]) if (dir) ensureDir(dir);

let files: string[];
try {
  files = walk(root);
} catch (e) {
  console.error(`cutcode-batch: cannot read directory "${root}" — ${(e as Error).message}`);
  process.exit(2);
}

const rows: Row[] = [];
const bedOversize: string[] = [];
let exportedDxf = 0;
let exportedSchedule = 0;

for (const path of files) {
  try {
    const bytes = new Uint8Array(readFileSync(path));
    const r = parseFileBytes(bytes, path);
    const rel = relative(root, path);
    const stem = exportStem(rel);

    if (r.document && r.document.sheets.length > 0) {
      const schedule = buildSchedule(r.document);

      if (opts.dxf) {
        const dxf = r.document.sheets.length > 1 ? documentToDxf(r.document) : planToDxf(r.document.sheets[0]!, r.detected.vendor);
        writeFileSync(join(opts.dxf, `${stem}.dxf`), dxf);
        exportedDxf++;
      }
      if (opts.schedule) {
        writeFileSync(join(opts.schedule, `${stem}-cuts.csv`), scheduleToCsv(schedule));
        writeFileSync(join(opts.schedule, `${stem}-stages.csv`), stagesToCsv(schedule));
        exportedSchedule++;
      }
      if (opts.panes) {
        writeFileSync(join(opts.panes, `${stem}-panes.csv`), panesToCsv(r.document));
      }

      if (bed) {
        for (const s of r.document.sheets) {
          const fit = checkBedFit(s, bed);
          if (!fit.fits && fit.warning) bedOversize.push(`${rel}: ${fit.warning}`);
        }
      }

      let errors: number | undefined;
      let warningsCount: number | undefined;
      if (opts.validate) {
        const issues = validateCutDocument(r.document);
        const groups = groupIssues(issues);
        errors = groups.filter((g) => g.severity === "error").reduce((n, g) => n + g.count, 0);
        warningsCount = groups.reduce((n, g) => n + g.count, 0) - errors;
      }

      rows.push({
        path: rel,
        detectedVendor: r.detected.vendor,
        formatId: r.detected.formatId,
        confidence: r.detected.confidence,
        status: r.status,
        warnings: r.warnings,
        error: r.error,
        sheets: r.document.sheets.length,
        sheet: `${r.document.sheets[0]!.sheet.width}x${r.document.sheets[0]!.sheet.height}`,
        panes: r.document.sheets.reduce((n, s) => n + s.panes.length, 0),
        cuts: r.document.sheets.reduce((n, s) => n + s.cuts.length, 0),
        scoreM: schedule.totals.scoreLengthMm / 1000,
        yieldPct: meanYield(r.document.sheets.map(analyzeYield)),
        errors,
        warningsCount,
      });
    } else {
      rows.push({
        path: rel,
        detectedVendor: r.detected.vendor,
        formatId: r.detected.formatId,
        confidence: r.detected.confidence,
        status: r.status,
        warnings: r.warnings,
        error: r.error,
        sheets: r.document?.sheets.length ?? 0,
      });
    }
  } catch (e) {
    rows.push({
      path: relative(root, path),
      detectedVendor: "unknown",
      formatId: "unknown",
      confidence: "unknown",
      status: "failed",
      warnings: [],
      error: String(e),
      sheets: 0,
    });
  }
}

function meanYield(reports: { yieldPct: number }[]): number | undefined {
  if (reports.length === 0) return undefined;
  return reports.reduce((n, r) => n + r.yieldPct, 0) / reports.length;
}

const RANK: Record<string, number> = { ok: 0, partial: 1, failed: 2 };

const report: Report = {
  root,
  total: rows.length,
  ok: rows.filter((r) => r.status === "ok").length,
  partial: rows.filter((r) => r.status === "partial").length,
  failed: rows.filter((r) => r.status === "failed").length,
  rows,
};

writeFileSync(out, JSON.stringify(report, null, 2));

/* ---- console output ---- */
if (format === "csv") {
  console.log("path,vendor,format,confidence,status,sheets,panes,cuts,score_m,yield_pct,sheet,errors,warnings,error");
  const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  for (const r of rows) {
    console.log(
      [
        r.path, r.detectedVendor, r.formatId, r.confidence, r.status,
        r.sheets, r.panes ?? "", r.cuts ?? "",
        r.scoreM !== undefined ? r.scoreM.toFixed(2) : "",
        r.yieldPct !== undefined ? r.yieldPct.toFixed(1) : "",
        r.sheet ?? "", r.errors ?? "", r.warningsCount ?? "", r.error ?? "",
      ]
        .map(esc)
        .join(",")
    );
  }
} else if (format === "table") {
  for (const r of rows) {
    const issues =
      r.errors || r.warningsCount
        ? ` err=${r.errors ?? 0} warn=${r.warningsCount ?? 0}`
        : "";
    const score = r.scoreM !== undefined ? ` score=${r.scoreM.toFixed(1)}m` : "";
    const yld = r.yieldPct !== undefined ? ` yield=${r.yieldPct.toFixed(0)}%` : "";
    console.log(
      `${r.status.padEnd(7)} ${(r.detectedVendor + "/" + r.confidence).padEnd(16)} sheets=${String(r.sheets).padEnd(3)} panes=${String(r.panes ?? "-").padEnd(4)} cuts=${String(r.cuts ?? "-").padEnd(5)}${score}${yld}${issues} ${r.path}`
    );
    for (const w of r.warnings.slice(0, 2)) console.log(`         warn: ${w}`);
    if (r.error) console.log(`         err:  ${r.error}`);
  }
}
console.log(`cutcode-batch: ${report.ok} ok, ${report.partial} partial, ${report.failed} failed / ${report.total} → ${out}`);

if (opts.dxf) console.log(`  wrote ${exportedDxf} DXF file(s) → ${opts.dxf}`);
if (opts.schedule) console.log(`  wrote ${exportedSchedule} cut schedule + stage CSV pair(s) → ${opts.schedule}`);
if (opts.panes && files.length) console.log(`  wrote pane list CSVs → ${opts.panes}`);

if (opts.validate) {
  const errorTotal = rows.reduce((n, r) => n + (r.errors ?? 0), 0);
  const warnTotal = rows.reduce((n, r) => n + (r.warningsCount ?? 0), 0);
  const worst = [...rows].filter((r) => (r.errors ?? 0) > 0).sort((a, b) => (b.errors ?? 0) - (a.errors ?? 0));
  console.log(`validation: ${errorTotal} error(s), ${warnTotal} warning(s) across ${rows.length} file(s)`);
  for (const r of worst.slice(0, 10)) {
    console.log(`  ${r.path}: ${r.errors} error(s), ${r.warningsCount ?? 0} warning(s)`);
  }
  if (opts.validateStrict && errorTotal > 0) {
    console.log("validation: failing due to --validate-strict");
    process.exit(1);
  }
}

if (bed) {
  console.log(`bed ${bed.width}x${bed.height}: ${bedOversize.length} sheet(s) do not fit`);
  for (const line of bedOversize.slice(0, 10)) console.log(`  ${line}`);
}

/* ---- baseline regression comparison ---- */
let regressions = 0;
if (baseline) {
  if (!existsSync(baseline)) {
    console.error(`cutcode-batch: baseline file does not exist: "${baseline}"`);
    process.exit(2);
  }
  let prev: Report;
  try {
    prev = JSON.parse(readFileSync(baseline, "utf8")) as Report;
  } catch (e) {
    console.error(`cutcode-batch: cannot parse baseline: ${(e as Error).message}`);
    process.exit(2);
  }
  const prevByPath = new Map(prev.rows.map((r) => [r.path, r]));

  for (const cur of report.rows) {
    const before = prevByPath.get(cur.path);
    if (!before) continue; // new file — not a regression
    if ((RANK[cur.status] ?? 2) > (RANK[before.status] ?? 2)) {
      regressions++;
      console.log(`  REGRESSION ${cur.path}: ${before.status} → ${cur.status}${cur.error ? ` (${cur.error})` : ""}`);
    } else if ((before.panes ?? 0) > 0 && (cur.panes ?? 0) === 0) {
      regressions++;
      console.log(`  REGRESSION ${cur.path}: lost all panes (${before.panes} → 0)`);
    } else if ((before.cuts ?? 0) > 0 && (cur.cuts ?? 0) === 0) {
      regressions++;
      console.log(`  REGRESSION ${cur.path}: lost all cuts (${before.cuts} → 0)`);
    }
  }
  if (regressions === 0) console.log("baseline comparison: no regressions");
}

if (regressions > 0) process.exit(1);
if (strict && report.failed > 0) process.exit(1);
