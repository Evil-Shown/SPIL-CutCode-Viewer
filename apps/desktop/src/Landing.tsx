import { useMemo, useState } from "react";
import { MACHINES, type Machine } from "./machines";

type Props = {
  onSelect: (machine: Machine) => void;
};

function MachineThumb({ machine }: { machine: Machine }) {
  return (
    <img
      className="machine-thumb"
      src={`/machines/${machine.id}.png`}
      alt={`${machine.brand} ${machine.model}`}
    />
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
        <div className="landing-brand"><span>◩</span> SPIL CUTCODE SIMULATOR</div>
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
