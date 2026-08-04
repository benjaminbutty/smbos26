import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateBuilderLocationCreationIntent } from "../src/ai/evaluation/location-creation-intent/evaluator";
import {
  builderLocationCreationEvaluationScenarios,
  locationCreationEvaluationScenario,
} from "../src/ai/evaluation/location-creation-intent/scenarios";
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
        "input_tokens",
        "output_state",
        "output_tokens",
        "passed",
        "repetition",
        "scenario_id",
        "timezone_intent",
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
  });
});
