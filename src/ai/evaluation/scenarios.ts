import {
  builderEvaluationScenarioSchema,
  type BuilderEvaluationScenario,
} from "./schemas";

const scenarioDefinitions = [
  {
    id: "preorder_phone_optional",
    owner_request: "Make phone optional for the public preorder.",
    allowed_result_states: ["ready"],
  },
  {
    id: "preorder_schedule_change",
    owner_request: "Remove Sunday collection and require 72 hours’ notice.",
    allowed_result_states: ["ready"],
  },
  {
    id: "corporate_catering_enquiries",
    owner_request:
      "Create corporate catering enquiries that collect company name, event date, number of guests, budget, and notes. Add a public enquiry page and Form, plus a separate internal screen for staff.",
    allowed_result_states: ["ready"],
  },
  {
    id: "create_cambridge_location",
    owner_request: "Add Cambridge as a new Location.",
    allowed_result_states: ["ready"],
  },
  {
    id: "add_cambridge_preorder_collection",
    owner_request: "Add Cambridge as a new preorder collection Location.",
    allowed_result_states: ["ready", "needs_clarification"],
  },
  {
    id: "automated_weekly_customer_email",
    owner_request:
      "Every Monday automatically email customers who have not ordered in 30 days.",
    allowed_result_states: ["needs_clarification"],
  },
  {
    id: "card_payment_at_checkout",
    owner_request: "Take card payment when customers submit a preorder.",
    allowed_result_states: ["needs_clarification"],
  },
  {
    id: "ambiguous_bookings",
    owner_request: "Add bookings to my business.",
    allowed_result_states: ["needs_clarification"],
  },
] as const;

export const builderEvaluationScenarios: readonly BuilderEvaluationScenario[] =
  Object.freeze(
    scenarioDefinitions.map((scenario) =>
      Object.freeze(builderEvaluationScenarioSchema.parse(scenario)),
    ),
  );
