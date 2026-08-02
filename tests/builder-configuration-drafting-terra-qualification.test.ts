import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StructuredAiProviderError } from "../src/ai/contracts";
import { AiExecutionError } from "../src/ai/errors";
import { BuilderConfigurationDraftValidationError } from "../src/ai/configuration-drafting/diagnostics";
import {
  configurationDraftingProviderFailureSchema,
  configurationDraftingQualificationAggregateSchema,
  configurationDraftingReportSchema,
} from "../src/ai/evaluation/configuration-drafting/schemas";
import {
  liveConfigurationDraftingQualificationIsActivated,
  redactConfigurationDraftingFailure,
  runLiveConfigurationDraftingQualification,
} from "../src/ai/evaluation/configuration-drafting/live";
import { configurationDraftingScenarios } from "../src/ai/evaluation/configuration-drafting/scenarios";
import type { BuilderConfigurationDraftOutput } from "../src/ai/configuration-drafting/schemas";
import {
  compliantConfigurationDraftingOutputs,
  createInjectedConfigurationDraftingExecution,
} from "./support/builder-configuration-drafting-evaluation-fixtures";

const activeEnvironment = {
  RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

function outputFor(
  scenarioId: keyof typeof compliantConfigurationDraftingOutputs,
): BuilderConfigurationDraftOutput {
  return structuredClone(compliantConfigurationDraftingOutputs[scenarioId]);
}

function compliantExecution(
  responseFor?: Parameters<
    typeof createInjectedConfigurationDraftingExecution
  >[0],
) {
  return createInjectedConfigurationDraftingExecution(
    responseFor ??
      (async (scenarioId) => ({
        output: outputFor(scenarioId),
        usage: { inputTokens: 1_200, outputTokens: 400 },
      })),
  );
}

function aggregateFrom(emitted: readonly unknown[]) {
  return configurationDraftingQualificationAggregateSchema.parse(
    emitted[emitted.length - 1],
  );
}

describe("configuration drafting Terra qualification gate", () => {
  it("does not activate or construct a provider without every exact activation input", async () => {
    const loadProductionExecution = vi.fn();
    const environments = [
      {},
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "synthetic-key" },
      {
        RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION: "1",
        AI_PROVIDER: "disabled",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: " ",
      },
      {
        RUN_LIVE_OPENAI_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
    ] as const;

    for (const environment of environments) {
      expect(
        liveConfigurationDraftingQualificationIsActivated(environment),
      ).toBe(false);
      await expect(
        runLiveConfigurationDraftingQualification(environment, {
          loadProductionExecution,
        }),
      ).resolves.toEqual({ ran: false, passed: false, reports: [] });
    }
    expect(loadProductionExecution).not.toHaveBeenCalled();
  });

  it("runs the exact eight scenarios once, sequentially, in fixed order", async () => {
    const emitted: unknown[] = [];
    const calls: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const execution = compliantExecution(async (scenarioId) => {
      calls.push(scenarioId);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running -= 1;
      return {
        output: outputFor(scenarioId),
        usage: { inputTokens: 1_200, outputTokens: 400 },
      };
    });

    const result = await runLiveConfigurationDraftingQualification(
      activeEnvironment,
      {
        loadProductionExecution: async () => execution,
        now: () => 10,
        emit: (value) => emitted.push(value),
      },
    );

    expect(result).toMatchObject({ ran: true, passed: true });
    expect(calls).toEqual(configurationDraftingScenarios.map(({ id }) => id));
    expect(result.reports.map(({ scenario_id }) => scenario_id)).toEqual(calls);
    expect(result.reports).toHaveLength(8);
    expect(maxRunning).toBe(1);
    expect(emitted).toHaveLength(9);
    for (const report of emitted.slice(0, 8)) {
      expect(configurationDraftingReportSchema.parse(report).passed).toBe(true);
    }
    expect(aggregateFrom(emitted)).toMatchObject({
      total_scenarios: 8,
      passed_scenarios: 8,
      failed_scenarios: 0,
      total_attempts: 8,
      total_input_tokens: 9_600,
      total_output_tokens: 3_200,
      total_estimated_cost_microusd: 72_000,
    });
  });

  it.each([
    ["structural output", "ai_output_invalid", "structural"],
    ["semantic output", "ai_output_invalid", "semantic"],
    ["provider", "ai_provider_unavailable", undefined],
  ] as const)(
    "finishes all eight scenarios and fails closed for one %s failure",
    async (_label, expectedErrorCode, expectedStage) => {
      const emitted: unknown[] = [];
      const target = "catering_enquiry_full_stack" as const;
      const execution = compliantExecution(async (scenarioId) => {
        if (scenarioId === target && expectedStage === "structural") {
          return {
            output: { malformed: "synthetic-output-marker" },
            usage: { inputTokens: 1_200, outputTokens: 400 },
          };
        }
        if (scenarioId === target && expectedStage === "semantic") {
          const output = outputFor(scenarioId);
          output.fields[0]!.source_step_references = ["step_99"];
          return {
            output,
            usage: { inputTokens: 1_200, outputTokens: 400 },
          };
        }
        if (scenarioId === target) {
          throw new StructuredAiProviderError(
            "unavailable",
            "raw provider marker must not escape",
          );
        }
        return {
          output: outputFor(scenarioId),
          usage: { inputTokens: 1_200, outputTokens: 400 },
        };
      });

      const result = await runLiveConfigurationDraftingQualification(
        activeEnvironment,
        {
          loadProductionExecution: async () => execution,
          now: () => 10,
          emit: (value) => emitted.push(value),
        },
      );

      expect(result).toMatchObject({ ran: true, passed: false });
      expect(emitted).toHaveLength(9);
      const failure = emitted.find(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "scenario_id" in value &&
          value.scenario_id === target &&
          !("passed" in value),
      );
      if (expectedStage === undefined) {
        expect(
          configurationDraftingProviderFailureSchema.parse(failure),
        ).toMatchObject({
          schema_version: 1,
          scenario_id: target,
          error_code: expectedErrorCode,
        });
      } else {
        expect(
          configurationDraftingProviderFailureSchema.parse(failure),
        ).toMatchObject({
          schema_version: 1,
          scenario_id: target,
          error_code: expectedErrorCode,
          validation_stage: expectedStage,
        });
      }
      expect(result.reports).toHaveLength(7);
      expect(aggregateFrom(emitted).failed_scenarios).toBe(1);
      expect(JSON.stringify(emitted)).not.toContain("synthetic-output-marker");
      expect(JSON.stringify(emitted)).not.toContain("raw provider marker");
    },
  );

  it("fails the scenario gate for a semantically valid adjacent field and continues", async () => {
    const emitted: unknown[] = [];
    const execution = compliantExecution(async (scenarioId) => {
      const output = outputFor(scenarioId);
      if (scenarioId === "catering_enquiry_full_stack") {
        output.fields.push({
          reference: "draft_field_6",
          source_step_references: ["step_2"],
          object_reference: {
            source: "draft",
            object_reference: "draft_object_1",
          },
          label: "Internal code",
          field_type: "short_text",
          required: false,
          settings: null,
        });
      }
      return {
        output,
        usage: { inputTokens: 1_200, outputTokens: 400 },
      };
    });
    const result = await runLiveConfigurationDraftingQualification(
      activeEnvironment,
      {
        loadProductionExecution: async () => execution,
        now: () => 10,
        emit: (value) => emitted.push(value),
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    const report = configurationDraftingReportSchema.parse(emitted[0]);
    expect(report.passed).toBe(false);
    expect(report.failed_gate_codes).toEqual(
      expect.arrayContaining(["field_set_mismatch", "adjacent_scope_added"]),
    );
    expect(aggregateFrom(emitted).scenario_gate_failure_count).toBe(1);
    expect(emitted).toHaveLength(9);
  });

  it("requires complete usage and keeps the aggregate below the hard ceiling", async () => {
    const incompleteEmitted: unknown[] = [];
    const incomplete = await runLiveConfigurationDraftingQualification(
      activeEnvironment,
      {
        loadProductionExecution: async () =>
          compliantExecution(async (scenarioId) => ({
            output: outputFor(scenarioId),
          })),
        now: () => 10,
        emit: (value) => incompleteEmitted.push(value),
      },
    );
    expect(incomplete).toMatchObject({ ran: true, passed: false });
    expect(
      configurationDraftingReportSchema.parse(incompleteEmitted[0]),
    ).toMatchObject({
      passed: false,
      usage_complete: false,
      failed_gate_codes: ["usage_accounting_incomplete"],
    });

    const costEmitted: unknown[] = [];
    const cost = await runLiveConfigurationDraftingQualification(
      activeEnvironment,
      {
        loadProductionExecution: async () =>
          compliantExecution(async (scenarioId) => ({
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
    expect(cost).toMatchObject({ ran: true, passed: false });
    const costAggregate = aggregateFrom(costEmitted);
    expect(costAggregate.total_estimated_cost_microusd).toBeGreaterThan(
      6_000_000,
    );
    expect(costAggregate.passed_scenarios).toBe(8);
  });

  it("classifies bounded causes and emits no raw failure details", () => {
    const scenarioId = "catering_enquiry_full_stack" as const;
    const semantic = redactConfigurationDraftingFailure(
      new AiExecutionError("ai_output_invalid", {
        cause: new AiExecutionError("ai_execution_failed", {
          cause: new BuilderConfigurationDraftValidationError(
            "duplicate_view_field_reference",
          ),
        }),
      }),
      scenarioId,
    );
    expect(configurationDraftingProviderFailureSchema.parse(semantic)).toEqual({
      schema_version: 1,
      scenario_id: scenarioId,
      error_code: "ai_output_invalid",
      validation_stage: "semantic",
      validation_reason_code: "duplicate_view_field_reference",
    });

    const unknownMarker = "unknown-nested-failure-marker";
    const unknown = redactConfigurationDraftingFailure(
      new AiExecutionError("ai_output_invalid", {
        cause: { cause: { cause: unknownMarker } },
      }),
      scenarioId,
    );
    expect(unknown).toMatchObject({
      error_code: "ai_output_invalid",
      validation_stage: "unknown",
      validation_reason_code: "unknown_output_invalid",
    });
    expect(JSON.stringify(unknown)).not.toContain(unknownMarker);

    for (const code of [
      "ai_provider_unavailable",
      "ai_refused",
      "ai_incomplete",
      "ai_timeout",
      "ai_execution_failed",
    ] as const) {
      const marker = `raw-${code}-marker`;
      const redacted = redactConfigurationDraftingFailure(
        new AiExecutionError(code, { cause: new Error(marker) }),
        scenarioId,
      );
      expect(redacted).toMatchObject({
        schema_version: 1,
        scenario_id: scenarioId,
        error_code: code,
      });
      expect(JSON.stringify(redacted)).not.toContain(marker);
    }
  });

  it("does not trigger reliability as a side effect", async () => {
    let calls = 0;
    const result = await runLiveConfigurationDraftingQualification(
      activeEnvironment,
      {
        loadProductionExecution: async () =>
          compliantExecution(async (scenarioId) => {
            calls += 1;
            return {
              output: outputFor(scenarioId),
              usage: { inputTokens: 1_200, outputTokens: 400 },
            };
          }),
        now: () => 10,
        emit: () => undefined,
      },
    );
    expect(result.passed).toBe(true);
    expect(calls).toBe(8);
  });
});
