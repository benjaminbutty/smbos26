import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
  OPENAI_ACQUISITION_CORRECTION_TIMEOUT_MS,
  openAiAcquisitionPlanningPolicy,
  openAiAcquisitionRequiredIdentityCorrectionPolicy,
} from "../src/ai/policies";
import {
  acquisitionPlanningInputSchema,
  acquisitionRequiredIdentityCorrectionInputSchema,
  type AcquisitionPlanningOutput,
} from "../src/ai/acquisition-planning/schemas";
import { validateAcquisitionPlanningOutput } from "../src/ai/acquisition-planning/validation";
import {
  ACQUISITION_PLANNING_INSTRUCTION,
  ACQUISITION_REQUIRED_IDENTITY_REPLAN_INSTRUCTION,
  acquisitionPlanningTaskV1,
  acquisitionRequiredIdentityCorrectionTaskV1,
} from "../src/ai/acquisition-planning/task";
import {
  ACQUISITION_CORRECTION_QUALIFICATION_EXECUTIONS,
  ACQUISITION_CORRECTION_QUALIFICATION_REPETITIONS,
  assertAcquisitionCorrectionQualificationSubject,
  runLiveAcquisitionCorrectionQualification,
} from "../src/ai/evaluation/acquisition/correction-qualification-live";
import { acquisitionEvaluationScenarios } from "../src/ai/evaluation/acquisition/scenarios";
import { emitAcquisitionEvent } from "../src/core/acquisition/events";
import {
  ACQUISITION_MAX_PLANNING_EXECUTIONS,
  ACQUISITION_MAX_PLANNING_EXECUTION_COST_MICROUSD,
  ACQUISITION_MAX_WORKFLOW_COST_MICROUSD,
} from "../src/core/acquisition/interpreter";

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
      modelKey: "gpt-5.6-sol",
      reasoningEffort: "medium",
      serviceTier: "auto",
      inputMicrousdPerMillion: 5_000_000,
      outputMicrousdPerMillion: 30_000_000,
      maxInputBytes: 8 * 1024,
      maxBillableInputTokens: 4_000,
      maxOutputTokens: 2_500,
      timeoutMs: 25_000,
      maxAttempts: 1,
      retryableFailureKinds: [],
    });
    expect(ACQUISITION_MAX_PLANNING_EXECUTIONS).toBe(2);
    expect(ACQUISITION_MAX_PLANNING_EXECUTION_COST_MICROUSD).toBe(47_500);
    expect(ACQUISITION_MAX_WORKFLOW_COST_MICROUSD).toBe(95_000);
  });

  it("uses a dedicated correction task and policy for the finite server-owned correction", () => {
    const first = acquisitionPlanningTaskV1.buildInstruction();
    const correction =
      acquisitionRequiredIdentityCorrectionTaskV1.buildInstruction();
    const firstInput = acquisitionPlanningInputSchema.parse({
      schema_version: 1,
      category: "jobs",
      owner_request: "Keep customers and jobs organised.",
      grounded_currency: null,
    });
    const correctionInput =
      acquisitionRequiredIdentityCorrectionInputSchema.parse({
        schema_version: 1,
        category: "jobs",
        owner_request: "Keep customers and jobs organised.",
        grounded_currency: null,
        correction_reason: "required_cross_object_identity_must_use_connection",
      });

    expect(first).toBe(ACQUISITION_PLANNING_INSTRUCTION);
    expect(correction).toBe(
      `${ACQUISITION_PLANNING_INSTRUCTION} ${ACQUISITION_REQUIRED_IDENTITY_REPLAN_INSTRUCTION}`,
    );
    expect(correction).toContain("preserve every requested business area");
    expect(correction).toContain(
      "each distinct reusable person or organisation",
    );
    expect(correction).toContain("explicit naming is a floor, not a ceiling");
    expect(correction).toContain("minimal inferred linking structure");
    expect(correction).toContain("through Connections");
    expect(acquisitionPlanningTaskV1.key).toBe("acquisition_workspace_plan_v1");
    expect(acquisitionRequiredIdentityCorrectionTaskV1).toMatchObject({
      key: "acquisition_required_identity_correction_v1",
      policyKey: ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
    });
    expect(openAiAcquisitionRequiredIdentityCorrectionPolicy).toMatchObject({
      key: ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
      providerKey: "openai",
      modelKey: "gpt-5.6-sol",
      reasoningEffort: "medium",
      serviceTier: "auto",
      timeoutMs: OPENAI_ACQUISITION_CORRECTION_TIMEOUT_MS,
      inputMicrousdPerMillion: 5_000_000,
      outputMicrousdPerMillion: 30_000_000,
      maxAttempts: 1,
    });
    expect(firstInput).not.toHaveProperty("correction_reason");
    expect(() =>
      acquisitionPlanningInputSchema.parse({
        ...firstInput,
        correction_reason: "required_cross_object_identity_must_use_connection",
      }),
    ).toThrow();
    expect(correctionInput.correction_reason).toBe(
      "required_cross_object_identity_must_use_connection",
    );
  });

  it("fixes correction qualification at eight scenarios and three repetitions", async () => {
    expect(ACQUISITION_CORRECTION_QUALIFICATION_REPETITIONS).toBe(3);
    expect(ACQUISITION_CORRECTION_QUALIFICATION_EXECUTIONS).toBe(24);
    expect(() =>
      assertAcquisitionCorrectionQualificationSubject(),
    ).not.toThrow();
    await expect(
      runLiveAcquisitionCorrectionQualification({ AI_PROVIDER: "disabled" }),
    ).resolves.toEqual({ ran: false, passed: false });
  });

  it("keeps one owner build reservation around both bounded planning executions", () => {
    const source = readFileSync(
      new URL("../src/core/acquisition/service.ts", import.meta.url),
      "utf8",
    );
    const submission = source.slice(
      source.indexOf("export async function createOrRegenerateProposal"),
      source.indexOf("export async function acceptAcquisitionSetup"),
    );
    const candidate = source.slice(
      source.indexOf("export async function generateCandidate"),
      source.indexOf("async function writeClarificationState"),
    );

    expect(submission.match(/reserveAttempt\(category\)/g)).toHaveLength(1);
    expect(submission.match(/generateCandidate\(/g)).toHaveLength(1);
    expect(candidate).not.toContain("reserveAttempt(");
    expect(candidate).toContain("correction_plan_attempted");
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

  it("treats clear operational requests as enough for a minimal workspace", () => {
    expect(ACQUISITION_PLANNING_INSTRUCTION).toContain(
      "A clear business type plus a clear operational problem",
    );
    expect(ACQUISITION_PLANNING_INSTRUCTION).toContain(
      "Do not return needs_more_detail merely because the owner has not specified exact Fields",
    );
    expect(ACQUISITION_PLANNING_INSTRUCTION).toContain(
      "Keep uncertain extras out and propose the smallest useful internal starting point.",
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
