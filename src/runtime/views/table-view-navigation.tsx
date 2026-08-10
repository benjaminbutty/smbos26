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
          key={view.key}
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
