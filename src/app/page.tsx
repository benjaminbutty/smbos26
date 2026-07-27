import type { ReactNode } from "react";

export default function HomePage(): ReactNode {
  return (
    <main className="home">
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">Milestone 0 · Engineering foundation</p>
        <h1 id="home-title">Business systems, shaped in plain language.</h1>
        <p className="lede">
          SMBOS is being built for small-business operators. This initial
          release establishes a safe, dependable application foundation;
          business features begin in the next milestone.
        </p>
      </section>

      <section className="foundation-card" aria-labelledby="foundation-title">
        <header>
          <h2 id="foundation-title">Repository scaffold</h2>
          <span className="status">Ready for Milestone 1</span>
        </header>

        <dl className="foundation-list">
          <div>
            <dt>Application</dt>
            <dd>Next.js App Router</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>Strict TypeScript</dd>
          </div>
          <div>
            <dt>Guardrails</dt>
            <dd>Tests, lint, and validation</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
