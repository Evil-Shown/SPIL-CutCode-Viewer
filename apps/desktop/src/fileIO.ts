import { parseAndNormalize, type ParseResult } from "@spil/cutcode-core";

export async function readCutcodeFile(path: string): Promise<ParseResult> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const content = await readTextFile(path);
    return parseAndNormalize(content, path);
  }
  throw new Error("Tauri FS not available — use openFileFromBrowser for web dev");
}

export async function openFileFromBrowser(file: File): Promise<ParseResult> {
  const content = await file.text();
  return parseAndNormalize(content, file.name);
}

export async function openFileDialog(): Promise<{ path: string; result: ParseResult } | null> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Cutcode",
          extensions: ["otd", "dat", "opt", "r01", "imp", "edi", "otv", "cut", "xml", "json"],
        },
      ],
      defaultPath: "C:\\Users\\TUF\\Downloads\\Cutcode",
    });
    if (selected && typeof selected === "string") {
      const result = await readCutcodeFile(selected);
      return { path: selected, result };
    }
    return null;
  }
  return null;
}
