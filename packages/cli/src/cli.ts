#!/usr/bin/env node
/**
 * cutcode-batch — corpus regression tool for SPIL CutCode Simulator.
 *
 * Parses every cutcode file under a directory and writes a JSON report.
 * With --baseline, compares the fresh run against a previous report and
 * exits non-zero on regressions (files that got worse or newly failed).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { parseFileBytes } from "@spil/cutcode-core";

type Row = {
  path: string;
  detectedVendor: string;
  confidence: string;
  status: string;
  warnings: string[];
  error?: string;
  sheets: number;
  sheet?: string;
  panes?: number;
  cuts?: number;
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
  ".otd", ".dat", ".opt", ".r01", ".imp", ".edi", ".otv", ".dxf", ".ot5", ".cut", ".xml", ".json",
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
  --help, -h         Show this help

Exit codes:
  0  success
  1  failed files found (--strict) or regressions vs baseline
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

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { root: "", out: "report.json", strict: false, format: "json" as "json" | "csv" | "table", baseline: "" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--root") opts.root = args[++i] ?? "";
    else if (a === "--out") opts.out = args[++i] ?? "report.json";
    else if (a === "--strict") opts.strict = true;
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

const { root, out, strict, format, baseline } = parseArgs();

if (!root) {
  console.error("cutcode-batch: missing --root <directory>\n");
  console.error(USAGE);
  process.exit(2);
}
if (!existsSync(root)) {
  console.error(`cutcode-batch: directory does not exist: "${root}"`);
  process.exit(2);
}

let files: string[];
try {
  files = walk(root);
} catch (e) {
  console.error(`cutcode-batch: cannot read directory "${root}" — ${(e as Error).message}`);
  process.exit(2);
}

const rows: Row[] = [];

for (const path of files) {
  try {
    const bytes = new Uint8Array(readFileSync(path));
    const r = parseFileBytes(bytes, path);
    const firstSheet = r.document?.sheets[0];
    rows.push({
      path: relative(root, path),
      detectedVendor: r.detected.vendor,
      confidence: r.detected.confidence,
      status: r.status,
      warnings: r.warnings,
      error: r.error,
      sheets: r.document?.sheets.length ?? 0,
      sheet: firstSheet ? `${firstSheet.sheet.width}x${firstSheet.sheet.height}` : undefined,
      panes: r.document?.sheets.reduce((n, s) => n + s.panes.length, 0),
      cuts: r.document?.sheets.reduce((n, s) => n + s.cuts.length, 0),
    });
  } catch (e) {
    rows.push({
      path: relative(root, path),
      detectedVendor: "unknown",
      confidence: "unknown",
      status: "failed",
      warnings: [],
      error: String(e),
      sheets: 0,
    });
  }
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
  console.log("path,vendor,confidence,status,sheets,panes,cuts,sheet,error");
  for (const r of rows) {
    const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
    console.log([r.path, r.detectedVendor, r.confidence, r.status, r.sheets, r.panes ?? "", r.cuts ?? "", r.sheet ?? "", r.error ?? ""].map(esc).join(","));
  }
} else if (format === "table") {
  for (const r of rows) {
    const line = `${r.status.padEnd(7)} ${(r.detectedVendor + "/" + r.confidence).padEnd(16)} sheets=${String(r.sheets).padEnd(3)} panes=${String(r.panes ?? "-").padEnd(4)} cuts=${String(r.cuts ?? "-").padEnd(5)} ${r.path}`;
    console.log(line);
    for (const w of r.warnings.slice(0, 2)) console.log(`         warn: ${w}`);
  }
}
console.log(`cutcode-batch: ${report.ok} ok, ${report.partial} partial, ${report.failed} failed / ${report.total} → ${out}`);

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
