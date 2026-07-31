import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StructuredAiProviderError } from "../src/ai/contracts";
import {
  BUILDER_TERRA_RELIABILITY_EXPECTED_AGGREGATE_MAX_MICROUSD,
  BUILDER_TERRA_RELIABILITY_HARD_CEILING_MICROUSD,
  BUILDER_TERRA_RELIABILITY_REPETITIONS,
  BUILDER_TERRA_RELIABILITY_TOTAL_EXECUTIONS,
  deriveBuilderTerraReliabilityEnvelope,
} from "../src/ai/evaluation/envelope";
import {
  liveBuilderTerraReliabilityIsActivated,
  runLiveBuilderTerraReliability,
} from "../src/ai/evaluation/live";
import { builderEvaluationScenarios } from "../src/ai/evaluation/scenarios";
import {
  builderEvaluationReliabilityAggregateSchema,
  builderEvaluationReliabilityProviderFailureSchema,
} from "../src/ai/evaluation/schemas";
import {
  builderEvaluationStep,
  compliantBuilderEvaluationOutputs,
  createInjectedBuilderEvaluationExecution,
  readyBuilderEvaluationOutput,
} from "./support/builder-evaluation-fixtures";

const activeEnvironment = {
  RUN_LIVE_OPENAI_TERRA_RELIABILITY: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

describe("GPT-5.6 Terra medium repeated reliability gate", () => {
  it("derives the exact trusted twenty-four-call cost envelope", () => {
    const envelope = deriveBuilderTerraReliabilityEnvelope();
    expect(envelope).toEqual({
      perScenarioMicrousd: 442_880,
      aggregateMicrousd:
        BUILDER_TERRA_RELIABILITY_EXPECTED_AGGREGATE_MAX_MICROUSD,
      hardCeilingMicrousd: BUILDER_TERRA_RELIABILITY_HARD_CEILING_MICROUSD,
    });
    expect(BUILDER_TERRA_RELIABILITY_REPETITIONS).toBe(3);
    expect(BUILDER_TERRA_RELIABILITY_TOTAL_EXECUTIONS).toBe(24);
    expect(envelope.aggregateMicrousd).toBe(10_629_120);
    expect(envelope.hardCeilingMicrousd).toBe(11_000_000);
  });

  it("runs three sequential rounds and requires 24 of 24 passes", async () => {
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
    const result = await runLiveBuilderTerraReliability(activeEnvironment, {
      loadProductionExecution: async () => execution,
      now: () => 10,
      emit: (value) => emitted.push(value),
    });

    expect(result).toMatchObject({ ran: true, passed: true });
    expect(result.reports).toHaveLength(24);
    expect(result.reports.map(({ repetition }) => repetition)).toEqual([
      ...Array(8).fill(1),
      ...Array(8).fill(2),
      ...Array(8).fill(3),
    ]);
    expect(maxRunning).toBe(1);
    expect(emitted).toHaveLength(25);
    expect(
      builderEvaluationReliabilityAggregateSchema.parse(emitted[24]),
    ).toMatchObject({
      total_scenarios: 8,
      repetitions_per_scenario: 3,
      total_executions: 24,
      passed_executions: 24,
      failed_executions: 0,
      per_scenario_pass_counts: builderEvaluationScenarios.map(({ id }) => ({
        scenario_id: id,
        passed_count: 3,
      })),
    });
  });

  it.each([
    ["structural", 1, "preorder_phone_optional", { state: "ready" }],
    [
      "semantic",
      1,
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
      "scenario gate",
      1,
      "preorder_phone_optional",
      readyBuilderEvaluationOutput([
        builderEvaluationStep("step_1", 1, "configuration", "define_field"),
      ]),
    ],
  ] as const)(
    "fails the whole gate for one %s failure",
    async (_label, failingInvocation, scenarioId, output) => {
      const result = await runLiveBuilderTerraReliability(activeEnvironment, {
        loadProductionExecution: async () =>
          createInjectedBuilderEvaluationExecution(
            async (currentScenarioId, invocation) => ({
              output:
                invocation === failingInvocation &&
                currentScenarioId === scenarioId
                  ? structuredClone(output)
                  : structuredClone(
                      compliantBuilderEvaluationOutputs[currentScenarioId],
                    ),
              usage: { inputTokens: 1_200, outputTokens: 400 },
            }),
          ),
        now: () => 10,
        emit: () => undefined,
      });
      expect(result).toMatchObject({ ran: true, passed: false });
    },
  );

  it("fails if one scenario passes only two of three repetitions", async () => {
    const result = await runLiveBuilderTerraReliability(activeEnvironment, {
      loadProductionExecution: async () =>
        createInjectedBuilderEvaluationExecution(
          async (scenarioId, invocation) => ({
            output:
              scenarioId === "preorder_phone_optional" && invocation === 17
                ? readyBuilderEvaluationOutput([
                    builderEvaluationStep(
                      "step_1",
                      1,
                      "configuration",
                      "define_field",
                    ),
                  ])
                : structuredClone(
                    compliantBuilderEvaluationOutputs[scenarioId],
                  ),
            usage: { inputTokens: 1_200, outputTokens: 400 },
          }),
        ),
      now: () => 10,
      emit: () => undefined,
    });
    expect(result).toMatchObject({ ran: true, passed: false });
  });

  it("fails closed and redacts provider failures with their bounded repetition", async () => {
    const emitted: unknown[] = [];
    const result = await runLiveBuilderTerraReliability(activeEnvironment, {
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
    expect(
      builderEvaluationReliabilityProviderFailureSchema.parse(emitted[0]),
    ).toEqual({
      scenario_id: "preorder_phone_optional",
      error_code: "ai_provider_unavailable",
      repetition: 1,
    });
    expect(JSON.stringify(emitted)).not.toContain("raw provider marker");
  });

  it("constructs no provider without its own exact activation gate", async () => {
    const loadProductionExecution = vi.fn();
    for (const environment of [
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "synthetic-key" },
      {
        RUN_LIVE_OPENAI_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        RUN_LIVE_OPENAI_EVAL: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
    ]) {
      expect(liveBuilderTerraReliabilityIsActivated(environment)).toBe(false);
      await expect(
        runLiveBuilderTerraReliability(environment, {
          loadProductionExecution,
        }),
      ).resolves.toMatchObject({ ran: false, passed: false });
    }
    expect(loadProductionExecution).not.toHaveBeenCalled();
  });
});
