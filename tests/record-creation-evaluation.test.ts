import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  builderRecordCreationSingleExecutionReservationMicrousd,
  deriveBuilderRecordCreationQualificationEnvelope,
  deriveBuilderRecordCreationReliabilityEnvelope,
} from "../src/ai/evaluation/record-creation-intent/envelope";
import {
  evaluateBuilderRecordCreationIntent,
  executionFailureReport,
} from "../src/ai/evaluation/record-creation-intent/evaluator";
import {
  liveBuilderRecordCreationQualificationIsActivated,
  runLiveBuilderRecordCreationQualification,
  runLiveBuilderRecordCreationReliability,
} from "../src/ai/evaluation/record-creation-intent/live";
import {
  builderRecordCreationEvaluationQualificationAggregateSchema,
  builderRecordCreationEvaluationReliabilityAggregateSchema,
} from "../src/ai/evaluation/record-creation-intent/schemas";
import {
  BUILDER_RECORD_CREATION_EVALUATION_SCENARIO_IDS,
  builderRecordCreationEvaluationScenarios,
} from "../src/ai/evaluation/record-creation-intent/scenarios";
import { StructuredAiProviderError } from "../src/ai/contracts";
import { AiExecutionError } from "../src/ai/errors";
import { validateBuilderRecordCreationIntentOutput } from "../src/ai/record-creation-intent/validation";
import { OpenAiInvalidRequestDiagnostic } from "../src/ai/providers/openai-diagnostics";

const activeEnvironment = {
  RUN_LIVE_OPENAI_RECORD_CREATION_TERRA_QUALIFICATION: "1",
  RUN_LIVE_OPENAI_RECORD_CREATION_TERRA_RELIABILITY: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

function injectedExecution(input: unknown) {
  const scenario = builderRecordCreationEvaluationScenarios.find(
    (candidate) => candidate.input === input,
  );
  if (!scenario) throw new Error("Unknown injected Record scenario.");
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
      taskKey: "builder_record_creation_intent_v1",
      taskVersion: 1,
      purposeLabel: "test",
      providerKey: "openai",
      modelKey: "gpt-5.6-terra",
      attempts: 1,
      usage: { inputTokens: 120, outputTokens: 40, complete: true },
    },
  };
}

describe("Builder generic Record creation evaluation harness", () => {
  it("derives the exact approved reservation envelopes", () => {
    expect(builderRecordCreationSingleExecutionReservationMicrousd).toBe(
      522_880,
    );
    expect(deriveBuilderRecordCreationQualificationEnvelope()).toMatchObject({
      reservedCostMicrousdPerExecution: 522_880,
      reservedCostMicrousd: 4_183_040,
      hardCeilingMicrousd:
        BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
    });
    expect(deriveBuilderRecordCreationReliabilityEnvelope()).toMatchObject({
      reservedCostMicrousd: 12_549_120,
      hardCeilingMicrousd: 12_700_000,
    });
  });

  it("passes every frozen scenario through the deterministic evaluator", () => {
    for (const scenario of builderRecordCreationEvaluationScenarios) {
      const report = evaluateBuilderRecordCreationIntent(
        scenario,
        scenario.expected_output,
        { attempts: 1, inputTokens: 120, outputTokens: 40, elapsedMs: 12 },
      );
      expect(report.passed).toBe(true);
      expect(report.failed_gate_codes).toEqual([]);
      const serializedReport = JSON.stringify(report);
      expect(serializedReport).not.toContain(scenario.owner_request);
      if (scenario.expected_output.state === "ready") {
        for (const value of scenario.expected_output.field_values) {
          if ("string_value" in value) {
            expect(serializedReport).not.toContain(value.string_value);
          }
        }
      }
      expect(Object.keys(report).sort()).toEqual([
        "attempts",
        "elapsed_ms",
        "error_code",
        "estimated_microusd",
        "failed_gate_codes",
        "failure_class",
        "field_value_count",
        "input_tokens",
        "output_state",
        "output_tokens",
        "passed",
        "provider_reason_code",
        "repetition",
        "scenario_id",
        "usage_complete",
        "validation_reason_code",
        "value_kind_counts",
      ]);
    }
  });

  it("freezes eight distinct ordered inputs whose expected outputs pass the real validator", () => {
    expect(builderRecordCreationEvaluationScenarios).toHaveLength(8);
    expect(
      builderRecordCreationEvaluationScenarios.map(({ id }) => id),
    ).toEqual(BUILDER_RECORD_CREATION_EVALUATION_SCENARIO_IDS);
    const serializedInputs = builderRecordCreationEvaluationScenarios.map(
      ({ input }) => JSON.stringify(input),
    );
    expect(new Set(serializedInputs).size).toBe(8);

    const optionalScenario = builderRecordCreationEvaluationScenarios.find(
      ({ id }) => id === "optional_fields_omitted",
    );
    expect(optionalScenario).toBeDefined();
    if (
      !optionalScenario ||
      optionalScenario.expected_output.state !== "ready"
    ) {
      throw new Error("The optional omission scenario must be ready.");
    }
    expect(
      optionalScenario.expected_output.field_values.map(
        ({ field_key }) => field_key,
      ),
    ).toEqual(["name", "email", "phone"]);
    expect(
      optionalScenario.expected_output.field_values.some(
        ({ field_key }) => field_key === "website",
      ),
    ).toBe(false);

    for (const scenario of builderRecordCreationEvaluationScenarios) {
      expect(
        validateBuilderRecordCreationIntentOutput(
          scenario.input,
          scenario.expected_output,
        ),
      ).toEqual(scenario.expected_output);
    }
  });

  it("classifies incomplete usage as provider execution without exposing input or values", () => {
    const scenario = builderRecordCreationEvaluationScenarios[0]!;
    const report = evaluateBuilderRecordCreationIntent(
      scenario,
      scenario.expected_output,
      {
        attempts: 1,
        inputTokens: 120,
        outputTokens: 40,
        usageComplete: false,
        elapsedMs: 12,
      },
    );

    expect(report).toMatchObject({
      passed: false,
      failure_class: "provider_execution",
      failed_gate_codes: ["usage_incomplete"],
      usage_complete: false,
    });
    expect(JSON.stringify(report)).not.toContain(scenario.owner_request);
    expect(JSON.stringify(report)).not.toContain("Afternoon Tea Box");
  });

  it("carries only a finite provider reason through bounded causes into the report", () => {
    const scenario = builderRecordCreationEvaluationScenarios[0]!;
    const rawProviderCause = {
      message: "raw-provider-message-marker",
      body: "raw-provider-body-marker",
      param: "secret.parameter.value",
      cause: new OpenAiInvalidRequestDiagnostic(
        "provider_invalid_request_unknown",
      ),
    };
    const providerFailure = new StructuredAiProviderError(
      "invalid_request",
      "safe provider message",
      { cause: rawProviderCause },
    );
    const executionFailure = new AiExecutionError("ai_execution_failed", {
      accounting: {
        attemptsStarted: 1,
        inputTokens: 0,
        outputTokens: 0,
        usageReported: false,
        usageComplete: false,
        providerInvocationStarted: true,
        failureBeforeProviderInvocation: false,
      },
      cause: providerFailure,
    });
    const report = executionFailureReport(
      scenario,
      {
        attempts: 1,
        inputTokens: 0,
        outputTokens: 0,
        usageComplete: false,
        elapsedMs: 1_061,
      },
      "ai_execution_failed",
      1,
      executionFailure,
    );

    expect(report).toMatchObject({
      failure_class: "provider_execution",
      failed_gate_codes: ["provider_execution"],
      error_code: "ai_execution_failed",
      provider_reason_code: "provider_invalid_request_unknown",
      usage_complete: false,
      input_tokens: 0,
      output_tokens: 0,
      estimated_microusd: 0,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("raw-provider-message-marker");
    expect(serialized).not.toContain("raw-provider-body-marker");
    expect(serialized).not.toContain("secret.parameter.value");
  });

  it("runs qualification sequentially and stops before provider construction when inactive", async () => {
    const calls: string[] = [];
    const emitted: unknown[] = [];
    const result = await runLiveBuilderRecordCreationQualification(
      activeEnvironment,
      {
        now: () => 10,
        emit: (value) => emitted.push(value),
        execute: async (_taskKey, input) => {
          const scenario = builderRecordCreationEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          calls.push(scenario.id);
          return injectedExecution(input);
        },
      },
    );
    expect(result).toMatchObject({ ran: true, passed: true });
    expect(calls).toEqual(
      builderRecordCreationEvaluationScenarios.map(({ id }) => id),
    );
    expect(emitted).toHaveLength(9);
    expect(
      builderRecordCreationEvaluationQualificationAggregateSchema.parse(
        emitted.at(-1),
      ),
    ).toMatchObject({
      total_scenarios: 8,
      passed_scenarios: 8,
      failed_scenarios: 0,
      total_estimated_cost_microusd: 7_200,
    });

    const loadDependencies = vi.fn();
    expect(
      liveBuilderRecordCreationQualificationIsActivated({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "key",
      }),
    ).toBe(false);
    await expect(
      runLiveBuilderRecordCreationQualification(
        { AI_PROVIDER: "openai", OPENAI_API_KEY: "key" },
        { loadDependencies },
      ),
    ).resolves.toMatchObject({ ran: false, passed: false });
    expect(loadDependencies).not.toHaveBeenCalled();

    await expect(
      runLiveBuilderRecordCreationReliability(
        { AI_PROVIDER: "openai", OPENAI_API_KEY: "key" },
        { loadDependencies },
      ),
    ).resolves.toMatchObject({ ran: false, passed: false });
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it("stops qualification on the first failed scenario", async () => {
    const emitted: unknown[] = [];
    const calls: string[] = [];
    const firstScenario = builderRecordCreationEvaluationScenarios[0]!;
    const secondScenario = builderRecordCreationEvaluationScenarios[1]!;
    const result = await runLiveBuilderRecordCreationQualification(
      activeEnvironment,
      {
        now: () => 10,
        emit: (value) => emitted.push(value),
        execute: async (_taskKey, input) => {
          const scenario = builderRecordCreationEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          calls.push(scenario.id);
          return {
            ...injectedExecution(input),
            output:
              scenario.id === firstScenario.id
                ? secondScenario.expected_output
                : scenario.expected_output,
          };
        },
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    if (!result.ran) throw new Error("Qualification did not run.");
    expect(calls).toEqual([firstScenario.id]);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.passed).toBe(false);
    expect(
      builderRecordCreationEvaluationQualificationAggregateSchema.parse(
        emitted.at(-1),
      ),
    ).toMatchObject({
      total_scenarios: 8,
      passed_scenarios: 0,
      failed_scenarios: 1,
    });
  });

  it("runs reliability in ordered sequential rounds", async () => {
    const calls: string[] = [];
    const emitted: unknown[] = [];
    const result = await runLiveBuilderRecordCreationReliability(
      activeEnvironment,
      {
        now: () => 10,
        emit: (value) => emitted.push(value),
        execute: async (_taskKey, input) => {
          const scenario = builderRecordCreationEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          calls.push(`${scenario.id}`);
          return injectedExecution(input);
        },
      },
    );
    expect(result).toMatchObject({ ran: true, passed: true });
    expect(calls).toHaveLength(24);
    expect(emitted).toHaveLength(25);
    expect(
      builderRecordCreationEvaluationReliabilityAggregateSchema.parse(
        emitted.at(-1),
      ),
    ).toMatchObject({
      total_executions: 24,
      passed_executions: 24,
      failed_executions: 0,
      passed_scenarios: 8,
      failed_scenarios: 0,
      total_estimated_cost_microusd: 21_600,
      per_scenario_pass_counts: builderRecordCreationEvaluationScenarios.map(
        ({ id }) => ({ scenario_id: id, passed_count: 3 }),
      ),
    });
  });

  it("derives reliability scenario counts from three-pass completion, not execution totals", async () => {
    const emitted: unknown[] = [];
    let calls = 0;
    const result = await runLiveBuilderRecordCreationReliability(
      activeEnvironment,
      {
        now: () => 10,
        emit: (value) => emitted.push(value),
        execute: async (_taskKey, input) => {
          const scenario = builderRecordCreationEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          const callNumber = calls;
          calls += 1;
          if (callNumber === 8) {
            throw new AiExecutionError("ai_provider_unavailable", {
              accounting: {
                attemptsStarted: 2,
                inputTokens: 240,
                outputTokens: 80,
                usageReported: true,
                usageComplete: true,
                providerInvocationStarted: true,
                failureBeforeProviderInvocation: false,
              },
            });
          }
          return injectedExecution(input);
        },
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    if (!result.ran) throw new Error("Reliability did not run.");
    expect(result.reports).toHaveLength(9);
    const aggregate =
      builderRecordCreationEvaluationReliabilityAggregateSchema.parse(
        emitted.at(-1),
      );
    expect(aggregate).toMatchObject({
      total_executions: 24,
      passed_executions: 8,
      failed_executions: 1,
      passed_scenarios: 0,
      failed_scenarios: 8,
      total_attempts: 10,
      total_input_tokens: 1_200,
      total_output_tokens: 400,
      total_estimated_cost_microusd: 9_000,
    });
    expect(aggregate.per_scenario_pass_counts).toEqual(
      builderRecordCreationEvaluationScenarios.map(({ id }) => ({
        scenario_id: id,
        passed_count: 1,
      })),
    );
  });

  it("reports one completed scenario when the next scenario fails after its third repetition", async () => {
    const emitted: unknown[] = [];
    let calls = 0;
    const result = await runLiveBuilderRecordCreationReliability(
      activeEnvironment,
      {
        now: () => 10,
        emit: (value) => emitted.push(value),
        execute: async (_taskKey, input) => {
          const scenario = builderRecordCreationEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          const callNumber = calls;
          calls += 1;
          if (callNumber === 17) {
            throw new AiExecutionError("ai_provider_unavailable", {
              accounting: {
                attemptsStarted: 1,
                inputTokens: 120,
                outputTokens: 40,
                usageReported: true,
                usageComplete: true,
                providerInvocationStarted: true,
                failureBeforeProviderInvocation: false,
              },
            });
          }
          return injectedExecution(input);
        },
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    if (!result.ran) throw new Error("Reliability did not run.");
    expect(result.reports).toHaveLength(18);
    const aggregate =
      builderRecordCreationEvaluationReliabilityAggregateSchema.parse(
        emitted.at(-1),
      );
    expect(aggregate).toMatchObject({
      total_executions: 24,
      passed_executions: 17,
      failed_executions: 1,
      passed_scenarios: 1,
      failed_scenarios: 7,
      total_attempts: 18,
      total_input_tokens: 2_160,
      total_output_tokens: 720,
      total_estimated_cost_microusd: 16_200,
    });
    expect(aggregate.per_scenario_pass_counts).toEqual([
      {
        scenario_id: builderRecordCreationEvaluationScenarios[0]!.id,
        passed_count: 3,
      },
      ...builderRecordCreationEvaluationScenarios.slice(1).map(({ id }) => ({
        scenario_id: id,
        passed_count: 2,
      })),
    ]);
  });

  it("performs reservation and ceiling preflight before provider construction", async () => {
    const emitted: unknown[] = [];
    const loadDependencies = vi.fn();
    const result = await runLiveBuilderRecordCreationQualification(
      activeEnvironment,
      {
        emit: (value) => emitted.push(value),
        loadDependencies,
        deriveQualificationEnvelope: () => ({
          taskKey: "builder_record_creation_intent_v1",
          policyKey: "builder_record_creation_intent_terra_medium_v1",
          modelKey: "gpt-5.6-terra",
          reasoningEffort: "medium",
          reservedCostMicrousdPerExecution: 522_880,
          reservedCostMicrousd: 4_183_040,
          hardCeilingMicrousd: 1,
        }),
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    expect(loadDependencies).not.toHaveBeenCalled();
    expect(emitted).toEqual([
      {
        evaluation_error_code: "evaluation_setup_failed",
        reason_code: "qualification_ceiling_mismatch",
      },
    ]);
  });
});
