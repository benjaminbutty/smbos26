import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { openAiBuilderLocationCreationPolicy } from "../../policies";
import {
  builderLocationCreationIntentOutputSchema,
  type BuilderLocationCreationIntentOutput,
} from "../../location-creation-intent/schemas";
import { validateBuilderLocationCreationIntentOutput } from "../../location-creation-intent/validation";
import {
  builderLocationCreationEvaluationReportSchema,
  type BuilderLocationCreationEvaluationReport,
} from "./schemas";
import type { BuilderLocationCreationEvaluationScenario } from "./scenarios";

export interface BuilderLocationCreationEvaluationExecutionMetadata {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete?: boolean;
  elapsedMs: number;
}

function safeOutputState(
  output: unknown,
): BuilderLocationCreationIntentOutput["state"] | null {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return null;
  }
  const state = (output as { state?: unknown }).state;
  return state === "ready" || state === "needs_clarification" ? state : null;
}

function estimatedCost(inputTokens: number, outputTokens: number): number {
  return calculateAiTokenCostMicrousd({
    inputTokens,
    outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderLocationCreationPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderLocationCreationPolicy.outputMicrousdPerMillion,
  });
}

function report(
  scenario: BuilderLocationCreationEvaluationScenario,
  metadata: BuilderLocationCreationEvaluationExecutionMetadata,
  repetition: 1 | 2 | 3,
  fields: {
    passed: boolean;
    outputState: BuilderLocationCreationIntentOutput["state"] | null;
    timezoneIntent: "explicit_timezone" | "use_business_timezone" | null;
    failureClass: BuilderLocationCreationEvaluationReport["failure_class"];
    failedGateCodes: BuilderLocationCreationEvaluationReport["failed_gate_codes"];
    errorCode: BuilderLocationCreationEvaluationReport["error_code"];
  },
): BuilderLocationCreationEvaluationReport {
  return builderLocationCreationEvaluationReportSchema.parse({
    scenario_id: scenario.id,
    repetition,
    passed: fields.passed,
    output_state: fields.outputState,
    timezone_intent: fields.timezoneIntent,
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
  });
}

function failureClassFor(
  failedGateCodes: readonly BuilderLocationCreationEvaluationReport["failed_gate_codes"][number][],
): BuilderLocationCreationEvaluationReport["failure_class"] {
  if (failedGateCodes.includes("output_contract")) {
    return "output_contract";
  }
  if (failedGateCodes.includes("semantic_validation")) {
    return "semantic_validation";
  }
  if (
    failedGateCodes.some((code) =>
      [
        "scenario_expectation",
        "expected_state",
        "expected_name",
        "expected_timezone_intent",
        "explicit_timezone_not_in_request",
        "duplicate_was_ready",
      ].includes(code),
    )
  ) {
    return "scenario_expectation";
  }
  if (failedGateCodes.includes("usage_incomplete")) {
    return "provider_execution";
  }
  if (failedGateCodes.includes("unknown_output")) {
    return "unknown";
  }
  return null;
}

export function evaluateBuilderLocationCreationIntent(
  scenario: BuilderLocationCreationEvaluationScenario,
  output: unknown,
  metadata: BuilderLocationCreationEvaluationExecutionMetadata,
  options: { repetition?: 1 | 2 | 3 } = {},
): BuilderLocationCreationEvaluationReport {
  const failed = new Set<
    BuilderLocationCreationEvaluationReport["failed_gate_codes"][number]
  >();
  let parsed: BuilderLocationCreationIntentOutput | null = null;
  try {
    parsed = builderLocationCreationIntentOutputSchema.parse(output);
  } catch {
    failed.add("output_contract");
  }

  if (parsed) {
    try {
      validateBuilderLocationCreationIntentOutput(scenario.input, parsed);
    } catch {
      failed.add("semantic_validation");
    }

    const expected = scenario.expected_output;
    if (parsed.state !== expected.state) {
      failed.add("expected_state");
    }
    if (parsed.state === "ready" && expected.state === "ready") {
      if (parsed.location_name !== expected.location_name) {
        failed.add("expected_name");
      }
      if (parsed.timezone_intent.kind !== expected.timezone_intent.kind) {
        failed.add("expected_timezone_intent");
      }
      if (
        expected.timezone_intent.kind === "explicit_timezone" &&
        parsed.timezone_intent.kind === "explicit_timezone" &&
        parsed.timezone_intent.timezone !== expected.timezone_intent.timezone
      ) {
        failed.add("expected_timezone_intent");
      }
    }
    if (
      (scenario.id === "active_duplicate" ||
        scenario.id === "inactive_duplicate") &&
      parsed.state === "ready"
    ) {
      failed.add("duplicate_was_ready");
    }
    if (
      parsed.state === "ready" &&
      parsed.timezone_intent.kind === "explicit_timezone" &&
      !scenario.owner_request.includes(parsed.timezone_intent.timezone)
    ) {
      failed.add("explicit_timezone_not_in_request");
    }
  }

  if (metadata.usageComplete === false) {
    failed.add("usage_incomplete");
  }

  const failedGateCodes = [...failed];
  return report(scenario, metadata, options.repetition ?? 1, {
    passed: failed.size === 0,
    outputState: safeOutputState(output),
    timezoneIntent:
      parsed?.state === "ready" ? parsed.timezone_intent.kind : null,
    failureClass: failureClassFor(failedGateCodes),
    failedGateCodes,
    errorCode: null,
  });
}

export function providerFailureReport(
  scenario: BuilderLocationCreationEvaluationScenario,
  metadata: BuilderLocationCreationEvaluationExecutionMetadata,
  errorCode: BuilderLocationCreationEvaluationReport["error_code"],
  repetition: 1 | 2 | 3,
): BuilderLocationCreationEvaluationReport {
  const result = report(scenario, metadata, repetition, {
    passed: false,
    outputState: null,
    timezoneIntent: null,
    failureClass: "provider_execution",
    failedGateCodes: ["provider_execution"],
    errorCode,
  });
  return builderLocationCreationEvaluationReportSchema.parse({
    ...result,
    repetition,
  });
}
