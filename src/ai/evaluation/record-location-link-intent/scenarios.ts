import { aiBusinessModelContextV1Schema } from "../../context/schemas";
import {
  builderRecordLocationLinkIntentOutputSchema,
  builderRecordLocationLinkIntentTaskInputSchema,
  type BuilderRecordLocationLinkIntentTaskInput,
} from "../../record-location-link-intent/schemas";
import { syntheticBusinessContext } from "../../../../evaluations/fixtures/synthetic-business-context";
import {
  builderRecordLocationLinkEvaluationScenarioIdSchema,
  type BuilderRecordLocationLinkEvaluationScenario,
  type BuilderRecordLocationLinkEvaluationScenarioId,
} from "./schemas";

export type { BuilderRecordLocationLinkEvaluationScenario } from "./schemas";

export const RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES =
  Object.freeze({
    bedford: "11111111-1111-4111-8111-111111111111",
    cambridge: "22222222-2222-4222-8222-222222222222",
    miltonKeynes: "33333333-3333-4333-8333-333333333333",
  });

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
    {
      key: "name",
      label: "Name",
      field_type: "short_text" as const,
      required: true,
      position: 0,
      is_active: true,
      has_default: false,
      settings: {},
    },
  ],
};

const product = syntheticBusinessContext.objects.find(
  ({ key }) => key === "product",
)!;

const evaluationContext = Object.freeze(
  aiBusinessModelContextV1Schema.parse({
    ...syntheticBusinessContext,
    business: {
      name: "Synthetic Record Availability Business",
      business_type: "bakery and equipment hire",
      timezone: "Europe/London",
    },
    locations: [
      {
        reference: RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.bedford,
        name: "Bedford",
        timezone: "Europe/London",
        is_active: true,
      },
      {
        reference:
          RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.cambridge,
        name: "Cambridge",
        timezone: "Europe/London",
        is_active: true,
      },
      {
        reference:
          RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.miltonKeynes,
        name: "Milton Keynes",
        timezone: "Europe/London",
        is_active: false,
      },
    ],
    objects: [product, equipment],
    relationships: [],
    views: [],
    forms: [],
    pages: [],
    preorder_experiences: [],
  }),
);

function readyPlan(objectKey: "product" | "equipment", locationId: string) {
  return {
    schema_version: 1 as const,
    state: "ready" as const,
    understanding: "The owner wants to change one Record's availability.",
    assumptions: [],
    unsupported_requirements: [],
    plan: {
      outcome: "One Record's Location availability changes after confirmation.",
      concepts: [
        {
          reference: "concept_1",
          label: objectKey,
          disposition: "existing" as const,
          existing_object_key: objectKey,
          purpose: "The existing Record whose availability changes.",
        },
      ],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: "Change one Record's Location availability.",
          dependencies: [],
          affected_concepts: ["concept_1"],
          existing_object_keys: [objectKey],
          location_references: [locationId],
          materiality: "medium" as const,
          requires_owner_confirmation: true as const,
          lane: "operational" as const,
          category: "link_record_to_location" as const,
        },
      ],
    },
  };
}

function taskInput(
  ownerRequest: string,
  objectKey: "product" | "equipment",
  locationId: string,
): BuilderRecordLocationLinkIntentTaskInput {
  return builderRecordLocationLinkIntentTaskInputSchema.parse({
    schema_version: 1,
    owner_request: ownerRequest,
    business_context: evaluationContext,
    ready_plan: readyPlan(objectKey, locationId),
  });
}

function expectedReady(input: {
  action: "link" | "unlink";
  objectKey: "product" | "equipment";
  selectorValue: string;
  locationReference: string;
  summary: string;
}) {
  return builderRecordLocationLinkIntentOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    summary: input.summary,
    source_step_reference: "step_1",
    action: input.action,
    object_key: input.objectKey,
    selector: {
      field_key: "name",
      field_type: "short_text",
      string_value: input.selectorValue,
    },
    location_reference: input.locationReference,
  });
}

function expectedClarification(question: string) {
  return builderRecordLocationLinkIntentOutputSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    understanding:
      "The request does not yet identify one safe availability change.",
    question,
    reason:
      "Builder needs one exact Record selector and one active Location before it can prepare this change.",
    source_step_reference: "step_1",
  });
}

export const BUILDER_RECORD_LOCATION_LINK_EVALUATION_SCENARIO_IDS = [
  "product_link",
  "product_unlink",
  "equipment_link",
  "equipment_unlink",
  "alternate_availability_wording",
  "missing_record_selector",
  "inactive_location",
  "multiple_record_request",
] as const satisfies readonly BuilderRecordLocationLinkEvaluationScenarioId[];

const definitions = [
  {
    id: "product_link",
    owner_request: "Make the Kids Afternoon Tea available at Bedford.",
    input: taskInput(
      "Make the Kids Afternoon Tea available at Bedford.",
      "product",
      RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.bedford,
    ),
    expected_output: expectedReady({
      action: "link",
      objectKey: "product",
      selectorValue: "Kids Afternoon Tea",
      locationReference:
        RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.bedford,
      summary: "Make one Product available at one Location.",
    }),
  },
  {
    id: "product_unlink",
    owner_request: "Kids Afternoon Tea shouldn't be available at Bedford.",
    input: taskInput(
      "Kids Afternoon Tea shouldn't be available at Bedford.",
      "product",
      RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.bedford,
    ),
    expected_output: expectedReady({
      action: "unlink",
      objectKey: "product",
      selectorValue: "Kids Afternoon Tea",
      locationReference:
        RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.bedford,
      summary: "Remove one Product from one Location.",
    }),
  },
  {
    id: "equipment_link",
    owner_request: "Make the Projector available at Cambridge.",
    input: taskInput(
      "Make the Projector available at Cambridge.",
      "equipment",
      RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.cambridge,
    ),
    expected_output: expectedReady({
      action: "link",
      objectKey: "equipment",
      selectorValue: "Projector",
      locationReference:
        RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.cambridge,
      summary: "Make one Record available at one Location.",
    }),
  },
  {
    id: "equipment_unlink",
    owner_request: "The Projector is no longer available at Cambridge.",
    input: taskInput(
      "The Projector is no longer available at Cambridge.",
      "equipment",
      RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.cambridge,
    ),
    expected_output: expectedReady({
      action: "unlink",
      objectKey: "equipment",
      selectorValue: "Projector",
      locationReference:
        RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.cambridge,
      summary: "Remove one Record from one Location.",
    }),
  },
  {
    id: "alternate_availability_wording",
    owner_request:
      "Please ensure the Kids Afternoon Tea is available in Bedford.",
    input: taskInput(
      "Please ensure the Kids Afternoon Tea is available in Bedford.",
      "product",
      RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.bedford,
    ),
    expected_output: expectedReady({
      action: "link",
      objectKey: "product",
      selectorValue: "Kids Afternoon Tea",
      locationReference:
        RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.bedford,
      summary: "Keep one Record available at one Location.",
    }),
  },
  {
    id: "missing_record_selector",
    owner_request: "Make the equipment available at Cambridge.",
    input: taskInput(
      "Make the equipment available at Cambridge.",
      "equipment",
      RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.cambridge,
    ),
    expected_output: expectedClarification(
      "Which exact Record should be made available at Cambridge?",
    ),
  },
  {
    id: "inactive_location",
    owner_request: "Make the Projector available at Milton Keynes.",
    input: taskInput(
      "Make the Projector available at Milton Keynes.",
      "equipment",
      RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.miltonKeynes,
    ),
    expected_output: expectedClarification(
      "Milton Keynes is inactive. Which active Location should be used?",
    ),
  },
  {
    id: "multiple_record_request",
    owner_request: "Make the Projector and the Speaker available at Cambridge.",
    input: taskInput(
      "Make the Projector and the Speaker available at Cambridge.",
      "equipment",
      RECORD_LOCATION_LINK_EVALUATION_LOCATION_REFERENCES.cambridge,
    ),
    expected_output: expectedClarification(
      "Which one exact Record should be made available at Cambridge?",
    ),
  },
] as const;

export const builderRecordLocationLinkEvaluationScenarios: readonly BuilderRecordLocationLinkEvaluationScenario[] =
  Object.freeze(
    definitions.map((definition) => ({
      id: builderRecordLocationLinkEvaluationScenarioIdSchema.parse(
        definition.id,
      ),
      owner_request: definition.owner_request,
      input: definition.input,
      expected_output: definition.expected_output,
    })),
  );

export function recordLocationLinkEvaluationScenario(
  id: BuilderRecordLocationLinkEvaluationScenarioId,
) {
  const scenario = builderRecordLocationLinkEvaluationScenarios.find(
    (candidate) => candidate.id === id,
  );
  if (!scenario) {
    throw new Error(`Missing Record-to-Location evaluation scenario: ${id}`);
  }
  return scenario;
}
