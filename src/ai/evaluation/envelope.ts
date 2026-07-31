import { deriveAiReservationEnvelope } from "../accounting/cost";
import { openAiBuilderPlanningPolicy } from "../policies";

export const BUILDER_TERRA_QUALIFICATION_SCENARIO_COUNT = 8 as const;
export const BUILDER_TERRA_QUALIFICATION_EXPECTED_AGGREGATE_MAX_MICROUSD =
  3_543_040 as const;
export const BUILDER_TERRA_QUALIFICATION_HARD_CEILING_MICROUSD =
  3_700_000 as const;
export const BUILDER_TERRA_RELIABILITY_REPETITIONS = 3 as const;
export const BUILDER_TERRA_RELIABILITY_TOTAL_EXECUTIONS =
  BUILDER_TERRA_QUALIFICATION_SCENARIO_COUNT *
  BUILDER_TERRA_RELIABILITY_REPETITIONS;
export const BUILDER_TERRA_RELIABILITY_EXPECTED_AGGREGATE_MAX_MICROUSD =
  10_629_120 as const;
export const BUILDER_TERRA_RELIABILITY_HARD_CEILING_MICROUSD =
  11_000_000 as const;

function deriveEnvelope(
  executionCount: number,
  expectedAggregateMicrousd: number,
  hardCeilingMicrousd: number,
): {
  perScenarioMicrousd: number;
  aggregateMicrousd: number;
  hardCeilingMicrousd: number;
} {
  const perScenarioMicrousd = deriveAiReservationEnvelope(
    openAiBuilderPlanningPolicy,
  ).reservedCostMicrousd;
  const aggregateBigInt = BigInt(perScenarioMicrousd) * BigInt(executionCount);
  if (aggregateBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("The builder evaluation envelope is not safe.");
  }
  const aggregateMicrousd = Number(aggregateBigInt);
  if (
    aggregateMicrousd !== expectedAggregateMicrousd ||
    aggregateMicrousd > hardCeilingMicrousd
  ) {
    throw new RangeError("The builder evaluation envelope is not approved.");
  }
  return Object.freeze({
    perScenarioMicrousd,
    aggregateMicrousd,
    hardCeilingMicrousd,
  });
}

export function deriveBuilderTerraQualificationEnvelope() {
  return deriveEnvelope(
    BUILDER_TERRA_QUALIFICATION_SCENARIO_COUNT,
    BUILDER_TERRA_QUALIFICATION_EXPECTED_AGGREGATE_MAX_MICROUSD,
    BUILDER_TERRA_QUALIFICATION_HARD_CEILING_MICROUSD,
  );
}

export function deriveBuilderTerraReliabilityEnvelope() {
  return deriveEnvelope(
    BUILDER_TERRA_RELIABILITY_TOTAL_EXECUTIONS,
    BUILDER_TERRA_RELIABILITY_EXPECTED_AGGREGATE_MAX_MICROUSD,
    BUILDER_TERRA_RELIABILITY_HARD_CEILING_MICROUSD,
  );
}
