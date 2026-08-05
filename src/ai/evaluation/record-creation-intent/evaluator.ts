import { ZodError } from "zod";

import {
  StructuredAiProviderError,
  type StructuredAiProviderError as StructuredAiProviderErrorType,
} from "../../contracts";
import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { AiExecutionError } from "../../errors";
import { openAiBuilderRecordCreationIntentPolicy } from "../../policies";
import {
  builderRecordCreationIntentOutputSchema,
  type BuilderRecordCreationFieldValue,
  type BuilderRecordCreationIntentOutput,
} from "../../record-creation-intent/schemas";
import { BuilderRecordCreationIntentValidationError } from "../../record-creation-intent/diagnostics";
import { validateBuilderRecordCreationIntentOutput } from "../../record-creation-intent/validation";
import {
  builderRecordCreationEvaluationReportSchema,
  builderRecordCreationEvaluationValidationReasonCodeSchema,
  type BuilderRecordCreationEvaluationReport,
} from "./schemas";
import type { BuilderRecordCreationEvaluationScenario } from "./scenarios";

export interface BuilderRecordCreationEvaluationExecutionMetadata {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete?: boolean;
  elapsedMs: number;
}

function safeOutputState(
  output: unknown,
): BuilderRecordCreationIntentOutput["state"] | null {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return null;
  }
  const state = (output as { state?: unknown }).state;
  return state === "ready" || state === "needs_clarification" ? state : null;
}

function valueKind(
  fieldType: BuilderRecordCreationFieldValue["field_type"],
):
  | "text_like"
  | "numeric"
  | "boolean"
  | "date"
  | "datetime"
  | "single_option"
  | "multi_select" {
  switch (fieldType) {
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
      return "text_like";
    case "number":
    case "currency":
      return "numeric";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "select":
    case "status":
      return "single_option";
    case "multi_select":
      return "multi_select";
  }
}

function emptyValueKindCounts(): BuilderRecordCreationEvaluationReport["value_kind_counts"] {
  return {
    text_like: 0,
    numeric: 0,
    boolean: 0,
    date: 0,
    datetime: 0,
    single_option: 0,
    multi_select: 0,
  };
}

function valueKindCounts(output: unknown) {
  const counts = emptyValueKindCounts();
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return counts;
  }
  const values = (output as { field_values?: unknown }).field_values;
  if (!Array.isArray(values)) return counts;
  for (const value of values) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const fieldType = (value as { field_type?: unknown }).field_type;
    if (
      fieldType === "short_text" ||
      fieldType === "long_text" ||
      fieldType === "email" ||
      fieldType === "phone" ||
      fieldType === "url" ||
      fieldType === "number" ||
      fieldType === "currency" ||
      fieldType === "boolean" ||
      fieldType === "date" ||
      fieldType === "datetime" ||
      fieldType === "select" ||
      fieldType === "status" ||
      fieldType === "multi_select"
    ) {
      counts[valueKind(fieldType)] += 1;
    }
  }
  return counts;
}

function estimatedCost(inputTokens: number, outputTokens: number): number {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderRecordCreationIntentPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderRecordCreationIntentPolicy.outputMicrousdPerMillion,
  });
}

function valuePayload(value: BuilderRecordCreationFieldValue): unknown {
  switch (value.field_type) {
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
      return value.string_value;
    case "number":
    case "currency":
      return value.number_value;
    case "boolean":
      return value.boolean_value;
    case "date":
      return value.date_value;
    case "datetime":
      return value.datetime_value;
    case "select":
    case "status":
      return value.option_value;
    case "multi_select":
      return value.option_values;
  }
}

function report(
  scenario: BuilderRecordCreationEvaluationScenario,
  metadata: BuilderRecordCreationEvaluationExecutionMetadata,
  repetition: 1 | 2 | 3,
  fields: {
    passed: boolean;
    outputState: BuilderRecordCreationIntentOutput["state"] | null;
    failureClass: BuilderRecordCreationEvaluationReport["failure_class"];
    failedGateCodes: BuilderRecordCreationEvaluationReport["failed_gate_codes"];
    errorCode: BuilderRecordCreationEvaluationReport["error_code"];
    validationReasonCode: BuilderRecordCreationEvaluationReport["validation_reason_code"];
    fieldValueCount: number;
    valueKindCounts: BuilderRecordCreationEvaluationReport["value_kind_counts"];
  },
): BuilderRecordCreationEvaluationReport {
  return builderRecordCreationEvaluationReportSchema.parse({
    scenario_id: scenario.id,
    repetition,
    passed: fields.passed,
    output_state: fields.outputState,
    field_value_count: fields.fieldValueCount,
    value_kind_counts: fields.valueKindCounts,
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
  });
}

function failureClassFor(
  failedGateCodes: readonly BuilderRecordCreationEvaluationReport["failed_gate_codes"][number][],
): BuilderRecordCreationEvaluationReport["failure_class"] {
  if (failedGateCodes.includes("output_contract")) return "output_contract";
  if (failedGateCodes.includes("semantic_validation")) {
    return "semantic_validation";
  }
  if (
    failedGateCodes.some((code) =>
      [
        "scenario_expectation",
        "expected_state",
        "expected_field_set",
        "expected_field_type",
        "expected_value",
        "default_backed_field_supplied",
        "optional_field_invented",
        "duplicate_record_scope",
      ].includes(code),
    )
  ) {
    return "scenario_expectation";
  }
  if (failedGateCodes.includes("provider_execution")) {
    return "provider_execution";
  }
  if (failedGateCodes.includes("usage_incomplete")) {
    return "provider_execution";
  }
  if (failedGateCodes.includes("unknown_output")) return "unknown";
  return null;
}

function fieldValues(output: BuilderRecordCreationIntentOutput | null) {
  return output?.state === "ready" ? output.field_values : [];
}

export function evaluateBuilderRecordCreationIntent(
  scenario: BuilderRecordCreationEvaluationScenario,
  output: unknown,
  metadata: BuilderRecordCreationEvaluationExecutionMetadata,
  options: { repetition?: 1 | 2 | 3 } = {},
): BuilderRecordCreationEvaluationReport {
  const failed = new Set<
    BuilderRecordCreationEvaluationReport["failed_gate_codes"][number]
  >();
  let parsed: BuilderRecordCreationIntentOutput | null = null;
  let validationReasonCode: BuilderRecordCreationEvaluationReport["validation_reason_code"] =
    null;
  try {
    parsed = builderRecordCreationIntentOutputSchema.parse(output);
  } catch {
    failed.add("output_contract");
    validationReasonCode = "output_contract_invalid";
  }

  if (parsed) {
    try {
      validateBuilderRecordCreationIntentOutput(scenario.input, parsed);
    } catch (cause) {
      failed.add("semantic_validation");
      validationReasonCode =
        cause instanceof BuilderRecordCreationIntentValidationError
          ? cause.diagnosticCode
          : null;
    }

    const expected = scenario.expected_output;
    if (parsed.state !== expected.state) failed.add("expected_state");
    if (parsed.state === "ready" && expected.state === "ready") {
      const actualByKey = new Map(
        parsed.field_values.map((value) => [value.field_key, value]),
      );
      const expectedKeys = expected.field_values.map(
        (value) => value.field_key,
      );
      const actualKeys = parsed.field_values.map((value) => value.field_key);
      if (
        actualKeys.length !== expectedKeys.length ||
        actualKeys.some((key) => !expectedKeys.includes(key))
      ) {
        failed.add("expected_field_set");
        if (actualKeys.some((key) => !expectedKeys.includes(key))) {
          failed.add("optional_field_invented");
        }
      }
      for (const expectedValue of expected.field_values) {
        const actualValue = actualByKey.get(expectedValue.field_key);
        if (!actualValue) {
          failed.add("expected_field_set");
          continue;
        }
        if (actualValue.field_type !== expectedValue.field_type) {
          failed.add("expected_field_type");
        } else if (
          JSON.stringify(valuePayload(actualValue)) !==
          JSON.stringify(valuePayload(expectedValue))
        ) {
          failed.add("expected_value");
        }
      }
      if (actualByKey.has("status") && !expectedKeys.includes("status")) {
        failed.add("default_backed_field_supplied");
      }
    }
  }

  if (metadata.usageComplete === false) failed.add("usage_incomplete");
  const values = fieldValues(parsed);
  const failedGateCodes = [...failed];
  return report(scenario, metadata, options.repetition ?? 1, {
    passed: failed.size === 0,
    outputState: safeOutputState(output),
    failureClass: failureClassFor(failedGateCodes),
    failedGateCodes,
    errorCode: null,
    validationReasonCode,
    fieldValueCount: values.length,
    valueKindCounts: valueKindCounts(output),
  });
}

function safeErrorCode(
  cause: unknown,
): BuilderRecordCreationEvaluationReport["error_code"] {
  if (cause instanceof AiExecutionError) return cause.code;
  if (cause instanceof StructuredAiProviderError) {
    const mapped: Record<
      StructuredAiProviderErrorType["kind"],
      BuilderRecordCreationEvaluationReport["error_code"]
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

function nextCause(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null || !("cause" in cause)) {
    return undefined;
  }
  return (cause as { cause?: unknown }).cause;
}

function classifyOutputInvalidFailure(cause: unknown) {
  const seen = new Set<object>();
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (
      current instanceof StructuredAiProviderError &&
      current.kind === "invalid_response"
    ) {
      return {
        failureClass: "provider_execution" as const,
        failedGateCode: "provider_execution" as const,
        validationReasonCode: "provider_invalid_response" as const,
      };
    }
    if (current instanceof BuilderRecordCreationIntentValidationError) {
      return {
        failureClass:
          current.diagnosticCode === "output_contract_invalid"
            ? ("output_contract" as const)
            : ("semantic_validation" as const),
        failedGateCode:
          current.diagnosticCode === "output_contract_invalid"
            ? ("output_contract" as const)
            : ("semantic_validation" as const),
        validationReasonCode:
          builderRecordCreationEvaluationValidationReasonCodeSchema.parse(
            current.diagnosticCode,
          ),
      };
    }
    if (current instanceof ZodError) {
      return {
        failureClass: "output_contract" as const,
        failedGateCode: "output_contract" as const,
        validationReasonCode: "output_contract_invalid" as const,
      };
    }
    if (
      (typeof current === "object" && current !== null) ||
      typeof current === "function"
    ) {
      const objectCause = current as object;
      if (seen.has(objectCause)) break;
      seen.add(objectCause);
    }
    current = nextCause(current);
  }
  return {
    failureClass: "unknown" as const,
    failedGateCode: "unknown_output" as const,
    validationReasonCode: "unknown_output_invalid" as const,
  };
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
  scenario: BuilderRecordCreationEvaluationScenario,
  metadata: BuilderRecordCreationEvaluationExecutionMetadata,
  errorCode: BuilderRecordCreationEvaluationReport["error_code"],
  repetition: 1 | 2 | 3,
  cause?: unknown,
): BuilderRecordCreationEvaluationReport {
  const classification =
    errorCode === "ai_output_invalid"
      ? classifyOutputInvalidFailure(cause)
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
    fieldValueCount: 0,
    valueKindCounts: emptyValueKindCounts(),
  });
}

export { failureAccounting, safeErrorCode };
