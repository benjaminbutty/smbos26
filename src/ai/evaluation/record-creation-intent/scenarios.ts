import { aiBusinessModelContextV1Schema } from "../../context/schemas";
import {
  builderRecordCreationIntentOutputSchema,
  builderRecordCreationIntentTaskInputSchema,
  type BuilderRecordCreationFieldValue,
  type BuilderRecordCreationIntentTaskInput,
} from "../../record-creation-intent/schemas";
import { syntheticBusinessContext } from "../../../../evaluations/fixtures/synthetic-business-context";
import {
  builderRecordCreationEvaluationScenarioIdSchema,
  type BuilderRecordCreationEvaluationScenarioId,
  type BuilderRecordCreationEvaluationScenario,
} from "./schemas";

export type { BuilderRecordCreationEvaluationScenario } from "./schemas";

type FieldType =
  | "short_text"
  | "long_text"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "email"
  | "phone"
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
    hasDefault?: boolean;
  } = {},
) {
  return {
    key,
    label,
    field_type: fieldType,
    required: options.required ?? false,
    position,
    is_active: true,
    has_default: options.hasDefault ?? false,
    settings: options.settings ?? {},
  };
}

function context(
  name: string,
  businessType: string,
  objects: readonly unknown[],
) {
  return aiBusinessModelContextV1Schema.parse({
    ...syntheticBusinessContext,
    business: {
      name,
      business_type: businessType,
      timezone: "Europe/London",
    },
    locations: [],
    objects,
    relationships: [],
    views: [],
    forms: [],
    pages: [],
    preorder_experiences: [],
  });
}

const product = {
  key: "product",
  singular_label: "Product",
  plural_label: "Products",
  description: "Food products offered by the business.",
  kind: "custom" as const,
  semantic_type: "product",
  icon: "box",
  is_active: true,
  fields: [
    field("name", "Name", "short_text", 0, { required: true }),
    field("description", "Description", "long_text", 1),
    field("price", "Price", "currency", 2, {
      required: true,
      settings: { currency: "GBP" },
    }),
    field("status", "Status", "status", 3, {
      required: true,
      hasDefault: true,
      settings: { options: ["Active", "Inactive"] },
    }),
    field("image", "Image", "file", 4),
  ],
};

const menuItem = {
  key: "menu_item",
  singular_label: "Menu item",
  plural_label: "Menu items",
  description: "A configured menu item with categorisation.",
  kind: "custom" as const,
  semantic_type: null,
  icon: "list",
  is_active: true,
  fields: [
    field("name", "Name", "short_text", 0, { required: true }),
    field("category", "Category", "select", 1, {
      settings: { options: ["Food", "Drink", "Gift"] },
    }),
    field("tags", "Tags", "multi_select", 2, {
      settings: { options: ["Featured", "Seasonal", "Vegan"] },
    }),
    field("status", "Status", "status", 3, {
      required: true,
      hasDefault: true,
      settings: { options: ["Active", "Paused"] },
    }),
  ],
};

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
      hasDefault: true,
      settings: { options: ["New", "Contacted", "Closed"] },
    }),
  ],
};

const lead = {
  key: "lead",
  singular_label: "Lead",
  plural_label: "Leads",
  description: "A prospective customer contact.",
  kind: "custom" as const,
  semantic_type: null,
  icon: "user",
  is_active: true,
  fields: [
    field("name", "Name", "short_text", 0, { required: true }),
    field("email", "Email", "email", 1, { required: true }),
    field("phone", "Phone", "phone", 2, { required: true }),
    field("website", "Website", "url", 3),
  ],
};

export const recordCreationEvaluationContextA = Object.freeze(
  context("Synthetic Lantern Bakery", "bakery and local food business", [
    product,
    menuItem,
  ]),
);

export const recordCreationEvaluationContextB = Object.freeze(
  context("Synthetic Lantern Services", "equipment hire and catering", [
    equipment,
    cateringEnquiry,
    lead,
  ]),
);

function readyPlan(objectKey: string, objectLabel: string) {
  return {
    schema_version: 1 as const,
    state: "ready" as const,
    understanding: `The owner wants to add one ${objectLabel}.`,
    assumptions: [],
    unsupported_requirements: [],
    plan: {
      outcome: `One ${objectLabel} can be added after confirmation.`,
      concepts: [
        {
          reference: "concept_1",
          label: objectLabel,
          disposition: "existing" as const,
          existing_object_key: objectKey,
          purpose: `The existing ${objectLabel} Object to add.`,
        },
      ],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: `Create one ${objectLabel}.`,
          dependencies: [],
          affected_concepts: ["concept_1"],
          existing_object_keys: [objectKey],
          location_references: [],
          materiality: "medium" as const,
          requires_owner_confirmation: true as const,
          lane: "operational" as const,
          category: "create_initial_record" as const,
        },
      ],
    },
  };
}

function taskInput(
  ownerRequest: string,
  businessContext: unknown,
  objectKey: string,
  objectLabel: string,
): BuilderRecordCreationIntentTaskInput {
  return builderRecordCreationIntentTaskInputSchema.parse({
    schema_version: 1,
    owner_request: ownerRequest,
    business_context: businessContext,
    ready_plan: readyPlan(objectKey, objectLabel),
  });
}

function readyOutput(
  objectKey: string,
  fieldValues: readonly BuilderRecordCreationFieldValue[],
  summary: string,
) {
  return builderRecordCreationIntentOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    summary,
    source_step_references: ["step_1"],
    object_key: objectKey,
    field_values: fieldValues,
  });
}

function clarification(question: string) {
  return builderRecordCreationIntentOutputSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    understanding: "The request needs one required Record value.",
    question,
    reason: "Builder cannot safely invent a required business value.",
    source_step_references: ["step_1"],
  });
}

const definitions = [
  {
    id: "product_text_currency_default",
    owner_request:
      'Add a Product called Afternoon Tea Box, with the description "Afternoon tea for two", priced at £30.',
    input: taskInput(
      'Add a Product called Afternoon Tea Box, with the description "Afternoon tea for two", priced at £30.',
      recordCreationEvaluationContextA,
      "product",
      "Product",
    ),
    expected_output: readyOutput(
      "product",
      [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Afternoon Tea Box",
        },
        {
          field_key: "description",
          field_type: "long_text",
          string_value: "Afternoon tea for two",
        },
        { field_key: "price", field_type: "currency", number_value: 30 },
      ],
      "Add Afternoon Tea Box at £30.",
    ),
  },
  {
    id: "equipment_boolean",
    owner_request:
      "Add a Projector to Equipment. Its hire price is £50 and it is available.",
    input: taskInput(
      "Add a Projector to Equipment. Its hire price is £50 and it is available.",
      recordCreationEvaluationContextB,
      "equipment",
      "Equipment",
    ),
    expected_output: readyOutput(
      "equipment",
      [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Projector",
        },
        { field_key: "hire_price", field_type: "currency", number_value: 50 },
        { field_key: "available", field_type: "boolean", boolean_value: true },
      ],
      "Add Projector equipment at £50; it is available.",
    ),
  },
  {
    id: "catering_enquiry_dates_numbers",
    owner_request:
      "Add a Catering Enquiry for Bedford Events Ltd for 20 August 2026, for 80 guests, with a budget of £2,000.",
    input: taskInput(
      "Add a Catering Enquiry for Bedford Events Ltd for 20 August 2026, for 80 guests, with a budget of £2,000.",
      recordCreationEvaluationContextB,
      "catering_enquiry",
      "Catering Enquiry",
    ),
    expected_output: readyOutput(
      "catering_enquiry",
      [
        {
          field_key: "company_name",
          field_type: "short_text",
          string_value: "Bedford Events Ltd",
        },
        {
          field_key: "event_date",
          field_type: "date",
          date_value: "2026-08-20",
        },
        { field_key: "guest_count", field_type: "number", number_value: 80 },
        { field_key: "budget", field_type: "currency", number_value: 2000 },
      ],
      "Add the Bedford Events Ltd catering enquiry for 20 August 2026.",
    ),
  },
  {
    id: "configured_options",
    owner_request:
      "Add a Menu item called Earl Grey. Its category is Drink and its status is Active.",
    input: taskInput(
      "Add a Menu item called Earl Grey. Its category is Drink and its status is Active.",
      recordCreationEvaluationContextA,
      "menu_item",
      "Menu item",
    ),
    expected_output: readyOutput(
      "menu_item",
      [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Earl Grey",
        },
        { field_key: "category", field_type: "select", option_value: "Drink" },
        { field_key: "status", field_type: "status", option_value: "Active" },
      ],
      "Add Earl Grey as a Drink menu item.",
    ),
  },
  {
    id: "optional_fields_omitted",
    owner_request:
      "Add a Lead named Bedford Events Ltd. Their email is events@example.test and phone is 01234567890.",
    input: taskInput(
      "Add a Lead named Bedford Events Ltd. Their email is events@example.test and phone is 01234567890.",
      recordCreationEvaluationContextB,
      "lead",
      "Lead",
    ),
    expected_output: readyOutput(
      "lead",
      [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Bedford Events Ltd",
        },
        {
          field_key: "email",
          field_type: "email",
          string_value: "events@example.test",
        },
        {
          field_key: "phone",
          field_type: "phone",
          string_value: "01234567890",
        },
      ],
      "Add the Bedford Events Ltd Lead contact without a website.",
    ),
  },
  {
    id: "required_field_missing",
    owner_request: "Add a Projector to Equipment.",
    input: taskInput(
      "Add a Projector to Equipment.",
      recordCreationEvaluationContextB,
      "equipment",
      "Equipment",
    ),
    expected_output: clarification(
      "What hire price and availability should the Projector have?",
    ),
  },
  {
    id: "contact_field_types",
    owner_request:
      "Add a Lead named Bedford Events Ltd. Their email is events@example.test, phone is 01234567890, and website is https://bedford-events.example.",
    input: taskInput(
      "Add a Lead named Bedford Events Ltd. Their email is events@example.test, phone is 01234567890, and website is https://bedford-events.example.",
      recordCreationEvaluationContextB,
      "lead",
      "Lead",
    ),
    expected_output: readyOutput(
      "lead",
      [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Bedford Events Ltd",
        },
        {
          field_key: "email",
          field_type: "email",
          string_value: "events@example.test",
        },
        {
          field_key: "phone",
          field_type: "phone",
          string_value: "01234567890",
        },
        {
          field_key: "website",
          field_type: "url",
          string_value: "https://bedford-events.example",
        },
      ],
      "Add the Bedford Events Ltd Lead contact.",
    ),
  },
  {
    id: "multi_select",
    owner_request:
      "Add a Projector to Equipment. Its hire price is £50, it is available, and its tags are Indoor and Powered.",
    input: taskInput(
      "Add a Projector to Equipment. Its hire price is £50, it is available, and its tags are Indoor and Powered.",
      recordCreationEvaluationContextB,
      "equipment",
      "Equipment",
    ),
    expected_output: readyOutput(
      "equipment",
      [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Projector",
        },
        { field_key: "hire_price", field_type: "currency", number_value: 50 },
        { field_key: "available", field_type: "boolean", boolean_value: true },
        {
          field_key: "tags",
          field_type: "multi_select",
          option_values: ["Indoor", "Powered"],
        },
      ],
      "Add Projector equipment with Indoor and Powered tags.",
    ),
  },
] as const;

export const BUILDER_RECORD_CREATION_EVALUATION_SCENARIO_IDS = [
  "product_text_currency_default",
  "equipment_boolean",
  "catering_enquiry_dates_numbers",
  "configured_options",
  "optional_fields_omitted",
  "required_field_missing",
  "contact_field_types",
  "multi_select",
] as const satisfies readonly BuilderRecordCreationEvaluationScenarioId[];

export const builderRecordCreationEvaluationScenarios: readonly BuilderRecordCreationEvaluationScenario[] =
  Object.freeze(
    definitions.map((definition) => {
      const id = builderRecordCreationEvaluationScenarioIdSchema.parse(
        definition.id,
      );
      return Object.freeze({
        id,
        owner_request: definition.owner_request,
        input: definition.input,
        expected_output: definition.expected_output,
      });
    }),
  );

export function recordCreationEvaluationScenario(
  id: BuilderRecordCreationEvaluationScenarioId,
) {
  const scenario = builderRecordCreationEvaluationScenarios.find(
    (candidate) => candidate.id === id,
  );
  if (!scenario) {
    throw new Error(`Missing Record creation evaluation scenario: ${id}`);
  }
  return scenario;
}
