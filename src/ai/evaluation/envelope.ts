import { deriveAiReservationEnvelope } from "../accounting/cost";
import { openAiBuilderPlanningPolicy } from "../policies";

export const BUILDER_EVALUATION_SCENARIO_COUNT = 8 as const;
export const BUILDER_EVALUATION_EXPECTED_AGGREGATE_MAX_MICROUSD =
  1_062_912 as const;
export const BUILDER_EVALUATION_HARD_CEILING_MICROUSD = 1_100_000 as const;

export function deriveBuilderEvaluationEnvelope(): {
  perScenarioMicrousd: number;
  aggregateMicrousd: number;
  hardCeilingMicrousd: number;
} {
  const perScenarioMicrousd = deriveAiReservationEnvelope(
    openAiBuilderPlanningPolicy,
  ).reservedCostMicrousd;
  const aggregateBigInt =
    BigInt(perScenarioMicrousd) * BigInt(BUILDER_EVALUATION_SCENARIO_COUNT);
  if (aggregateBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("The builder evaluation envelope is not safe.");
  }
  const aggregateMicrousd = Number(aggregateBigInt);
  if (
    aggregateMicrousd !== BUILDER_EVALUATION_EXPECTED_AGGREGATE_MAX_MICROUSD ||
    aggregateMicrousd > BUILDER_EVALUATION_HARD_CEILING_MICROUSD
  ) {
    throw new RangeError("The builder evaluation envelope is not approved.");
  }
  return Object.freeze({
    perScenarioMicrousd,
    aggregateMicrousd,
    hardCeilingMicrousd: BUILDER_EVALUATION_HARD_CEILING_MICROUSD,
  });
}
