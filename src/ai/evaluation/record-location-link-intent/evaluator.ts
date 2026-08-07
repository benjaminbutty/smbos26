import { ZodError } from "zod";

import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import {
  StructuredAiProviderError,
  type StructuredAiProviderError as StructuredAiProviderErrorType,
} from "../../contracts";
import { AiExecutionError } from "../../errors";
import { openAiBuilderRecordLocationLinkIntentPolicy } from "../../policies";
import {
  builderRecordLocationLinkIntentOutputSchema,
  type BuilderRecordLocationLinkIntentOutput,
} from "../../record-location-link-intent/schemas";
import { BuilderRecordLocationLinkIntentValidationError } from "../../record-location-link-intent/diagnostics";
import { validateBuilderRecordLocationLinkIntentOutput } from "../../record-location-link-intent/validation";
import {
  builderRecordLocationLinkEvaluationReportSchema,
  builderRecordLocationLinkEvaluationValidationReasonCodeSchema,
  type BuilderRecordLocationLinkEvaluationReport,
} from "./schemas";
import type { BuilderRecordLocationLinkEvaluationScenario } from "./scenarios";

export interface BuilderRecordLocationLinkEvaluationExecutionMetadata {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete?: boolean;
  elapsedMs: number;
}

function safeOutputState(
  output: unknown,
): BuilderRecordLocationLinkIntentOutput["state"] | null {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return null;
  }
  const state = (output as { state?: unknown }).state;
  return state === "ready" || state === "needs_clarification" ? state : null;
}

function safeAction(
  output: unknown,
):
  | Extract<BuilderRecordLocationLinkIntentOutput, { state: "ready" }>["action"]
  | null {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return null;
  }
  const action = (output as { action?: unknown }).action;
  return action === "link" || action === "unlink" ? action : null;
}

function estimatedCost(inputTokens: number, outputTokens: number): number {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderRecordLocationLinkIntentPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderRecordLocationLinkIntentPolicy.outputMicrousdPerMillion,
  });
}

function comparableValue(value: unknown): string {
  return JSON.stringify(value);
}

function containsForbiddenOperationalData(output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  const serialized = JSON.stringify(output).toLocaleLowerCase("en");
  return /record_id|link_id|candidate|row|rpc|sql|token/.test(serialized);
}

function report(
  scenario: BuilderRecordLocationLinkEvaluationScenario,
  metadata: BuilderRecordLocationLinkEvaluationExecutionMetadata,
  repetition: 1 | 2 | 3,
  fields: {
    passed: boolean;
    outputState: BuilderRecordLocationLinkIntentOutput["state"] | null;
    action: "link" | "unlink" | null;
    failureClass: BuilderRecordLocationLinkEvaluationReport["failure_class"];
    failedGateCodes: BuilderRecordLocationLinkEvaluationReport["failed_gate_codes"];
    errorCode: BuilderRecordLocationLinkEvaluationReport["error_code"];
    validationReasonCode: BuilderRecordLocationLinkEvaluationReport["validation_reason_code"];
    providerReasonCode: BuilderRecordLocationLinkEvaluationReport["provider_reason_code"];
  },
): BuilderRecordLocationLinkEvaluationReport {
  return builderRecordLocationLinkEvaluationReportSchema.parse({
    scenario_id: scenario.id,
    repetition,
    passed: fields.passed,
    output_state: fields.outputState,
    action: fields.action,
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
  failedGateCodes: readonly BuilderRecordLocationLinkEvaluationReport["failed_gate_codes"][number][],
): BuilderRecordLocationLinkEvaluationReport["failure_class"] {
  if (failedGateCodes.includes("output_contract")) return "output_contract";
  if (failedGateCodes.includes("semantic_validation")) {
    return "semantic_validation";
  }
  if (
    failedGateCodes.some((code) =>
      [
        "scenario_expectation",
        "expected_state",
        "expected_action",
        "expected_object",
        "expected_selector",
        "expected_location",
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
): BuilderRecordLocationLinkEvaluationReport["validation_reason_code"] {
  if (cause instanceof BuilderRecordLocationLinkIntentValidationError) {
    return builderRecordLocationLinkEvaluationValidationReasonCodeSchema.parse(
      cause.diagnosticCode,
    );
  }
  return null;
}

export function evaluateBuilderRecordLocationLinkIntent(
  scenario: BuilderRecordLocationLinkEvaluationScenario,
  output: unknown,
  metadata: BuilderRecordLocationLinkEvaluationExecutionMetadata,
  options: { repetition?: 1 | 2 | 3 } = {},
): BuilderRecordLocationLinkEvaluationReport {
  const failed = new Set<
    BuilderRecordLocationLinkEvaluationReport["failed_gate_codes"][number]
  >();
  let parsed: BuilderRecordLocationLinkIntentOutput | null = null;
  let validationReasonCode: BuilderRecordLocationLinkEvaluationReport["validation_reason_code"] =
    null;

  try {
    parsed = builderRecordLocationLinkIntentOutputSchema.parse(output);
  } catch {
    failed.add("output_contract");
    validationReasonCode = "output_contract_invalid";
  }

  if (parsed) {
    try {
      validateBuilderRecordLocationLinkIntentOutput(scenario.input, parsed);
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
      if (parsed.action !== scenario.expected_output.action) {
        failed.add("expected_action");
      }
      if (parsed.object_key !== scenario.expected_output.object_key) {
        failed.add("expected_object");
      }
      if (
        comparableValue(parsed.selector) !==
        comparableValue(scenario.expected_output.selector)
      ) {
        failed.add("expected_selector");
      }
      if (
        parsed.location_reference !==
        scenario.expected_output.location_reference
      ) {
        failed.add("expected_location");
      }
    }

    if (containsForbiddenOperationalData(parsed)) {
      failed.add("no_record_data");
    }
  }

  if (metadata.usageComplete === false) failed.add("usage_incomplete");

  const failedGateCodes = [...failed];
  return report(scenario, metadata, options.repetition ?? 1, {
    passed: failed.size === 0,
    outputState: safeOutputState(output),
    action: safeAction(output),
    failureClass: failureClassFor(failedGateCodes),
    failedGateCodes,
    errorCode: null,
    validationReasonCode,
    providerReasonCode: null,
  });
}

export function safeErrorCode(
  cause: unknown,
): BuilderRecordLocationLinkEvaluationReport["error_code"] {
  if (cause instanceof AiExecutionError) return cause.code;
  if (cause instanceof StructuredAiProviderError) {
    const mapped = {
      disabled: "ai_disabled",
      unavailable: "ai_provider_unavailable",
      rate_limited: "ai_rate_limited",
      transient: "ai_provider_unavailable",
      invalid_request: "ai_execution_failed",
      invalid_response: "ai_output_invalid",
      refused: "ai_refused",
      incomplete: "ai_incomplete",
      content_filtered: "ai_content_filtered",
    } as const;
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

export function classifyOutputInvalidFailure(cause: unknown): {
  failureClass:
    | "output_contract"
    | "semantic_validation"
    | "provider_execution"
    | "unknown";
  failedGateCode:
    | "output_contract"
    | "semantic_validation"
    | "provider_execution"
    | "unknown_output";
  validationReasonCode: BuilderRecordLocationLinkEvaluationReport["validation_reason_code"];
} {
  const seen = new Set<object>();
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (
      current instanceof StructuredAiProviderError &&
      current.kind === "invalid_response"
    ) {
      return {
        failureClass: "provider_execution",
        failedGateCode: "provider_execution",
        validationReasonCode: "provider_invalid_response",
      };
    }
    if (current instanceof BuilderRecordLocationLinkIntentValidationError) {
      const diagnosticCode =
        builderRecordLocationLinkEvaluationValidationReasonCodeSchema.parse(
          current.diagnosticCode,
        );
      const outputContract = diagnosticCode === "output_contract_invalid";
      return {
        failureClass: outputContract
          ? "output_contract"
          : "semantic_validation",
        failedGateCode: outputContract
          ? "output_contract"
          : "semantic_validation",
        validationReasonCode: diagnosticCode,
      };
    }
    if (current instanceof ZodError) {
      return {
        failureClass: "output_contract",
        failedGateCode: "output_contract",
        validationReasonCode: "output_contract_invalid",
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
    failureClass: "unknown",
    failedGateCode: "unknown_output",
    validationReasonCode: "unknown_output_invalid",
  };
}

export function failureAccounting(cause: unknown) {
  if (cause instanceof AiExecutionError && cause.accounting) {
    return {
      attempts: cause.accounting.attemptsStarted,
      inputTokens: cause.accounting.inputTokens,
      outputTokens: cause.accounting.outputTokens,
      usageComplete: cause.accounting.usageComplete,
    };
  }
  if (cause instanceof StructuredAiProviderError) {
    return {
      attempts: 1,
      inputTokens: cause.usage?.inputTokens ?? 0,
      outputTokens: cause.usage?.outputTokens ?? 0,
      usageComplete: Boolean(cause.usage),
    };
  }
  return {
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageComplete: false,
  };
}

export function executionFailureReport(
  scenario: BuilderRecordLocationLinkEvaluationScenario,
  metadata: BuilderRecordLocationLinkEvaluationExecutionMetadata,
  errorCode: BuilderRecordLocationLinkEvaluationReport["error_code"],
  repetition: 1 | 2 | 3,
  classification: {
    failureClass: NonNullable<
      BuilderRecordLocationLinkEvaluationReport["failure_class"]
    >;
    failedGateCode: BuilderRecordLocationLinkEvaluationReport["failed_gate_codes"][number];
    validationReasonCode: BuilderRecordLocationLinkEvaluationReport["validation_reason_code"];
    providerReasonCode?: BuilderRecordLocationLinkEvaluationReport["provider_reason_code"];
  } = {
    failureClass: "provider_execution",
    failedGateCode: "provider_execution",
    validationReasonCode: null,
  },
): BuilderRecordLocationLinkEvaluationReport {
  return report(scenario, metadata, repetition, {
    passed: false,
    outputState: null,
    action: null,
    failureClass: classification.failureClass,
    failedGateCodes: [classification.failedGateCode],
    errorCode,
    validationReasonCode: classification.validationReasonCode,
    providerReasonCode: classification.providerReasonCode ?? null,
  });
}

export type { StructuredAiProviderErrorType };
