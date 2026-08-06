import { aiBusinessModelContextV1Schema } from "../../context/schemas";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
} from "../../planning/schemas";
import {
  builderRecordUpdateIntentOutputSchema,
  builderRecordUpdateIntentTaskInputSchema,
  type BuilderRecordUpdateIntentTaskInput,
} from "../../record-update-intent/schemas";
import { syntheticBusinessContext } from "../../../../evaluations/fixtures/synthetic-business-context";
import {
  builderRecordUpdateEvaluationScenarioIdSchema,
  type BuilderRecordUpdateEvaluationScenario,
  type BuilderRecordUpdateEvaluationScenarioId,
} from "./schemas";

export type { BuilderRecordUpdateEvaluationScenario } from "./schemas";

type FieldType =
  | "short_text"
  | "long_text"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "email"
  | "phone"
  | "currency"
  | "url"
  | "select"
  | "multi_select"
  | "file"
  | "status";

function field(
  key: string,
  label: string,
  fieldType: FieldType,
  position: number,
  options: {
    required?: boolean;
    settings?: { options?: string[]; currency?: string };
  } = {},
) {
  return {
    key,
    label,
    field_type: fieldType,
    required: options.required ?? false,
    position,
    is_active: true,
    has_default: false,
    settings: options.settings ?? {},
  };
}

const productFields = [
  field("name", "Name", "short_text", 0, { required: true }),
  field("description", "Description", "long_text", 1),
  field("price", "Price", "currency", 2, {
    required: true,
    settings: { currency: "GBP" },
  }),
  field("status", "Status", "status", 3, {
    required: true,
    settings: { options: ["Active", "Inactive"] },
  }),
  field("image", "Image", "file", 4),
];

const contextAProduct = {
  ...syntheticBusinessContext.objects.find(({ key }) => key === "product")!,
  fields: productFields,
};

export const recordUpdateEvaluationContextA = Object.freeze(
  aiBusinessModelContextV1Schema.parse({
    ...syntheticBusinessContext,
    business: {
      name: "Synthetic Bedford Bakery",
      business_type: "bakery and local food business",
      timezone: "Europe/London",
    },
    locations: [],
    objects: syntheticBusinessContext.objects.map((object) =>
      object.key === "product" ? contextAProduct : object,
    ),
    relationships: [],
    views: [],
    forms: [],
    pages: [],
  }),
);

const equipment = {
  key: "equipment",
  singular_label: "Equipment",
  plural_label: "Equipment",
  description: "Equipment available for hire.",
  kind: "custom" as const,
  semantic_type: null,
  icon: "tool",
  is_active: true,
  fields: [
    field("name", "Name", "short_text", 0, { required: true }),
    field("hire_price", "Hire price", "currency", 1, {
      required: true,
      settings: { currency: "GBP" },
    }),
    field("available", "Available", "boolean", 2, { required: true }),
    field("category", "Category", "select", 3, {
      settings: { options: ["Audio Visual", "Furniture", "Catering"] },
    }),
    field("tags", "Tags", "multi_select", 4, {
      settings: { options: ["Indoor", "Outdoor", "Powered"] },
    }),
  ],
};

const cateringEnquiry = {
  key: "catering_enquiry",
  singular_label: "Catering Enquiry",
  plural_label: "Catering Enquiries",
  description: "An enquiry about an upcoming catering event.",
  kind: "custom" as const,
  semantic_type: null,
  icon: "calendar",
  is_active: true,
  fields: [
    field("company_name", "Company name", "short_text", 0, {
      required: true,
    }),
    field("event_date", "Event date", "date", 1, { required: true }),
    field("guest_count", "Guest count", "number", 2, { required: true }),
    field("budget", "Budget", "currency", 3, {
      required: true,
      settings: { currency: "GBP" },
    }),
    field("notes", "Notes", "long_text", 4),
    field("status", "Status", "status", 5, {
      required: true,
      settings: { options: ["New", "Contacted", "Closed"] },
    }),
  ],
};

const supplierQuote = {
  key: "supplier_quote",
  singular_label: "Supplier Quote",
  plural_label: "Supplier Quotes",
  description: "A quote received from a supplier.",
  kind: "custom" as const,
  semantic_type: null,
  icon: "file-text",
  is_active: true,
  fields: [
    field("quote_reference", "Quote reference", "short_text", 0, {
      required: true,
    }),
    field("status", "Status", "status", 1, {
      required: true,
      settings: { options: ["Draft", "Submitted", "Approved", "Rejected"] },
    }),
  ],
};

export const recordUpdateEvaluationContextB = Object.freeze(
  aiBusinessModelContextV1Schema.parse({
    ...syntheticBusinessContext,
    business: {
      name: "Synthetic Lantern Services",
      business_type: "equipment hire and catering",
      timezone: "Europe/London",
    },
    locations: [],
    objects: [equipment, cateringEnquiry, supplierQuote],
    relationships: [],
    views: [],
    forms: [],
    pages: [],
    preorder_experiences: [],
  }),
);

function readyPlan(objectKey: string, objectLabel: string): BuilderPlanOutput {
  return builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: `The owner wants to update one ${objectLabel}.`,
    assumptions: [],
    unsupported_requirements: [],
    plan: {
      outcome: `One ${objectLabel} can be updated after confirmation.`,
      concepts: [
        {
          reference: "concept_1",
          label: objectLabel,
          disposition: "existing",
          existing_object_key: objectKey,
          purpose: `The existing ${objectLabel} Record to update.`,
        },
      ],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: `Update one ${objectLabel} Record.`,
          dependencies: [],
          affected_concepts: ["concept_1"],
          existing_object_keys: [objectKey],
          location_references: [],
          materiality: "medium",
          requires_owner_confirmation: true,
          lane: "operational",
          category: "update_record",
        },
      ],
    },
  });
}

function taskInput(
  ownerRequest: string,
  businessContext: unknown,
  objectKey: string,
  objectLabel: string,
): BuilderRecordUpdateIntentTaskInput {
  return builderRecordUpdateIntentTaskInputSchema.parse({
    schema_version: 1,
    owner_request: ownerRequest,
    business_context: businessContext,
    ready_plan: readyPlan(objectKey, objectLabel),
  });
}

function readyOutput(
  objectKey: string,
  selector: unknown,
  fieldUpdates: readonly unknown[],
  summary: string,
) {
  return builderRecordUpdateIntentOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    summary,
    source_step_reference: "step_1",
    object_key: objectKey,
    selector,
    field_updates: fieldUpdates,
  });
}

function clarification(question: string) {
  return builderRecordUpdateIntentOutputSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    understanding: "The request does not yet identify a safe absolute update.",
    question,
    reason:
      "Builder needs one exact current Record detail and an explicit new value.",
    source_step_reference: "step_1",
  });
}

const productContext = recordUpdateEvaluationContextA;
const servicesContext = recordUpdateEvaluationContextB;

const definitions = [
  {
    id: "product_rename",
    owner_request: "Rename Celebration Box to Celebration Platter.",
    input: taskInput(
      "Rename Celebration Box to Celebration Platter.",
      productContext,
      "product",
      "Product",
    ),
    expected_output: readyOutput(
      "product",
      {
        field_key: "name",
        field_type: "short_text",
        string_value: "Celebration Box",
      },
      [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Celebration Platter",
        },
      ],
      "Rename the Celebration Box Product to Celebration Platter.",
    ),
  },
  {
    id: "product_absolute_currency",
    owner_request: "Change Afternoon Tea Box price to £32.",
    input: taskInput(
      "Change Afternoon Tea Box price to £32.",
      productContext,
      "product",
      "Product",
    ),
    expected_output: readyOutput(
      "product",
      {
        field_key: "name",
        field_type: "short_text",
        string_value: "Afternoon Tea Box",
      },
      [{ field_key: "price", field_type: "currency", number_value: 32 }],
      "Change the Afternoon Tea Box price to £32.",
    ),
  },
  {
    id: "equipment_multi_field",
    owner_request:
      "Change the Projector hire price to £65 and mark it unavailable.",
    input: taskInput(
      "Change the Projector hire price to £65 and mark it unavailable.",
      servicesContext,
      "equipment",
      "Equipment",
    ),
    expected_output: readyOutput(
      "equipment",
      {
        field_key: "name",
        field_type: "short_text",
        string_value: "Projector",
      },
      [
        { field_key: "hire_price", field_type: "currency", number_value: 65 },
        { field_key: "available", field_type: "boolean", boolean_value: false },
      ],
      "Change the Projector hire price and availability.",
    ),
  },
  {
    id: "catering_date_budget",
    owner_request:
      "For Bedford Events Ltd, change the event date to 2026-09-12 and the budget to £2,500.",
    input: taskInput(
      "For Bedford Events Ltd, change the event date to 2026-09-12 and the budget to £2,500.",
      servicesContext,
      "catering_enquiry",
      "Catering Enquiry",
    ),
    expected_output: readyOutput(
      "catering_enquiry",
      {
        field_key: "company_name",
        field_type: "short_text",
        string_value: "Bedford Events Ltd",
      },
      [
        {
          field_key: "event_date",
          field_type: "date",
          date_value: "2026-09-12",
        },
        { field_key: "budget", field_type: "currency", number_value: 2500 },
      ],
      "Change the Bedford Events Ltd enquiry date and budget.",
    ),
  },
  {
    id: "single_selector_update",
    owner_request:
      "Rename the Projector with hire price £50 to Conference Projector.",
    input: taskInput(
      "Rename the Projector with hire price £50 to Conference Projector.",
      servicesContext,
      "equipment",
      "Equipment",
    ),
    expected_output: readyOutput(
      "equipment",
      {
        field_key: "name",
        field_type: "short_text",
        string_value: "Projector",
      },
      [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Conference Projector",
        },
      ],
      "Rename the uniquely selected Projector.",
    ),
  },
  {
    id: "status_option",
    owner_request: "Change Supplier Quote SQ-104 status to Approved.",
    input: taskInput(
      "Change Supplier Quote SQ-104 status to Approved.",
      servicesContext,
      "supplier_quote",
      "Supplier Quote",
    ),
    expected_output: readyOutput(
      "supplier_quote",
      {
        field_key: "quote_reference",
        field_type: "short_text",
        string_value: "SQ-104",
      },
      [{ field_key: "status", field_type: "status", option_value: "Approved" }],
      "Change Supplier Quote SQ-104 to Approved.",
    ),
  },
  {
    id: "relative_value_clarification",
    owner_request: "Increase the Projector hire price by 10%.",
    input: taskInput(
      "Increase the Projector hire price by 10%.",
      servicesContext,
      "equipment",
      "Equipment",
    ),
    expected_output: clarification(
      "What should the Projector's absolute new hire price be?",
    ),
  },
  {
    id: "missing_target_clarification",
    owner_request: "Change the Product price to £30.",
    input: taskInput(
      "Change the Product price to £30.",
      productContext,
      "product",
      "Product",
    ),
    expected_output: clarification(
      "Which Product's current name should Builder use to identify it?",
    ),
  },
] as const;

export const BUILDER_RECORD_UPDATE_EVALUATION_SCENARIO_IDS = [
  "product_rename",
  "product_absolute_currency",
  "equipment_multi_field",
  "catering_date_budget",
  "single_selector_update",
  "status_option",
  "relative_value_clarification",
  "missing_target_clarification",
] as const satisfies readonly BuilderRecordUpdateEvaluationScenarioId[];

export const builderRecordUpdateEvaluationScenarios = Object.freeze(
  definitions.map((scenario) =>
    Object.freeze({
      ...scenario,
      id: builderRecordUpdateEvaluationScenarioIdSchema.parse(scenario.id),
    }),
  ),
) as readonly BuilderRecordUpdateEvaluationScenario[];

export function getBuilderRecordUpdateEvaluationScenario(
  id: BuilderRecordUpdateEvaluationScenarioId,
) {
  const scenario = builderRecordUpdateEvaluationScenarios.find(
    (candidate) => candidate.id === id,
  );
  if (!scenario) {
    throw new Error(`Missing Record-update evaluation scenario: ${id}`);
  }
  return scenario;
}
