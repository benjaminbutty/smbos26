import {
  displayEditorValue,
  type EditorRow,
  type EditorTable,
  type EditorValue,
} from "./contracts";

export function tableGroupValue(
  table: EditorTable,
  row: EditorRow,
): EditorValue {
  const key = table.grouping?.propertyKey ?? "";
  if (key.startsWith("connection:"))
    return row.connectionValues?.[key]?.[0]?.label ?? null;
  return row.values[key.replace(/^field:/, "")] ?? null;
}

export function tableGroups(table: EditorTable, rows: readonly EditorRow[]) {
  const key = table.grouping?.propertyKey.replace(/^field:/, "");
  const column = (table.recordColumns ?? table.columns).find(
    (item) => item.key === key,
  );
  const groups = new Map<
    string,
    { id: string; label: string; count: number; rows: EditorRow[] }
  >();
  for (const row of rows) {
    const value = tableGroupValue(table, row);
    const id = row.isDraft ? "draft" : JSON.stringify(value);
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        label: row.isDraft
          ? "New record"
          : value === null || value === ""
            ? "No value"
            : column
              ? displayEditorValue(column, value)
              : String(value),
        count:
          table.grouping?.counts.find(
            (item) => JSON.stringify(item.value) === id,
          )?.count ?? 0,
        rows: [],
      };
      groups.set(id, group);
    }
    group.rows.push(row);
    group.count = Math.max(
      group.count,
      group.rows.filter((item) => !item.isDraft).length,
    );
  }
  return [...groups.values()];
}

export function tableVisualRowIndex(
  table: EditorTable,
  rows: readonly EditorRow[],
  rowId: string,
  collapsed: ReadonlySet<unknown>,
): number {
  if (!table.grouping) return rows.findIndex((row) => row.id === rowId);
  let index = 0;
  for (const group of tableGroups(table, rows)) {
    index += 1;
    if (collapsed.has(group.id)) continue;
    const offset = group.rows.findIndex((row) => row.id === rowId);
    if (offset >= 0) return index + offset;
    index += group.rows.length;
  }
  return -1;
}
