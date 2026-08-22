import type {
  EditorColumn,
  EditorColumnKind,
  EditorTable,
  PropertyPlacement,
} from "./contracts";

export const minimumPropertyOptions = 2;
export const maximumPropertyOptions = 100;

export const addablePropertyKinds: readonly EditorColumnKind[] = [
  "text",
  "long_text",
  "number",
  "currency",
  "boolean",
  "date",
  "email",
  "phone",
  "url",
  "select",
  "status",
];

export interface PropertyDraft {
  label: string;
  kind: EditorColumnKind;
  options: readonly string[];
  currency?: string;
  placement: PropertyPlacement;
}

export interface PropertyChangeDescriptor {
  actionLabel: "Add property";
  summary: string;
  typeLabel: string;
  placementLabel: string;
  optionCount?: number;
  details: readonly string[];
}

export const proposedPropertyKey = "__proposed_property__";

const propertyKindLabels: Readonly<Partial<Record<EditorColumnKind, string>>> =
  {
    text: "Text",
    long_text: "Long text",
    number: "Number",
    currency: "Money",
    boolean: "Yes / No",
    date: "Date",
    email: "Email",
    phone: "Phone",
    url: "Website",
    select: "Choice",
    status: "Status",
  };

const propertyKindDescriptions: Readonly<
  Partial<Record<EditorColumnKind, string>>
> = {
  text: "Short names and labels.",
  long_text: "Notes and longer writing.",
  number: "Counts and quantities.",
  currency: "Prices and amounts.",
  boolean: "A simple Yes / No value.",
  date: "A calendar date.",
  email: "Email addresses.",
  phone: "Telephone numbers.",
  url: "Web links.",
  select: "A controlled list of choices.",
  status: "A labelled progress state, without automation.",
};

export function propertyKindLabel(kind: EditorColumnKind): string {
  return propertyKindLabels[kind] ?? kind;
}

export function propertyKindDescription(kind: EditorColumnKind): string {
  return propertyKindDescriptions[kind] ?? "A supported Table property.";
}

export function normalizePropertyOptions(
  options: readonly string[],
): readonly string[] {
  return options.map((option) => option.trim());
}

export function validatePropertyOptions(
  options: readonly string[],
): string | null {
  const normalized = normalizePropertyOptions(options);
  if (normalized.some((option) => option.length === 0)) {
    return "Each option needs a name.";
  }
  if (normalized.length < minimumPropertyOptions) {
    return "Choice and Status need at least two options.";
  }
  if (normalized.length > maximumPropertyOptions) {
    return `A property can have up to ${maximumPropertyOptions} options.`;
  }
  const comparisonValues = normalized.map((option) =>
    option.normalize("NFKC").toLocaleLowerCase("en"),
  );
  if (new Set(comparisonValues).size !== comparisonValues.length) {
    return "Each option needs a different name.";
  }
  return null;
}

export function reorderPropertyOptions(
  options: readonly string[],
  index: number,
  direction: "up" | "down",
): readonly string[] {
  const next = [...options];
  const target = index + (direction === "up" ? -1 : 1);
  if (
    index < 0 ||
    index >= next.length ||
    target < 0 ||
    target >= next.length
  ) {
    return next;
  }
  [next[index]!, next[target]!] = [next[target]!, next[index]!];
  return next;
}

function previewColumnKey(table: EditorTable): string {
  if (!table.columns.some((column) => column.key === proposedPropertyKey)) {
    return proposedPropertyKey;
  }
  let suffix = 2;
  while (
    table.columns.some(
      (column) => column.key === `${proposedPropertyKey}_${suffix}`,
    )
  ) {
    suffix += 1;
  }
  return `${proposedPropertyKey}_${suffix}`;
}

function insertPreviewColumn(
  columns: readonly EditorColumn[],
  previewColumn: EditorColumn,
  placement: PropertyPlacement,
): readonly EditorColumn[] {
  if (placement.mode === "end") {
    return [...columns, previewColumn];
  }
  const anchorIndex = columns.findIndex(
    (column) => column.key === placement.anchorColumnKey,
  );
  if (anchorIndex < 0) {
    return [...columns, previewColumn];
  }
  const insertionIndex =
    placement.mode === "before" ? anchorIndex : anchorIndex + 1;
  return [
    ...columns.slice(0, insertionIndex),
    previewColumn,
    ...columns.slice(insertionIndex),
  ];
}

export function previewTableWithProperty(
  table: EditorTable,
  draft: PropertyDraft,
): EditorTable {
  const key = previewColumnKey(table);
  const previewColumn: EditorColumn = {
    key,
    label: draft.label.trim() || "New property",
    kind: draft.kind,
    ...(draft.kind === "select" || draft.kind === "status"
      ? { options: [...draft.options] }
      : {}),
    ...(draft.kind === "currency" ? { currency: draft.currency ?? "GBP" } : {}),
    editable: false,
    preview: true,
    readOnlyReason: "Not added yet",
    width: draft.kind === "currency" ? 150 : 160,
  };
  return {
    ...table,
    columns: insertPreviewColumn(table.columns, previewColumn, draft.placement),
  };
}

export function propertyPlacementLabel(
  table: EditorTable,
  placement: PropertyPlacement,
): string {
  if (placement.mode === "end") {
    return "at the end";
  }
  const anchor = table.columns.find(
    (column) => column.key === placement.anchorColumnKey,
  );
  if (!anchor) {
    return "at the end";
  }
  return `${placement.mode} ${anchor.label}`;
}

export function describePropertyChange(
  table: EditorTable,
  draft: PropertyDraft,
): PropertyChangeDescriptor {
  const label = draft.label.trim() || "New property";
  const typeLabel = propertyKindLabel(draft.kind);
  const placementLabel = propertyPlacementLabel(table, draft.placement);
  const optionCount =
    draft.kind === "select" || draft.kind === "status"
      ? draft.options.length
      : undefined;
  return {
    actionLabel: "Add property",
    summary: `Add ${label} as ${typeLabel} ${placementLabel} in ${table.name}.`,
    typeLabel,
    placementLabel,
    ...(optionCount !== undefined ? { optionCount } : {}),
    details: [
      "Existing records keep their current values. The new property starts empty.",
      "The Table's configured add and edit screens include it where supported.",
      "This is an internal change; it does not publish anything to customers.",
    ],
  };
}
