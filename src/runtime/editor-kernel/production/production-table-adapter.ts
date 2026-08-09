import type {
  CreateColumnInput,
  EditorColumn,
  EditorColumnKind,
  EditorRow,
  EditorTable,
  EditorValue,
  TableEditorAdapter,
} from "../contracts";
import type {
  ProductionAddColumnAction,
  ProductionConfigurationCurrentness,
  ProductionCellEditAction,
  ProductionRecordReadAction,
  ProductionRenameColumnAction,
  ProductionRenameTableAction,
  ProductionReorderColumnsAction,
  ProductionRowCreateAction,
  ProductionUpdateColumnOptionsAction,
  ProductionColumnType,
} from "./action-types";

export interface ProductionTableAdapterActions {
  updateCell: ProductionCellEditAction;
  createRow: ProductionRowCreateAction;
  openRecord: ProductionRecordReadAction;
  addColumn: ProductionAddColumnAction;
  renameColumn: ProductionRenameColumnAction;
  updateColumnOptions: ProductionUpdateColumnOptionsAction;
  reorderColumns: ProductionReorderColumnsAction;
  renameTable: ProductionRenameTableAction;
}

function cloneValue(value: EditorValue): EditorValue {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (value !== null && typeof value === "object") {
    return { ...value };
  }
  return value;
}

function cloneColumn(column: EditorColumn): EditorColumn {
  return {
    ...column,
    ...(column.options ? { options: [...column.options] } : {}),
  };
}

function cloneRow(row: EditorRow): EditorRow {
  return {
    ...row,
    values: Object.fromEntries(
      Object.entries(row.values).map(([key, value]) => [
        key,
        cloneValue(value),
      ]),
    ),
  };
}

function cloneTable(table: EditorTable): EditorTable {
  const columns = table.columns.map(cloneColumn);
  const recordColumns = table.recordColumns?.map(cloneColumn);
  return {
    ...table,
    columns,
    ...(recordColumns ? { recordColumns } : {}),
    rows: table.rows.map(cloneRow),
  };
}

function replaceRow(table: EditorTable, row: EditorRow): EditorTable {
  return {
    ...table,
    rows: table.rows.map((candidate) =>
      candidate.id === row.id ? cloneRow(row) : candidate,
    ),
  };
}

function cloneCurrentness(
  currentness: ProductionConfigurationCurrentness,
): ProductionConfigurationCurrentness {
  return { ...currentness };
}

function directColumnType(kind: EditorColumnKind): ProductionColumnType {
  switch (kind) {
    case "text":
      return "short_text";
    case "long_text":
      return "long_text";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "email":
      return "email";
    case "phone":
      return "phone";
    case "url":
      return "url";
    case "select":
      return "select";
    case "status":
      return "status";
    default:
      throw new Error("That column type is unavailable in this preview.");
  }
}

function unavailable(): never {
  throw new Error("Structural Table controls are unavailable in this preview.");
}

export class ProductionTableAdapter implements TableEditorAdapter {
  private table: EditorTable;

  private currentness: ProductionConfigurationCurrentness | null;

  constructor(
    initialTable: EditorTable,
    private readonly actions: ProductionTableAdapterActions,
    initialCurrentness?: ProductionConfigurationCurrentness,
  ) {
    this.table = cloneTable(initialTable);
    this.currentness = initialCurrentness
      ? cloneCurrentness(initialCurrentness)
      : null;
  }

  getTable(): EditorTable {
    return cloneTable(this.table);
  }

  async updateCell(
    rowId: string,
    columnKey: string,
    value: EditorValue,
  ): Promise<EditorRow> {
    const result = await this.actions.updateCell({
      recordId: rowId,
      fieldKey: columnKey,
      value,
    });
    if (result.status === "error") {
      throw new Error(result.message);
    }
    this.table = replaceRow(this.table, result.value);
    return cloneRow(result.value);
  }

  async createRow(
    initialValues: Readonly<Record<string, EditorValue>>,
  ): Promise<EditorRow> {
    const primaryValue = initialValues[this.table.primaryColumnKey];
    if (typeof primaryValue !== "string" || !primaryValue.trim()) {
      throw new Error("A record needs a primary value.");
    }
    const result = await this.actions.createRow({
      primaryValue: primaryValue.trim(),
    });
    if (result.status === "error") {
      throw new Error(result.message);
    }
    this.table = {
      ...this.table,
      rows: [...this.table.rows, cloneRow(result.value)],
    };
    return cloneRow(result.value);
  }

  async openRecord(rowId: string): Promise<EditorRow | null> {
    const result = await this.actions.openRecord({ recordId: rowId });
    if (result.status === "error") {
      throw new Error(result.message);
    }
    if (!result.value) {
      return null;
    }
    this.table = replaceRow(this.table, result.value);
    return cloneRow(result.value);
  }

  async createColumn(input: CreateColumnInput): Promise<EditorColumn> {
    const result = await this.actions.addColumn({
      currentness: this.requireCurrentness(),
      label: input.label,
      columnType: directColumnType(input.kind),
      ...(input.options ? { options: [...input.options] } : {}),
    });
    const table = this.applyStructure(result);
    const column = table.columns.find(
      (candidate) => candidate.label === input.label.trim(),
    );
    if (!column) {
      throw new Error("The new column could not be found after saving.");
    }
    return cloneColumn(column);
  }

  async renameColumn(columnKey: string, label: string): Promise<EditorColumn> {
    const result = await this.actions.renameColumn({
      currentness: this.requireCurrentness(),
      fieldKey: columnKey,
      label,
    });
    const table = this.applyStructure(result);
    const column = table.columns.find(
      (candidate) => candidate.key === columnKey,
    );
    if (!column) {
      throw new Error("That column is no longer available.");
    }
    return cloneColumn(column);
  }

  async updateColumnOptions(
    columnKey: string,
    options: readonly string[],
  ): Promise<EditorColumn> {
    const result = await this.actions.updateColumnOptions({
      currentness: this.requireCurrentness(),
      fieldKey: columnKey,
      options: [...options],
    });
    const table = this.applyStructure(result);
    const column = table.columns.find(
      (candidate) => candidate.key === columnKey,
    );
    if (!column) {
      throw new Error("That column is no longer available.");
    }
    return cloneColumn(column);
  }

  async reorderColumns(
    columnKeys: readonly string[],
  ): Promise<readonly EditorColumn[]> {
    const result = await this.actions.reorderColumns({
      currentness: this.requireCurrentness(),
      fieldKeys: [...columnKeys],
    });
    return this.applyStructure(result).columns.map(cloneColumn);
  }

  async resizeColumn(columnKey: string, width: number): Promise<EditorColumn> {
    const column = this.table.columns.find(
      (candidate) => candidate.key === columnKey,
    );
    if (!column) {
      throw new Error("That column is no longer available.");
    }
    const nextColumn = {
      ...column,
      width: Math.max(128, Math.min(640, Math.round(width))),
    };
    this.table = {
      ...this.table,
      columns: this.table.columns.map((candidate) =>
        candidate.key === columnKey ? nextColumn : candidate,
      ),
      ...(this.table.recordColumns
        ? {
            recordColumns: this.table.recordColumns.map((candidate) =>
              candidate.key === columnKey ? nextColumn : candidate,
            ),
          }
        : {}),
    };
    return cloneColumn(nextColumn);
  }

  async renameTable(title: string): Promise<EditorTable> {
    const result = await this.actions.renameTable({
      currentness: this.requireCurrentness(),
      title,
    });
    return this.applyStructure(result);
  }

  private requireCurrentness(): ProductionConfigurationCurrentness {
    return this.currentness
      ? cloneCurrentness(this.currentness)
      : unavailable();
  }

  private applyStructure(
    result: Awaited<ReturnType<ProductionAddColumnAction>>,
  ): EditorTable {
    if (result.status === "error") {
      throw new Error(result.message);
    }
    const localWidths = new Map(
      this.table.columns.map((column) => [column.key, column.width]),
    );
    const nextTable = cloneTable(result.value.table);
    this.table = {
      ...nextTable,
      columns: nextTable.columns.map((column) =>
        localWidths.has(column.key)
          ? { ...column, width: localWidths.get(column.key)! }
          : column,
      ),
      ...(nextTable.recordColumns
        ? {
            recordColumns: nextTable.recordColumns.map((column) =>
              localWidths.has(column.key)
                ? { ...column, width: localWidths.get(column.key)! }
                : column,
            ),
          }
        : {}),
    };
    this.currentness = cloneCurrentness(result.value.currentness);
    return this.getTable();
  }
}

export function createProductionTableAdapter(
  initialTable: EditorTable,
  actions: ProductionTableAdapterActions,
  initialCurrentness?: ProductionConfigurationCurrentness,
): TableEditorAdapter {
  return new ProductionTableAdapter(initialTable, actions, initialCurrentness);
}
