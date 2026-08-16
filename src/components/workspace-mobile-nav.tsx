"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

type SheetKind = "work" | "more";

interface WorkspaceTableDestination {
  key: string;
  name: string;
  path: string;
}

interface WorkspacePageDestination {
  slug: string;
  title: string;
}

interface WorkspaceViewDestination {
  key: string;
  name: string;
  path: string;
}

interface WorkspaceMobileNavProps {
  businessSlug: string;
  businessName: string;
  canManageConfiguration: boolean;
  tables: ReadonlyArray<WorkspaceTableDestination>;
  pages: ReadonlyArray<WorkspacePageDestination>;
  otherViews: ReadonlyArray<WorkspaceViewDestination>;
  sites?: ReadonlyArray<WorkspacePageDestination>;
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isWorkPath(pathname: string): boolean {
  return (
    pathname.includes("/workspace/") ||
    pathname.includes("/pages/") ||
    pathname.includes("/sites/")
  );
}

function closeOnNavigation(
  event: MouseEvent<HTMLAnchorElement>,
  close: () => void,
): void {
  if (!event.defaultPrevented) close();
}

export function WorkspaceMobileNav({
  businessName,
  businessSlug,
  canManageConfiguration,
  otherViews,
  pages,
  sites = [],
  tables,
}: Readonly<WorkspaceMobileNavProps>): ReactNode {
  const pathname = usePathname();
  const rootPath = `/app/${encodeURIComponent(businessSlug)}`;
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<
    Partial<Record<SheetKind, HTMLButtonElement | null>>
  >({});
  const lastSheetRef = useRef<SheetKind | null>(null);
  const isHome = pathname === rootPath || pathname === `${rootPath}/`;
  const isWork = isWorkPath(pathname);
  const isTellLenni = pathname.includes("/builder");

  useEffect(() => {
    if (!sheet) {
      const trigger = lastSheetRef.current
        ? triggerRefs.current[lastSheetRef.current]
        : null;
      if (trigger) trigger.focus();
      lastSheetRef.current = null;
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      sheetRef.current
        ?.querySelector<HTMLElement>("[data-sheet-close]")
        ?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSheet(null);
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;

      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [sheet]);

  const openSheet = (
    nextSheet: SheetKind,
    trigger: HTMLButtonElement | null,
  ): void => {
    triggerRefs.current[nextSheet] = trigger;
    lastSheetRef.current = nextSheet;
    setSheet(nextSheet);
  };

  const closeSheet = (): void => setSheet(null);

  return (
    <>
      <nav
        aria-label="Mobile workspace navigation"
        className={`workspace-mobile-nav ${
          canManageConfiguration
            ? "workspace-mobile-nav-owner"
            : "workspace-mobile-nav-staff"
        }`}
      >
        <Link
          aria-current={isHome ? "page" : undefined}
          className={isHome ? "selected" : undefined}
          href={rootPath}
          onClick={(event) => closeOnNavigation(event, closeSheet)}
        >
          <span aria-hidden="true">⌂</span>
          Home
        </Link>
        <button
          aria-current={isWork ? "page" : undefined}
          aria-expanded={sheet === "work"}
          aria-haspopup="dialog"
          className={isWork ? "selected" : undefined}
          onClick={(event) => openSheet("work", event.currentTarget)}
          type="button"
        >
          <span aria-hidden="true">▦</span>
          Work
        </button>
        {canManageConfiguration ? (
          <Link
            aria-current={isTellLenni ? "page" : undefined}
            className={isTellLenni ? "selected" : undefined}
            href={`${rootPath}/builder`}
            onClick={(event) => closeOnNavigation(event, closeSheet)}
          >
            <span aria-hidden="true">✦</span>
            Tell Lenni
          </Link>
        ) : null}
        <button
          aria-expanded={sheet === "more"}
          aria-haspopup="dialog"
          onClick={(event) => openSheet("more", event.currentTarget)}
          type="button"
        >
          <span aria-hidden="true">•••</span>
          More
        </button>
      </nav>

      {sheet ? (
        <div
          aria-label={`${sheet === "work" ? "Work" : "More"} navigation`}
          aria-modal="true"
          className="workspace-mobile-sheet"
          ref={sheetRef}
          role="dialog"
        >
          <div className="workspace-mobile-sheet-header">
            <div>
              <p className="workspace-mobile-sheet-kicker">{businessName}</p>
              <h2>{sheet === "work" ? "Work" : "More"}</h2>
            </div>
            <button
              aria-label={`Close ${sheet === "work" ? "Work" : "More"} navigation`}
              className="workspace-mobile-sheet-close"
              data-sheet-close
              onClick={closeSheet}
              type="button"
            >
              ×
            </button>
          </div>

          {sheet === "work" ? (
            <div className="workspace-mobile-sheet-body">
              <section aria-labelledby="mobile-tables-heading">
                <h3 id="mobile-tables-heading">Tables</h3>
                <div className="workspace-mobile-sheet-links">
                  {tables.length > 0 ? (
                    tables.map((table) => (
                      <Link
                        aria-current={
                          pathname === `${rootPath}/workspace/${table.path}`
                            ? "page"
                            : undefined
                        }
                        href={`${rootPath}/workspace/${table.path}`}
                        key={table.key}
                        onClick={(event) =>
                          closeOnNavigation(event, closeSheet)
                        }
                      >
                        <span aria-hidden="true">▦</span>
                        {table.name}
                      </Link>
                    ))
                  ) : (
                    <span className="workspace-mobile-sheet-empty">
                      No Tables yet
                    </span>
                  )}
                </div>
              </section>

              <section aria-labelledby="mobile-pages-heading">
                <h3 id="mobile-pages-heading">Pages</h3>
                <div className="workspace-mobile-sheet-links">
                  {pages.length > 0 ? (
                    pages.map((page) => (
                      <Link
                        aria-current={
                          pathname === `${rootPath}/pages/${page.slug}`
                            ? "page"
                            : undefined
                        }
                        href={`${rootPath}/pages/${page.slug}`}
                        key={page.slug}
                        onClick={(event) =>
                          closeOnNavigation(event, closeSheet)
                        }
                      >
                        <span aria-hidden="true">▤</span>
                        {page.title}
                      </Link>
                    ))
                  ) : (
                    <span className="workspace-mobile-sheet-empty">
                      No Pages yet
                    </span>
                  )}
                </div>
              </section>

              {sites.length > 0 ? (
                <section aria-labelledby="mobile-sites-heading">
                  <h3 id="mobile-sites-heading">Sites</h3>
                  <div className="workspace-mobile-sheet-links">
                    {sites.map((site) => (
                      <Link
                        aria-current={
                          pathname === `${rootPath}/sites/${site.slug}`
                            ? "page"
                            : undefined
                        }
                        href={`${rootPath}/sites/${site.slug}`}
                        key={site.slug}
                        onClick={(event) =>
                          closeOnNavigation(event, closeSheet)
                        }
                      >
                        <span aria-hidden="true">▣</span>
                        {site.title}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}

              {otherViews.length > 0 ? (
                <section aria-labelledby="mobile-other-views-heading">
                  <h3 id="mobile-other-views-heading">Other views</h3>
                  <div className="workspace-mobile-sheet-links">
                    {otherViews.map((view) => (
                      <Link
                        aria-current={
                          pathname === `${rootPath}/workspace/${view.path}`
                            ? "page"
                            : undefined
                        }
                        href={`${rootPath}/workspace/${view.path}`}
                        key={view.key}
                        onClick={(event) =>
                          closeOnNavigation(event, closeSheet)
                        }
                      >
                        <span aria-hidden="true">◌</span>
                        {view.name}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="workspace-mobile-sheet-body">
              <section aria-labelledby="mobile-utilities-heading">
                <h3 id="mobile-utilities-heading">Workspace</h3>
                <div className="workspace-mobile-sheet-links">
                  {canManageConfiguration ? (
                    <Link
                      href={`${rootPath}/changes`}
                      onClick={(event) => closeOnNavigation(event, closeSheet)}
                    >
                      <span aria-hidden="true">≋</span>
                      Changes
                    </Link>
                  ) : null}
                  {canManageConfiguration ? (
                    <Link
                      href={`${rootPath}/setup`}
                      onClick={(event) => closeOnNavigation(event, closeSheet)}
                    >
                      <span aria-hidden="true">◉</span>
                      Setup
                    </Link>
                  ) : null}
                  <Link
                    href={`${rootPath}/locations`}
                    onClick={(event) => closeOnNavigation(event, closeSheet)}
                  >
                    <span aria-hidden="true">◎</span>
                    Settings
                  </Link>
                  <Link
                    href="/onboarding"
                    onClick={(event) => closeOnNavigation(event, closeSheet)}
                  >
                    <span aria-hidden="true">◌</span>
                    Account and businesses
                  </Link>
                </div>
              </section>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
