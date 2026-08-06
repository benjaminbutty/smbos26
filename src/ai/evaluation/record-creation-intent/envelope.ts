import {
  BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
  OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
  openAiBuilderRecordCreationIntentPolicy,
} from "../../policies";
import { deriveAiReservationEnvelope } from "../../accounting/cost";

export const BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT =
  8 as const;
export const BUILDER_RECORD_CREATION_INTENT_RELIABILITY_REPETITIONS =
  3 as const;
export const BUILDER_RECORD_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS =
  24 as const;
export const BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD =
  4_300_000 as const;
export const BUILDER_RECORD_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD =
  12_700_000 as const;

export function deriveBuilderRecordCreationQualificationEnvelope() {
  const single = deriveAiReservationEnvelope(
    openAiBuilderRecordCreationIntentPolicy,
  );
  return Object.freeze({
    taskKey: "builder_record_creation_intent_v1" as const,
    policyKey: BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    modelKey: OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
    reasoningEffort: OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
    reservedCostMicrousdPerExecution: single.reservedCostMicrousd,
    reservedCostMicrousd:
      single.reservedCostMicrousd *
      BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_SCENARIO_COUNT,
    hardCeilingMicrousd:
      BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  });
}

export function deriveBuilderRecordCreationReliabilityEnvelope() {
  const single = deriveAiReservationEnvelope(
    openAiBuilderRecordCreationIntentPolicy,
  );
  return Object.freeze({
    taskKey: "builder_record_creation_intent_v1" as const,
    policyKey: BUILDER_RECORD_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    modelKey: OPENAI_BUILDER_RECORD_CREATION_INTENT_MODEL_KEY,
    reasoningEffort: OPENAI_BUILDER_RECORD_CREATION_INTENT_REASONING_EFFORT,
    reservedCostMicrousdPerExecution: single.reservedCostMicrousd,
    reservedCostMicrousd:
      single.reservedCostMicrousd *
      BUILDER_RECORD_CREATION_INTENT_RELIABILITY_TOTAL_EXECUTIONS,
    hardCeilingMicrousd:
      BUILDER_RECORD_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
  });
}

export const builderRecordCreationSingleExecutionReservationMicrousd =
  deriveAiReservationEnvelope(
    openAiBuilderRecordCreationIntentPolicy,
  ).reservedCostMicrousd;
