import {
  setFieldOperationSchema,
  setFormOperationSchema,
  setObjectOperationSchema,
  setRelationshipOperationSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../../../core/configuration/schemas";
import {
  formConfigSchema,
  parseViewConfig,
} from "../../../core/experience/schemas";
import { composeStarterComposition } from "../../../core/acquisition/composer";
import {
  acquisitionBuildPayloadSchema,
  type AcquisitionBuildPayload,
} from "../../../core/acquisition/schemas";
import type { AcquisitionEvaluationScenario } from "./scenarios";

type FieldFixture = {
  key: string;
  label: string;
  field_type:
    | "short_text"
    | "long_text"
    | "number"
    | "boolean"
    | "date"
    | "datetime"
    | "email"
    | "phone"
    | "url"
    | "select"
    | "multi_select"
    | "status";
  required?: boolean;
};

type AreaFixture = {
  key: string;
  singular_label: string;
  plural_label: string;
  description: string;
  fields: readonly FieldFixture[];
};

type RelationshipFixture = {
  key: string;
  source_object_key: string;
  target_object_key: string;
  source_label: string;
  target_label: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_many";
  text: string;
};

function objectOperation(area: AreaFixture) {
  return setObjectOperationSchema.parse({
    op: "set_object",
    key: area.key,
    singular_label: area.singular_label,
    plural_label: area.plural_label,
    description: area.description,
    icon: null,
    is_active: true,
  });
}

function fieldOperation(
  objectKey: string,
  field: FieldFixture,
  position: number,
) {
  return setFieldOperationSchema.parse({
    op: "set_field",
    object_key: objectKey,
    key: field.key,
    label: field.label,
    field_type: field.field_type,
    required: field.required ?? false,
    default_value: null,
    settings_json: {},
    position,
    is_active: true,
  });
}

function formOperation(
  area: AreaFixture,
  mode: "create" | "edit",
  key: string,
) {
  return setFormOperationSchema.parse({
    op: "set_form",
    key,
    name: `${mode === "create" ? "New" : "Edit"} ${area.singular_label}`,
    object_key: area.key,
    mode,
    config_json: formConfigSchema.parse({
      fields: area.fields.map((field) => ({ field: field.key, hidden: false })),
      submit_label:
        mode === "create" ? `Add ${area.singular_label}` : "Save changes",
    }),
    audience: "internal",
    is_active: true,
  });
}

function viewOperation(
  area: AreaFixture,
  createFormKey: string,
  editFormKey: string,
) {
  const fields = area.fields.map((field) => field.key);
  return setViewOperationSchema.parse({
    op: "set_view",
    key: `${area.key}_view`,
    name: area.plural_label,
    view_type: "table",
    object_key: area.key,
    config_json: parseViewConfig("table", {
      schema_version: 2,
      role: "primary",
      columns: fields.map((field_key) => ({ kind: "field", field_key })),
      fields,
      title_field: fields[0],
      create_form_key: createFormKey,
      edit_form_key: editFormKey,
      include_archived: false,
      filters: [],
      filter_match: "all",
      sorts: [],
      group: null,
    }),
    audience: "internal",
    is_active: true,
  });
}

function appendArea(
  payload: AcquisitionBuildPayload,
  area: AreaFixture,
): AcquisitionBuildPayload {
  const createFormKey = `${area.key}_create`;
  const editFormKey = `${area.key}_edit`;
  const operations = [
    ...payload.operations,
    objectOperation(area),
    ...area.fields.map((field, index) =>
      fieldOperation(area.key, field, index),
    ),
    formOperation(area, "create", createFormKey),
    formOperation(area, "edit", editFormKey),
    viewOperation(area, createFormKey, editFormKey),
  ];
  return acquisitionBuildPayloadSchema.parse({
    proposal: {
      ...payload.proposal,
      concepts: [
        ...payload.proposal.concepts,
        {
          name: area.plural_label,
          description: area.description,
          tracked_information: area.fields.map((field) => field.label),
        },
      ],
      views: [
        ...payload.proposal.views,
        {
          name: area.plural_label,
          description: `A practical view of ${area.plural_label.toLocaleLowerCase("en")}.`,
        },
      ],
    },
    operations,
  });
}

function appendField(
  payload: AcquisitionBuildPayload,
  objectKey: string,
  field: FieldFixture,
): AcquisitionBuildPayload {
  const objectFields = payload.operations.filter(
    (
      operation,
    ): operation is Extract<ConfigurationOperation, { op: "set_field" }> =>
      operation.op === "set_field" &&
      operation.object_key === objectKey &&
      operation.is_active,
  );
  const operations = payload.operations.map((operation) => {
    if (operation.op === "set_form" && operation.object_key === objectKey) {
      const config = formConfigSchema.parse(operation.config_json);
      return setFormOperationSchema.parse({
        ...operation,
        config_json: formConfigSchema.parse({
          ...config,
          fields: [...config.fields, { field: field.key, hidden: false }],
        }),
      });
    }
    if (operation.op === "set_view" && operation.object_key === objectKey) {
      const config = parseViewConfig(
        operation.view_type,
        operation.config_json,
      );
      if (operation.view_type !== "table" || !("fields" in config)) {
        return operation;
      }
      return setViewOperationSchema.parse({
        ...operation,
        config_json: parseViewConfig("table", {
          ...config,
          columns: [
            ...("columns" in config
              ? config.columns
              : config.fields.map((field_key) => ({
                  kind: "field" as const,
                  field_key,
                }))),
            { kind: "field", field_key: field.key },
          ],
          fields: [...config.fields, field.key],
        }),
      });
    }
    return operation;
  });
  operations.splice(
    operations.findIndex(
      (operation) =>
        operation.op === "set_object" && operation.key === objectKey,
    ) +
      objectFields.length +
      1,
    0,
    fieldOperation(objectKey, field, objectFields.length),
  );
  return acquisitionBuildPayloadSchema.parse({
    proposal: payload.proposal,
    operations,
  });
}

function appendRelationship(
  payload: AcquisitionBuildPayload,
  relationship: RelationshipFixture,
): AcquisitionBuildPayload {
  return acquisitionBuildPayloadSchema.parse({
    proposal: {
      ...payload.proposal,
      connections: [
        ...payload.proposal.connections,
        { text: relationship.text },
      ],
    },
    operations: [
      ...payload.operations,
      setRelationshipOperationSchema.parse({
        op: "set_relationship",
        key: relationship.key,
        source_object_key: relationship.source_object_key,
        target_object_key: relationship.target_object_key,
        source_label: relationship.source_label,
        target_label: relationship.target_label,
        cardinality: relationship.cardinality,
        is_required: false,
        is_active: true,
      }),
    ],
  });
}

function markTailored(
  payload: AcquisitionBuildPayload,
): AcquisitionBuildPayload {
  return acquisitionBuildPayloadSchema.parse({
    ...payload,
    proposal: { ...payload.proposal, source: "tailored" },
  });
}

const petArea: AreaFixture = {
  key: "pet",
  singular_label: "Pet",
  plural_label: "Pets",
  description: "The animals cared for in the grooming work.",
  fields: [
    { key: "name", label: "Name", field_type: "short_text", required: true },
  ],
};

const itemArea: AreaFixture = {
  key: "item",
  singular_label: "Item",
  plural_label: "Items",
  description: "The props available to rent.",
  fields: [
    { key: "name", label: "Name", field_type: "short_text", required: true },
  ],
};

const bookingArea: AreaFixture = {
  key: "booking",
  singular_label: "Booking",
  plural_label: "Bookings",
  description: "Bookings for the rented items.",
  fields: [
    { key: "title", label: "Title", field_type: "short_text", required: true },
  ],
};

function fixtureForScenario(
  scenario: AcquisitionEvaluationScenario,
): AcquisitionBuildPayload {
  let payload = markTailored(
    composeStarterComposition(scenario.category, scenario.request),
  );
  if (scenario.category === "appointments") {
    payload = appendRelationship(payload, {
      key: "customer_has_appointment",
      source_object_key: "customer",
      target_object_key: "appointment",
      source_label: "has appointments",
      target_label: "customer",
      cardinality: "one_to_many",
      text: "Customers can have several Appointments.",
    });
  }
  if (scenario.id === "dog_groomer") payload = appendArea(payload, petArea);
  if (scenario.id === "unusual_other") {
    payload = appendArea(payload, itemArea);
    payload = appendArea(payload, bookingArea);
    payload = appendRelationship(payload, {
      key: "customer_has_booking",
      source_object_key: "customer",
      target_object_key: "booking",
      source_label: "has bookings",
      target_label: "customer",
      cardinality: "one_to_many",
      text: "Customers can have several Bookings.",
    });
  }
  if (scenario.id === "product_tracking") {
    payload = appendArea(payload, {
      key: "customer",
      singular_label: "Customer",
      plural_label: "Customers",
      description: "People connected with the products.",
      fields: [
        {
          key: "name",
          label: "Name",
          field_type: "short_text",
          required: true,
        },
      ],
    });
    payload = appendRelationship(payload, {
      key: "customer_has_product",
      source_object_key: "customer",
      target_object_key: "product",
      source_label: "has products",
      target_label: "customer",
      cardinality: "one_to_many",
      text: "Customers can be connected with Products.",
    });
  }
  if (scenario.id === "milk_round") {
    payload = acquisitionBuildPayloadSchema.parse({
      ...payload,
      proposal: {
        ...payload.proposal,
        not_included: [
          ...payload.proposal.not_included,
          "WhatsApp integrations",
        ],
      },
    });
  }

  const leakTarget =
    scenario.id === "unusual_other"
      ? "booking"
      : scenario.category === "delivery"
        ? "order"
        : scenario.category === "jobs"
          ? "job"
          : scenario.category === "enquiries"
            ? "enquiry"
            : scenario.category === "products"
              ? "product"
              : "appointment";
  return appendField(payload, leakTarget, {
    key: "customer_name",
    label: "Customer name",
    field_type: "short_text",
    required: true,
  });
}

export function createScopedCorrectionQualificationFixture(
  scenario: AcquisitionEvaluationScenario,
): AcquisitionBuildPayload {
  return fixtureForScenario(scenario);
}
