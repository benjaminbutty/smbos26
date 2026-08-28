"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

function MarketingShell({ children }: Readonly<AppShellProps>): ReactNode {
  return (
    <div className="app-frame marketing-frame">
      <header className="site-header marketing-header">
        <Link className="marketing-brand" href="/" aria-label="Lenni home">
          Lenni
        </Link>

        <nav
          className="marketing-nav marketing-nav-desktop"
          aria-label="Primary"
        >
          <Link href="/outgrown-spreadsheets">Outgrown spreadsheets</Link>
          <Link href="/#early-access">Early access</Link>
          <Link className="marketing-header-action" href="/#early-access">
            Join early access
          </Link>
        </nav>

        <details className="marketing-nav-mobile">
          <summary>Menu</summary>
          <nav aria-label="Mobile primary">
            <Link href="/outgrown-spreadsheets">Outgrown spreadsheets</Link>
            <Link href="/#early-access">Early access</Link>
            <Link href="/#early-access">Join early access</Link>
          </nav>
        </details>
      </header>

      {children}

      <footer className="site-footer marketing-footer">
        <div>
          <Link className="marketing-brand" href="/">
            Lenni
          </Link>
          <span>Your business, in one calm workspace.</span>
        </div>
        <Link href="/#early-access">Join early access</Link>
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

  if (pathname === "/" || pathname === "/outgrown-spreadsheets") {
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
