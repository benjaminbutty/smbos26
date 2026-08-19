import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { openAiAcquisitionPlanningPolicy } from "../src/ai/policies";
import {
  acquisitionPlanningInputSchema,
  type AcquisitionPlanningOutput,
} from "../src/ai/acquisition-planning/schemas";
import { validateAcquisitionPlanningOutput } from "../src/ai/acquisition-planning/validation";
import { ACQUISITION_PLANNING_INSTRUCTION } from "../src/ai/acquisition-planning/task";
import { acquisitionEvaluationScenarios } from "../src/ai/evaluation/acquisition/scenarios";
import { emitAcquisitionEvent } from "../src/core/acquisition/events";

describe("Phase 5 public AI and telemetry boundary", () => {
  it.each([
    ["Location", "Locations"],
    ["Ｌｏｃａｔｉｏｎ", "LOCATIONS"],
  ])(
    "rejects a custom Location table after case and NFKC normalisation",
    (singularName, pluralName) => {
      const input = acquisitionPlanningInputSchema.parse({
        schema_version: 1,
        category: "other",
        owner_request: "I need a small internal workspace.",
        grounded_currency: null,
      });
      const output: AcquisitionPlanningOutput = {
        schema_version: 1,
        state: "ready",
        understanding: "A small internal workspace for the work you do.",
        why: "These business areas keep the work organised.",
        tables: [
          {
            reference: "table_1",
            singular_name: singularName,
            plural_name: pluralName,
            purpose: "Keep the work organised.",
            fields: [
              {
                label: "Name",
                field_type: "short_text",
                required: true,
                options: null,
                currency: null,
              },
            ],
          },
        ],
        connections: [],
        primary_table_reference: "table_1",
        unsupported_requirements: [],
      };

      expect(() => validateAcquisitionPlanningOutput(input, output)).toThrow(
        "The acquisition plan is not safe to use.",
      );
      try {
        validateAcquisitionPlanningOutput(input, output);
      } catch (error) {
        expect(error).toMatchObject({ code: "location_table_forbidden" });
      }
    },
  );

  it("keeps the public interpretation inside the acquisition cost envelope", () => {
    expect(openAiAcquisitionPlanningPolicy).toMatchObject({
      maxInputBytes: 8 * 1024,
      maxBillableInputTokens: 4_000,
      maxOutputTokens: 2_500,
      timeoutMs: 25_000,
      maxAttempts: 1,
      retryableFailureKinds: [],
    });
  });

  it("fixes the production acceptance set at exactly eight scenarios", () => {
    expect(acquisitionEvaluationScenarios).toHaveLength(8);
    expect(
      new Set(acquisitionEvaluationScenarios.map(({ id }) => id)).size,
    ).toBe(8);
  });

  it("keeps the minimal one-to-many convention without porting linking-record prompt tuning", () => {
    expect(ACQUISITION_PLANNING_INSTRUCTION).toContain(
      "source_table_reference is the ONE side",
    );
    expect(ACQUISITION_PLANNING_INSTRUCTION).toContain(
      "target_table_reference is the MANY side",
    );
    expect(ACQUISITION_PLANNING_INSTRUCTION).not.toContain(
      "quantity-bearing linking business area",
    );
    expect(ACQUISITION_PLANNING_INSTRUCTION).not.toContain(
      "particular pairing or inclusion",
    );
  });

  it("guides generic graph identity modelling without adding a vertical rule", () => {
    expect(ACQUISITION_PLANNING_INSTRUCTION).toContain(
      "keep identity and contact information on the business area it belongs to",
    );
    expect(ACQUISITION_PLANNING_INSTRUCTION).toContain(
      "use the Connection to represent the relationship",
    );
    expect(ACQUISITION_PLANNING_INSTRUCTION).not.toMatch(
      /carpenter|trades|worker|quote/i,
    );
  });

  it("drops prompt, customer and authoritative payload metadata", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    emitAcquisitionEvent("prompt_submitted", {
      category: "appointments",
      prompt: "A customer name and phone number",
      customer: "Private customer",
      operations: "authoritative operations",
      business_slug: "private-business",
    });
    expect(info).toHaveBeenCalledOnce();
    const event = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(event).toMatchObject({
      event: "prompt_submitted",
      category: "appointments",
    });
    expect(event).not.toHaveProperty("prompt");
    expect(event).not.toHaveProperty("customer");
    expect(event).not.toHaveProperty("operations");
    expect(event).not.toHaveProperty("business_slug");
    info.mockRestore();
  });

  it("keeps recovery telemetry finite and redacted", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    emitAcquisitionEvent("repair_succeeded", {
      category: "jobs",
      recovery_code: "quality_cross_object_field_leakage",
      removed_field_count: 1,
      prompt: "owner-request-marker",
      model_output: "raw-output-marker",
    });
    const event = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(event).toMatchObject({
      event: "repair_succeeded",
      category: "jobs",
      recovery_code: "quality_cross_object_field_leakage",
      removed_field_count: 1,
    });
    expect(JSON.stringify(event)).not.toMatch(
      /owner-request-marker|raw-output-marker/,
    );
    expect(Object.keys(event)).toHaveLength(5);
    info.mockRestore();
  });
});
