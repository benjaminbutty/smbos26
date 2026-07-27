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
