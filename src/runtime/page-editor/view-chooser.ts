export interface PageViewOption {
  key: string;
  name: string;
  tableKey?: string;
  tableName?: string;
  viewType: "table" | "list" | "cards" | "detail";
}

export interface PageViewTableOption {
  key: string;
  label: string;
  views: readonly PageViewOption[];
}

export interface PageViewSelection {
  tableKey: string;
  viewKey: string;
}

function tableKeyForView(view: PageViewOption): string {
  return view.tableKey ?? view.tableName ?? `view:${view.key}`;
}

export function groupPageViewsByTable(
  availableViews: readonly PageViewOption[],
): readonly PageViewTableOption[] {
  const groups = new Map<string, { label: string; views: PageViewOption[] }>();

  for (const view of availableViews) {
    const key = tableKeyForView(view);
    const group = groups.get(key);
    if (group) {
      group.views.push(view);
      continue;
    }
    groups.set(key, {
      label: view.tableName ?? view.name,
      views: [view],
    });
  }

  return [...groups].map(([key, group]) => ({
    key,
    label: group.label,
    views: group.views,
  }));
}

export function selectPageViewTable(
  tables: readonly PageViewTableOption[],
  tableKey: string,
): PageViewSelection {
  const table = tables.find((candidate) => candidate.key === tableKey);
  return {
    tableKey: table?.key ?? "",
    viewKey: table?.views[0]?.key ?? "",
  };
}

export function selectPageView(
  table: PageViewTableOption | undefined,
  viewKey: string,
): string {
  if (table?.views.some((view) => view.key === viewKey)) {
    return viewKey;
  }
  return table?.views[0]?.key ?? "";
}
