import { deriveAiReservationEnvelope } from "../../accounting/cost";
import {
  BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
  OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT,
  openAiBuilderLocationCreationPolicy,
} from "../../policies";

export const BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT =
  8 as const;
export const BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_REPETITIONS =
  3 as const;
export const BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS =
  24 as const;
export const BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD =
  3_800_000 as const;
export const BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD =
  11_200_000 as const;

export function deriveBuilderLocationCreationQualificationEnvelope() {
  const single = deriveAiReservationEnvelope(
    openAiBuilderLocationCreationPolicy,
  );
  return Object.freeze({
    taskKey: "builder_location_creation_intent_v1" as const,
    policyKey: BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    modelKey: OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
    reasoningEffort: OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT,
    reservedCostMicrousdPerExecution: single.reservedCostMicrousd,
    reservedCostMicrousd:
      single.reservedCostMicrousd *
      BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT,
    hardCeilingMicrousd:
      BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  });
}

export function deriveBuilderLocationCreationReliabilityEnvelope() {
  const single = deriveAiReservationEnvelope(
    openAiBuilderLocationCreationPolicy,
  );
  return Object.freeze({
    taskKey: "builder_location_creation_intent_v1" as const,
    policyKey: BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    modelKey: OPENAI_BUILDER_LOCATION_CREATION_MODEL_KEY,
    reasoningEffort: OPENAI_BUILDER_LOCATION_CREATION_REASONING_EFFORT,
    reservedCostMicrousdPerExecution: single.reservedCostMicrousd,
    reservedCostMicrousd:
      single.reservedCostMicrousd *
      BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS,
    hardCeilingMicrousd:
      BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
  });
}
