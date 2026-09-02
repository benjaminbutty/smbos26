"use client";

import { useEffect, useRef, useState } from "react";

import type { Tables } from "../../db/supabase/database.types";
import { experienceKeyToPath } from "../routing";

function isSavedView(view: Tables<"views">): boolean {
  return Boolean(
    view.config_json &&
    typeof view.config_json === "object" &&
    !Array.isArray(view.config_json) &&
    view.config_json.role === "saved",
  );
}

/**
 * Presentation only: View identities, routes and configuration semantics stay
 * unchanged from the replaced tab strip.
 */
export function TableViewSelector({
  businessSlug,
  canCreateSavedViews = false,
  currentViewKey,
  views,
}: Readonly<{
  businessSlug: string;
  canCreateSavedViews?: boolean;
  currentViewKey: string;
  views: readonly Tables<"views">[];
}>): React.ReactNode {
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const orderedViews = [...views].sort(
    (left, right) => Number(isSavedView(left)) - Number(isSavedView(right)),
  );
  const currentView = orderedViews.find((view) => view.key === currentViewKey);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !selectorRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectCreateView = (): void => {
    setOpen(false);
    window.location.hash = "create-saved-view";
  };

  return (
    <nav
      aria-label="Table views"
      className="table-view-selector"
      ref={selectorRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="table-view-selector-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="table-view-selector-label">Current view</span>
        <strong>{currentView?.name ?? "Table"}</strong>
        <span aria-hidden="true" className="table-view-selector-chevron">
          ⌄
        </span>
      </button>
      {open ? (
        <div className="table-view-selector-menu" role="menu">
          {orderedViews.map((view) => {
            const current = view.key === currentViewKey;
            return (
              <a
                aria-current={current ? "page" : undefined}
                className={`table-view-selector-option${current ? " is-current" : ""}`}
                href={`/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(view.key)}#table-view-selector-${view.key}`}
                key={view.key}
                onClick={() => setOpen(false)}
                role="menuitem"
              >
                <span>{view.name}</span>
                {current ? (
                  <span className="table-view-selector-current">Current</span>
                ) : isSavedView(view) ? null : (
                  <span className="table-view-selector-primary">Main</span>
                )}
              </a>
            );
          })}
          {canCreateSavedViews ? (
            <>
              <div aria-hidden="true" className="table-view-selector-divider" />
              <button
                className="table-view-selector-create"
                onClick={selectCreateView}
                role="menuitem"
                type="button"
              >
                <span aria-hidden="true">+</span> Create new view
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
