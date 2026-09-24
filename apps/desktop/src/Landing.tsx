import { useMemo, useState } from "react";
import { MACHINES, machineVisual, type Machine } from "./machines";

type Props = {
  onSelect: (machine: Machine) => void;
};

function MachineThumb({ machine }: { machine: Machine }) {
  const v = machineVisual(machine);
  return (
    <svg className="machine-thumb" viewBox="0 0 360 170" role="img" aria-label={`${machine.brand} ${machine.model} table`}>
      <path d="M44 126 180 76 319 119 181 164Z" fill={v.frame} opacity=".28" />
      {v.layout === "laminated" && <path d="M176 81 249 53 332 79 257 108Z" fill={v.bed} stroke={v.frame} strokeWidth="5" />}
      <path d="M34 104 177 52 326 98 180 148Z" fill={v.bed} stroke={v.frame} strokeWidth="7" />
      <path d="M34 104v19l146 48v-23zM326 98v20l-146 53v-23z" fill={v.frame} opacity=".88" />
      {[68, 108, 148, 188, 228, 268].map((x) => (
        <path key={x} d={`M${x} 92 ${x + 144} 137`} stroke="#fff" opacity=".09" strokeWidth="2" />
      ))}
      {v.layout === "split" && <path d="m180 52 0 96" stroke={v.frame} strokeWidth="6" />}
      <path d="m54 88 3 24M301 79l3 28" stroke={v.gantry} strokeWidth="8" />
      <path d="m55 88 245-9" stroke={v.gantry} strokeWidth="12" />
      <rect x="168" y="69" width="35" height="25" rx="3" fill={v.frame} />
      <path d="M180 94v24" stroke={v.frame} strokeWidth="5" />
      {v.loadingArms && [82, 146, 210].map((x) => (
        <path key={x} d={`M${x} 126 ${x - 32} 159`} stroke={v.frame} strokeWidth="7" strokeLinecap="round" />
      ))}
      <path d={v.pedestal === "left" ? "M25 115v38h20v-38z" : "M315 111v38h20v-38z"} fill={v.frame} />
      <rect x={v.pedestal === "left" ? 27 : 317} y="120" width="16" height="11" fill="#9bdaf1" opacity=".9" />
    </svg>
  );
}

export function Landing({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [onlyReady, setOnlyReady] = useState(false);

  const machines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MACHINES.filter((m) => {
      if (onlyReady && !m.importReady) return false;
      if (!q) return true;
      return `${m.brand} ${m.model} ${m.kind} ${m.origin} ${m.summary}`.toLowerCase().includes(q);
    });
  }, [query, onlyReady]);

  const readyCount = MACHINES.filter((m) => m.importReady).length;

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="landing-brand"><span>◩</span> SPIL CUTCODE</div>
        <div className="landing-nav-meta">MACHINE FIELD GUIDE · 2026</div>
      </nav>
      <header className="landing-top">
        <div>
          <p className="eyebrow">§ 00 — Select a cutting system</p>
          <h1>Glass<span>·</span>works</h1>
          <p className="lede">
            A visual field guide to industrial glass cutting—choose the physical table, load its native program, and inspect every score in motion.
          </p>
          <div className="landing-pills">
            <span><i />Real-time 3D</span>
            <span><i />Native cutcode</span>
            <span><i />Machine-specific</span>
          </div>
        </div>
        <div className="landing-stats">
          <div>
            <strong>{MACHINES.length}</strong>
            <span>machines</span>
          </div>
          <div>
            <strong>{readyCount}</strong>
            <span>import ready</span>
          </div>
        </div>
      </header>

      <div className="landing-tools">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brand, model, or country"
          aria-label="Search machines"
        />
        <button type="button" className={onlyReady ? "chip on" : "chip"} onClick={() => setOnlyReady((v) => !v)}>
          Import ready
        </button>
      </div>

      <div className="machine-grid">
        {machines.map((m) => (
          <button key={m.id} type="button" className="machine-card" onClick={() => onSelect(m)}>
            <span className="card-index">{String(MACHINES.indexOf(m) + 1).padStart(2, "0")}</span>
            <MachineThumb machine={m} />
            <span className="card-kicker">
              {m.origin} · {m.kind}
            </span>
            <strong>
              {m.brand} <em>{m.model}</em>
            </strong>
            <span className="card-bed">
              Bed {m.bed.width} × {m.bed.height} mm
            </span>
            <span className="card-summary">{m.summary}</span>
            <span className="card-foot">
              {m.importReady ? (
                <span className="ready">Import {m.extensions.map((e) => `.${e}`).join(" ")}</span>
              ) : (
                <span className="soon">3D table only</span>
              )}
            </span>
          </button>
        ))}
        {machines.length === 0 && <p className="empty-search">No machines match that search.</p>}
      </div>
    </div>
  );
}
