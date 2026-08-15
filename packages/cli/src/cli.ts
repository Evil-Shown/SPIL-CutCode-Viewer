import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parseAndNormalize } from "@spil/cutcode-core";

type Row = {
  path: string;
  detectedVendor: string;
  confidence: string;
  status: string;
  warnings: string[];
  error?: string;
  sheet?: string;
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
  let root = "C:\\Users\\TUF\\Downloads\\Cutcode";
  let out = "report.json";
  let strict = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    if (args[i] === "--out") out = args[++i];
    if (args[i] === "--strict") strict = true;
  }
  return { root, out, strict };
}

const { root, out, strict } = parseArgs();
const files = walk(root);
const rows: Row[] = [];
let failed = 0;

for (const path of files) {
  try {
    const content = readFileSync(path, "utf8");
    const r = parseAndNormalize(content, path);
    if (r.status === "failed") failed++;
    rows.push({
      path,
      detectedVendor: r.detected.vendor,
      confidence: r.detected.confidence,
      status: r.status,
      warnings: r.warnings,
      error: r.error,
      sheet: r.plan ? `${r.plan.sheet.width}x${r.plan.sheet.height}` : undefined,
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
