import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StructuredAiProviderError } from "../src/ai/contracts";
import {
  configurationDraftingReliabilityAggregateSchema,
  configurationDraftingReliabilityProviderFailureSchema,
  configurationDraftingReliabilityReportSchema,
} from "../src/ai/evaluation/configuration-drafting/schemas";
import {
  liveConfigurationDraftingReliabilityIsActivated,
  runLiveConfigurationDraftingReliability,
} from "../src/ai/evaluation/configuration-drafting/live";
import { configurationDraftingScenarios } from "../src/ai/evaluation/configuration-drafting/scenarios";
import type { BuilderConfigurationDraftOutput } from "../src/ai/configuration-drafting/schemas";
import {
  compliantConfigurationDraftingOutputs,
  createInjectedConfigurationDraftingExecution,
} from "./support/builder-configuration-drafting-evaluation-fixtures";

const activeEnvironment = {
  RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

function outputFor(
  scenarioId: keyof typeof compliantConfigurationDraftingOutputs,
): BuilderConfigurationDraftOutput {
  return structuredClone(compliantConfigurationDraftingOutputs[scenarioId]);
}

function aggregateFrom(emitted: readonly unknown[]) {
  return configurationDraftingReliabilityAggregateSchema.parse(
    emitted[emitted.length - 1],
  );
}

describe("configuration drafting Terra reliability gate", () => {
  it("requires its own exact activation flag and never treats qualification as reliability", async () => {
    const loadProductionExecution = vi.fn();
    for (const environment of [
      {},
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "synthetic-key" },
      {
        RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY: "1",
        AI_PROVIDER: "disabled",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: " ",
      },
      {
        RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
    ] as const) {
      expect(liveConfigurationDraftingReliabilityIsActivated(environment)).toBe(
        false,
      );
      await expect(
        runLiveConfigurationDraftingReliability(environment, {
          loadProductionExecution,
        }),
      ).resolves.toEqual({ ran: false, passed: false, reports: [] });
    }
    expect(loadProductionExecution).not.toHaveBeenCalled();
  });

  it("runs three sequential rounds of the unchanged eight-scenario order", async () => {
    const emitted: unknown[] = [];
    const calls: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const execution = createInjectedConfigurationDraftingExecution(
      async (scenarioId) => {
        calls.push(scenarioId);
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        running -= 1;
        return {
          output: outputFor(scenarioId),
          usage: { inputTokens: 1_200, outputTokens: 400 },
        };
      },
    );
    const result = await runLiveConfigurationDraftingReliability(
      activeEnvironment,
      {
        loadProductionExecution: async () => execution,
        now: () => 10,
        emit: (value) => emitted.push(value),
      },
    );

    const expectedOrder = Array.from({ length: 3 }, () =>
      configurationDraftingScenarios.map(({ id }) => id),
    ).flat();
    expect(result).toMatchObject({ ran: true, passed: true });
    expect(calls).toEqual(expectedOrder);
    expect(result.reports).toHaveLength(24);
    expect(result.reports.map(({ repetition }) => repetition)).toEqual([
      ...Array(8).fill(1),
      ...Array(8).fill(2),
      ...Array(8).fill(3),
    ]);
    expect(maxRunning).toBe(1);
    expect(emitted).toHaveLength(25);
    for (const report of emitted.slice(0, 24)) {
      const parsed = configurationDraftingReliabilityReportSchema.parse(report);
      expect(parsed.passed).toBe(true);
      expect(parsed.usage_complete).toBe(true);
    }
    expect(aggregateFrom(emitted)).toMatchObject({
      total_scenarios: 8,
      repetitions_per_scenario: 3,
      total_executions: 24,
      passed_executions: 24,
      failed_executions: 0,
      total_attempts: 24,
      total_input_tokens: 28_800,
      total_output_tokens: 9_600,
      total_estimated_cost_microusd: 216_000,
      per_scenario_pass_counts: configurationDraftingScenarios.map(
        ({ id }) => ({
          scenario_id: id,
          passed_count: 3,
        }),
      ),
    });
  });

  it("fails when one scenario passes only two of three repetitions", async () => {
    const emitted: unknown[] = [];
    const target = "catering_enquiry_full_stack" as const;
    const execution = createInjectedConfigurationDraftingExecution(
      async (scenarioId, invocation) => {
        const output = outputFor(scenarioId);
        if (scenarioId === target && invocation === 1) {
          output.fields.push({
            reference: "draft_field_6",
            source_step_references: ["step_2"],
            object_reference: {
              source: "draft",
              object_reference: "draft_object_1",
            },
            label: "Adjacent field",
            field_type: "short_text",
            required: false,
            settings: null,
          });
        }
        return {
          output,
          usage: { inputTokens: 1_200, outputTokens: 400 },
        };
      },
    );
    const result = await runLiveConfigurationDraftingReliability(
      activeEnvironment,
      {
        loadProductionExecution: async () => execution,
        now: () => 10,
        emit: (value) => emitted.push(value),
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    expect(result.reports).toHaveLength(24);
    expect(aggregateFrom(emitted)).toMatchObject({
      passed_executions: 23,
      failed_executions: 1,
      scenario_gate_failure_count: 1,
      per_scenario_pass_counts: expect.arrayContaining([
        { scenario_id: target, passed_count: 2 },
      ]),
    });
    expect(
      configurationDraftingReliabilityReportSchema.parse(emitted[0]),
    ).toMatchObject({
      repetition: 1,
      passed: false,
      failed_gate_codes: expect.arrayContaining(["field_set_mismatch"]),
    });
  });

  it("continues after a structural and provider failure and preserves only bounded repetition metadata", async () => {
    const emitted: unknown[] = [];
    const target = "catering_enquiry_full_stack" as const;
    const execution = createInjectedConfigurationDraftingExecution(
      async (scenarioId, invocation) => {
        if (scenarioId === target && invocation === 9) {
          return {
            output: { malformed: "reliability-output-marker" },
            usage: { inputTokens: 1_200, outputTokens: 400 },
          };
        }
        if (scenarioId === target && invocation === 17) {
          throw new StructuredAiProviderError(
            "unavailable",
            "reliability-provider-marker",
          );
        }
        return {
          output: outputFor(scenarioId),
          usage: { inputTokens: 1_200, outputTokens: 400 },
        };
      },
    );
    const result = await runLiveConfigurationDraftingReliability(
      activeEnvironment,
      {
        loadProductionExecution: async () => execution,
        now: () => 10,
        emit: (value) => emitted.push(value),
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    expect(result.reports).toHaveLength(22);
    const failures = emitted.filter(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "scenario_id" in value &&
        value.scenario_id === target &&
        !("passed" in value),
    );
    expect(failures).toHaveLength(2);
    expect(
      configurationDraftingReliabilityProviderFailureSchema.parse(failures[0]),
    ).toMatchObject({
      schema_version: 1,
      scenario_id: target,
      repetition: 2,
      error_code: "ai_output_invalid",
      validation_stage: "structural",
    });
    expect(
      configurationDraftingReliabilityProviderFailureSchema.parse(failures[1]),
    ).toMatchObject({
      schema_version: 1,
      scenario_id: target,
      repetition: 3,
      error_code: "ai_provider_unavailable",
    });
    expect(JSON.stringify(emitted)).not.toContain("reliability-output-marker");
    expect(JSON.stringify(emitted)).not.toContain(
      "reliability-provider-marker",
    );
  });

  it("requires complete usage and stays below the reliability hard ceiling", async () => {
    const incompleteEmitted: unknown[] = [];
    const incomplete = await runLiveConfigurationDraftingReliability(
      activeEnvironment,
      {
        loadProductionExecution: async () =>
          createInjectedConfigurationDraftingExecution(async (scenarioId) => ({
            output: outputFor(scenarioId),
          })),
        now: () => 10,
        emit: (value) => incompleteEmitted.push(value),
      },
    );
    expect(incomplete.passed).toBe(false);
    expect(aggregateFrom(incompleteEmitted)).toMatchObject({
      passed_executions: 0,
      failed_executions: 24,
    });
    expect(
      configurationDraftingReliabilityReportSchema.parse(incompleteEmitted[0]),
    ).toMatchObject({
      passed: false,
      usage_complete: false,
      failed_gate_codes: ["usage_accounting_incomplete"],
      repetition: 1,
    });

    const costEmitted: unknown[] = [];
    const cost = await runLiveConfigurationDraftingReliability(
      activeEnvironment,
      {
        loadProductionExecution: async () =>
          createInjectedConfigurationDraftingExecution(async (scenarioId) => ({
            output: outputFor(scenarioId),
            usage: {
              inputTokens: 1_000_000_000,
              outputTokens: 1_000_000_000,
            },
          })),
        now: () => 10,
        emit: (value) => costEmitted.push(value),
      },
    );
    expect(cost.passed).toBe(false);
    expect(
      aggregateFrom(costEmitted).total_estimated_cost_microusd,
    ).toBeGreaterThan(18_000_000);
  });
});
