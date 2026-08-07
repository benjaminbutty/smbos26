import { deriveAiReservationEnvelope } from "../../accounting/cost";
import {
  BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT,
  openAiBuilderRecordLocationLinkIntentPolicy,
} from "../../policies";

export const BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_SCENARIO_COUNT =
  8 as const;
export const BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_REPETITIONS =
  3 as const;
export const BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_TOTAL_EXECUTIONS =
  24 as const;

// Derived from the final bounded subject contract: 48,000 input tokens and
// 1,536 output tokens, with at most two attempts per execution.
export const BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD =
  2_400_000 as const;
export const BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_HARD_CEILING_MICROUSD =
  7_100_000 as const;

export function deriveBuilderRecordLocationLinkQualificationEnvelope() {
  const single = deriveAiReservationEnvelope(
    openAiBuilderRecordLocationLinkIntentPolicy,
  );
  return Object.freeze({
    taskKey: "builder_record_location_link_intent_v1" as const,
    policyKey: BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
    modelKey: OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
    reasoningEffort:
      OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT,
    reservedCostMicrousdPerExecution: single.reservedCostMicrousd,
    reservedCostMicrousd:
      single.reservedCostMicrousd *
      BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_SCENARIO_COUNT,
    hardCeilingMicrousd:
      BUILDER_RECORD_LOCATION_LINK_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  });
}

export function deriveBuilderRecordLocationLinkReliabilityEnvelope() {
  const single = deriveAiReservationEnvelope(
    openAiBuilderRecordLocationLinkIntentPolicy,
  );
  return Object.freeze({
    taskKey: "builder_record_location_link_intent_v1" as const,
    policyKey: BUILDER_RECORD_LOCATION_LINK_INTENT_TERRA_MEDIUM_POLICY_KEY,
    modelKey: OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_MODEL_KEY,
    reasoningEffort:
      OPENAI_BUILDER_RECORD_LOCATION_LINK_INTENT_REASONING_EFFORT,
    reservedCostMicrousdPerExecution: single.reservedCostMicrousd,
    reservedCostMicrousd:
      single.reservedCostMicrousd *
      BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_TOTAL_EXECUTIONS,
    hardCeilingMicrousd:
      BUILDER_RECORD_LOCATION_LINK_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
  });
}

export const builderRecordLocationLinkSingleExecutionReservationMicrousd =
  deriveAiReservationEnvelope(
    openAiBuilderRecordLocationLinkIntentPolicy,
  ).reservedCostMicrousd;
