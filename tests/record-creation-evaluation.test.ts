import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_RECORD_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  builderRecordCreationSingleExecutionReservationMicrousd,
  deriveBuilderRecordCreationQualificationEnvelope,
  deriveBuilderRecordCreationReliabilityEnvelope,
} from "../src/ai/evaluation/record-creation-intent/envelope";
import { evaluateBuilderRecordCreationIntent } from "../src/ai/evaluation/record-creation-intent/evaluator";
import {
  liveBuilderRecordCreationQualificationIsActivated,
  runLiveBuilderRecordCreationQualification,
  runLiveBuilderRecordCreationReliability,
} from "../src/ai/evaluation/record-creation-intent/live";
import {
  builderRecordCreationEvaluationQualificationAggregateSchema,
  builderRecordCreationEvaluationReliabilityAggregateSchema,
} from "../src/ai/evaluation/record-creation-intent/schemas";
import { builderRecordCreationEvaluationScenarios } from "../src/ai/evaluation/record-creation-intent/scenarios";

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
      expect(JSON.stringify(report)).not.toContain(scenario.owner_request);
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
        "repetition",
        "scenario_id",
        "usage_complete",
        "validation_reason_code",
        "value_kind_counts",
      ]);
    }
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
      total_estimated_cost_microusd: 21_600,
    });
  });
});
