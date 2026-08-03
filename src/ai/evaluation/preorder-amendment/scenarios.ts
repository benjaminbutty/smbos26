import { builderPreorderAmendmentOutputSchema } from "../../preorder-amendment/schemas";
import {
  builderPreorderAmendmentEvaluationScenarioSchema,
  type BuilderPreorderAmendmentEvaluationScenario,
} from "./schemas";

const plan = (
  categories: readonly ("configure_preorder" | "define_field")[],
) => ({
  schema_version: 1 as const,
  state: "ready" as const,
  understanding: "Synthetic preorder amendment request.",
  assumptions: [],
  plan: {
    outcome: "The owner can review one bounded preorder proposal.",
    concepts: [],
    user_journeys: [],
    steps: categories.map((category, index) => ({
      reference: `step_${index + 1}`,
      sequence: index + 1,
      summary:
        category === "configure_preorder"
          ? "Change the existing public preorder experience."
          : "Define one new Order question Field.",
      dependencies: index === 0 ? [] : [`step_${index}`],
      affected_concepts: [],
      existing_object_keys: category === "define_field" ? ["order"] : [],
      location_references: [],
      materiality: "low" as const,
      requires_owner_confirmation: true as const,
      lane: "configuration" as const,
      category,
    })),
  },
  unsupported_requirements: [],
});

const amendment = (value: unknown) =>
  builderPreorderAmendmentOutputSchema.parse({
    schema_version: 1,
    summary: "Synthetic bounded preorder amendment.",
    preorder_key: "bakery_preorder",
    amendments: [value],
  });

const combined = (values: readonly unknown[]) =>
  builderPreorderAmendmentOutputSchema.parse({
    schema_version: 1,
    summary: "Synthetic combined preorder amendment.",
    preorder_key: "bakery_preorder",
    amendments: values,
  });

const scenarioDefinitions = [
  {
    id: "phone_optional",
    owner_request: "Make phone optional.",
    expected_output: amendment({
      type: "set_existing_question_requiredness",
      target: "customer",
      field_key: "phone",
      required: false,
      source_step_references: ["step_1"],
    }),
    plan: plan(["configure_preorder"]),
  },
  {
    id: "remove_sunday",
    owner_request: "Remove Sunday collection.",
    expected_output: amendment({
      type: "set_collection_days",
      days_of_week: [5, 6],
      source_step_references: ["step_1"],
    }),
    plan: plan(["configure_preorder"]),
  },
  {
    id: "cutoff_to_72",
    owner_request: "Change the cutoff from 48 to 72 hours.",
    expected_output: amendment({
      type: "set_cutoff_hours",
      cutoff_hours: 72,
      source_step_references: ["step_1"],
    }),
    plan: plan(["configure_preorder"]),
  },
  {
    id: "remove_sunday_cutoff_72",
    owner_request: "Remove Sunday collection and require 72 hours' notice.",
    expected_output: combined([
      {
        type: "set_collection_days",
        days_of_week: [5, 6],
        source_step_references: ["step_1"],
      },
      {
        type: "set_cutoff_hours",
        cutoff_hours: 72,
        source_step_references: ["step_1"],
      },
    ]),
    plan: plan(["configure_preorder"]),
  },
  {
    id: "occasion_optional_short",
    owner_request: "Add an optional Occasion question.",
    expected_output: amendment({
      type: "add_preorder_question",
      label: "Occasion",
      help_text: null,
      required: false,
      answer_style: "short_answer",
      source_step_references: ["step_1", "step_2"],
    }),
    plan: plan(["configure_preorder", "define_field"]),
  },
  {
    id: "gift_message_optional_long",
    owner_request: "Add an optional long-answer Gift message question.",
    expected_output: amendment({
      type: "add_preorder_question",
      label: "Gift message",
      help_text: null,
      required: false,
      answer_style: "long_answer",
      source_step_references: ["step_1", "step_2"],
    }),
    plan: plan(["configure_preorder", "define_field"]),
  },
  {
    id: "existing_question_wording_help",
    owner_request:
      'Rename Dietary requirements to Food notes and set its help text to "Tell us about allergies or preferences."',
    expected_output: combined([
      {
        type: "set_existing_question_label",
        target: "order",
        field_key: "dietary_requirements",
        label: "Food notes",
        source_step_references: ["step_1"],
      },
      {
        type: "set_existing_question_help_text",
        target: "order",
        field_key: "dietary_requirements",
        help_text: "Tell us about allergies or preferences.",
        source_step_references: ["step_1"],
      },
    ]),
    plan: plan(["configure_preorder"]),
  },
  {
    id: "phone_optional_and_occasion",
    owner_request: "Make phone optional and add an optional Occasion question.",
    expected_output: combined([
      {
        type: "set_existing_question_requiredness",
        target: "customer",
        field_key: "phone",
        required: false,
        source_step_references: ["step_1"],
      },
      {
        type: "add_preorder_question",
        label: "Occasion",
        help_text: null,
        required: false,
        answer_style: "short_answer",
        source_step_references: ["step_1", "step_2"],
      },
    ]),
    plan: plan(["configure_preorder", "define_field"]),
  },
] as const;

export const builderPreorderAmendmentEvaluationScenarios: readonly BuilderPreorderAmendmentEvaluationScenario[] =
  Object.freeze(
    scenarioDefinitions.map((scenario) =>
      Object.freeze(
        builderPreorderAmendmentEvaluationScenarioSchema.parse({
          id: scenario.id,
          owner_request: scenario.owner_request,
          expected_output: scenario.expected_output,
        }),
      ),
    ),
  );

export const builderPreorderAmendmentEvaluationPlans = Object.freeze(
  Object.fromEntries(
    scenarioDefinitions.map((scenario) => [scenario.id, scenario.plan]),
  ),
);
