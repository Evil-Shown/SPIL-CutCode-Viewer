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
  const featured = MACHINES.find((m) => m.id === "bottero-bcs") ?? MACHINES[0];
  const rail = MACHINES.filter((m) => m.id !== featured.id).slice(0, 4);
  const brands = [...new Set(MACHINES.map((m) => m.brand))];

  return (
    <div className="landing">
      <section className="poster">
        <header className="poster-bar">
          <span>SPIL CutCode</span>
          <a href="#library">Machine library</a>
        </header>

        <div className="poster-grid">
          <div className="poster-copy">
            <p className="poster-kicker">Glass cutting simulator</p>
            <h1>See the score before the glass is on the table.</h1>
            <p>
              Pick a real cutting system, load its native program, and play the head across the sheet in 3D or in plan.
            </p>
            <div className="poster-actions">
              <a className="poster-cta" href="#library">Browse machines</a>
              <button type="button" className="poster-ghost" onClick={() => onSelect(featured)}>
                Open {featured.brand} {featured.model}
              </button>
            </div>
            <dl className="poster-facts">
              <div>
                <dt>Machines</dt>
                <dd>{MACHINES.length}</dd>
              </div>
              <div>
                <dt>Import ready</dt>
                <dd>{readyCount}</dd>
              </div>
              <div>
                <dt>Makers</dt>
                <dd>{brands.length}</dd>
              </div>
              <div>
                <dt>Views</dt>
                <dd>3D + plan</dd>
              </div>
            </dl>
          </div>

          <div className="poster-stage">
            <button type="button" className="poster-frame" onClick={() => onSelect(featured)}>
              <img src={`/machines/${featured.id}.png`} alt={`${featured.brand} ${featured.model}`} />
              <span className="frame-cap">
                <em>On the floor</em>
                <strong>
                  {featured.brand} {featured.model}
                </strong>
                <small>
                  {featured.origin} · bed {featured.bed.width} × {featured.bed.height} mm
                </small>
              </span>
            </button>
            <div className="poster-rail">
              {rail.map((m) => (
                <button key={m.id} type="button" onClick={() => onSelect(m)}>
                  <img src={`/machines/${m.id}.png`} alt="" />
                  <span>
                    {m.brand}
                    <small>{m.model}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="poster-foot">
          <span>© 2026 SPIL</span>
          <ul>
            {brands.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </footer>
      </section>

      <section className="poster-steps">
        <article>
          <span>01</span>
          <h3>Pick the table</h3>
          <p>Each card is a real cutting system — bed size, origin, and the file types that machine accepts.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Load the cutcode</h3>
          <p>Drop an OTD, CUT, or the maker’s own program. The sheet is built from that file, not from a generic drawing.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Run the score</h3>
          <p>Play the head across the glass in 3D, or drop to plan view and read every line of the path.</p>
        </article>
      </section>

      <div className="landing-tools" id="library">
        <div>
          <p className="section-eyebrow">The tables</p>
          <h2>Every system in the library.</h2>
        </div>
        <div className="filter-row">
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
