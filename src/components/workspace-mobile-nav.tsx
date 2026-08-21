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

type SheetKind = "tables" | "pages" | "more";

interface WorkspaceTableDestination {
  key: string;
  name: string;
  path: string;
}

interface WorkspacePageDestination {
  slug: string;
  title: string;
}

interface WorkspaceMobileNavProps {
  businessSlug: string;
  businessName: string;
  canManageConfiguration: boolean;
  tables: ReadonlyArray<WorkspaceTableDestination>;
  pages: ReadonlyArray<WorkspacePageDestination>;
  sites?: ReadonlyArray<WorkspacePageDestination>;
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isTablePath(pathname: string): boolean {
  return pathname.includes("/workspace/");
}

function isPagePath(pathname: string): boolean {
  return pathname.includes("/pages/") || pathname.includes("/sites/");
}

function closeOnNavigation(
  event: MouseEvent<HTMLAnchorElement>,
  close: () => void,
): void {
  if (!event.defaultPrevented) close();
}

function sheetTitle(sheet: SheetKind): string {
  switch (sheet) {
    case "tables":
      return "Tables";
    case "pages":
      return "Pages";
    case "more":
      return "More";
  }
}

export function WorkspaceMobileNav({
  businessName,
  businessSlug,
  canManageConfiguration,
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
  const isTables = isTablePath(pathname);
  const isPages = isPagePath(pathname);
  const isMore =
    pathname.includes("/builder") ||
    pathname.includes("/changes") ||
    pathname.includes("/locations") ||
    pathname.includes("/setup");

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
  const title = sheet ? sheetTitle(sheet) : "";

  return (
    <>
      <nav
        aria-label="Mobile workspace navigation"
        className="workspace-mobile-nav"
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
          aria-current={isTables ? "page" : undefined}
          aria-expanded={sheet === "tables"}
          aria-haspopup="dialog"
          className={isTables ? "selected" : undefined}
          onClick={(event) => openSheet("tables", event.currentTarget)}
          type="button"
        >
          <span aria-hidden="true">▦</span>
          Tables
        </button>
        <button
          aria-current={isPages ? "page" : undefined}
          aria-expanded={sheet === "pages"}
          aria-haspopup="dialog"
          className={isPages ? "selected" : undefined}
          onClick={(event) => openSheet("pages", event.currentTarget)}
          type="button"
        >
          <span aria-hidden="true">▤</span>
          Pages
        </button>
        <button
          aria-current={isMore ? "page" : undefined}
          aria-expanded={sheet === "more"}
          aria-haspopup="dialog"
          className={isMore ? "selected" : undefined}
          onClick={(event) => openSheet("more", event.currentTarget)}
          type="button"
        >
          <span aria-hidden="true">•••</span>
          More
        </button>
      </nav>

      {sheet ? (
        <div
          aria-label={`${title} navigation`}
          aria-modal="true"
          className="workspace-mobile-sheet"
          ref={sheetRef}
          role="dialog"
        >
          <div className="workspace-mobile-sheet-header">
            <div>
              <p className="workspace-mobile-sheet-kicker">{businessName}</p>
              <h2>{title}</h2>
            </div>
            <button
              aria-label={`Close ${title} navigation`}
              className="workspace-mobile-sheet-close"
              data-sheet-close
              onClick={closeSheet}
              type="button"
            >
              ×
            </button>
          </div>

          {sheet === "tables" ? (
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
            </div>
          ) : null}

          {sheet === "pages" ? (
            <div className="workspace-mobile-sheet-body">
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
            </div>
          ) : null}

          {sheet === "more" ? (
            <div className="workspace-mobile-sheet-body">
              <section aria-labelledby="mobile-utilities-heading">
                <h3 id="mobile-utilities-heading">Workspace</h3>
                <div className="workspace-mobile-sheet-links">
                  {canManageConfiguration ? (
                    <Link
                      href={`${rootPath}/builder`}
                      onClick={(event) => closeOnNavigation(event, closeSheet)}
                    >
                      <span aria-hidden="true">→</span>
                      Tell Lenni
                    </Link>
                  ) : null}
                  {canManageConfiguration ? (
                    <Link
                      href={`${rootPath}/changes`}
                      onClick={(event) => closeOnNavigation(event, closeSheet)}
                    >
                      <span aria-hidden="true">≋</span>
                      Changes
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
          ) : null}
        </div>
      ) : null}
    </>
  );
}
