import Link from "next/link";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: Readonly<AppShellProps>): ReactNode {
  return (
    <div className="app-frame">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="SMBOS home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          SMBOS
        </Link>

        <Link className="header-link" href="/health">
          System health
        </Link>
      </header>

      {children}

      <footer className="site-footer">
        SMBOS v0.1 · Milestone 0 foundation
      </footer>
    </div>
  );
}
