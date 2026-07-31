import "server-only";

import type { AiExecutionPolicy } from "../contracts";

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const TOKENS_PER_MILLION = BigInt(1_000_000);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export interface AiTokenCostInput {
  inputTokens: number;
  outputTokens: number;
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
}

export interface AiReservationEnvelope {
  reservedRequestCount: 1;
  reservedInputTokens: number;
  reservedOutputTokens: number;
  reservedCostMicrousd: number;
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
}

function safeNonNegativeInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return BigInt(value);
}

function checkedNumber(value: bigint, label: string): number {
  if (value > MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} exceeds safe integer accounting bounds.`);
  }
  return Number(value);
}

function ceilingDivide(value: bigint, divisor: bigint): bigint {
  return value === BIGINT_ZERO
    ? BIGINT_ZERO
    : (value + divisor - BIGINT_ONE) / divisor;
}

export function calculateAiTokenCostMicrousd(input: AiTokenCostInput): number {
  const inputTokens = safeNonNegativeInteger(input.inputTokens, "Input tokens");
  const outputTokens = safeNonNegativeInteger(
    input.outputTokens,
    "Output tokens",
  );
  const inputRate = safeNonNegativeInteger(
    input.inputMicrousdPerMillion,
    "Input rate",
  );
  const outputRate = safeNonNegativeInteger(
    input.outputMicrousdPerMillion,
    "Output rate",
  );
  const calculated =
    ceilingDivide(inputTokens * inputRate, TOKENS_PER_MILLION) +
    ceilingDivide(outputTokens * outputRate, TOKENS_PER_MILLION);
  return checkedNumber(calculated, "Calculated AI cost");
}

export function deriveAiReservationEnvelope(
  policy: AiExecutionPolicy,
): AiReservationEnvelope {
  const reservedInputTokens = checkedNumber(
    safeNonNegativeInteger(
      policy.maxBillableInputTokens,
      "Maximum billable input tokens",
    ) * safeNonNegativeInteger(policy.maxAttempts, "Maximum attempts"),
    "Reserved input tokens",
  );
  const reservedOutputTokens = checkedNumber(
    safeNonNegativeInteger(policy.maxOutputTokens, "Maximum output tokens") *
      safeNonNegativeInteger(policy.maxAttempts, "Maximum attempts"),
    "Reserved output tokens",
  );

  if (reservedInputTokens === 0 || reservedOutputTokens === 0) {
    throw new RangeError("AI token reservations must be positive.");
  }

  return Object.freeze({
    reservedRequestCount: 1,
    reservedInputTokens,
    reservedOutputTokens,
    reservedCostMicrousd: calculateAiTokenCostMicrousd({
      inputTokens: reservedInputTokens,
      outputTokens: reservedOutputTokens,
      inputMicrousdPerMillion: policy.inputMicrousdPerMillion,
      outputMicrousdPerMillion: policy.outputMicrousdPerMillion,
    }),
    inputMicrousdPerMillion: policy.inputMicrousdPerMillion,
    outputMicrousdPerMillion: policy.outputMicrousdPerMillion,
  });
}
