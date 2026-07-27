import Link from "next/link";
import type { ReactNode } from "react";

export default function HomePage(): ReactNode {
  return (
    <main className="home">
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">SMBOS v0.1</p>
        <h1 id="home-title">Run your business from one clear place.</h1>
        <p className="lede">
          Create your business, add its locations, and give your team a secure
          place to work.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/sign-up">
            Create account
          </Link>
          <Link className="button button-secondary" href="/sign-in">
            Sign in
          </Link>
        </div>
      </section>

      <section className="foundation-card" aria-labelledby="foundation-title">
        <header>
          <h2 id="foundation-title">A secure foundation</h2>
          <span className="status">Milestone 1</span>
        </header>

        <dl className="foundation-list">
          <div>
            <dt>Accounts</dt>
            <dd>Email and password</dd>
          </div>
          <div>
            <dt>Businesses</dt>
            <dd>Private workspaces</dd>
          </div>
          <div>
            <dt>Setup</dt>
            <dd>Location management</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
