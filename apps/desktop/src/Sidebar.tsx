import { useAppStore } from "./store";
import { fixtureSamples } from "./fixtures";
import { isTauri, readCutcodeFile } from "./fileIO";

type Props = {
  onOpenResult: (path: string, resultPromise: Promise<import("@spil/cutcode-core").ParseResult>) => void;
};

export function Sidebar({ onOpenResult }: Props) {
  const recents = useAppStore((s) => s.recents);
  const filePath = useAppStore((s) => s.filePath);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white text-sm dark:bg-slate-900">
      <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Samples</h2>
      </div>
      <div className="p-2">
        {fixtureSamples.length === 0 && (
          <p className="px-2 text-xs text-slate-400">No bundled samples found.</p>
        )}
        {fixtureSamples.map((s) => (
          <button
            key={s.url}
            type="button"
            onClick={async () => {
              onOpenResult(s.name, (async () => {
                const { loadFixtureUrl } = await import("./fileIO");
                return loadFixtureUrl(s.url, s.name);
              })());
            }}
            className={`mb-0.5 block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${
              filePath === s.name ? "bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : ""
            }`}
          >
            <span className="block truncate font-medium">{s.name}</span>
            <span className="text-[10px] text-slate-400">{s.vendor}</span>
          </button>
        ))}
      </div>

      {isTauri && recents.length > 0 && (
        <>
          <div className="border-y border-slate-200 px-3 py-2 dark:border-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent Files</h2>
          </div>
          <div className="p-2">
            {recents.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onOpenResult(path, readCutcodeFile(path))}
                className={`mb-0.5 block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  filePath === path ? "bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : ""
                }`}
                title={path}
              >
                {path.split(/[/\\]/).pop()}
                <span className="block truncate text-[10px] text-slate-400">{path}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-auto border-t border-slate-200 p-3 text-[10px] text-slate-400 dark:border-slate-700">
        SPIL CutCode Viewer v0.2
      </div>
    </div>
  );
}
