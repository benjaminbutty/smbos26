import { aiBusinessModelContextV1Schema } from "../../context/schemas";
import {
  builderLocationCreationIntentOutputSchema,
  builderLocationCreationIntentTaskInputSchema,
  type BuilderLocationCreationIntentTaskInput,
} from "../../location-creation-intent/schemas";
import { syntheticBusinessContext } from "../../../../evaluations/fixtures/synthetic-business-context";
import {
  builderLocationCreationEvaluationScenarioIdSchema,
  type BuilderLocationCreationEvaluationScenarioId,
} from "./schemas";

function readyPlan() {
  return {
    schema_version: 1 as const,
    state: "ready" as const,
    understanding: "The owner wants to add one new Location.",
    assumptions: [],
    plan: {
      outcome: "One new Location can be added after owner confirmation.",
      concepts: [],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          summary: "Create one new Location.",
          dependencies: [],
          affected_concepts: [],
          existing_object_keys: [],
          location_references: [],
          materiality: "high" as const,
          requires_owner_confirmation: true as const,
          lane: "operational" as const,
          category: "create_location" as const,
        },
      ],
    },
    unsupported_requirements: [],
  };
}

function contextWithLocation(name: string, isActive: boolean) {
  return aiBusinessModelContextV1Schema.parse({
    ...syntheticBusinessContext,
    locations: [
      ...syntheticBusinessContext.locations,
      {
        reference: "33333333-3333-4333-8333-333333333333",
        name,
        timezone: "Europe/London",
        is_active: isActive,
      },
    ],
  });
}

export const BUILDER_LOCATION_CREATION_EVALUATION_SCENARIO_IDS = [
  "explicit_timezone",
  "business_timezone",
  "alternate_wording",
  "active_duplicate",
  "inactive_duplicate",
  "missing_name",
  "local_timezone_without_iana",
  "multi_word_identity",
] as const satisfies readonly BuilderLocationCreationEvaluationScenarioId[];

function expectedReady(input: {
  locationName: string;
  timezoneIntent: "explicit_timezone" | "use_business_timezone";
  timezone?: string;
}) {
  return builderLocationCreationIntentOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    summary: `Add ${input.locationName} as one new Location.`,
    location_name: input.locationName,
    timezone_intent:
      input.timezoneIntent === "explicit_timezone"
        ? { kind: "explicit_timezone", timezone: input.timezone }
        : { kind: "use_business_timezone" },
    source_step_references: ["step_1"],
  });
}

function expectedClarification(question: string) {
  return builderLocationCreationIntentOutputSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    understanding: "The request needs one exact Location detail.",
    question,
    reason: "Builder cannot safely infer this operational detail.",
    source_step_references: ["step_1"],
  });
}

const definitions = [
  {
    id: "explicit_timezone",
    owner_request: "Add Cambridge as a new Location in Europe/London.",
    business_context: syntheticBusinessContext,
    expected_output: expectedReady({
      locationName: "Cambridge",
      timezoneIntent: "explicit_timezone",
      timezone: "Europe/London",
    }),
  },
  {
    id: "business_timezone",
    owner_request: "Add Cambridge as a new Location.",
    business_context: syntheticBusinessContext,
    expected_output: expectedReady({
      locationName: "Cambridge",
      timezoneIntent: "use_business_timezone",
    }),
  },
  {
    id: "alternate_wording",
    owner_request: "We have opened another site in Cambridge.",
    business_context: syntheticBusinessContext,
    expected_output: expectedReady({
      locationName: "Cambridge",
      timezoneIntent: "use_business_timezone",
    }),
  },
  {
    id: "active_duplicate",
    owner_request: "Add Cambridge as a new Location.",
    business_context: contextWithLocation("Cambridge", true),
    expected_output: expectedClarification(
      "Cambridge is already an active Location. What should happen next?",
    ),
  },
  {
    id: "inactive_duplicate",
    owner_request: "Create a Location called Cambridge.",
    business_context: contextWithLocation("Cambridge", false),
    expected_output: expectedClarification(
      "Cambridge is already an inactive Location. What should happen next?",
    ),
  },
  {
    id: "missing_name",
    owner_request: "Add another Location.",
    business_context: syntheticBusinessContext,
    expected_output: expectedClarification(
      "What exact name should the new Location have?",
    ),
  },
  {
    id: "local_timezone_without_iana",
    owner_request: "Add Cambridge using its local timezone.",
    business_context: syntheticBusinessContext,
    expected_output: expectedClarification(
      "Which exact IANA timezone should this Location use?",
    ),
  },
  {
    id: "multi_word_identity",
    owner_request: "Create a new Location called New York.",
    business_context: contextWithLocation("York", true),
    expected_output: expectedReady({
      locationName: "New York",
      timezoneIntent: "use_business_timezone",
    }),
  },
] as const;

export interface BuilderLocationCreationEvaluationScenario {
  id: BuilderLocationCreationEvaluationScenarioId;
  owner_request: string;
  input: BuilderLocationCreationIntentTaskInput;
  expected_output: ReturnType<
    typeof builderLocationCreationIntentOutputSchema.parse
  >;
}

export const builderLocationCreationEvaluationScenarios: readonly BuilderLocationCreationEvaluationScenario[] =
  Object.freeze(
    definitions.map((definition) => {
      const id = builderLocationCreationEvaluationScenarioIdSchema.parse(
        definition.id,
      );
      const input = builderLocationCreationIntentTaskInputSchema.parse({
        schema_version: 1,
        owner_request: definition.owner_request,
        business_context: definition.business_context,
        ready_plan: readyPlan(),
      });
      return Object.freeze({
        id,
        owner_request: definition.owner_request,
        input,
        expected_output: definition.expected_output,
      });
    }),
  );

export function locationCreationEvaluationScenario(
  id: BuilderLocationCreationEvaluationScenarioId,
) {
  const scenario = builderLocationCreationEvaluationScenarios.find(
    (candidate) => candidate.id === id,
  );
  if (!scenario) {
    throw new Error(`Missing Location creation evaluation scenario: ${id}`);
  }
  return scenario;
}
