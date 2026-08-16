import { parseFileBytes, parseAndNormalize, type ParseResult } from "@spil/cutcode-core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const CUTCODE_EXTENSIONS = ["otd", "dat", "opt", "r01", "imp", "edi", "otv", "dxf", "cut", "xml", "json"];

function lastDir(): string | undefined {
  try {
    const recents = JSON.parse(localStorage.getItem("ccv.recents") ?? "[]") as string[];
    const first = recents[0];
    if (first) return first.replace(/[/\\][^(/\\)]+$/, "");
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Tauri: read file as bytes and decode with proper encoding detection. */
export async function readCutcodeFile(path: string): Promise<ParseResult> {
  if (!isTauri) {
    throw new Error("File system access is only available in the desktop app. Use the file picker in browser mode.");
  }
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(path);
  return parseFileBytes(new Uint8Array(bytes), path);
}

/** Browser: read a File object. */
export async function openFileFromBrowser(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  return parseFileBytes(new Uint8Array(buf), file.name);
}

/** Fetch a bundled fixture URL (works in dev and packaged app). */
export async function loadFixtureUrl(url: string, name: string): Promise<ParseResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load bundled sample (${res.status})`);
  const buf = await res.arrayBuffer();
  return parseFileBytes(new Uint8Array(buf), name);
}

export async function openFileDialog(): Promise<{ path: string; result: ParseResult } | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Cutcode", extensions: CUTCODE_EXTENSIONS }],
    defaultPath: lastDir(),
  });
  if (selected && typeof selected === "string") {
    const result = await readCutcodeFile(selected);
    return { path: selected, result };
  }
  return null;
}

/** Parse text content (used for drag-drop text or already-decoded content). */
export function parseText(content: string, name: string): ParseResult {
  return parseAndNormalize(content, name);
}

/** Tauri save dialog returning path, or null in browser. */
export async function saveDialog(defaultName: string): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: defaultName.endsWith(".svg") ? "SVG" : "PNG", extensions: [defaultName.split(".").pop() ?? "png"] }],
  });
  return typeof path === "string" ? path : null;
}

export async function writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, data);
}
