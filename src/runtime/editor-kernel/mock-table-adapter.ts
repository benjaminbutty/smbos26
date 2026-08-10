import {
  columnKeyFromLabel,
  editorValueForColumn,
  type CreateColumnInput,
  type EditorColumn,
  type EditorColumnKind,
  type EditorPasteRequest,
  type EditorPasteResult,
  type EditorPasteFailure,
  type EditorRow,
  type EditorTable,
  type EditorValue,
  type TableEditorAdapter,
} from "./contracts";

export const mockFailureTrigger = "!fail";

export interface MockTableAdapterOptions {
  delayMs?: number;
}

function cloneColumn(column: EditorColumn): EditorColumn {
  return {
    ...column,
    ...(column.options ? { options: [...column.options] } : {}),
  };
}

function cloneRow(row: EditorRow): EditorRow {
  return { ...row, values: { ...row.values } };
}

function cloneTable(table: EditorTable): EditorTable {
  return {
    ...table,
    columns: table.columns.map(cloneColumn),
    rows: table.rows.map(cloneRow),
  };
}

function defaultValue(column: EditorColumn): EditorValue {
  switch (column.kind) {
    case "boolean":
      return false;
    case "number":
    case "currency":
      return null;
    case "status":
    case "select":
      return column.options?.[0] ?? "";
    case "multi_select":
    case "connection":
      return [];
    case "text":
    case "long_text":
    case "email":
    case "url":
    case "phone":
    case "date":
    case "datetime":
    case "file":
      return "";
  }
}

function createMockColumns(): EditorColumn[] {
  return [
    {
      key: "name",
      label: "Name",
      kind: "text",
      primary: true,
      width: 230,
    },
    { key: "phone", label: "Phone", kind: "phone", width: 170 },
    {
      key: "status",
      label: "Status",
      kind: "status",
      options: ["Active", "Inactive", "Lead"],
      width: 145,
    },
    { key: "quantity", label: "Quantity", kind: "number", width: 120 },
    { key: "subscribed", label: "Subscribed", kind: "boolean", width: 135 },
    {
      key: "next_delivery_date",
      label: "Next delivery date",
      kind: "date",
      width: 190,
    },
  ];
}

const seedRows: ReadonlyArray<Readonly<Record<string, EditorValue>>> = [
  {
    name: "Amelia Carter",
    phone: "07700 900101",
    status: "Active",
    quantity: 3,
    subscribed: true,
    next_delivery_date: "2026-08-12",
  },
  {
    name: "Benji Morgan",
    phone: "07700 900102",
    status: "Lead",
    quantity: 1,
    subscribed: false,
    next_delivery_date: "2026-08-15",
  },
  {
    name: "Charlotte Evans",
    phone: "07700 900103",
    status: "Active",
    quantity: 6,
    subscribed: true,
    next_delivery_date: "2026-08-16",
  },
  {
    name: "Daniel Hughes",
    phone: "07700 900104",
    status: "Inactive",
    quantity: 0,
    subscribed: false,
    next_delivery_date: "",
  },
  {
    name: "Eleanor Foster",
    phone: "07700 900105",
    status: "Active",
    quantity: 4,
    subscribed: true,
    next_delivery_date: "2026-08-19",
  },
  {
    name: "Freddie Walsh",
    phone: "07700 900106",
    status: "Lead",
    quantity: 2,
    subscribed: false,
    next_delivery_date: "2026-08-20",
  },
  {
    name: "Grace Bennett",
    phone: "07700 900107",
    status: "Active",
    quantity: 8,
    subscribed: true,
    next_delivery_date: "2026-08-21",
  },
  {
    name: "Harry Palmer",
    phone: "07700 900108",
    status: "Active",
    quantity: 5,
    subscribed: true,
    next_delivery_date: "2026-08-22",
  },
  {
    name: "Isla Dixon",
    phone: "07700 900109",
    status: "Inactive",
    quantity: 0,
    subscribed: false,
    next_delivery_date: "",
  },
  {
    name: "Jack Richardson",
    phone: "07700 900110",
    status: "Lead",
    quantity: 1,
    subscribed: false,
    next_delivery_date: "2026-08-27",
  },
  {
    name: "Katherine Shaw",
    phone: "07700 900111",
    status: "Active",
    quantity: 7,
    subscribed: true,
    next_delivery_date: "2026-08-28",
  },
  {
    name: "Liam Turner",
    phone: "07700 900112",
    status: "Active",
    quantity: 2,
    subscribed: true,
    next_delivery_date: "2026-08-29",
  },
  {
    name: "Maya Collins",
    phone: "07700 900113",
    status: "Lead",
    quantity: 3,
    subscribed: false,
    next_delivery_date: "2026-08-30",
  },
  {
    name: "Noah Williams",
    phone: "07700 900114",
    status: "Active",
    quantity: 5,
    subscribed: true,
    next_delivery_date: "2026-09-01",
  },
  {
    name: "Olivia King",
    phone: "07700 900115",
    status: "Inactive",
    quantity: 0,
    subscribed: false,
    next_delivery_date: "",
  },
  {
    name: "Peter James",
    phone: "07700 900116",
    status: "Active",
    quantity: 9,
    subscribed: true,
    next_delivery_date: "2026-09-03",
  },
  {
    name: "Ruby Ellis",
    phone: "07700 900117",
    status: "Lead",
    quantity: 2,
    subscribed: false,
    next_delivery_date: "2026-09-04",
  },
  {
    name: "Samuel Wright",
    phone: "07700 900118",
    status: "Active",
    quantity: 4,
    subscribed: true,
    next_delivery_date: "2026-09-05",
  },
  {
    name: "Thea Cooper",
    phone: "07700 900119",
    status: "Active",
    quantity: 6,
    subscribed: true,
    next_delivery_date: "2026-09-06",
  },
  {
    name: "William Green",
    phone: "07700 900120",
    status: "Inactive",
    quantity: 0,
    subscribed: false,
    next_delivery_date: "",
  },
];

function seedRow(
  columns: readonly EditorColumn[],
  id: string,
  values: Readonly<Record<string, EditorValue>>,
): EditorRow {
  const rowValues: Record<string, EditorValue> = {};
  for (const column of columns) {
    const value = values[column.key];
    rowValues[column.key] = value === undefined ? defaultValue(column) : value;
  }
  return {
    id,
    values: rowValues,
  };
}

function normalizedOptions(options: readonly string[] | undefined): string[] {
  const next = (options ?? []).map((option) => option.trim()).filter(Boolean);
  return next.length >= 2 ? [...new Set(next)] : ["Option 1", "Option 2"];
}

function columnWithOptions(
  input: CreateColumnInput,
  key: string,
  width = 160,
): EditorColumn {
  const base: EditorColumn = {
    key,
    label: input.label.trim(),
    kind: input.kind,
    width,
  };
  return input.kind === "status" || input.kind === "select"
    ? { ...base, options: normalizedOptions(input.options) }
    : base;
}

export class MockTableAdapter implements TableEditorAdapter {
  private table: EditorTable;

  private readonly delayMs: number;

  private nextRowNumber = seedRows.length + 1;

  private readonly failedUpdates = new Set<string>();

  constructor(options: MockTableAdapterOptions = {}) {
    const columns = createMockColumns();
    this.delayMs = options.delayMs ?? 240;
    this.table = {
      key: "customers",
      name: "Customers",
      primaryColumnKey: "name",
      columns,
      rows: seedRows.map((values, index) =>
        seedRow(columns, `customer-${index + 1}`, values),
      ),
    };
  }

  getTable(): EditorTable {
    return cloneTable(this.table);
  }

  async updateCell(
    rowId: string,
    columnKey: string,
    value: EditorValue,
  ): Promise<EditorRow> {
    await this.wait();
    const row = this.table.rows.find((candidate) => candidate.id === rowId);
    const column = this.table.columns.find(
      (candidate) => candidate.key === columnKey,
    );
    if (!row || !column) {
      throw new Error("That mock cell is no longer available.");
    }

    const nextValue = editorValueForColumn(column, value);
    const failureKey = `${rowId}:${columnKey}`;
    if (
      nextValue === mockFailureTrigger &&
      !this.failedUpdates.has(failureKey)
    ) {
      this.failedUpdates.add(failureKey);
      throw new Error("Simulated save failure.");
    }

    const nextRow: EditorRow = {
      ...row,
      values: { ...row.values, [columnKey]: nextValue },
    };
    this.table = {
      ...this.table,
      rows: this.table.rows.map((candidate) =>
        candidate.id === rowId ? nextRow : candidate,
      ),
    };
    return cloneRow(nextRow);
  }

  async createRow(
    initialValues: Readonly<Record<string, EditorValue>>,
  ): Promise<EditorRow> {
    await this.wait();
    const primary = this.table.columns.find(
      (column) => column.key === this.table.primaryColumnKey,
    );
    if (!primary) {
      throw new Error("The mock Table has no primary column.");
    }
    const name = String(initialValues[primary.key] ?? "").trim();
    if (!name) {
      throw new Error("A record needs a Name.");
    }

    const row = seedRow(this.table.columns, `customer-${this.nextRowNumber}`, {
      ...initialValues,
      [primary.key]: name,
    });
    this.nextRowNumber += 1;
    this.table = { ...this.table, rows: [...this.table.rows, row] };
    return cloneRow(row);
  }

  async createColumn(input: CreateColumnInput): Promise<EditorColumn> {
    await this.wait();
    const label = input.label.trim();
    if (!label) {
      throw new Error("A column needs a name.");
    }
    let key = columnKeyFromLabel(label);
    let suffix = 2;
    while (this.table.columns.some((column) => column.key === key)) {
      key = `${columnKeyFromLabel(label)}_${suffix}`;
      suffix += 1;
    }

    const column = columnWithOptions(input, key);
    this.table = {
      ...this.table,
      columns: [...this.table.columns, column],
      rows: this.table.rows.map((row) => ({
        ...row,
        values: { ...row.values, [key]: defaultValue(column) },
      })),
    };
    return cloneColumn(column);
  }

  async insertColumn(
    input: import("./contracts").InsertColumnInput,
  ): Promise<EditorColumn> {
    await this.wait();
    const label = input.label.trim();
    if (!label) throw new Error("A column needs a name.");
    let key = columnKeyFromLabel(label);
    let suffix = 2;
    while (this.table.columns.some((column) => column.key === key)) {
      key = `${columnKeyFromLabel(label)}_${suffix}`;
      suffix += 1;
    }
    const column = columnWithOptions(input, key);
    const anchorIndex = this.table.columns.findIndex(
      (candidate) => candidate.key === input.anchorColumnKey,
    );
    if (anchorIndex < 0)
      throw new Error("That mock column is no longer available.");
    const columns = [...this.table.columns];
    columns.splice(
      anchorIndex + (input.position === "right" ? 1 : 0),
      0,
      column,
    );
    this.table = {
      ...this.table,
      columns,
      rows: this.table.rows.map((row) => ({
        ...row,
        values: { ...row.values, [key]: defaultValue(column) },
      })),
    };
    return cloneColumn(column);
  }

  async renameColumn(columnKey: string, label: string): Promise<EditorColumn> {
    await this.wait();
    const nextLabel = label.trim();
    if (!nextLabel) {
      throw new Error("A column needs a name.");
    }
    const column = this.table.columns.find(
      (candidate) => candidate.key === columnKey,
    );
    if (!column) {
      throw new Error("That mock column is no longer available.");
    }
    const nextColumn = { ...column, label: nextLabel };
    this.table = {
      ...this.table,
      columns: this.table.columns.map((candidate) =>
        candidate.key === columnKey ? nextColumn : candidate,
      ),
    };
    return cloneColumn(nextColumn);
  }

  async changeColumnType(
    columnKey: string,
    kind: EditorColumnKind,
    options?: readonly string[],
    currency?: string,
  ): Promise<EditorColumn> {
    await this.wait();
    const column = this.table.columns.find(
      (candidate) => candidate.key === columnKey,
    );
    if (!column) throw new Error("That mock column is no longer available.");
    const nextColumn: EditorColumn = {
      ...column,
      kind,
      ...(options ? { options: normalizedOptions(options) } : {}),
      ...(currency ? { currency } : {}),
    };
    this.table = {
      ...this.table,
      columns: this.table.columns.map((candidate) =>
        candidate.key === columnKey ? nextColumn : candidate,
      ),
    };
    return cloneColumn(nextColumn);
  }

  async updateColumnOptions(
    columnKey: string,
    options: readonly string[],
  ): Promise<EditorColumn> {
    await this.wait();
    const column = this.table.columns.find(
      (candidate) => candidate.key === columnKey,
    );
    if (!column || (column.kind !== "select" && column.kind !== "status")) {
      throw new Error("That mock column does not support options.");
    }
    const nextColumn = {
      ...column,
      options: normalizedOptions(options),
    };
    this.table = {
      ...this.table,
      columns: this.table.columns.map((candidate) =>
        candidate.key === columnKey ? nextColumn : candidate,
      ),
    };
    return cloneColumn(nextColumn);
  }

  async reorderColumns(
    columnKeys: readonly string[],
  ): Promise<readonly EditorColumn[]> {
    await this.wait();
    if (
      columnKeys.length !== this.table.columns.length ||
      new Set(columnKeys).size !== this.table.columns.length ||
      this.table.columns.some((column) => !columnKeys.includes(column.key))
    ) {
      throw new Error("That column order is not valid.");
    }
    const byKey = new Map(
      this.table.columns.map((column) => [column.key, column]),
    );
    const columns = columnKeys.flatMap((key) => {
      const column = byKey.get(key);
      return column ? [column] : [];
    });
    this.table = { ...this.table, columns };
    return columns.map(cloneColumn);
  }

  async resizeColumn(columnKey: string, width: number): Promise<EditorColumn> {
    await this.wait();
    const column = this.table.columns.find(
      (candidate) => candidate.key === columnKey,
    );
    if (!column) {
      throw new Error("That mock column is no longer available.");
    }
    const nextColumn = {
      ...column,
      width: Math.max(128, Math.min(640, width)),
    };
    this.table = {
      ...this.table,
      columns: this.table.columns.map((candidate) =>
        candidate.key === columnKey ? nextColumn : candidate,
      ),
    };
    return cloneColumn(nextColumn);
  }

  async renameTable(title: string): Promise<EditorTable> {
    await this.wait();
    const nextName = title.trim();
    if (!nextName) {
      throw new Error("A Table needs a name.");
    }
    this.table = { ...this.table, name: nextName };
    return cloneTable(this.table);
  }

  async applyPaste(request: EditorPasteRequest): Promise<EditorPasteResult> {
    await this.wait();
    const saved: EditorRow[] = [];
    const failures: EditorPasteFailure[] = [];
    for (const [rowOffset, values] of request.matrix.entries()) {
      const rowIndex = request.startRowIndex + rowOffset;
      const existing = this.table.rows[rowIndex];
      const nextValues: Record<string, EditorValue> = {};
      for (const [columnOffset, raw] of values.entries()) {
        const column =
          this.table.columns[request.startColumnIndex + columnOffset];
        if (!column || column.editable === false) continue;
        try {
          nextValues[column.key] = editorValueForColumn(column, raw);
        } catch (error) {
          failures.push({
            rowIndex: rowOffset,
            fieldKey: column.key,
            message: error instanceof Error ? error.message : "Invalid value.",
          });
        }
      }
      if (failures.some((failure) => failure.rowIndex === rowOffset)) continue;
      if (existing) {
        const nextRow = {
          ...existing,
          values: { ...existing.values, ...nextValues },
        };
        this.table = {
          ...this.table,
          rows: this.table.rows.map((row) =>
            row.id === existing.id ? nextRow : row,
          ),
        };
        saved.push(cloneRow(nextRow));
      } else {
        const primary = nextValues[this.table.primaryColumnKey];
        if (typeof primary !== "string" || !primary.trim()) {
          failures.push({
            rowIndex: rowOffset,
            message: "A new Record needs a primary value.",
          });
          continue;
        }
        const row = await this.createRow(nextValues);
        saved.push(row);
      }
    }
    return { rows: saved, failures };
  }

  async openRecord(rowId: string): Promise<EditorRow | null> {
    await this.wait();
    const row = this.table.rows.find((candidate) => candidate.id === rowId);
    return row ? cloneRow(row) : null;
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, this.delayMs);
    });
  }
}

export function createMockTableAdapter(
  options?: MockTableAdapterOptions,
): TableEditorAdapter {
  return new MockTableAdapter(options);
}
