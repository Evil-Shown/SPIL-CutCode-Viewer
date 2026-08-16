#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
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

const EXT = new Set([
  ".otd", ".dat", ".opt", ".r01", ".imp", ".edi", ".otv", ".cut", ".xml", ".json",
]);

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
  const opts = { root: "", out: "report.json", strict: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") opts.root = args[++i] ?? "";
    else if (args[i] === "--out") opts.out = args[++i] ?? "report.json";
    else if (args[i] === "--strict") opts.strict = true;
  }
  return opts;
}

const { root, out, strict } = parseArgs();
if (!root) {
  console.error("cutcode-batch: missing --root <directory>");
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
let failed = 0;

for (const path of files) {
  try {
    const bytes = new Uint8Array(readFileSync(path));
    const r = parseFileBytes(bytes, path);
    if (r.status === "failed") failed++;
    const firstSheet = r.document?.sheets[0];
    rows.push({
      path,
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
    failed++;
    rows.push({
      path,
      detectedVendor: "unknown",
      confidence: "unknown",
      status: "failed",
      warnings: [],
      error: String(e),
      sheets: 0,
    });
  }
}

const summary = {
  root,
  total: rows.length,
  ok: rows.filter((r) => r.status === "ok").length,
  partial: rows.filter((r) => r.status === "partial").length,
  failed: rows.filter((r) => r.status === "failed").length,
  rows,
};

writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(`cutcode-batch: ${summary.ok} ok, ${summary.partial} partial, ${summary.failed} failed / ${summary.total}`);
if (strict && summary.failed > 0) process.exit(1);
