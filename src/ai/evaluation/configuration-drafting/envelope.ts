import { deriveAiReservationEnvelope } from "../../accounting/cost";
import type { AiExecutionPolicy } from "../../contracts";
import { openAiBuilderConfigurationDraftingPolicy } from "../../policies";

export const CONFIGURATION_DRAFTING_QUALIFICATION_SCENARIO_COUNT = 8 as const;
export const CONFIGURATION_DRAFTING_QUALIFICATION_EXPECTED_AGGREGATE_MAX_MICROUSD =
  5_806_080 as const;
export const CONFIGURATION_DRAFTING_QUALIFICATION_HARD_CEILING_MICROUSD =
  6_000_000 as const;
export const CONFIGURATION_DRAFTING_RELIABILITY_REPETITIONS = 3 as const;
export const CONFIGURATION_DRAFTING_RELIABILITY_TOTAL_EXECUTIONS =
  CONFIGURATION_DRAFTING_QUALIFICATION_SCENARIO_COUNT *
  CONFIGURATION_DRAFTING_RELIABILITY_REPETITIONS;
export const CONFIGURATION_DRAFTING_RELIABILITY_EXPECTED_AGGREGATE_MAX_MICROUSD =
  17_418_240 as const;
export const CONFIGURATION_DRAFTING_RELIABILITY_HARD_CEILING_MICROUSD =
  18_000_000 as const;

export interface ConfigurationDraftingEvaluationEnvelope {
  perExecutionMicrousd: number;
  aggregateMicrousd: number;
  hardCeilingMicrousd: number;
}

function deriveEnvelope(
  policy: AiExecutionPolicy,
  executionCount: number,
  expectedAggregateMicrousd: number,
  hardCeilingMicrousd: number,
): ConfigurationDraftingEvaluationEnvelope {
  if (
    !Number.isSafeInteger(executionCount) ||
    executionCount <= 0 ||
    !Number.isSafeInteger(expectedAggregateMicrousd) ||
    expectedAggregateMicrousd < 0 ||
    !Number.isSafeInteger(hardCeilingMicrousd) ||
    hardCeilingMicrousd <= 0
  ) {
    throw new RangeError(
      "The configuration-drafting evaluation envelope is not safe.",
    );
  }

  const perExecutionMicrousd =
    deriveAiReservationEnvelope(policy).reservedCostMicrousd;
  const aggregateBigInt = BigInt(perExecutionMicrousd) * BigInt(executionCount);
  if (aggregateBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      "The configuration-drafting evaluation envelope is not safe.",
    );
  }
  const aggregateMicrousd = Number(aggregateBigInt);
  if (
    aggregateMicrousd !== expectedAggregateMicrousd ||
    aggregateMicrousd > hardCeilingMicrousd
  ) {
    throw new RangeError(
      "The configuration-drafting evaluation envelope is not approved.",
    );
  }
  return Object.freeze({
    perExecutionMicrousd,
    aggregateMicrousd,
    hardCeilingMicrousd,
  });
}

export function deriveConfigurationDraftingQualificationEnvelope(
  policy: AiExecutionPolicy = openAiBuilderConfigurationDraftingPolicy,
): ConfigurationDraftingEvaluationEnvelope {
  return deriveEnvelope(
    policy,
    CONFIGURATION_DRAFTING_QUALIFICATION_SCENARIO_COUNT,
    CONFIGURATION_DRAFTING_QUALIFICATION_EXPECTED_AGGREGATE_MAX_MICROUSD,
    CONFIGURATION_DRAFTING_QUALIFICATION_HARD_CEILING_MICROUSD,
  );
}

export function deriveConfigurationDraftingReliabilityEnvelope(
  policy: AiExecutionPolicy = openAiBuilderConfigurationDraftingPolicy,
): ConfigurationDraftingEvaluationEnvelope {
  return deriveEnvelope(
    policy,
    CONFIGURATION_DRAFTING_RELIABILITY_TOTAL_EXECUTIONS,
    CONFIGURATION_DRAFTING_RELIABILITY_EXPECTED_AGGREGATE_MAX_MICROUSD,
    CONFIGURATION_DRAFTING_RELIABILITY_HARD_CEILING_MICROUSD,
  );
}
