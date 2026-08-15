import { createHash } from "node:crypto";

import {
  bookingConfigSchema,
  publicBookingCatalogueSchema,
  type BookingConfig,
  type PublicBookingCatalogue,
} from "../booking/schemas";
import {
  normalizeTableViewConfig,
  type FormConfig,
  type PageLayout,
} from "../experience/schemas";
import { connectionColumnStorageKey } from "../experience/table-query";
import type { AcquisitionBuildPayload } from "./schemas";
import { acquisitionBuildPayloadSchema } from "./schemas";
import type { ConfigurationOperation } from "../configuration/schemas";
import type { PublicPreorderCatalogue } from "../preorder/schemas";
import { publicPreorderCatalogueSchema } from "../preorder/schemas";
import type {
  EditorColumn,
  EditorColumnKind,
  EditorRow,
  EditorTable,
  EditorValue,
} from "../../runtime/editor-kernel/contracts";
import type { ExperienceFormBundle } from "../experience/service";
import type { Tables } from "../../db/supabase/database.types";

const PREVIEW_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const PREVIEW_CREATED_AT = "2026-08-15T09:00:00.000Z";
const PREVIEW_TIMEZONE = "Europe/London";
const PREVIEW_FIRST_DATE = new Date("2026-08-17T12:00:00.000Z");

type ObjectOperation = Extract<ConfigurationOperation, { op: "set_object" }>;
type FieldOperation = Extract<ConfigurationOperation, { op: "set_field" }>;
type RelationshipOperation = Extract<
  ConfigurationOperation,
  { op: "set_relationship" }
>;
type ViewOperation = Extract<ConfigurationOperation, { op: "set_view" }>;
type FormOperation = Extract<ConfigurationOperation, { op: "set_form" }>;
type PageOperation = Extract<ConfigurationOperation, { op: "set_page" }>;
type PreorderOperation = Extract<
  ConfigurationOperation,
  { op: "set_preorder_experience" }
>;

export interface CandidatePreviewPage {
  key: string;
  title: string;
  slug: string;
  audience: "internal" | "public";
  status: "draft" | "published";
  layout: PageLayout;
}

export interface CandidatePreviewTable {
  viewKey: string;
  name: string;
  objectLabel: string;
  table: EditorTable;
}

export interface CandidatePreviewModel {
  checksum: string;
  title: string;
  pages: readonly CandidatePreviewPage[];
  tables: Readonly<Record<string, CandidatePreviewTable>>;
  forms: Readonly<Record<string, { bundle: ExperienceFormBundle }>>;
  bookings: Readonly<Record<string, { catalogue: PublicBookingCatalogue }>>;
  preorders: Readonly<Record<string, { catalogue: PublicPreorderCatalogue }>>;
}

export function candidateTablePageKey(tableKey: string): string {
  return `table-${tableKey}`;
}

export function candidateTableKeyFromPageKey(pageKey: string): string | null {
  return pageKey.startsWith("table-") ? pageKey.slice("table-".length) : null;
}

interface CandidateObject {
  operation: ObjectOperation;
  id: string;
  fields: readonly FieldOperation[];
  rows: readonly EditorRow[];
}

function deterministicUuid(namespace: string): string {
  const hash = createHash("sha256").update(namespace, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function candidateChecksum(payloadInput: unknown, revision = 1): string {
  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  return createHash("sha256")
    .update(JSON.stringify({ payload, revision }), "utf8")
    .digest("hex");
}

function fieldOptions(field: FieldOperation): string[] {
  const options = field.settings_json.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string")
    : [];
}

function fieldCurrency(field: FieldOperation): string {
  const currency = field.settings_json.currency;
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
    ? currency
    : "GBP";
}

function editorKind(fieldType: FieldOperation["field_type"]): EditorColumnKind {
  switch (fieldType) {
    case "short_text":
      return "text";
    case "long_text":
      return "long_text";
    case "email":
      return "email";
    case "url":
      return "url";
    case "phone":
      return "phone";
    case "number":
      return "number";
    case "currency":
      return "currency";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "select":
      return "select";
    case "multi_select":
      return "multi_select";
    case "file":
      return "file";
    case "status":
      return "status";
  }
}

function objectRecordLabel(object: CandidateObject, row: EditorRow): string {
  const primary =
    object.fields.find((field) => /^(?:name|title|label)$/i.test(field.key)) ??
    object.fields[0];
  const value = primary ? row.values[primary.key] : null;
  if (typeof value === "string" && value.trim()) return value;
  return `${object.operation.singular_label} example`;
}

function syntheticValue(
  object: ObjectOperation,
  field: FieldOperation,
  index: number,
): EditorValue {
  const lowerObject = `${object.key} ${object.singular_label}`.toLowerCase();
  const lowerField = `${field.key} ${field.label}`.toLowerCase();
  const nameValues =
    lowerObject.includes("customer") || lowerObject.includes("client")
      ? ["Sarah Evans", "Martin Jones"]
      : lowerObject.includes("pet") || lowerObject.includes("animal")
        ? ["Milo", "Maisie"]
        : lowerObject.includes("service") || lowerObject.includes("treatment")
          ? ["Full groom", "Wash and tidy"]
          : lowerObject.includes("booking") ||
              lowerObject.includes("appointment")
            ? ["Milo · Full groom", "Maisie · Wash and tidy"]
            : [
                `Example ${object.singular_label} ${index + 1}`,
                `Example ${object.singular_label} ${index + 2}`,
              ];
  const name = nameValues[index] ?? nameValues[0]!;

  if (field.field_type === "status") {
    const defaultValue = field.default_value;
    return typeof defaultValue === "string" ||
      typeof defaultValue === "number" ||
      typeof defaultValue === "boolean" ||
      defaultValue === null
      ? (defaultValue ?? fieldOptions(field)[0] ?? "Planned")
      : (fieldOptions(field)[0] ?? "Planned");
  }
  if (field.field_type === "select") {
    return (
      fieldOptions(field)[index % Math.max(1, fieldOptions(field).length)] ??
      "Example"
    );
  }
  if (field.field_type === "multi_select") {
    const options = fieldOptions(field);
    return options.length > 0 ? [options[index % options.length]!] : [];
  }
  if (field.field_type === "email") {
    return index === 0
      ? "sarah.evans@example.invalid"
      : "martin.jones@example.invalid";
  }
  if (field.field_type === "phone")
    return index === 0 ? "020 0000 0001" : "020 0000 0002";
  if (field.field_type === "url")
    return `https://example.invalid/${object.key}/${index + 1}`;
  if (field.field_type === "boolean") return false;
  if (field.field_type === "number") return index + 1;
  if (field.field_type === "currency") return index === 0 ? 45 : 65;
  if (field.field_type === "date")
    return `2026-08-${String(17 + index).padStart(2, "0")}`;
  if (field.field_type === "datetime")
    return `2026-08-${String(17 + index).padStart(2, "0")}T${index === 0 ? "10:00" : "14:00"}:00.000Z`;
  if (field.field_type === "long_text")
    return `Example preview information for ${object.singular_label.toLowerCase()}.`;
  if (field.field_type === "file") return null;
  if (
    lowerField.includes("type") &&
    (lowerObject.includes("pet") || lowerObject.includes("animal"))
  ) {
    return index === 0 ? "Cockapoo" : "Dachshund";
  }
  if (lowerField.includes("description"))
    return `Example ${object.singular_label.toLowerCase()} description.`;
  if (/name|title|label/.test(lowerField)) return name;
  return name;
}

function fakeObjectDefinition(
  object: CandidateObject,
): Tables<"object_definitions"> {
  return {
    id: object.id,
    business_id: PREVIEW_BUSINESS_ID,
    key: object.operation.key,
    singular_label: object.operation.singular_label,
    plural_label: object.operation.plural_label,
    description: object.operation.description,
    kind: "custom",
    semantic_type: null,
    icon: object.operation.icon,
    is_active: object.operation.is_active,
    created_at: PREVIEW_CREATED_AT,
    updated_at: PREVIEW_CREATED_AT,
  };
}

function fakeFieldDefinition(
  object: CandidateObject,
  field: FieldOperation,
): Tables<"field_definitions"> {
  return {
    id: deterministicUuid(`field:${object.operation.key}:${field.key}`),
    business_id: PREVIEW_BUSINESS_ID,
    object_definition_id: object.id,
    key: field.key,
    label: field.label,
    field_type: field.field_type,
    required: field.required,
    default_value: field.default_value,
    settings_json: field.settings_json,
    position: field.position,
    is_active: field.is_active,
    created_at: PREVIEW_CREATED_AT,
    updated_at: PREVIEW_CREATED_AT,
  };
}

function fieldColumn(field: FieldOperation, primary: boolean): EditorColumn {
  const kind = editorKind(field.field_type);
  const options = fieldOptions(field);
  return {
    key: field.key,
    label: field.label,
    kind,
    primary,
    editable: false,
    required: field.required,
    ...(options.length > 0 ? { options } : {}),
    ...(kind === "currency" ? { currency: fieldCurrency(field) } : {}),
    readOnlyReason: "This property is read-only in the preview.",
    width: kind === "long_text" ? 260 : kind === "email" ? 220 : 180,
  };
}

function connectionColumn(
  column: Extract<
    ReturnType<typeof normalizeTableViewConfig>["columns"][number],
    { kind: "connection" }
  >,
  relationship: RelationshipOperation,
  objects: ReadonlyMap<string, CandidateObject>,
): EditorColumn | null {
  const source = objects.get(relationship.source_object_key);
  const target = objects.get(relationship.target_object_key);
  if (!source || !target) return null;
  const targetObjectKey =
    column.direction === "source" ? target.operation.key : source.operation.key;
  const multiple =
    relationship.cardinality === "many_to_many" ||
    (relationship.cardinality === "one_to_many" &&
      column.direction === "source");
  return {
    key: connectionColumnStorageKey(column.relationship_key, column.direction),
    label:
      column.label ??
      (column.direction === "source"
        ? relationship.source_label
        : relationship.target_label),
    kind: "connection",
    editable: false,
    readOnlyReason: "Connections are read-only in the preview.",
    connection: {
      relationshipKey: relationship.key,
      direction: column.direction,
      multiple,
      targetObjectKey,
    },
    width: 220,
  };
}

function fakeFormDefinition(
  form: FormOperation,
  object: CandidateObject,
): Tables<"forms"> {
  return {
    id: deterministicUuid(`form:${form.key}`),
    business_id: PREVIEW_BUSINESS_ID,
    key: form.key,
    name: form.name,
    object_definition_id: object.id,
    mode: form.mode,
    config_json: form.config_json,
    audience: form.audience,
    is_active: form.is_active,
    created_at: PREVIEW_CREATED_AT,
    updated_at: PREVIEW_CREATED_AT,
  };
}

function fakePageDefinition(page: PageOperation): CandidatePreviewPage {
  return {
    key: page.key,
    title: page.title,
    slug: page.slug,
    audience: page.audience,
    status: page.status,
    layout: page.layout_json,
  };
}

function makeSlots(schedule: BookingConfig["schedule"]): Array<{
  start_at: string;
  local_date: string;
  local_time: string;
  remaining: number;
}> {
  const slots: Array<{
    start_at: string;
    local_date: string;
    local_time: string;
    remaining: number;
  }> = [];
  const first =
    Number(schedule.first_time.slice(0, 2)) * 60 +
    Number(schedule.first_time.slice(3));
  const last =
    Number(schedule.last_time.slice(0, 2)) * 60 +
    Number(schedule.last_time.slice(3));
  for (
    let dayOffset = 0;
    dayOffset < Math.min(schedule.booking_horizon_days, 14);
    dayOffset += 1
  ) {
    const date = new Date(
      PREVIEW_FIRST_DATE.getTime() + dayOffset * 86_400_000,
    );
    const localDate = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if (!schedule.days_of_week.includes(weekday)) continue;
    for (
      let minutes = first;
      minutes < last && minutes < first + schedule.slot_interval_minutes * 8;
      minutes += schedule.slot_interval_minutes
    ) {
      const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");
      const localTime = `${hours}:${minute}`;
      slots.push({
        start_at: `${localDate}T${localTime}:00+00:00`,
        local_date: localDate,
        local_time: localTime,
        remaining: schedule.capacity_per_slot,
      });
    }
  }
  return slots;
}

function bookingCatalogue(
  blockConfig: unknown,
  page: CandidatePreviewPage,
  objects: ReadonlyMap<string, CandidateObject>,
): PublicBookingCatalogue {
  const config = bookingConfigSchema.parse(blockConfig);
  const services = config.service_object_key
    ? (() => {
        const serviceObject = objects.get(config.service_object_key);
        return (serviceObject?.rows ?? []).map((row, index) => ({
          id: row.id,
          name: serviceObject
            ? objectRecordLabel(serviceObject, row)
            : `Example service ${index + 1}`,
        }));
      })()
    : [];
  return publicBookingCatalogueSchema.parse({
    business: { name: "Example business", slug: "preview" },
    page: { title: page.title, slug: page.slug },
    booking: {
      key: "booking",
      timezone: PREVIEW_TIMEZONE,
      schedule: config.schedule,
      slots: makeSlots(config.schedule),
      services,
      public_fields: config.public_fields,
    },
  });
}

function preorderCatalogue(
  operation: PreorderOperation,
  page: CandidatePreviewPage,
  objects: ReadonlyMap<string, CandidateObject>,
): PublicPreorderCatalogue {
  const config = operation.config_json;
  const product = objects.get(operation.product_object_key);
  const locationId =
    operation.allowed_location_ids[0] ?? deterministicUuid("preview:location");
  const productName = config.field_mappings.product.name;
  const productDescription = config.field_mappings.product.description;
  const productPrice = config.field_mappings.product.price;
  const products = (product?.rows ?? []).map((row, index) => ({
    id: row.id,
    name:
      typeof row.values[productName] === "string"
        ? row.values[productName]
        : `Example product ${index + 1}`,
    description:
      typeof row.values[productDescription] === "string"
        ? row.values[productDescription]
        : "Example preview product.",
    price:
      typeof row.values[productPrice] === "number" &&
      row.values[productPrice] > 0
        ? row.values[productPrice]
        : index === 0
          ? 4.5
          : 6,
    location_ids: [locationId],
  }));
  const locationSlots = makeSlots({
    timezone_source: "location",
    location_id: locationId,
    days_of_week: config.schedule.days_of_week,
    first_time: config.schedule.start_time,
    last_time: config.schedule.end_time,
    slot_interval_minutes: config.schedule.slot_interval_minutes,
    capacity_per_slot: config.schedule.slot_capacity,
    minimum_notice_minutes: config.schedule.cutoff_hours * 60,
    booking_horizon_days: config.schedule.booking_horizon_days,
  }).map((slot) => ({
    date: slot.local_date,
    time: slot.local_time,
    collection_at: slot.start_at,
    available: true,
    remaining: slot.remaining,
  }));
  const fieldLookup = new Map(
    [...objects.values()].flatMap((object) =>
      object.fields.map((field) => [field.key, field] as const),
    ),
  );
  const publicFields = config.public_fields.map((field) => {
    const definition = fieldLookup.get(field.field);
    const options = definition ? fieldOptions(definition) : [];
    return {
      ...field,
      field_type:
        definition?.field_type === "multi_select" ||
        definition?.field_type === "boolean" ||
        definition?.field_type === "number" ||
        definition?.field_type === "short_text" ||
        definition?.field_type === "long_text" ||
        definition?.field_type === "date" ||
        definition?.field_type === "email" ||
        definition?.field_type === "phone" ||
        definition?.field_type === "select"
          ? definition.field_type
          : "short_text",
      ...(options.length > 0 ? { options } : {}),
    };
  });
  return publicPreorderCatalogueSchema.parse({
    business: { name: "Example business", slug: "preview" },
    page: { title: page.title, slug: page.slug },
    preorder: {
      key: operation.key,
      currency: "GBP",
      schedule: config.schedule,
      locations: [
        {
          id: locationId,
          name: "Example collection point",
          timezone: PREVIEW_TIMEZONE,
          slots: locationSlots,
        },
      ],
      products,
      public_fields: publicFields,
    },
    generated_at: PREVIEW_CREATED_AT,
  });
}

export function buildCandidatePreviewModel(
  payloadInput: AcquisitionBuildPayload,
  revision = 1,
): CandidatePreviewModel {
  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  const checksum = candidateChecksum(payload, revision);
  const operations = payload.operations;
  const objectOperations = operations.filter(
    (operation): operation is ObjectOperation =>
      operation.op === "set_object" && operation.is_active,
  );
  const fieldsByObject = new Map<string, FieldOperation[]>();
  for (const operation of operations) {
    if (operation.op !== "set_field" || !operation.is_active) continue;
    const fields = fieldsByObject.get(operation.object_key) ?? [];
    fields.push(operation);
    fieldsByObject.set(operation.object_key, fields);
  }
  const objects = new Map<string, CandidateObject>();
  for (const operation of objectOperations) {
    const object: CandidateObject = {
      operation,
      id: deterministicUuid(`object:${operation.key}`),
      fields: [...(fieldsByObject.get(operation.key) ?? [])].toSorted(
        (a, b) => a.position - b.position,
      ),
      rows: [],
    };
    const rows = [0, 1].map((index) => {
      const values = Object.fromEntries(
        object.fields.map((field) => [
          field.key,
          syntheticValue(operation, field, index),
        ]),
      );
      return {
        id: deterministicUuid(`${checksum}:record:${operation.key}:${index}`),
        values,
      } satisfies EditorRow;
    });
    object.rows = rows;
    objects.set(operation.key, object);
  }

  const relationships = operations.filter(
    (operation): operation is RelationshipOperation =>
      operation.op === "set_relationship" && operation.is_active,
  );
  const relationshipByKey = new Map(
    relationships.map((relationship) => [relationship.key, relationship]),
  );
  const views = operations.filter(
    (operation): operation is ViewOperation =>
      operation.op === "set_view" && operation.is_active,
  );
  const tables: Record<string, CandidatePreviewTable> = {};
  for (const view of views) {
    if (view.view_type !== "table") continue;
    const object = objects.get(view.object_key);
    if (!object) continue;
    const config = normalizeTableViewConfig(view.config_json);
    const fieldColumns = object.fields.map((field) =>
      fieldColumn(field, field.key === config.title_field),
    );
    const connectionColumns = config.columns.flatMap((column) => {
      if (column.kind !== "connection") return [];
      const relationship = relationshipByKey.get(column.relationship_key);
      const mapped = relationship
        ? connectionColumn(column, relationship, objects)
        : null;
      return mapped ? [mapped] : [];
    });
    const recordColumns = [...fieldColumns, ...connectionColumns];
    const columns = config.columns.flatMap((column) => {
      const key =
        column.kind === "field"
          ? column.field_key
          : connectionColumnStorageKey(
              column.relationship_key,
              column.direction,
            );
      const mapped = recordColumns.find((candidate) => candidate.key === key);
      return mapped ? [mapped] : [];
    });
    const rows = object.rows.map((row, index) => {
      const connectionValues: Record<
        string,
        readonly { id: string; label: string }[]
      > = {};
      const values = { ...row.values };
      for (const column of connectionColumns) {
        const relationship = relationshipByKey.get(
          column.connection!.relationshipKey,
        );
        if (!relationship) continue;
        const targetKey = column.connection!.targetObjectKey;
        const target = objects.get(targetKey);
        const targetRow = target?.rows[index % Math.max(1, target.rows.length)];
        if (!target || !targetRow) continue;
        const value = [
          { id: targetRow.id, label: objectRecordLabel(target, targetRow) },
        ];
        connectionValues[column.key] = value;
        values[column.key] = value.map((item) => item.id);
      }
      return { ...row, values, connectionValues } satisfies EditorRow;
    });
    const table: EditorTable = {
      key: view.key,
      name: view.name,
      primaryColumnKey: config.title_field,
      columns,
      recordColumns,
      rows,
    };
    tables[view.key] = {
      viewKey: view.key,
      name: view.name,
      objectLabel: object.operation.plural_label,
      table,
    };
  }

  const forms: Record<string, { bundle: ExperienceFormBundle }> = {};
  for (const form of operations.filter(
    (operation): operation is FormOperation =>
      operation.op === "set_form" && operation.is_active,
  )) {
    const object = objects.get(form.object_key);
    if (!object) continue;
    const definition = fakeFormDefinition(form, object);
    forms[form.key] = {
      bundle: {
        definition,
        object: fakeObjectDefinition(object),
        fields: object.fields.map((field) =>
          fakeFieldDefinition(object, field),
        ),
        config: form.config_json as FormConfig,
      },
    };
  }

  const pages = operations
    .filter(
      (operation): operation is PageOperation =>
        operation.op === "set_page" && operation.is_active,
    )
    .map(fakePageDefinition);
  const bookings: Record<string, { catalogue: PublicBookingCatalogue }> = {};
  const preorders: Record<string, { catalogue: PublicPreorderCatalogue }> = {};
  const preorder = operations.find(
    (operation): operation is PreorderOperation =>
      operation.op === "set_preorder_experience" && operation.is_active,
  );
  for (const page of pages) {
    for (const block of page.layout.blocks) {
      if (block.type === "booking") {
        bookings[block.booking_key] = {
          catalogue: bookingCatalogue(block.config, page, objects),
        };
      }
      if (block.type === "preorder" && preorder) {
        preorders[block.preorder_key] = {
          catalogue: preorderCatalogue(preorder, page, objects),
        };
      }
    }
  }

  return {
    checksum,
    title: payload.proposal.title,
    pages,
    tables,
    forms,
    bookings,
    preorders,
  };
}
