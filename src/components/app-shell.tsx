"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LenniBrand } from "./lenni-brand";

interface AppShellProps {
  children: ReactNode;
}

function MarketingShell({ children }: Readonly<AppShellProps>): ReactNode {
  return (
    <div className="app-frame marketing-frame">
      <a className="marketing-skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header marketing-header">
        <Link className="marketing-brand" href="/" aria-label="Lenni home">
          <LenniBrand />
        </Link>

        <nav
          className="marketing-nav marketing-nav-desktop"
          aria-label="Primary"
        >
          <Link href="/#possibilities">Meet Lenni</Link>
          <Link href="/#why">Why we&apos;re building it</Link>
        </nav>
        <Link className="marketing-header-action" href="/#early-access">
          Join early access <span aria-hidden="true">↗</span>
        </Link>
      </header>

      {children}

      <footer className="site-footer marketing-footer">
        <div>
          <span>Made for the independently minded.</span>
          <span>Lenni © 2026</span>
        </div>
        <div className="marketing-footer-links">
          <Link href="/guides/what-software-does-my-small-business-need">
            Choosing software
          </Link>
          <Link href="/outgrown-spreadsheets">Outgrown spreadsheets</Link>
          <Link href="/#early-access">Join early access</Link>
          <Link href="#main">Back to top ↑</Link>
        </div>
      </footer>
    </div>
  );
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

  if (
    pathname === "/" ||
    pathname === "/outgrown-spreadsheets" ||
    pathname.startsWith("/guides/")
  ) {
    return <MarketingShell>{children}</MarketingShell>;
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
