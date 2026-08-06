import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StructuredAiProviderError } from "../src/ai/contracts";
import {
  builderRecordUpdateSingleExecutionReservationMicrousd,
  deriveBuilderRecordUpdateQualificationEnvelope,
  deriveBuilderRecordUpdateReliabilityEnvelope,
} from "../src/ai/evaluation/record-update-intent/envelope";
import {
  evaluateBuilderRecordUpdateIntent,
  executionFailureReport,
} from "../src/ai/evaluation/record-update-intent/evaluator";
import {
  liveBuilderRecordUpdateQualificationIsActivated,
  runLiveBuilderRecordUpdateQualification,
  runLiveBuilderRecordUpdateReliability,
} from "../src/ai/evaluation/record-update-intent/live";
import {
  BUILDER_RECORD_UPDATE_EVALUATION_SCENARIO_IDS,
  builderRecordUpdateEvaluationScenarios,
} from "../src/ai/evaluation/record-update-intent/scenarios";
import {
  BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD,
  BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT,
  builderRecordUpdateSchemaCompatibilityBaseProbes,
  compareBuilderRecordUpdateSchemaWithInstalledOpenAiHelper,
  liveBuilderRecordUpdateSchemaCompatibilityIsActivated,
  measureBuilderRecordUpdateSchemaCompatibilitySchema,
  runLiveBuilderRecordUpdateSchemaCompatibility,
} from "../src/ai/evaluation/record-update-intent/schema-compatibility";
import { OpenAiInvalidRequestDiagnostic } from "../src/ai/providers/openai-diagnostics";

const activeEnvironment = {
  RUN_LIVE_OPENAI_RECORD_UPDATE_TERRA_QUALIFICATION: "1",
  RUN_LIVE_OPENAI_RECORD_UPDATE_TERRA_RELIABILITY: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

const compatibilityEnvironment = {
  RUN_LIVE_OPENAI_RECORD_UPDATE_SCHEMA_COMPATIBILITY: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

function injectedExecution(input: unknown) {
  const scenario = builderRecordUpdateEvaluationScenarios.find(
    (candidate) => candidate.input === input,
  );
  if (!scenario) throw new Error("Unknown injected Record-update scenario.");
  return {
    output: scenario.expected_output,
    accounting: {
      attemptsStarted: 1,
      inputTokens: 120,
      outputTokens: 40,
      usageReported: true,
      usageComplete: true,
      providerInvocationStarted: true,
      failureBeforeProviderInvocation: false,
    },
    metadata: {
      taskKey: "builder_record_update_intent_v1",
      taskVersion: 1,
      purposeLabel: "test",
      providerKey: "openai",
      modelKey: "gpt-5.6-terra",
      attempts: 1,
      usage: { inputTokens: 120, outputTokens: 40, complete: true },
    },
  };
}

describe("Builder generic Record-update evaluation harness", () => {
  it("derives the exact approved cost envelopes", () => {
    expect(builderRecordUpdateSingleExecutionReservationMicrousd).toBe(522_880);
    expect(deriveBuilderRecordUpdateQualificationEnvelope()).toMatchObject({
      reservedCostMicrousd: 4_183_040,
      hardCeilingMicrousd: 4_300_000,
    });
    expect(deriveBuilderRecordUpdateReliabilityEnvelope()).toMatchObject({
      reservedCostMicrousd: 12_549_120,
      hardCeilingMicrousd: 12_700_000,
    });
  });

  it("freezes the exact ordered eight scenarios and validates every expected output", () => {
    expect(builderRecordUpdateEvaluationScenarios).toHaveLength(8);
    expect(builderRecordUpdateEvaluationScenarios.map(({ id }) => id)).toEqual(
      BUILDER_RECORD_UPDATE_EVALUATION_SCENARIO_IDS,
    );
    expect(BUILDER_RECORD_UPDATE_EVALUATION_SCENARIO_IDS).not.toContain(
      "single_selector_update",
    );
    const missingReplacement = builderRecordUpdateEvaluationScenarios.find(
      ({ id }) => id === "missing_replacement_clarification",
    );
    expect(missingReplacement).toMatchObject({
      owner_request: "Change Celebration Box price.",
      expected_output: {
        state: "needs_clarification",
        source_step_reference: "step_1",
        question: "What should the Celebration Box's absolute new price be?",
      },
    });
    for (const scenario of builderRecordUpdateEvaluationScenarios) {
      const report = evaluateBuilderRecordUpdateIntent(
        scenario,
        scenario.expected_output,
        { attempts: 1, inputTokens: 120, outputTokens: 40, elapsedMs: 12 },
      );
      expect(report.passed, scenario.id).toBe(true);
      expect(report.failed_gate_codes, scenario.id).toEqual([]);
      expect(JSON.stringify(report)).not.toContain(scenario.owner_request);
    }
  });

  it("runs qualification and reliability sequentially with injected outputs", async () => {
    const qualificationCalls: string[] = [];
    const qualification = await runLiveBuilderRecordUpdateQualification(
      activeEnvironment,
      {
        now: () => 10,
        emit: () => {},
        execute: async (_taskKey, input) => {
          const scenario = builderRecordUpdateEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          qualificationCalls.push(scenario.id);
          return injectedExecution(input);
        },
      },
    );
    expect(qualification).toMatchObject({ ran: true, passed: true });
    expect(qualificationCalls).toEqual(
      BUILDER_RECORD_UPDATE_EVALUATION_SCENARIO_IDS,
    );

    const reliability = await runLiveBuilderRecordUpdateReliability(
      activeEnvironment,
      {
        now: () => 10,
        emit: () => {},
        execute: async (_taskKey, input) => injectedExecution(input),
      },
    );
    expect(reliability).toMatchObject({ ran: true, passed: true });
    if (reliability.ran) expect(reliability.reports).toHaveLength(24);
  });

  it("does not construct evaluation dependencies while inactive", async () => {
    expect(liveBuilderRecordUpdateQualificationIsActivated({})).toBe(false);
    expect(liveBuilderRecordUpdateSchemaCompatibilityIsActivated({})).toBe(
      false,
    );
    const execute = async () => {
      throw new Error("must not execute");
    };
    await expect(
      runLiveBuilderRecordUpdateQualification(
        {},
        { execute: execute as never },
      ),
    ).resolves.toMatchObject({ ran: false, passed: false });
  });

  it("reports provider failures using only finite safe fields", () => {
    const scenario = builderRecordUpdateEvaluationScenarios[0]!;
    const report = executionFailureReport(
      scenario,
      {
        attempts: 1,
        inputTokens: 0,
        outputTokens: 0,
        usageComplete: false,
        elapsedMs: 1,
      },
      "ai_execution_failed",
      1,
      new StructuredAiProviderError("invalid_request", "safe", {
        cause: new OpenAiInvalidRequestDiagnostic(
          "provider_invalid_request_unknown",
        ),
      }),
    );
    expect(report.provider_reason_code).toBe(
      "provider_invalid_request_unknown",
    );
    expect(JSON.stringify(report)).not.toContain("safe");
  });
});

describe("Record-update schema compatibility harness", () => {
  it("measures the exact registered transport schema without exposing it", () => {
    const probe = builderRecordUpdateSchemaCompatibilityBaseProbes.at(-1)!;
    expect(probe.transportSchema).not.toBeNull();
    expect(
      measureBuilderRecordUpdateSchemaCompatibilitySchema(
        probe.transportSchema!,
      ),
    ).toEqual(probe.schemaMetrics);
    const comparison =
      compareBuilderRecordUpdateSchemaWithInstalledOpenAiHelper();
    expect(comparison.helper_generation_succeeded).toBe(true);
    expect(JSON.stringify(comparison)).not.toContain('"registeredSchema"');
  });

  it("stops after the exact probe when compatibility is accepted", async () => {
    const calls: string[] = [];
    const result = await runLiveBuilderRecordUpdateSchemaCompatibility(
      compatibilityEnvironment,
      {
        now: () => 10,
        emit: () => {},
        execute: async (probe) => {
          calls.push(probe.id);
          return {
            output: { accepted: true },
            usage: { inputTokens: 16, outputTokens: 4 },
          };
        },
      },
    );
    expect(result).toMatchObject({ ran: true, passed: true });
    expect(calls).toEqual(["i_exact_registered_record_update_schema"]);
    if (!result.ran || !("aggregate" in result)) {
      throw new Error("Compatibility gate did not produce an aggregate.");
    }
    expect(result.aggregate.exact_schema_accepted).toBe(true);
  });

  it("uses the bounded diagnostic matrix only after schema rejection", async () => {
    const calls: string[] = [];
    const result = await runLiveBuilderRecordUpdateSchemaCompatibility(
      compatibilityEnvironment,
      {
        now: () => 10,
        emit: () => {},
        execute: async (probe) => {
          calls.push(probe.id);
          throw new StructuredAiProviderError("invalid_request", "safe", {
            cause: new OpenAiInvalidRequestDiagnostic(
              "provider_schema_rejected",
            ),
          });
        },
      },
    );
    expect(result).toMatchObject({ ran: true, passed: false });
    expect(calls[0]).toBe("i_exact_registered_record_update_schema");
    expect(calls.length).toBeLessThanOrEqual(
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT,
    );
    if (!result.ran || !("aggregate" in result)) {
      throw new Error("Compatibility gate did not produce an aggregate.");
    }
    expect(result.aggregate.stop_reason).toBe("completed");
    expect(result.aggregate.total_estimated_microusd).toBeLessThanOrEqual(
      BUILDER_RECORD_UPDATE_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD,
    );
  });
});
