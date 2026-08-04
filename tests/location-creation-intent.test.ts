import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
  BUILDER_LOCATION_CREATION_INTENT_DISABLED_POLICY_KEY,
  BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_LOCATION_CREATION_INTENT_MODEL_KEY,
  OPENAI_BUILDER_LOCATION_CREATION_INTENT_REASONING_EFFORT,
  disabledExecutionPolicies,
  openAiBuilderLocationCreationPolicy,
} from "../src/ai/policies";
import { deriveAiReservationEnvelope } from "../src/ai/accounting/cost";
import { builderLocationCreationIntentTaskV1 } from "../src/ai/location-creation-intent/task";
import {
  BuilderLocationCreationIntentValidationError,
  type BuilderLocationCreationIntentDiagnosticCode,
} from "../src/ai/location-creation-intent/diagnostics";
import { validateBuilderLocationCreationIntentOutput } from "../src/ai/location-creation-intent/validation";
import { builderLocationCreationIntentOutputSchema } from "../src/ai/location-creation-intent/schemas";
import {
  builderLocationCreationEvaluationScenarios,
  locationCreationEvaluationScenario,
} from "../src/ai/evaluation/location-creation-intent/scenarios";
import { evaluateBuilderLocationCreationIntent } from "../src/ai/evaluation/location-creation-intent/evaluator";
import {
  BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
  deriveBuilderLocationCreationQualificationEnvelope,
  deriveBuilderLocationCreationReliabilityEnvelope,
} from "../src/ai/evaluation/location-creation-intent/envelope";
import {
  liveBuilderLocationCreationQualificationIsActivated,
  liveBuilderLocationCreationReliabilityIsActivated,
} from "../src/ai/evaluation/location-creation-intent/live";

describe("Builder Location creation intent boundary", () => {
  it("freezes exactly the eight required evaluation scenarios", () => {
    expect(builderLocationCreationEvaluationScenarios).toHaveLength(8);
    expect(
      builderLocationCreationEvaluationScenarios.map(({ id }) => id),
    ).toEqual([
      "explicit_timezone",
      "business_timezone",
      "alternate_wording",
      "active_duplicate",
      "inactive_duplicate",
      "missing_name",
      "different_timezone_implied",
      "neutral_business_wording",
    ]);
    expect(Object.isFrozen(builderLocationCreationEvaluationScenarios)).toBe(
      true,
    );
  });

  it("uses the exact disabled and evaluation-only Terra policy identities", () => {
    expect(BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY).toBe(
      "builder_location_creation_intent_disabled_v1",
    );
    expect(BUILDER_LOCATION_CREATION_INTENT_DISABLED_POLICY_KEY).toBe(
      BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
    );
    expect(BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY).toBe(
      "builder_location_creation_intent_terra_medium_v1",
    );
    expect(builderLocationCreationIntentTaskV1.policyKey).toBe(
      BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
    );
    expect(openAiBuilderLocationCreationPolicy).toMatchObject({
      key: BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
      modelKey: OPENAI_BUILDER_LOCATION_CREATION_INTENT_MODEL_KEY,
      providerKey: "openai",
      maxInputBytes: 256 * 1024,
      maxBillableInputTokens: 80_000,
      maxOutputTokens: 2_048,
      timeoutMs: 30_000,
      maxAttempts: 2,
    });
    expect(OPENAI_BUILDER_LOCATION_CREATION_INTENT_REASONING_EFFORT).toBe(
      "medium",
    );
    expect(disabledExecutionPolicies).not.toHaveProperty(
      BUILDER_LOCATION_CREATION_INTENT_TERRA_MEDIUM_POLICY_KEY,
    );
  });

  it("reserves the exact stated cost envelope", () => {
    const single = deriveAiReservationEnvelope(
      openAiBuilderLocationCreationPolicy,
    );
    expect(single.reservedCostMicrousd).toBe(461_440);
    expect(deriveBuilderLocationCreationQualificationEnvelope()).toMatchObject({
      reservedCostMicrousd: 3_691_520,
      hardCeilingMicrousd:
        BUILDER_LOCATION_CREATION_INTENT_QUALIFICATION_HARD_CEILING_MICROUSD,
    });
    expect(deriveBuilderLocationCreationReliabilityEnvelope()).toMatchObject({
      reservedCostMicrousd: 11_074_560,
      hardCeilingMicrousd:
        BUILDER_LOCATION_CREATION_INTENT_RELIABILITY_HARD_CEILING_MICROUSD,
    });
  });

  it("accepts the code-owned expected outputs through the real validator", () => {
    for (const scenario of builderLocationCreationEvaluationScenarios) {
      expect(() =>
        validateBuilderLocationCreationIntentOutput(
          scenario.input,
          scenario.expected_output,
        ),
      ).not.toThrow();
      expect(
        evaluateBuilderLocationCreationIntent(
          scenario,
          scenario.expected_output,
          {
            attempts: 1,
            inputTokens: 100,
            outputTokens: 50,
            elapsedMs: 1,
          },
        ),
      ).toMatchObject({ passed: true, failed_gate_codes: [] });
    }
  });

  it("rejects names not stated by the owner and implicit timezone inference", () => {
    const neutral = locationCreationEvaluationScenario(
      "neutral_business_wording",
    );
    const wrongName = builderLocationCreationIntentOutputSchema.parse({
      ...neutral.expected_output,
      location_name: "Birmingham",
    });
    expect(() =>
      validateBuilderLocationCreationIntentOutput(neutral.input, wrongName),
    ).toThrowError(
      expect.objectContaining<
        Partial<BuilderLocationCreationIntentValidationError>
      >({
        diagnosticCode:
          "location_name_not_in_request" satisfies BuilderLocationCreationIntentDiagnosticCode,
      }),
    );

    const implied = locationCreationEvaluationScenario(
      "different_timezone_implied",
    );
    const inferred = builderLocationCreationIntentOutputSchema.parse({
      schema_version: 1,
      state: "ready",
      summary: "Add New York as one new Location.",
      location_name: "New York",
      timezone_intent: { kind: "use_business_timezone" },
      source_step_references: ["step_1"],
    });
    expect(() =>
      validateBuilderLocationCreationIntentOutput(implied.input, inferred),
    ).toThrowError(
      expect.objectContaining<
        Partial<BuilderLocationCreationIntentValidationError>
      >({
        diagnosticCode:
          "timezone_implicit_or_ambiguous" satisfies BuilderLocationCreationIntentDiagnosticCode,
      }),
    );
  });

  it("requires both live gates to be separately and explicitly activated", () => {
    expect(
      liveBuilderLocationCreationQualificationIsActivated({
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "secret",
      }),
    ).toBe(true);
    expect(
      liveBuilderLocationCreationQualificationIsActivated({
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_QUALIFICATION: "1",
        AI_PROVIDER: "disabled",
        OPENAI_API_KEY: "secret",
      }),
    ).toBe(false);
    expect(
      liveBuilderLocationCreationReliabilityIsActivated({
        RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_RELIABILITY: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "secret",
      }),
    ).toBe(true);
  });
});
