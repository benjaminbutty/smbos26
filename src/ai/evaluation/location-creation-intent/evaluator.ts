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

export function evaluateBuilderLocationCreationIntent(
  scenario: BuilderLocationCreationEvaluationScenario,
  output: unknown,
  metadata: BuilderLocationCreationEvaluationExecutionMetadata,
  options: { repetition?: number; errorCode?: string } = {},
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
  } else if (options.errorCode) {
    failed.add("provider_failure");
  } else {
    failed.add("unknown_output");
  }

  const estimatedMicrousd = calculateAiTokenCostMicrousd({
    inputTokens: metadata.inputTokens,
    outputTokens: metadata.outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderLocationCreationPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderLocationCreationPolicy.outputMicrousdPerMillion,
  });
  return builderLocationCreationEvaluationReportSchema.parse({
    scenario_id: scenario.id,
    repetition: options.repetition ?? 1,
    passed: failed.size === 0,
    output_state: safeOutputState(output),
    timezone_intent:
      parsed?.state === "ready" ? parsed.timezone_intent.kind : null,
    failed_gate_codes: [...failed],
    attempts: metadata.attempts,
    input_tokens: metadata.inputTokens,
    output_tokens: metadata.outputTokens,
    estimated_microusd: estimatedMicrousd,
    elapsed_ms: metadata.elapsedMs,
    error_code: options.errorCode ?? null,
  });
}
