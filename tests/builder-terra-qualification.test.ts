import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StructuredAiProviderError } from "../src/ai/contracts";
import {
  BUILDER_TERRA_QUALIFICATION_EXPECTED_AGGREGATE_MAX_MICROUSD,
  BUILDER_TERRA_QUALIFICATION_HARD_CEILING_MICROUSD,
  deriveBuilderTerraQualificationEnvelope,
} from "../src/ai/evaluation/envelope";
import {
  liveBuilderTerraQualificationIsActivated,
  runLiveBuilderTerraQualification,
} from "../src/ai/evaluation/live";
import { builderEvaluationScenarios } from "../src/ai/evaluation/scenarios";
import {
  builderEvaluationAggregateSchema,
  builderEvaluationProviderFailureSchema,
} from "../src/ai/evaluation/schemas";
import {
  builderEvaluationStep,
  compliantBuilderEvaluationOutputs,
  createInjectedBuilderEvaluationExecution,
  readyBuilderEvaluationOutput,
} from "./support/builder-evaluation-fixtures";

const activeEnvironment = {
  RUN_LIVE_OPENAI_TERRA_QUALIFICATION: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

describe("GPT-5.6 Terra medium qualification gate", () => {
  it("derives the exact trusted eight-call cost envelope before provider construction", () => {
    const envelope = deriveBuilderTerraQualificationEnvelope();
    expect(envelope).toEqual({
      perScenarioMicrousd: 442_880,
      aggregateMicrousd:
        BUILDER_TERRA_QUALIFICATION_EXPECTED_AGGREGATE_MAX_MICROUSD,
      hardCeilingMicrousd: BUILDER_TERRA_QUALIFICATION_HARD_CEILING_MICROUSD,
    });
    expect(envelope.aggregateMicrousd).toBe(3_543_040);
    expect(envelope.hardCeilingMicrousd).toBe(3_700_000);
  });

  it("runs all eight scenarios exactly once and sequentially through strict execution", async () => {
    const emitted: unknown[] = [];
    let running = 0;
    let maxRunning = 0;
    const execution = createInjectedBuilderEvaluationExecution(
      async (scenarioId) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        running -= 1;
        return {
          output: structuredClone(
            compliantBuilderEvaluationOutputs[scenarioId],
          ),
          usage: { inputTokens: 1_200, outputTokens: 400 },
        };
      },
    );
    const result = await runLiveBuilderTerraQualification(activeEnvironment, {
      loadProductionExecution: async () => execution,
      now: () => 10,
      emit: (value) => emitted.push(value),
    });

    expect(result).toMatchObject({ ran: true, passed: true });
    expect(result.reports).toHaveLength(8);
    expect(result.reports.map(({ scenario_id }) => scenario_id)).toEqual(
      builderEvaluationScenarios.map(({ id }) => id),
    );
    expect(maxRunning).toBe(1);
    expect(emitted).toHaveLength(9);
    expect(builderEvaluationAggregateSchema.parse(emitted[8])).toMatchObject({
      total_scenarios: 8,
      passed_scenarios: 8,
      failed_scenarios: 0,
      total_estimated_cost_microusd: 72_000,
    });
  });

  it.each([
    ["structural", "preorder_phone_optional", { state: "ready" }],
    [
      "semantic",
      "preorder_phone_optional",
      (() => {
        const output = structuredClone(
          compliantBuilderEvaluationOutputs.preorder_phone_optional,
        );
        if (output.state !== "ready") throw new Error("Invalid fixture.");
        output.plan.steps[0]!.existing_object_keys = ["fabricated_object"];
        return output;
      })(),
    ],
    [
      "deterministic scenario gate",
      "preorder_phone_optional",
      readyBuilderEvaluationOutput([
        builderEvaluationStep("step_1", 1, "configuration", "define_field"),
      ]),
    ],
  ] as const)(
    "fails closed for one %s failure",
    async (_label, scenarioId, output) => {
      const emitted: unknown[] = [];
      const result = await runLiveBuilderTerraQualification(activeEnvironment, {
        loadProductionExecution: async () =>
          createInjectedBuilderEvaluationExecution(
            async (currentScenarioId) => ({
              output:
                currentScenarioId === scenarioId
                  ? structuredClone(output)
                  : structuredClone(
                      compliantBuilderEvaluationOutputs[currentScenarioId],
                    ),
              usage: { inputTokens: 1_200, outputTokens: 400 },
            }),
          ),
        now: () => 10,
        emit: (value) => emitted.push(value),
      });

      expect(result).toMatchObject({ ran: true, passed: false });
      expect(emitted).toHaveLength(9);
    },
  );

  it("fails closed and redacts one provider failure", async () => {
    const emitted: unknown[] = [];
    const result = await runLiveBuilderTerraQualification(activeEnvironment, {
      loadProductionExecution: async () =>
        createInjectedBuilderEvaluationExecution(async (scenarioId) => {
          if (scenarioId === "preorder_phone_optional") {
            throw new StructuredAiProviderError(
              "unavailable",
              "raw provider marker",
            );
          }
          return {
            output: structuredClone(
              compliantBuilderEvaluationOutputs[scenarioId],
            ),
            usage: { inputTokens: 1_200, outputTokens: 400 },
          };
        }),
      now: () => 10,
      emit: (value) => emitted.push(value),
    });

    expect(result).toMatchObject({ ran: true, passed: false });
    expect(builderEvaluationProviderFailureSchema.parse(emitted[0])).toEqual({
      scenario_id: "preorder_phone_optional",
      error_code: "ai_provider_unavailable",
    });
    expect(JSON.stringify(emitted)).not.toContain("raw provider marker");
  });

  it("constructs no provider without its exact flag, openai mode, and nonblank key", async () => {
    const loadProductionExecution = vi.fn();
    for (const environment of [
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "synthetic-key" },
      {
        RUN_LIVE_OPENAI_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "disabled",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        RUN_LIVE_OPENAI_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: " ",
      },
      {
        RUN_LIVE_OPENAI_EVAL: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
    ]) {
      expect(liveBuilderTerraQualificationIsActivated(environment)).toBe(false);
      await expect(
        runLiveBuilderTerraQualification(environment, {
          loadProductionExecution,
        }),
      ).resolves.toMatchObject({ ran: false, passed: false });
    }
    expect(loadProductionExecution).not.toHaveBeenCalled();
  });
});
