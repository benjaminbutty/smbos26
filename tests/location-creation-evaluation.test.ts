import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateBuilderLocationCreationIntent } from "../src/ai/evaluation/location-creation-intent/evaluator";
import {
  liveBuilderLocationCreationQualificationIsActivated,
  runLiveBuilderLocationCreationQualification,
  runLiveBuilderLocationCreationReliability,
} from "../src/ai/evaluation/location-creation-intent/live";
import {
  builderLocationCreationEvaluationScenarios,
  locationCreationEvaluationScenario,
} from "../src/ai/evaluation/location-creation-intent/scenarios";
import {
  builderLocationCreationEvaluationQualificationAggregateSchema,
  builderLocationCreationEvaluationReliabilityAggregateSchema,
} from "../src/ai/evaluation/location-creation-intent/schemas";
import { AiExecutionError } from "../src/ai/errors";
import { StructuredAiProviderError } from "../src/ai/contracts";
import { BuilderLocationCreationIntentValidationError } from "../src/ai/location-creation-intent/diagnostics";
import { builderLocationCreationIntentOutputSchema } from "../src/ai/location-creation-intent/schemas";

describe("Builder Location creation evaluation harness", () => {
  it("emits only bounded redacted report fields for every frozen scenario", () => {
    for (const scenario of builderLocationCreationEvaluationScenarios) {
      const report = evaluateBuilderLocationCreationIntent(
        scenario,
        scenario.expected_output,
        {
          attempts: 1,
          inputTokens: 120,
          outputTokens: 40,
          elapsedMs: 12,
        },
      );
      expect(report.passed).toBe(true);
      expect(report.failed_gate_codes).toEqual([]);
      expect(JSON.stringify(report)).not.toContain(scenario.owner_request);
      expect(JSON.stringify(report)).not.toContain(
        scenario.expected_output.state === "ready"
          ? scenario.expected_output.location_name
          : "Cambridge",
      );
      expect(Object.keys(report).sort()).toEqual([
        "attempts",
        "elapsed_ms",
        "error_code",
        "estimated_microusd",
        "failed_gate_codes",
        "failure_class",
        "input_tokens",
        "output_state",
        "output_tokens",
        "passed",
        "repetition",
        "scenario_id",
        "timezone_intent",
        "usage_complete",
        "validation_reason_code",
      ]);
    }
  });

  it("fails a ready duplicate and records a semantic gate without model judgment", () => {
    const scenario = locationCreationEvaluationScenario("active_duplicate");
    const forgedReady = builderLocationCreationIntentOutputSchema.parse({
      schema_version: 1,
      state: "ready" as const,
      summary: "Add Cambridge as one new Location.",
      location_name: "Cambridge",
      timezone_intent: { kind: "use_business_timezone" as const },
      source_step_references: ["step_1"],
    });
    const report = evaluateBuilderLocationCreationIntent(
      scenario,
      forgedReady,
      { attempts: 1, inputTokens: 1, outputTokens: 1, elapsedMs: 1 },
    );
    expect(report.passed).toBe(false);
    expect(report.failed_gate_codes).toEqual(
      expect.arrayContaining(["semantic_validation", "expected_state"]),
    );
    expect(report.validation_reason_code).toBe("duplicate_location_in_context");
  });

  it("classifies invalid-output cause chains with finite redacted diagnostics", async () => {
    const accounting = {
      attemptsStarted: 1,
      inputTokens: 100,
      outputTokens: 20,
      usageReported: true,
      usageComplete: true,
      providerInvocationStarted: true,
      failureBeforeProviderInvocation: false,
    };
    const structuralParse = z
      .object({ state: z.literal("ready") })
      .safeParse({ state: "invalid" });
    if (structuralParse.success) {
      throw new Error("Expected a synthetic output-contract error.");
    }

    async function reportFor(cause: unknown) {
      let calls = 0;
      const result = await runLiveBuilderLocationCreationQualification(
        {
          RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION: "1",
          AI_PROVIDER: "openai",
          OPENAI_API_KEY: "synthetic-key",
        },
        {
          emit: () => undefined,
          now: () => 10,
          execute: async () => {
            calls += 1;
            throw cause;
          },
        },
      );
      expect(result).toMatchObject({ ran: true, passed: false });
      if (!result.ran) throw new Error("Qualification did not run.");
      expect(calls).toBe(1);
      expect(result.reports).toHaveLength(1);
      expect(result.reports[0]).toMatchObject({
        error_code: "ai_output_invalid",
        attempts: 1,
        input_tokens: 100,
        output_tokens: 20,
        usage_complete: true,
        estimated_microusd: 550,
      });
      return result.reports[0]!;
    }

    const semantic = await reportFor(
      new AiExecutionError("ai_output_invalid", {
        accounting,
        cause: new BuilderLocationCreationIntentValidationError(
          "duplicate_location_in_context",
        ),
      }),
    );
    expect(semantic).toMatchObject({
      failure_class: "semantic_validation",
      failed_gate_codes: ["semantic_validation"],
      validation_reason_code: "duplicate_location_in_context",
    });

    const structural = await reportFor(
      new AiExecutionError("ai_output_invalid", {
        accounting,
        cause: structuralParse.error,
      }),
    );
    expect(structural).toMatchObject({
      failure_class: "output_contract",
      failed_gate_codes: ["output_contract"],
      validation_reason_code: "output_contract_invalid",
    });

    const providerMarker = "raw-provider-body-marker";
    const provider = await reportFor(
      new AiExecutionError("ai_output_invalid", {
        accounting,
        cause: new StructuredAiProviderError(
          "invalid_response",
          providerMarker,
        ),
      }),
    );
    expect(provider).toMatchObject({
      failure_class: "provider_execution",
      failed_gate_codes: ["provider_execution"],
      validation_reason_code: "provider_invalid_response",
    });
    expect(JSON.stringify(provider)).not.toContain(providerMarker);

    const unknownMarker = "unknown-invalid-output-marker";
    const unknown = await reportFor(
      new AiExecutionError("ai_output_invalid", {
        accounting,
        cause: { cause: { cause: unknownMarker } },
      }),
    );
    expect(unknown).toMatchObject({
      failure_class: "unknown",
      failed_gate_codes: ["unknown_output"],
      validation_reason_code: "unknown_output_invalid",
    });
    expect(JSON.stringify(unknown)).not.toContain(unknownMarker);
  });

  it("runs qualification in the frozen order and emits the required aggregate", async () => {
    const emitted: unknown[] = [];
    const calls: string[] = [];
    const result = await runLiveBuilderLocationCreationQualification(
      {
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        now: () => 10,
        emit: (value) => emitted.push(value),
        execute: async (_taskKey, input) => {
          const scenario = builderLocationCreationEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          calls.push(scenario.id);
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
              taskKey: "builder_location_creation_intent_v1",
              taskVersion: 1,
              purposeLabel: "test",
              providerKey: "openai",
              modelKey: "gpt-5.6-terra",
              attempts: 1,
              usage: { inputTokens: 120, outputTokens: 40, complete: true },
            },
          };
        },
      },
    );

    expect(
      liveBuilderLocationCreationQualificationIsActivated({
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      }),
    ).toBe(true);
    expect(result).toMatchObject({ ran: true, passed: true });
    if (!result.ran) throw new Error("Qualification did not run.");
    expect(calls).toEqual(
      builderLocationCreationEvaluationScenarios.map(({ id }) => id),
    );
    expect(result.reports).toHaveLength(8);
    expect(
      builderLocationCreationEvaluationQualificationAggregateSchema.parse(
        emitted.at(-1),
      ),
    ).toMatchObject({
      total_scenarios: 8,
      passed_scenarios: 8,
      failed_scenarios: 0,
      total_attempts: 8,
      total_input_tokens: 960,
      total_output_tokens: 320,
      total_estimated_cost_microusd: 7_200,
    });
  });

  it("runs reliability sequentially and reports three passes per scenario", async () => {
    const emitted: unknown[] = [];
    let running = 0;
    let maximumRunning = 0;
    const result = await runLiveBuilderLocationCreationReliability(
      {
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_RELIABILITY: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        now: () => 10,
        emit: (value) => emitted.push(value),
        execute: async (_taskKey, input) => {
          const scenario = builderLocationCreationEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          running += 1;
          maximumRunning = Math.max(maximumRunning, running);
          await Promise.resolve();
          running -= 1;
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
              taskKey: "builder_location_creation_intent_v1",
              taskVersion: 1,
              purposeLabel: "test",
              providerKey: "openai",
              modelKey: "gpt-5.6-terra",
              attempts: 1,
              usage: { inputTokens: 120, outputTokens: 40, complete: true },
            },
          };
        },
      },
    );

    expect(result).toMatchObject({ ran: true, passed: true });
    if (!result.ran) throw new Error("Reliability did not run.");
    expect(result.reports).toHaveLength(24);
    expect(maximumRunning).toBe(1);
    expect(
      builderLocationCreationEvaluationReliabilityAggregateSchema.parse(
        emitted.at(-1),
      ),
    ).toMatchObject({
      total_executions: 24,
      passed_executions: 24,
      failed_executions: 0,
      total_attempts: 24,
      total_estimated_cost_microusd: 21_600,
      per_scenario_pass_counts: builderLocationCreationEvaluationScenarios.map(
        ({ id }) => ({ scenario_id: id, passed_count: 3 }),
      ),
    });
  });

  it("stops qualification on the first failure and does not double-classify provider failure", async () => {
    const emitted: unknown[] = [];
    let calls = 0;
    const result = await runLiveBuilderLocationCreationQualification(
      {
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        emit: (value) => emitted.push(value),
        execute: async () => {
          calls += 1;
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
        },
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    if (!result.ran) throw new Error("Qualification did not run.");
    expect(calls).toBe(1);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      failure_class: "provider_execution",
      failed_gate_codes: ["provider_execution"],
      error_code: "ai_provider_unavailable",
      attempts: 2,
      input_tokens: 240,
      output_tokens: 80,
      usage_complete: true,
    });
    expect(JSON.stringify(result.reports[0])).not.toContain("Cambridge");
    expect(emitted).toHaveLength(2);
  });

  it("rejects a reservation-envelope mismatch before loading execution dependencies", async () => {
    const emitted: unknown[] = [];
    const loadDependencies = vi.fn();
    const result = await runLiveBuilderLocationCreationQualification(
      {
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        emit: (value) => emitted.push(value),
        loadDependencies,
        deriveQualificationEnvelope: () => ({
          taskKey: "builder_location_creation_intent_v1",
          policyKey: "builder_location_creation_intent_terra_medium_v1",
          modelKey: "gpt-5.6-terra",
          reasoningEffort: "medium",
          reservedCostMicrousdPerExecution: 1,
          reservedCostMicrousd: 8,
          hardCeilingMicrousd: 3_800_000,
        }),
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    expect(loadDependencies).not.toHaveBeenCalled();
    expect(emitted).toEqual([
      {
        evaluation_error_code: "evaluation_setup_failed",
        reason_code: "reservation_envelope_mismatch",
      },
    ]);
  });

  it("enforces the qualification ceiling using actual reported usage", async () => {
    const emitted: unknown[] = [];
    const result = await runLiveBuilderLocationCreationQualification(
      {
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        emit: (value) => emitted.push(value),
        execute: async (_taskKey, input) => {
          const scenario = builderLocationCreationEvaluationScenarios.find(
            (candidate) => candidate.input === input,
          );
          if (!scenario) throw new Error("Unknown injected scenario.");
          return {
            output: scenario.expected_output,
            accounting: {
              attemptsStarted: 1,
              inputTokens: 2_000_000,
              outputTokens: 0,
              usageReported: true,
              usageComplete: true,
              providerInvocationStarted: true,
              failureBeforeProviderInvocation: false,
            },
            metadata: {
              taskKey: "builder_location_creation_intent_v1",
              taskVersion: 1,
              purposeLabel: "test",
              providerKey: "openai",
              modelKey: "gpt-5.6-terra",
              attempts: 1,
              usage: {
                inputTokens: 2_000_000,
                outputTokens: 0,
                complete: true,
              },
            },
          };
        },
      },
    );

    expect(result).toMatchObject({ ran: true, passed: false });
    if (!result.ran) throw new Error("Qualification did not run.");
    expect(result.reports).toHaveLength(8);
    expect(emitted.at(-1)).toMatchObject({
      total_estimated_cost_microusd: 40_000_000,
    });
  });
});
