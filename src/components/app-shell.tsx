"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: Readonly<AppShellProps>): ReactNode {
  const pathname = usePathname();

  if (pathname.startsWith("/app/")) {
    return <div className="app-frame workspace-frame">{children}</div>;
  }

  if (pathname.startsWith("/p/")) {
    return <div className="app-frame customer-frame">{children}</div>;
  }

  if (pathname.startsWith("/start/preview/")) {
    return <div className="app-frame candidate-frame">{children}</div>;
  }

  const isLenniJourney = ["/start", "/sign-in", "/sign-up", "/onboarding"].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (isLenniJourney) {
    return (
      <div className="app-frame lenni-public-frame">
        <header className="site-header">
          <Link className="brand" href="/start" aria-label="Lenni home">
            Lenni
          </Link>

          <nav className="public-nav" aria-label="Account">
            <Link className="header-link" href="/sign-in">
              Sign in
            </Link>
          </nav>
        </header>

        {children}
      </div>
    );
  }

  if (pathname === "/") {
    return (
      <div className="app-frame marketing-frame">
        <header className="site-header marketing-header">
          <Link className="marketing-brand" href="/" aria-label="SMBOS home">
            SMBOS
          </Link>

          <nav
            className="marketing-nav marketing-nav-desktop"
            aria-label="Primary"
          >
            <a href="#how-it-works">How it works</a>
            <a href="#why-smbos">Why SMBOS</a>
            <a href="#early-access">Early access</a>
            <Link href="/sign-in">Sign in</Link>
            <Link className="marketing-header-action" href="/start">
              Start with Lenni
            </Link>
          </nav>

          <details className="marketing-nav-mobile">
            <summary>Menu</summary>
            <nav aria-label="Mobile primary">
              <a href="#how-it-works">How it works</a>
              <a href="#why-smbos">Why SMBOS</a>
              <a href="#early-access">Early access</a>
              <Link href="/sign-in">Sign in</Link>
            </nav>
          </details>
        </header>

        {children}

        <footer className="site-footer marketing-footer">
          <div>
            <span className="marketing-brand">SMBOS</span>
            <span>Run your business. Your way.</span>
          </div>
          <Link href="/sign-in">Sign in</Link>
        </footer>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="SMBOS home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          SMBOS
        </Link>

        <nav className="public-nav" aria-label="Account">
          <Link className="header-link" href="/sign-in">
            Sign in
          </Link>
          <Link className="button button-small" href="/sign-up">
            Get started
          </Link>
        </nav>
      </header>

      {children}

      <footer className="site-footer">
        SMBOS v0.1 · Business software shaped around your work
      </footer>
    </div>
  );
}
