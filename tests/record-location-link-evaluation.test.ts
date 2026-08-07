import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  builderRecordLocationLinkSingleExecutionReservationMicrousd,
  deriveBuilderRecordLocationLinkQualificationEnvelope,
  deriveBuilderRecordLocationLinkReliabilityEnvelope,
} from "../src/ai/evaluation/record-location-link-intent/envelope";
import { evaluateBuilderRecordLocationLinkIntent } from "../src/ai/evaluation/record-location-link-intent/evaluator";
import {
  liveBuilderRecordLocationLinkQualificationIsActivated,
  runLiveBuilderRecordLocationLinkQualification,
  runLiveBuilderRecordLocationLinkReliability,
} from "../src/ai/evaluation/record-location-link-intent/live";
import {
  BUILDER_RECORD_LOCATION_LINK_EVALUATION_SCENARIO_IDS,
  builderRecordLocationLinkEvaluationScenarios,
} from "../src/ai/evaluation/record-location-link-intent/scenarios";

const activeEnvironment = {
  RUN_LIVE_OPENAI_RECORD_LOCATION_LINK_TERRA_QUALIFICATION: "1",
  RUN_LIVE_OPENAI_RECORD_LOCATION_LINK_TERRA_RELIABILITY: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

function injectedExecution(input: unknown) {
  const scenario = builderRecordLocationLinkEvaluationScenarios.find(
    (candidate) => candidate.input === input,
  );
  if (!scenario) {
    throw new Error("Unknown injected Record-to-Location scenario.");
  }
  return {
    output: scenario.expected_output,
    metadata: {
      taskKey: "builder_record_location_link_intent_v1",
      taskVersion: 1,
      purposeLabel: "test",
      providerKey: "openai",
      modelKey: "gpt-5.6-terra",
      attempts: 1,
      usage: { inputTokens: 120, outputTokens: 40, complete: true },
    },
    accounting: {
      attemptsStarted: 1,
      inputTokens: 120,
      outputTokens: 40,
      usageReported: true,
      usageComplete: true,
      providerInvocationStarted: true,
      failureBeforeProviderInvocation: false,
    },
  };
}

describe("Builder Record-to-Location evaluation harness", () => {
  it("freezes eight bounded scenarios and redacts owner/Record details", () => {
    expect(builderRecordLocationLinkEvaluationScenarios).toHaveLength(8);
    expect(
      builderRecordLocationLinkEvaluationScenarios.map(({ id }) => id),
    ).toEqual(BUILDER_RECORD_LOCATION_LINK_EVALUATION_SCENARIO_IDS);

    for (const scenario of builderRecordLocationLinkEvaluationScenarios) {
      const report = evaluateBuilderRecordLocationLinkIntent(
        scenario,
        scenario.expected_output,
        { attempts: 1, inputTokens: 120, outputTokens: 40, elapsedMs: 12 },
      );
      expect(report.passed, scenario.id).toBe(true);
      expect(report.failed_gate_codes, scenario.id).toEqual([]);
      expect(JSON.stringify(report)).not.toContain(scenario.owner_request);
      expect(JSON.stringify(report)).not.toMatch(
        /Kids Afternoon Tea|Projector|Bedford|Cambridge/i,
      );
    }
  });

  it("derives the reviewed subject-specific reservation envelopes", () => {
    expect(builderRecordLocationLinkSingleExecutionReservationMicrousd).toBe(
      286_080,
    );
    expect(
      deriveBuilderRecordLocationLinkQualificationEnvelope(),
    ).toMatchObject({
      reservedCostMicrousd: 2_288_640,
      hardCeilingMicrousd: 2_400_000,
    });
    expect(deriveBuilderRecordLocationLinkReliabilityEnvelope()).toMatchObject({
      reservedCostMicrousd: 6_865_920,
      hardCeilingMicrousd: 7_100_000,
    });
  });

  it("runs qualification and reliability sequentially with injected outputs", async () => {
    const qualificationCalls: string[] = [];
    const qualification = await runLiveBuilderRecordLocationLinkQualification(
      activeEnvironment,
      {
        now: () => 10,
        emit: () => undefined,
        execute: async (_taskKey, input) => {
          const scenario = builderRecordLocationLinkEvaluationScenarios.find(
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
      BUILDER_RECORD_LOCATION_LINK_EVALUATION_SCENARIO_IDS,
    );

    const reliability = await runLiveBuilderRecordLocationLinkReliability(
      activeEnvironment,
      {
        now: () => 10,
        emit: () => undefined,
        execute: async (_taskKey, input) => injectedExecution(input),
      },
    );
    expect(reliability).toMatchObject({ ran: true, passed: true });
    if (reliability.ran) expect(reliability.reports).toHaveLength(24);
  });

  it("does not construct evaluation dependencies while inactive", async () => {
    expect(liveBuilderRecordLocationLinkQualificationIsActivated({})).toBe(
      false,
    );
    await expect(
      runLiveBuilderRecordLocationLinkQualification(
        {},
        {
          execute: async () => {
            throw new Error("must not execute");
          },
        },
      ),
    ).resolves.toMatchObject({ ran: false, passed: false });
  });
});
