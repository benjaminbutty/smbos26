import { ZodError } from "zod";

import {
  StructuredAiProviderError,
  type StructuredAiProviderError as StructuredAiProviderErrorType,
} from "../../contracts";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { AiExecutionError } from "../../errors";
import { openAiBuilderRecordUpdateIntentPolicy } from "../../policies";
import {
  builderRecordUpdateIntentOutputSchema,
  type BuilderRecordUpdateIntentOutput,
} from "../../record-update-intent/schemas";
import { BuilderRecordUpdateIntentValidationError } from "../../record-update-intent/diagnostics";
import { validateBuilderRecordUpdateIntentOutput } from "../../record-update-intent/validation";
import { OpenAiInvalidRequestDiagnostic } from "../../providers/openai-diagnostics";
import {
  builderRecordUpdateEvaluationReportSchema,
  builderRecordUpdateEvaluationValidationReasonCodeSchema,
  type BuilderRecordUpdateEvaluationReport,
} from "./schemas";
import type { BuilderRecordUpdateEvaluationScenario } from "./scenarios";

export interface BuilderRecordUpdateEvaluationExecutionMetadata {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete?: boolean;
  elapsedMs: number;
}

function safeOutputState(
  output: unknown,
): BuilderRecordUpdateIntentOutput["state"] | null {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return null;
  }
  const state = (output as { state?: unknown }).state;
  return state === "ready" || state === "needs_clarification" ? state : null;
}

function safeCounts(output: unknown) {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return { selectorCount: 0, updateCount: 0 };
  }
  const value = output as {
    selector_clauses?: unknown;
    field_updates?: unknown;
  };
  return {
    selectorCount: Array.isArray(value.selector_clauses)
      ? value.selector_clauses.length
      : 0,
    updateCount: Array.isArray(value.field_updates)
      ? value.field_updates.length
      : 0,
  };
}

function estimatedCost(inputTokens: number, outputTokens: number): number {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderRecordUpdateIntentPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderRecordUpdateIntentPolicy.outputMicrousdPerMillion,
  });
}

function comparableValue(value: unknown): string {
  return JSON.stringify(value);
}

function compareReadyOutput(
  expected: Extract<BuilderRecordUpdateIntentOutput, { state: "ready" }>,
  actual: Extract<BuilderRecordUpdateIntentOutput, { state: "ready" }>,
  failed: Set<BuilderRecordUpdateEvaluationReport["failed_gate_codes"][number]>,
) {
  if (actual.object_key !== expected.object_key) failed.add("expected_object");

  const expectedSelectors = new Map(
    expected.selector_clauses.map((clause) => [clause.field_key, clause]),
  );
  const actualSelectors = new Map(
    actual.selector_clauses.map((clause) => [clause.field_key, clause]),
  );
  if (
    actualSelectors.size !== expectedSelectors.size ||
    [...actualSelectors.keys()].some((key) => !expectedSelectors.has(key))
  ) {
    failed.add("expected_selector_set");
  }
  for (const [fieldKey, expectedClause] of expectedSelectors) {
    const actualClause = actualSelectors.get(fieldKey);
    if (!actualClause) continue;
    if (actualClause.field_type !== expectedClause.field_type) {
      failed.add("expected_selector_type");
    } else if (
      comparableValue(actualClause) !== comparableValue(expectedClause)
    ) {
      failed.add("expected_selector_value");
    }
  }

  const expectedUpdates = new Map(
    expected.field_updates.map((value) => [value.field_key, value]),
  );
  const actualUpdates = new Map(
    actual.field_updates.map((value) => [value.field_key, value]),
  );
  if (
    actualUpdates.size !== expectedUpdates.size ||
    [...actualUpdates.keys()].some((key) => !expectedUpdates.has(key))
  ) {
    failed.add("expected_update_set");
  }
  for (const [fieldKey, expectedValue] of expectedUpdates) {
    const actualValue = actualUpdates.get(fieldKey);
    if (!actualValue) continue;
    if (actualValue.field_type !== expectedValue.field_type) {
      failed.add("expected_update_type");
    } else if (
      comparableValue(actualValue) !== comparableValue(expectedValue)
    ) {
      failed.add("expected_update_value");
    }
  }
}

function report(
  scenario: BuilderRecordUpdateEvaluationScenario,
  metadata: BuilderRecordUpdateEvaluationExecutionMetadata,
  repetition: 1 | 2 | 3,
  fields: {
    passed: boolean;
    outputState: BuilderRecordUpdateIntentOutput["state"] | null;
    failureClass: BuilderRecordUpdateEvaluationReport["failure_class"];
    failedGateCodes: BuilderRecordUpdateEvaluationReport["failed_gate_codes"];
    errorCode: BuilderRecordUpdateEvaluationReport["error_code"];
    validationReasonCode: BuilderRecordUpdateEvaluationReport["validation_reason_code"];
    providerReasonCode: BuilderRecordUpdateEvaluationReport["provider_reason_code"];
    selectorCount: number;
    updateCount: number;
  },
): BuilderRecordUpdateEvaluationReport {
  return builderRecordUpdateEvaluationReportSchema.parse({
    scenario_id: scenario.id,
    repetition,
    passed: fields.passed,
    output_state: fields.outputState,
    selector_count: fields.selectorCount,
    update_count: fields.updateCount,
    failure_class: fields.failureClass,
    failed_gate_codes: fields.failedGateCodes,
    attempts: metadata.attempts,
    usage_complete: metadata.usageComplete ?? true,
    input_tokens: metadata.inputTokens,
    output_tokens: metadata.outputTokens,
    estimated_microusd: estimatedCost(
      metadata.inputTokens,
      metadata.outputTokens,
    ),
    elapsed_ms: metadata.elapsedMs,
    error_code: fields.errorCode,
    validation_reason_code: fields.validationReasonCode,
    provider_reason_code: fields.providerReasonCode,
  });
}

function failureClassFor(
  failedGateCodes: readonly BuilderRecordUpdateEvaluationReport["failed_gate_codes"][number][],
): BuilderRecordUpdateEvaluationReport["failure_class"] {
  if (failedGateCodes.includes("output_contract")) return "output_contract";
  if (failedGateCodes.includes("semantic_validation")) {
    return "semantic_validation";
  }
  if (
    failedGateCodes.some((code) =>
      [
        "scenario_expectation",
        "expected_state",
        "expected_object",
        "expected_selector_set",
        "expected_selector_type",
        "expected_selector_value",
        "expected_update_set",
        "expected_update_type",
        "expected_update_value",
        "source_step_coverage",
        "no_uuid",
        "no_record_data",
      ].includes(code),
    )
  ) {
    return "scenario_expectation";
  }
  if (
    failedGateCodes.includes("provider_execution") ||
    failedGateCodes.includes("usage_incomplete")
  ) {
    return "provider_execution";
  }
  if (failedGateCodes.includes("unknown_output")) return "unknown";
  return null;
}

function validationReasonCodeFor(
  cause: unknown,
): BuilderRecordUpdateEvaluationReport["validation_reason_code"] {
  if (cause instanceof BuilderRecordUpdateIntentValidationError) {
    return builderRecordUpdateEvaluationValidationReasonCodeSchema.parse(
      cause.diagnosticCode,
    );
  }
  return null;
}

export function evaluateBuilderRecordUpdateIntent(
  scenario: BuilderRecordUpdateEvaluationScenario,
  output: unknown,
  metadata: BuilderRecordUpdateEvaluationExecutionMetadata,
  options: { repetition?: 1 | 2 | 3 } = {},
): BuilderRecordUpdateEvaluationReport {
  const failed = new Set<
    BuilderRecordUpdateEvaluationReport["failed_gate_codes"][number]
  >();
  let parsed: BuilderRecordUpdateIntentOutput | null = null;
  let validationReasonCode: BuilderRecordUpdateEvaluationReport["validation_reason_code"] =
    null;

  try {
    parsed = builderRecordUpdateIntentOutputSchema.parse(output);
  } catch {
    failed.add("output_contract");
    validationReasonCode = "output_contract_invalid";
  }

  if (parsed) {
    try {
      validateBuilderRecordUpdateIntentOutput(scenario.input, parsed);
    } catch (cause) {
      failed.add("semantic_validation");
      validationReasonCode = validationReasonCodeFor(cause);
    }

    if (parsed.state !== scenario.expected_output.state) {
      failed.add("expected_state");
    } else if (
      parsed.state === "ready" &&
      scenario.expected_output.state === "ready"
    ) {
      compareReadyOutput(scenario.expected_output, parsed, failed);
    }
  }

  if (metadata.usageComplete === false) failed.add("usage_incomplete");
  const counts = safeCounts(output);
  const failedGateCodes = [...failed];
  return report(scenario, metadata, options.repetition ?? 1, {
    passed: failed.size === 0,
    outputState: safeOutputState(output),
    failureClass: failureClassFor(failedGateCodes),
    failedGateCodes,
    errorCode: null,
    validationReasonCode,
    providerReasonCode: null,
    selectorCount: counts.selectorCount,
    updateCount: counts.updateCount,
  });
}

function safeErrorCode(
  cause: unknown,
): BuilderRecordUpdateEvaluationReport["error_code"] {
  if (cause instanceof AiExecutionError) return cause.code;
  if (cause instanceof StructuredAiProviderError) {
    const mapped: Record<
      StructuredAiProviderErrorType["kind"],
      BuilderRecordUpdateEvaluationReport["error_code"]
    > = {
      disabled: "ai_disabled",
      unavailable: "ai_provider_unavailable",
      rate_limited: "ai_rate_limited",
      transient: "ai_provider_unavailable",
      invalid_request: "ai_execution_failed",
      invalid_response: "ai_output_invalid",
      refused: "ai_refused",
      incomplete: "ai_incomplete",
      content_filtered: "ai_content_filtered",
    };
    return mapped[cause.kind];
  }
  return "evaluation_execution_failed";
}

function providerReasonCodeFor(
  cause: unknown,
): BuilderRecordUpdateEvaluationReport["provider_reason_code"] {
  const seen = new Set<object>();
  let current: unknown = cause;
  for (let depth = 0; depth < 6 && current !== undefined; depth += 1) {
    if (current instanceof OpenAiInvalidRequestDiagnostic) {
      return current.reasonCode;
    }
    if (
      (typeof current === "object" && current !== null) ||
      typeof current === "function"
    ) {
      const objectCause = current as object;
      if (seen.has(objectCause)) break;
      seen.add(objectCause);
    }
    if (
      typeof current !== "object" ||
      current === null ||
      !("cause" in current)
    ) {
      break;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function boundedNumber(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function failureAccounting(cause: unknown) {
  if (cause instanceof AiExecutionError && cause.accounting) {
    return {
      attempts: boundedNumber(cause.accounting.attemptsStarted),
      inputTokens: boundedNumber(cause.accounting.inputTokens),
      outputTokens: boundedNumber(cause.accounting.outputTokens),
      usageComplete: cause.accounting.usageComplete,
    };
  }
  if (cause instanceof StructuredAiProviderError) {
    return {
      attempts: 1,
      inputTokens: boundedNumber(cause.usage?.inputTokens),
      outputTokens: boundedNumber(cause.usage?.outputTokens),
      usageComplete: Boolean(cause.usage),
    };
  }
  return { attempts: 0, inputTokens: 0, outputTokens: 0, usageComplete: false };
}

export function executionFailureReport(
  scenario: BuilderRecordUpdateEvaluationScenario,
  metadata: BuilderRecordUpdateEvaluationExecutionMetadata,
  errorCode: BuilderRecordUpdateEvaluationReport["error_code"],
  repetition: 1 | 2 | 3,
  cause?: unknown,
): BuilderRecordUpdateEvaluationReport {
  const classification =
    errorCode === "ai_output_invalid"
      ? cause instanceof ZodError ||
        cause instanceof BuilderRecordUpdateIntentValidationError
        ? {
            failureClass:
              cause instanceof ZodError
                ? ("output_contract" as const)
                : ("semantic_validation" as const),
            failedGateCode:
              cause instanceof ZodError
                ? ("output_contract" as const)
                : ("semantic_validation" as const),
            validationReasonCode:
              cause instanceof ZodError
                ? ("output_contract_invalid" as const)
                : cause.diagnosticCode,
          }
        : {
            failureClass: "provider_execution" as const,
            failedGateCode: "provider_execution" as const,
            validationReasonCode: "provider_invalid_response" as const,
          }
      : {
          failureClass: "provider_execution" as const,
          failedGateCode: "provider_execution" as const,
          validationReasonCode: null,
        };
  return report(scenario, metadata, repetition, {
    passed: false,
    outputState: null,
    failureClass: classification.failureClass,
    failedGateCodes: [classification.failedGateCode],
    errorCode,
    validationReasonCode: classification.validationReasonCode,
    providerReasonCode: providerReasonCodeFor(cause),
    selectorCount: 0,
    updateCount: 0,
  });
}

export { failureAccounting, providerReasonCodeFor, safeErrorCode };
