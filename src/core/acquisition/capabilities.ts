import { z } from "zod";

import {
  setFieldOperationSchema,
  setFormOperationSchema,
  setObjectOperationSchema,
  setPageOperationSchema,
  setRelationshipOperationSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../configuration/schemas";
import {
  parseViewConfig,
  formConfigSchema,
  pageLayoutSchema,
} from "../experience/schemas";
import { bookingConfigSchema, bookingBlockSchema } from "../booking/schemas";
import {
  acquisitionBuildPayloadSchema,
  type AcquisitionBuildPayload,
} from "./schemas";
import type { AcquisitionClarificationDecisions } from "./clarification";

type ObjectOperation = Extract<ConfigurationOperation, { op: "set_object" }>;
type FieldOperation = Extract<ConfigurationOperation, { op: "set_field" }>;
type RelationshipOperation = Extract<
  ConfigurationOperation,
  { op: "set_relationship" }
>;
type FormOperation = Extract<ConfigurationOperation, { op: "set_form" }>;
type PageOperation = Extract<ConfigurationOperation, { op: "set_page" }>;

type ObjectState = {
  object: ObjectOperation;
  fields: FieldOperation[];
};

const safePublicFieldTypes = new Set([
  "short_text",
  "long_text",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "email",
  "phone",
  "url",
  "select",
  "multi_select",
  "status",
]);

function keyAvailable(
  operations: readonly ConfigurationOperation[],
  kind: ConfigurationOperation["op"],
  key: string,
): boolean {
  return !operations.some((operation) => {
    if (operation.op !== kind) return false;
    return "key" in operation && operation.key === key;
  });
}

function nextKey(
  operations: readonly ConfigurationOperation[],
  kind: ConfigurationOperation["op"],
  base: string,
): string {
  if (keyAvailable(operations, kind, base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}_${index}`;
    if (keyAvailable(operations, kind, candidate)) return candidate;
  }
  throw new Error(`Unable to create a free ${kind} key.`);
}

function objectStateMap(
  operations: readonly ConfigurationOperation[],
): Map<string, ObjectState> {
  const states = new Map<string, ObjectState>();
  for (const operation of operations) {
    if (operation.op === "set_object") {
      states.set(operation.key, { object: operation, fields: [] });
    }
  }
  for (const operation of operations) {
    if (operation.op === "set_field") {
      states.get(operation.object_key)?.fields.push(operation);
    }
  }
  return states;
}

function findObject(
  states: ReadonlyMap<string, ObjectState>,
  patterns: readonly RegExp[],
  preferredKeys: readonly string[] = [],
): ObjectState | null {
  for (const key of preferredKeys) {
    const state = states.get(key);
    if (state) return state;
  }
  for (const state of states.values()) {
    if (
      patterns.some(
        (pattern) =>
          pattern.test(state.object.key) ||
          pattern.test(state.object.singular_label) ||
          pattern.test(state.object.plural_label),
      )
    ) {
      return state;
    }
  }
  return null;
}

function findField(
  state: ObjectState,
  patterns: readonly RegExp[],
  fieldTypes?: readonly string[],
): FieldOperation | null {
  return (
    state.fields.find(
      (field) =>
        (!fieldTypes || fieldTypes.includes(field.field_type)) &&
        patterns.some(
          (pattern) => pattern.test(field.key) || pattern.test(field.label),
        ),
    ) ?? null
  );
}

function appendField(
  operations: ConfigurationOperation[],
  state: ObjectState,
  input: Omit<FieldOperation, "op" | "position"> & { position?: number },
): FieldOperation {
  const field = setFieldOperationSchema.parse({
    op: "set_field",
    ...input,
    position: input.position ?? state.fields.length,
  });
  operations.push(field);
  state.fields.push(field);
  return field;
}

function appendObject(
  operations: ConfigurationOperation[],
  key: string,
  singularLabel: string,
  pluralLabel: string,
  description: string,
): ObjectState {
  const object = setObjectOperationSchema.parse({
    op: "set_object",
    key,
    singular_label: singularLabel,
    plural_label: pluralLabel,
    description,
    icon: null,
    is_active: true,
  });
  operations.push(object);
  const state = { object, fields: [] };
  return state;
}

function appendInternalSurface(
  operations: ConfigurationOperation[],
  state: ObjectState,
): void {
  const createKey = nextKey(
    operations,
    "set_form",
    `${state.object.key}_create`,
  );
  const editKey = nextKey(operations, "set_form", `${state.object.key}_edit`);
  const fields = state.fields.map((field) => ({
    field: field.key,
    hidden: false,
  }));
  operations.push(
    setFormOperationSchema.parse({
      op: "set_form",
      key: createKey,
      name: `New ${state.object.singular_label}`,
      object_key: state.object.key,
      mode: "create",
      config_json: formConfigSchema.parse({
        fields: fields.length > 0 ? fields : [{ field: "name", hidden: false }],
        submit_label: `Add ${state.object.singular_label}`,
      }),
      audience: "internal",
      is_active: true,
    }),
    setFormOperationSchema.parse({
      op: "set_form",
      key: editKey,
      name: `Edit ${state.object.singular_label}`,
      object_key: state.object.key,
      mode: "edit",
      config_json: formConfigSchema.parse({
        fields: fields.length > 0 ? fields : [{ field: "name", hidden: false }],
        submit_label: "Save changes",
      }),
      audience: "internal",
      is_active: true,
    }),
  );

  const viewKey = nextKey(operations, "set_view", `${state.object.key}_view`);
  const viewConfig = {
    schema_version: 2 as const,
    role: "primary" as const,
    columns: state.fields.map((field) => ({
      kind: "field" as const,
      field_key: field.key,
    })),
    fields: state.fields.map((field) => field.key),
    title_field: state.fields[0]?.key ?? "name",
    create_form_key: createKey,
    edit_form_key: editKey,
    include_archived: false,
    filters: [],
    filter_match: "all" as const,
    sorts: [],
    group: null,
  };
  operations.push(
    setViewOperationSchema.parse({
      op: "set_view",
      key: viewKey,
      name: state.object.plural_label,
      view_type: "table",
      object_key: state.object.key,
      config_json: viewConfig,
      audience: "internal",
      is_active: true,
    }),
  );
}

function appendRelationship(
  operations: ConfigurationOperation[],
  source: ObjectState,
  target: ObjectState,
  baseKey: string,
  sourceLabel: string,
  targetLabel: string,
): RelationshipOperation {
  const existing = operations.find(
    (operation): operation is RelationshipOperation =>
      operation.op === "set_relationship" &&
      ((operation.source_object_key === source.object.key &&
        operation.target_object_key === target.object.key) ||
        (operation.source_object_key === target.object.key &&
          operation.target_object_key === source.object.key)),
  );
  if (existing) return existing;

  const relationship = setRelationshipOperationSchema.parse({
    op: "set_relationship",
    key: nextKey(operations, "set_relationship", baseKey),
    source_object_key: source.object.key,
    target_object_key: target.object.key,
    source_label: sourceLabel,
    target_label: targetLabel,
    cardinality: "one_to_many",
    is_required: false,
    is_active: true,
  });
  operations.push(relationship);
  return relationship;
}

function addFieldToInternalForms(
  operations: ConfigurationOperation[],
  objectKey: string,
  fieldKey: string,
): void {
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (
      !operation ||
      operation.op !== "set_form" ||
      operation.object_key !== objectKey
    ) {
      continue;
    }
    const parsed = formConfigSchema.parse(operation.config_json);
    if (parsed.fields.some((field) => field.field === fieldKey)) continue;
    operations[index] = setFormOperationSchema.parse({
      ...operation,
      config_json: formConfigSchema.parse({
        ...parsed,
        fields: [...parsed.fields, { field: fieldKey, hidden: false }],
      }),
    });
  }
}

function addRelationshipToInternalViews(
  operations: ConfigurationOperation[],
  relationship: RelationshipOperation,
): void {
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (
      !operation ||
      operation.op !== "set_view" ||
      operation.view_type !== "table" ||
      !operation.is_active ||
      ![
        relationship.source_object_key,
        relationship.target_object_key,
      ].includes(operation.object_key)
    ) {
      continue;
    }
    const config = parseViewConfig(operation.view_type, operation.config_json);
    if (!("columns" in config)) continue;
    const direction =
      operation.object_key === relationship.source_object_key
        ? "source"
        : "target";
    if (
      config.columns.some(
        (column) =>
          column.kind === "connection" &&
          column.relationship_key === relationship.key &&
          column.direction === direction,
      )
    ) {
      continue;
    }
    operations[index] = setViewOperationSchema.parse({
      ...operation,
      config_json: {
        ...config,
        columns: [
          ...config.columns,
          {
            kind: "connection",
            relationship_key: relationship.key,
            direction,
            label:
              direction === "source"
                ? relationship.source_label
                : relationship.target_label,
          },
        ],
      },
    });
  }
}

function removeSeparateService(
  operations: ConfigurationOperation[],
  serviceKey: string,
): ConfigurationOperation[] {
  const removedRelationshipKeys = new Set(
    operations
      .filter(
        (operation): operation is RelationshipOperation =>
          operation.op === "set_relationship" &&
          (operation.source_object_key === serviceKey ||
            operation.target_object_key === serviceKey),
      )
      .map((operation) => operation.key),
  );
  const removedFormKeys = new Set(
    operations
      .filter(
        (operation): operation is FormOperation =>
          operation.op === "set_form" && operation.object_key === serviceKey,
      )
      .map((operation) => operation.key),
  );
  const removedViewKeys = new Set(
    operations
      .filter(
        (operation) =>
          operation.op === "set_view" && operation.object_key === serviceKey,
      )
      .map((operation) => operation.key),
  );
  const remaining = operations.filter((operation) => {
    if (operation.op === "set_object") return operation.key !== serviceKey;
    if (operation.op === "set_field")
      return operation.object_key !== serviceKey;
    if (operation.op === "set_form") return operation.object_key !== serviceKey;
    if (operation.op === "set_view") return operation.object_key !== serviceKey;
    if (operation.op === "set_relationship") {
      return !removedRelationshipKeys.has(operation.key);
    }
    return true;
  });

  return remaining.map((operation) => {
    if (operation.op === "set_page") {
      return setPageOperationSchema.parse({
        ...operation,
        layout_json: pageLayoutSchema.parse({
          blocks: operation.layout_json.blocks.filter((block) => {
            if (block.type === "view")
              return !removedViewKeys.has(block.view_key);
            if (block.type === "form")
              return !removedFormKeys.has(block.form_key);
            return true;
          }),
        }),
      });
    }
    if (operation.op !== "set_view" || operation.view_type !== "table") {
      return operation;
    }
    const config = parseViewConfig(operation.view_type, operation.config_json);
    if (!("columns" in config)) return operation;
    const columns = config.columns.filter(
      (column) =>
        column.kind !== "connection" ||
        !removedRelationshipKeys.has(column.relationship_key),
    );
    const fields = columns.flatMap((column) =>
      column.kind === "field" ? [column.field_key] : [],
    );
    if (fields.length === 0) return operation;
    return setViewOperationSchema.parse({
      ...operation,
      config_json: { ...config, columns, fields },
    });
  });
}

function publicFormFields(state: ObjectState): Array<{
  field: string;
  hidden: boolean;
  default_value?: unknown;
}> {
  const fields = state.fields.filter((field) =>
    safePublicFieldTypes.has(field.field_type),
  );
  return fields.map((field) => {
    const hasDefault =
      field.default_value !== null && field.default_value !== undefined;
    return field.required && hasDefault && field.field_type === "status"
      ? { field: field.key, hidden: true, default_value: field.default_value }
      : { field: field.key, hidden: false };
  });
}

function addPublicEnquirySurface(
  operations: ConfigurationOperation[],
  states: Map<string, ObjectState>,
): void {
  const publicForm = operations.find(
    (operation): operation is FormOperation =>
      operation.op === "set_form" &&
      operation.mode === "create" &&
      operation.audience === "public" &&
      operation.is_active,
  );
  const target = publicForm
    ? states.get(publicForm.object_key)
    : findObject(
        states,
        [/enquir/i, /lead/i, /contact/i, /request/i],
        ["enquiry"],
      );
  if (!target) return;

  let formKey = publicForm?.key;
  if (!formKey) {
    const fields = publicFormFields(target);
    if (fields.length === 0) return;
    formKey = nextKey(
      operations,
      "set_form",
      `public_${target.object.key}_form`,
    );
    operations.push(
      setFormOperationSchema.parse({
        op: "set_form",
        key: formKey,
        name: `Send ${target.object.singular_label.toLowerCase()}`,
        object_key: target.object.key,
        mode: "create",
        config_json: formConfigSchema.parse({
          fields,
          submit_label: "Send enquiry",
        }),
        audience: "public",
        is_active: true,
      }),
    );
  }

  const alreadyPresented = operations.some(
    (operation): operation is PageOperation =>
      operation.op === "set_page" &&
      operation.audience === "public" &&
      operation.layout_json.blocks.some(
        (block) => block.type === "public_form" && block.form_key === formKey,
      ),
  );
  if (alreadyPresented) return;

  operations.push(
    setPageOperationSchema.parse({
      op: "set_page",
      key: nextKey(operations, "set_page", "enquiry_site"),
      title: "Get in touch",
      slug: nextPageSlug(operations, "contact"),
      audience: "public",
      layout_json: pageLayoutSchema.parse({
        blocks: [
          { type: "heading", text: "Get in touch", level: 1 },
          {
            type: "text",
            text: "Send a message and we’ll get back to you.",
          },
          { type: "public_form", form_key: formKey },
        ],
      }),
      status: "draft",
      is_active: true,
    }),
  );
}

function nextPageSlug(
  operations: readonly ConfigurationOperation[],
  base: string,
): string {
  const used = new Set(
    operations
      .filter(
        (operation): operation is PageOperation => operation.op === "set_page",
      )
      .map((operation) => operation.slug),
  );
  if (!used.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Unable to create a free public Page slug.");
}

function addBookingSurface(
  operations: ConfigurationOperation[],
  states: Map<string, ObjectState>,
  request: string,
  decisions: AcquisitionClarificationDecisions,
): void {
  let customer = findObject(states, [/customer|client|contact/i], ["customer"]);
  if (!customer) {
    customer = appendObject(
      operations,
      nextKey(operations, "set_object", "customer"),
      "Customer",
      "Customers",
      "People who book your services.",
    );
    states.set(customer.object.key, customer);
    appendField(operations, customer, {
      object_key: customer.object.key,
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      is_active: true,
    });
    appendInternalSurface(operations, customer);
  }

  let booking = findObject(
    states,
    [/appointment|booking|session|visit/i],
    ["appointment", "booking"],
  );
  if (!booking) {
    booking = appendObject(
      operations,
      nextKey(operations, "set_object", "booking"),
      "Booking",
      "Bookings",
      "Appointments customers have requested.",
    );
    states.set(booking.object.key, booking);
    appendField(operations, booking, {
      object_key: booking.object.key,
      key: "title",
      label: "Booking",
      field_type: "short_text",
      required: false,
      default_value: null,
      settings_json: {},
      is_active: true,
    });
    appendInternalSurface(operations, booking);
  }

  let subject: ObjectState | null = findObject(states, [
    /pet|animal|dog|vehicle|room|patient|child/i,
  ]);
  if (
    !subject &&
    /\b(?:dog|groom|pet|animal|vehicle|room|patient|child)\b/i.test(request)
  ) {
    subject = appendObject(
      operations,
      nextKey(operations, "set_object", "pet"),
      "Pet",
      "Pets",
      "The pets that appointments are for.",
    );
    states.set(subject.object.key, subject);
    appendField(operations, subject, {
      object_key: subject.object.key,
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      is_active: true,
    });
    appendField(operations, subject, {
      object_key: subject.object.key,
      key: "type",
      label: "Type",
      field_type: "short_text",
      required: false,
      default_value: null,
      settings_json: {},
      is_active: true,
    });
    appendInternalSurface(operations, subject);
  }

  let service: ObjectState | null = null;
  if (decisions.usesServices !== false) {
    service = findObject(states, [/service|treatment|package/i], ["service"]);
    if (!service && decisions.usesServices === true) {
      service = appendObject(
        operations,
        nextKey(operations, "set_object", "service"),
        "Service",
        "Services",
        "Reusable services customers can choose when booking.",
      );
      states.set(service.object.key, service);
      appendField(operations, service, {
        object_key: service.object.key,
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        is_active: true,
      });
      appendInternalSurface(operations, service);
    }
  }

  const customerName =
    findField(
      customer,
      [/^name$|full.?name|customer.?name/i],
      ["short_text", "long_text"],
    ) ??
    appendField(operations, customer, {
      object_key: customer.object.key,
      key: nextFieldKey(customer, "name"),
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      is_active: true,
    });
  addFieldToInternalForms(operations, customer.object.key, customerName.key);
  const customerEmail = findField(customer, [/email/i], ["email"]);
  const customerPhone = findField(customer, [/phone|mobile|tel/i], ["phone"]);

  const bookingStart =
    findField(
      booking,
      [/start|date.?time|scheduled|appointment.?time/i],
      ["datetime"],
    ) ??
    appendField(operations, booking, {
      object_key: booking.object.key,
      key: nextFieldKey(booking, "starts_at"),
      label: "Starts at",
      field_type: "datetime",
      required: true,
      default_value: null,
      settings_json: {},
      is_active: true,
    });
  addFieldToInternalForms(operations, booking.object.key, bookingStart.key);
  const bookingStatus =
    findField(booking, [/^status$|state/i], ["status", "select"]) ??
    appendField(operations, booking, {
      object_key: booking.object.key,
      key: nextFieldKey(booking, "status"),
      label: "Status",
      field_type: "status",
      required: true,
      default_value: "Requested",
      settings_json: {
        options: ["Requested", "Confirmed", "Completed", "Cancelled"],
      },
      is_active: true,
    });
  addFieldToInternalForms(operations, booking.object.key, bookingStatus.key);
  const bookingDate = findField(booking, [/^date$|date/i], ["date"]);
  const bookingTime = findField(
    booking,
    [/^time$|time/i],
    ["short_text"],
  );

  const subjectName = subject
    ? (findField(
        subject,
        [/^name$|pet.?name|animal.?name/i],
        ["short_text", "long_text"],
      ) ??
      appendField(operations, subject, {
        object_key: subject.object.key,
        key: nextFieldKey(subject, "name"),
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        is_active: true,
      }))
    : null;
  if (subject && subjectName) {
    addFieldToInternalForms(operations, subject.object.key, subjectName.key);
  }
  const serviceName = service
    ? (findField(
        service,
        [/^name$|service.?name|treatment/i],
        ["short_text", "long_text"],
      ) ??
      appendField(operations, service, {
        object_key: service.object.key,
        key: nextFieldKey(service, "name"),
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        is_active: true,
      }))
    : null;
  if (service && serviceName) {
    addFieldToInternalForms(operations, service.object.key, serviceName.key);
  }

  const customerBooking = appendRelationship(
    operations,
    customer,
    booking,
    "customer_has_bookings",
    "has bookings",
    "customer",
  );
  const customerSubject = subject
    ? appendRelationship(
        operations,
        customer,
        subject,
        "customer_has_subjects",
        "has subjects",
        "customer",
      )
    : null;
  const subjectBooking = subject
    ? appendRelationship(
        operations,
        subject,
        booking,
        "subject_has_bookings",
        "has bookings",
        "subject",
      )
    : null;
  const serviceBooking = service
    ? appendRelationship(
        operations,
        service,
        booking,
        "service_has_bookings",
        "has bookings",
        "service",
      )
    : null;

  addRelationshipToInternalViews(operations, customerBooking);
  if (customerSubject)
    addRelationshipToInternalViews(operations, customerSubject);
  if (subjectBooking)
    addRelationshipToInternalViews(operations, subjectBooking);
  if (serviceBooking)
    addRelationshipToInternalViews(operations, serviceBooking);

  const config = bookingConfigSchema.parse({
    booking_object_key: booking.object.key,
    customer_object_key: customer.object.key,
    subject_object_key: subject?.object.key ?? null,
    service_object_key: service?.object.key ?? null,
    relationships: {
      customer_booking: customerBooking.key,
      customer_subject: customerSubject?.key ?? null,
      subject_booking: subjectBooking?.key ?? null,
      service_booking: serviceBooking?.key ?? null,
    },
    field_mappings: {
      customer: {
        name: customerName.key,
        email: customerEmail?.key ?? null,
        phone: customerPhone?.key ?? null,
      },
      booking: {
        start_at: bookingStart.key,
        status: bookingStatus.key,
        default_status:
          typeof bookingStatus.default_value === "string"
            ? bookingStatus.default_value
            : "Requested",
        date: bookingDate?.key ?? null,
        time: bookingTime?.key ?? null,
      },
      subject: subject && subjectName ? { name: subjectName.key } : null,
      service: service && serviceName ? { name: serviceName.key } : null,
    },
    public_fields: [
      {
        target: "customer",
        field: customerName.key,
        label: customerName.label,
        required: true,
        autocomplete: "name",
      },
      ...(customerEmail
        ? [
            {
              target: "customer" as const,
              field: customerEmail.key,
              label: customerEmail.label,
              required: false,
              autocomplete: "email" as const,
            },
          ]
        : []),
      ...(customerPhone
        ? [
            {
              target: "customer" as const,
              field: customerPhone.key,
              label: customerPhone.label,
              required: false,
              autocomplete: "tel" as const,
            },
          ]
        : []),
      ...(subject && subjectName
        ? [
            {
              target: "subject" as const,
              field: subjectName.key,
              label: subjectName.label,
              required: true,
              autocomplete: "off" as const,
            },
          ]
        : []),
      ...(bookingDate
        ? [
            {
              target: "booking" as const,
              field: bookingDate.key,
              label: bookingDate.label,
              required: true,
              derived: true,
              autocomplete: "off" as const,
            },
          ]
        : []),
      ...(bookingTime
        ? [
            {
              target: "booking" as const,
              field: bookingTime.key,
              label: bookingTime.label,
              required: true,
              derived: true,
              autocomplete: "off" as const,
            },
          ]
        : []),
    ],
    schedule: {
      timezone_source: "business",
      location_id: null,
      days_of_week: [1, 2, 3, 4, 5, 6],
      first_time: "09:00",
      last_time: "17:00",
      slot_interval_minutes: 60,
      capacity_per_slot: decisions.capacityPerSlot,
      minimum_notice_minutes: 0,
      booking_horizon_days: 30,
    },
  });

  const alreadyPresented = operations.some(
    (operation): operation is PageOperation =>
      operation.op === "set_page" &&
      operation.audience === "public" &&
      operation.layout_json.blocks.some(
        (block) => block.type === "booking" && block.booking_key === "booking",
      ),
  );
  if (alreadyPresented) return;

  const bookingKey = nextKey(operations, "set_page", "booking_site");
  operations.push(
    setPageOperationSchema.parse({
      op: "set_page",
      key: bookingKey,
      title: "Book online",
      slug: nextPageSlug(operations, "book"),
      audience: "public",
      layout_json: pageLayoutSchema.parse({
        blocks: [
          { type: "heading", text: "Book online", level: 1 },
          {
            type: "text",
            text: "Choose a time that works for you.",
          },
          bookingBlockSchema.parse({
            type: "booking",
            booking_key: "booking",
            config,
          }),
        ],
      }),
      status: "draft",
      is_active: true,
    }),
  );
}

function nextFieldKey(state: ObjectState, base: string): string {
  if (!state.fields.some((field) => field.key === base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}_${index}`;
    if (!state.fields.some((field) => field.key === candidate))
      return candidate;
  }
  throw new Error("Unable to create a free Field key.");
}

function updateProposal(
  payload: AcquisitionBuildPayload,
  decisions: AcquisitionClarificationDecisions,
): AcquisitionBuildPayload["proposal"] {
  const notIncluded = payload.proposal.not_included.filter((item) => {
    if (decisions.onlineBooking === true && /public\s+booking/i.test(item)) {
      return false;
    }
    if (decisions.publicEnquiry === true && /public\s+forms?/i.test(item)) {
      return false;
    }
    return true;
  });
  const concepts =
    decisions.usesServices === false
      ? payload.proposal.concepts.filter(
          (concept) => !/service/i.test(concept.name),
        )
      : payload.proposal.concepts;
  const connections =
    decisions.usesServices === false
      ? payload.proposal.connections.filter(
          (connection) => !/service/i.test(connection.text),
        )
      : payload.proposal.connections;
  const views =
    decisions.usesServices === false
      ? payload.proposal.views.filter((view) => !/service/i.test(view.name))
      : payload.proposal.views;
  const pages = [...payload.proposal.pages];
  if (decisions.onlineBooking === true && pages.length < 3) {
    pages.push({
      name: "Booking Site",
      description:
        "A draft customer-facing page for choosing an available time.",
    });
  }
  if (decisions.publicEnquiry === true && pages.length < 3) {
    pages.push({
      name: "Enquiry Site",
      description: "A draft public page where customers can send an enquiry.",
    });
  }
  const understandingSuffix = [
    decisions.onlineBooking === true
      ? "It includes a draft online booking Site."
      : null,
    decisions.publicEnquiry === true
      ? "It includes a draft public enquiry Site."
      : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");
  return {
    ...payload.proposal,
    concepts: concepts.length > 0 ? concepts : payload.proposal.concepts,
    connections,
    views: views.length > 0 ? views : payload.proposal.views,
    understanding: `${payload.proposal.understanding} ${understandingSuffix}`
      .trim()
      .slice(0, 900),
    pages: pages.slice(0, 3),
    not_included: notIncluded.slice(0, 8),
  };
}

export function enhanceAcquisitionPayload(
  payloadInput: unknown,
  decisionsInput: AcquisitionClarificationDecisions,
  requestInput: unknown,
): AcquisitionBuildPayload {
  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  const decisions = z
    .object({
      onlineBooking: z.boolean().nullable(),
      usesServices: z.boolean().nullable(),
      capacityPerSlot: z.number().int().min(1).max(1000),
      publicEnquiry: z.boolean().nullable(),
    })
    .parse(decisionsInput);
  const request = z.string().trim().min(1).max(4_000).parse(requestInput);
  let operations = [...payload.operations];
  let states = objectStateMap(operations);

  if (decisions.usesServices === false) {
    const service = findObject(
      states,
      [/service|treatment|package/i],
      ["service"],
    );
    if (service) {
      operations = removeSeparateService(operations, service.object.key);
      states = objectStateMap(operations);
    }
  }

  if (decisions.publicEnquiry === true) {
    addPublicEnquirySurface(operations, states);
  }
  if (decisions.onlineBooking === true) {
    addBookingSurface(operations, states, request, decisions);
  }

  const proposal = updateProposal(payload, decisions);
  return acquisitionBuildPayloadSchema.parse({
    proposal,
    operations,
  });
}
