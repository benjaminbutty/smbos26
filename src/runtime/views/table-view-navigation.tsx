"use client";

import { useEffect, useRef } from "react";

import type { Tables } from "../../db/supabase/database.types";
import { experienceKeyToPath } from "../routing";

export function TableViewTabs({
  businessSlug,
  currentViewKey,
  views,
}: Readonly<{
  businessSlug: string;
  currentViewKey: string;
  views: readonly Tables<"views">[];
}>): React.ReactNode {
  const activeTabRef = useRef<HTMLAnchorElement>(null);
  const activeTabId = `table-view-tab-${currentViewKey}`;
  useEffect(() => {
    let timeout: number | undefined;
    const focusActiveTab = (): void => {
      if (window.location.hash !== `#${activeTabId}`) return;
      timeout = window.setTimeout(() => {
        activeTabRef.current?.focus({ preventScroll: true });
      }, 100);
    };
    focusActiveTab();
    window.addEventListener("hashchange", focusActiveTab);
    return () => {
      window.removeEventListener("hashchange", focusActiveTab);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [activeTabId]);
  if (views.length < 2) {
    return null;
  }
  return (
    <nav aria-label="Table views" className="table-view-tabs">
      {views.map((view) => (
        <a
          aria-current={view.key === currentViewKey ? "page" : undefined}
          className={`table-view-tab${view.key === currentViewKey ? " is-active" : ""}`}
          href={`/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(view.key)}`}
          id={`table-view-tab-${view.key}`}
          key={view.key}
          ref={view.key === currentViewKey ? activeTabRef : undefined}
        >
          <span>{view.name}</span>
          {view.config_json &&
          typeof view.config_json === "object" &&
          view.config_json !== null &&
          !Array.isArray(view.config_json) &&
          view.config_json.role === "saved" ? (
            <small>Saved</small>
          ) : null}
        </a>
      ))}
    </nav>
  );
}
