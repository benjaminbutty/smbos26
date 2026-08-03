import { deriveAiReservationEnvelope } from "../../accounting/cost";
import {
  BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  openAiBuilderPreorderAmendmentPolicy,
} from "../../policies";

export const BUILDER_PREORDER_AMENDMENT_QUALIFICATION_SCENARIO_COUNT =
  8 as const;
export const BUILDER_PREORDER_AMENDMENT_RELIABILITY_REPETITIONS = 3 as const;
export const BUILDER_PREORDER_AMENDMENT_RELIABILITY_TOTAL_EXECUTIONS =
  24 as const;
export const BUILDER_PREORDER_AMENDMENT_QUALIFICATION_HARD_CEILING_MICROUSD =
  4_300_000 as const;
export const BUILDER_PREORDER_AMENDMENT_RELIABILITY_HARD_CEILING_MICROUSD =
  12_700_000 as const;

export function deriveBuilderPreorderAmendmentQualificationEnvelope() {
  const single = deriveAiReservationEnvelope(
    openAiBuilderPreorderAmendmentPolicy,
  );
  return Object.freeze({
    taskKey: "builder_preorder_amendment_v1" as const,
    policyKey: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
    reservedCostMicrousdPerExecution: single.reservedCostMicrousd,
    reservedCostMicrousd:
      single.reservedCostMicrousd *
      BUILDER_PREORDER_AMENDMENT_QUALIFICATION_SCENARIO_COUNT,
    hardCeilingMicrousd:
      BUILDER_PREORDER_AMENDMENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  });
}

export function deriveBuilderPreorderAmendmentReliabilityEnvelope() {
  const single = deriveAiReservationEnvelope(
    openAiBuilderPreorderAmendmentPolicy,
  );
  return Object.freeze({
    taskKey: "builder_preorder_amendment_v1" as const,
    policyKey: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
    reservedCostMicrousdPerExecution: single.reservedCostMicrousd,
    reservedCostMicrousd:
      single.reservedCostMicrousd *
      BUILDER_PREORDER_AMENDMENT_RELIABILITY_TOTAL_EXECUTIONS,
    hardCeilingMicrousd:
      BUILDER_PREORDER_AMENDMENT_RELIABILITY_HARD_CEILING_MICROUSD,
  });
}
