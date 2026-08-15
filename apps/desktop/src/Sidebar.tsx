import { useAppStore } from "./store";

const SAMPLES = [
  { label: "Intermac OTD", path: "C:\\Users\\TUF\\Downloads\\Cutcode\\Intermac\\06_CRY_FLUTED_G.OTD" },
  { label: "Lisec DAT", path: "C:\\Users\\TUF\\Downloads\\Cutcode\\Lisec\\PL001.DAT" },
  { label: "Bottero OPT", path: "C:\\Users\\TUF\\Downloads\\Cutcode\\Bottero\\92941_1.opt" },
  { label: "Optima R01", path: "C:\\Users\\TUF\\Downloads\\Cutcode\\Optima\\CLR03\\CLR03_4.r01" },
  { label: "Optima OTV", path: "C:\\Users\\TUF\\Downloads\\Cutcode\\Optima\\OptiTV\\3mm Clear\\o1.otv" },
  { label: "Macotech IMP", path: "C:\\Users\\TUF\\Downloads\\Cutcode\\Macotech\\1\\CLR10\\CLR10_1.imp" },
  { label: "Hegla EDI", path: "C:\\Users\\TUF\\Downloads\\Cutcode\\Hegla\\3981.EDI" },
];

type Props = {
  onOpenPath: (path: string) => void;
};

export function Sidebar({ onOpenPath }: Props) {
  const filePath = useAppStore((s) => s.filePath);

  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-white">
      <div className="p-3 border-b border-slate-200 bg-slate-50">
        <h1 className="text-sm font-semibold text-slate-900">SPIL CutCode</h1>
        <p className="text-xs text-slate-500 mt-0.5">Viewer</p>
      </div>
      <div className="p-2 space-y-1">
        <p className="text-xs font-medium text-slate-500 px-2 py-1">Samples</p>
        {SAMPLES.map((s) => (
          <button
            key={s.path}
            type="button"
            onClick={() => onOpenPath(s.path)}
            className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
              filePath === s.path
                ? "bg-blue-50 text-blue-800 border border-blue-200 font-medium"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-auto p-3 text-xs text-slate-400 border-t border-slate-200">
        Use Open to browse Cutcode folder
      </div>
    </div>
  );
}
