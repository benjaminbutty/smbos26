import type { EditorRow, EditorTable, EditorValue } from "../contracts";

export interface ProductionCellEditInput {
  recordId: string;
  fieldKey: string;
  value: EditorValue;
}

export interface ProductionRowCreateInput {
  primaryValue: string;
}

export interface ProductionRecordReadInput {
  recordId: string;
}

export interface ProductionPasteRowInput {
  recordId?: string;
  values: Readonly<Record<string, EditorValue>>;
}

export interface ProductionPasteInput {
  rows: readonly ProductionPasteRowInput[];
}

export interface ProductionPasteFailure {
  rowIndex: number;
  fieldKey?: string;
  message: string;
}

export interface ProductionPasteResult {
  rows: readonly EditorRow[];
  failures: readonly ProductionPasteFailure[];
}

export interface ProductionConfigurationCurrentness {
  expectedBaseVersionId: string;
  expectedHeadRevision: number;
}

export type ProductionColumnType =
  | "short_text"
  | "long_text"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "email"
  | "phone"
  | "url"
  | "select"
  | "status";

export interface ProductionTableStructureState {
  table: EditorTable;
  currentness: ProductionConfigurationCurrentness;
}

export interface ProductionAddColumnInput {
  currentness: ProductionConfigurationCurrentness;
  label: string;
  columnType: ProductionColumnType;
  options?: readonly string[];
  currency?: string;
}

export interface ProductionInsertColumnInput {
  currentness: ProductionConfigurationCurrentness;
  anchorFieldKey: string;
  position: "left" | "right";
  label: string;
  columnType: ProductionColumnType;
  options?: readonly string[];
  currency?: string;
}

export interface ProductionRenameColumnInput {
  currentness: ProductionConfigurationCurrentness;
  fieldKey: string;
  label: string;
}

export interface ProductionChangeColumnTypeInput {
  currentness: ProductionConfigurationCurrentness;
  fieldKey: string;
  columnType: ProductionColumnType;
  options?: readonly string[];
  currency?: string;
}

export interface ProductionUpdateColumnOptionsInput {
  currentness: ProductionConfigurationCurrentness;
  fieldKey: string;
  options: readonly string[];
}

export interface ProductionReorderColumnsInput {
  currentness: ProductionConfigurationCurrentness;
  fieldKeys: readonly string[];
}

export interface ProductionRenameTableInput {
  currentness: ProductionConfigurationCurrentness;
  title: string;
}

export type ProductionActionResult<T> =
  { status: "success"; value: T } | { status: "error"; message: string };

export type ProductionCellEditAction = (
  input: ProductionCellEditInput,
) => Promise<ProductionActionResult<EditorRow>>;

export type ProductionRowCreateAction = (
  input: ProductionRowCreateInput,
) => Promise<ProductionActionResult<EditorRow>>;

export type ProductionRecordReadAction = (
  input: ProductionRecordReadInput,
) => Promise<ProductionActionResult<EditorRow | null>>;

export type ProductionPasteAction = (
  input: ProductionPasteInput,
) => Promise<ProductionActionResult<ProductionPasteResult>>;

export type ProductionAddColumnAction = (
  input: ProductionAddColumnInput,
) => Promise<ProductionActionResult<ProductionTableStructureState>>;

export type ProductionInsertColumnAction = (
  input: ProductionInsertColumnInput,
) => Promise<ProductionActionResult<ProductionTableStructureState>>;

export type ProductionRenameColumnAction = (
  input: ProductionRenameColumnInput,
) => Promise<ProductionActionResult<ProductionTableStructureState>>;

export type ProductionChangeColumnTypeAction = (
  input: ProductionChangeColumnTypeInput,
) => Promise<ProductionActionResult<ProductionTableStructureState>>;

export type ProductionUpdateColumnOptionsAction = (
  input: ProductionUpdateColumnOptionsInput,
) => Promise<ProductionActionResult<ProductionTableStructureState>>;

export type ProductionReorderColumnsAction = (
  input: ProductionReorderColumnsInput,
) => Promise<ProductionActionResult<ProductionTableStructureState>>;

export type ProductionRenameTableAction = (
  input: ProductionRenameTableInput,
) => Promise<ProductionActionResult<ProductionTableStructureState>>;
