import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.restoreAllMocks();
});

import type { AiExecutionResult } from "../src/ai/execution";
import { AiExecutionError } from "../src/ai/errors";
import type { AcquisitionExecutionCore } from "../src/ai/acquisition-planning/runtime";
import { runAcquisitionHardGateScenario } from "../src/ai/evaluation/acquisition/live";
import { generateCandidate } from "../src/core/acquisition/service";
import { acquisitionBuildPayloadSchema } from "../src/core/acquisition/schemas";
import {
  attemptAcquisitionCandidateRecovery,
  recoverAcquisitionCandidate,
} from "../src/core/acquisition/recovery";
import { composeStarterComposition } from "../src/core/acquisition/composer";
import {
  AcquisitionCandidateQualityError,
  validateAcquisitionCandidate,
} from "../src/core/acquisition/quality";
import type { AcquisitionPlanningOutput } from "../src/ai/acquisition-planning/schemas";

const carpenterRequest =
  "I’m a carpenter who needs to be able to track ongoing jobs, quotes handed to customers, which quotes need following up and which workers are working on which job";

const carpenterScenario = {
  id: "deterministic_carpenter_hard_gate",
  category: "jobs",
  request: carpenterRequest,
  requiredConcepts: [],
} as const;

const decisions = {
  onlineBooking: null,
  usesServices: null,
  capacityPerSlot: 1,
  publicEnquiry: null,
} as const;

function executionForPlan(
  output: AcquisitionPlanningOutput | Error,
): AcquisitionExecutionCore & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async execute() {
      state.calls += 1;
      if (output instanceof Error) throw output;
      return {
        output,
        metadata: {
          taskKey: "acquisition_workspace_plan_v1",
          taskVersion: 1,
          purposeLabel: "test",
          providerKey: "test",
          modelKey: "test",
          attempts: 1,
          usage: { inputTokens: 1, outputTokens: 1, complete: true },
        },
        accounting: {
          attemptsStarted: 1,
          inputTokens: 1,
          outputTokens: 1,
          usageReported: true,
          usageComplete: true,
          providerInvocationStarted: true,
          failureBeforeProviderInvocation: false,
        },
      } satisfies AiExecutionResult;
    },
  };
}

function carpenterPlan(
  options: {
    crossObjectLeakage?: boolean;
    crossObjectLeakageLabel?: string;
    crossObjectLeakageRequired?: boolean;
    relationshipScalarDuplicate?: boolean;
  } = {},
): AcquisitionPlanningOutput {
  const jobFields = [
    {
      label: "Name",
      field_type: "short_text" as const,
      required: true,
      options: null,
      currency: null,
    },
    ...(options.crossObjectLeakage
      ? [
          {
            label: options.crossObjectLeakageLabel ?? "Customer name",
            field_type: "short_text" as const,
            required: options.crossObjectLeakageRequired ?? false,
            options: null,
            currency: null,
          },
        ]
      : []),
  ];
  return {
    schema_version: 1,
    state: "ready",
    understanding:
      "You need one clear place to keep jobs and related work organised.",
    why: "These connected areas keep the work easy to follow.",
    tables: [
      {
        reference: "table_1",
        singular_name: "Customer",
        plural_name: "Customers",
        purpose: "People and contact details for the work.",
        fields: [
          {
            label: "Name",
            field_type: "short_text",
            required: true,
            options: null,
            currency: null,
          },
          {
            label: "Email",
            field_type: "email",
            required: false,
            options: null,
            currency: null,
          },
          ...(options.relationshipScalarDuplicate
            ? [
                {
                  label: "Job",
                  field_type: "short_text" as const,
                  required: false,
                  options: null,
                  currency: null,
                },
              ]
            : []),
        ],
      },
      {
        reference: "table_2",
        singular_name: "Job",
        plural_name: "Jobs",
        purpose: "Ongoing work and its progress.",
        fields: jobFields,
      },
      {
        reference: "table_3",
        singular_name: "Quote",
        plural_name: "Quotes",
        purpose: "Quotes handed to customers and their follow-up.",
        fields: [
          {
            label: "Name",
            field_type: "short_text",
            required: true,
            options: null,
            currency: null,
          },
          {
            label: "Follow-up needed",
            field_type: "boolean",
            required: false,
            options: null,
            currency: null,
          },
        ],
      },
      {
        reference: "table_4",
        singular_name: "Worker",
        plural_name: "Workers",
        purpose: "Workers assigned to jobs.",
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
    connections: [
      {
        source_table_reference: "table_1",
        target_table_reference: "table_2",
        source_label: "has jobs",
        target_label: "customer",
        cardinality: "one_to_many",
        explanation: "Customers can have several Jobs.",
      },
      {
        source_table_reference: "table_1",
        target_table_reference: "table_3",
        source_label: "has quotes",
        target_label: "customer",
        cardinality: "one_to_many",
        explanation: "Customers can have several Quotes.",
      },
      {
        source_table_reference: "table_4",
        target_table_reference: "table_2",
        source_label: "works on",
        target_label: "worker",
        cardinality: "many_to_many",
        explanation:
          "Workers can be connected to the Jobs they are working on.",
      },
    ],
    primary_table_reference: "table_2",
    unsupported_requirements: [],
  };
}

function loggedEvents(
  spy: ReturnType<typeof vi.spyOn>,
): Array<Record<string, unknown>> {
  return spy.mock.calls.flatMap(([value]) => {
    try {
      return [JSON.parse(String(value)) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

describe("bounded acquisition quality recovery", () => {
  it("surfaces a finite required-field refusal for an already-composed candidate", () => {
    const starter = composeStarterComposition("jobs", carpenterRequest);
    const requiredLeak = {
      ...starter.operations.find(
        (operation) =>
          operation.op === "set_field" &&
          operation.object_key === "job" &&
          operation.key === "title",
      )!,
      key: "customer_name",
      label: "Customer name",
      required: true,
      position: 10,
    };
    const candidate = acquisitionBuildPayloadSchema.parse({
      ...starter,
      proposal: { ...starter.proposal, source: "tailored" },
      operations: [...starter.operations, requiredLeak],
    });
    let qualityError: unknown;
    try {
      validateAcquisitionCandidate(candidate);
    } catch (error) {
      qualityError = error;
    }

    expect(qualityError).toMatchObject({
      code: "cross_object_field_leakage",
    });
    expect(
      attemptAcquisitionCandidateRecovery(candidate, qualityError),
    ).toEqual({ status: "refused", failure_code: "required_field" });
  });

  it("fails the hard gate when recovery fails instead of accepting fallback", async () => {
    const execution = executionForPlan(
      carpenterPlan({
        crossObjectLeakage: true,
        crossObjectLeakageLabel: "Customer preferred contact name",
        relationshipScalarDuplicate: true,
      }),
    );

    const result = await runAcquisitionHardGateScenario(
      carpenterScenario,
      execution,
    );

    expect(result).toMatchObject({
      hard_passed: false,
      quality_passed: true,
      hard_findings: [
        "production_composition_failed:quality_relationship_scalar_duplication",
      ],
      diagnostic_code: "quality_relationship_scalar_duplication",
      recovery_failure_code:
        "second_quality_failure:cross_object_field_leakage",
    });
    expect(execution.calls).toBe(1);
  });

  it("passes the hard gate only after recovery produces a fully valid tailored candidate", async () => {
    const execution = executionForPlan(
      carpenterPlan({ relationshipScalarDuplicate: true }),
    );

    const result = await runAcquisitionHardGateScenario(
      carpenterScenario,
      execution,
    );

    expect(result).toMatchObject({
      hard_passed: true,
      quality_passed: true,
      hard_findings: [],
      quality_findings: [],
    });
    expect(result.diagnostic_code).toBeUndefined();
    expect(execution.calls).toBe(1);
  });

  it("canonicalises a required cross-object identity leak before dependent surfaces are compiled", async () => {
    const execution = executionForPlan(
      carpenterPlan({
        crossObjectLeakage: true,
        crossObjectLeakageRequired: true,
      }),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const payload = await generateCandidate(
      "jobs",
      carpenterRequest,
      decisions,
      { execution },
    );

    expect(payload.proposal.source).toBe("tailored");
    expect(execution.calls).toBe(1);
    expect(() => validateAcquisitionCandidate(payload)).not.toThrow();
    expect(
      payload.operations.some(
        (operation) =>
          operation.op === "set_field" && operation.label === "Customer name",
      ),
    ).toBe(false);
    const events = loggedEvents(info);
    expect(events.map((event) => event.event)).toContain(
      "first_pass_tailored_success",
    );
    expect(events.map((event) => event.event)).not.toContain(
      "repair_attempted",
    );
    expect(events.map((event) => event.event)).not.toContain("final_fallback");
    expect(events.map((event) => event.event)).not.toContain("proposal_failed");
    info.mockRestore();
  });

  it("preserves richer related information and lets the validator reject it", async () => {
    const result = await runAcquisitionHardGateScenario(
      carpenterScenario,
      executionForPlan(
        carpenterPlan({
          crossObjectLeakage: true,
          crossObjectLeakageLabel: "Customer preferred contact name",
        }),
      ),
    );

    expect(result).toMatchObject({
      hard_passed: false,
      diagnostic_code: "quality_cross_object_field_leakage",
      recovery_failure_code: "no_mechanical_repair_fields",
    });
  });

  it("returns a valid first-pass tailored candidate without recovery", async () => {
    const execution = executionForPlan(carpenterPlan());
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const payload = await generateCandidate(
      "jobs",
      carpenterRequest,
      decisions,
      { execution },
    );

    expect(payload.proposal.source).toBe("tailored");
    expect(execution.calls).toBe(1);
    const eventNames = loggedEvents(info).map((event) => event.event);
    expect(eventNames).toContain("first_pass_tailored_success");
    expect(eventNames).not.toContain("repair_attempted");
    info.mockRestore();
  });

  it("falls back after one failed recovery pass and cannot execute a third provider call", async () => {
    const execution = executionForPlan(
      carpenterPlan({
        crossObjectLeakage: true,
        crossObjectLeakageLabel: "Customer preferred contact name",
        relationshipScalarDuplicate: true,
      }),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const payload = await generateCandidate(
      "jobs",
      carpenterRequest,
      decisions,
      { execution },
    );

    expect(payload.proposal.source).toBe("fallback");
    expect(execution.calls).toBe(1);
    const events = loggedEvents(info);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toContain("repair_attempted");
    expect(eventNames).toContain("repair_failed");
    expect(eventNames).toContain("final_fallback");
    expect(eventNames).toContain("proposal_failed");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "repair_failed",
          recovery_failure_code:
            "second_quality_failure:cross_object_field_leakage",
        }),
      ]),
    );
    info.mockRestore();
  });

  it("does not enter semantic recovery for provider failures", async () => {
    const execution = executionForPlan(
      new AiExecutionError("ai_provider_unavailable"),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const payload = await generateCandidate(
      "jobs",
      carpenterRequest,
      decisions,
      { execution },
    );

    expect(payload.proposal.source).toBe("fallback");
    expect(execution.calls).toBe(1);
    const eventNames = loggedEvents(info).map((event) => event.event);
    expect(eventNames).not.toContain("repair_attempted");
    expect(eventNames).toContain("final_fallback");
    info.mockRestore();
  });

  it("does not recover an unlisted candidate or a refinement call", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const starter = composeStarterComposition("jobs", carpenterRequest);
    const jobTitleTemplate = starter.operations.find(
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "job" &&
        operation.key === "title",
    );
    if (!jobTitleTemplate || jobTitleTemplate.op !== "set_field") {
      throw new Error("The jobs starter must expose a job title field.");
    }
    const semanticCandidate = acquisitionBuildPayloadSchema.parse({
      proposal: { ...starter.proposal, source: "tailored" },
      operations: [
        {
          ...jobTitleTemplate,
          key: "name",
          label: "Name",
          required: false,
          position: jobTitleTemplate.position + 1,
        },
        {
          ...jobTitleTemplate,
          key: "job_name",
          label: "Job name",
          required: false,
          position: jobTitleTemplate.position + 2,
        },
        ...starter.operations,
      ],
    });
    const badError = new AcquisitionCandidateQualityError(
      "cross_object_field_leakage",
      "bounded test failure",
    );
    const repaired = recoverAcquisitionCandidate(starter, badError);
    expect(repaired).toBeNull();
    expect(attemptAcquisitionCandidateRecovery(starter, badError)).toEqual({
      status: "refused",
      failure_code: "no_mechanical_repair_fields",
    });

    const semanticError = new AcquisitionCandidateQualityError(
      "semantically_redundant_field",
      "bounded semantic test failure",
    );
    const semanticRepair = recoverAcquisitionCandidate(
      semanticCandidate,
      semanticError,
    );
    expect(semanticRepair?.removed_field_count).toBe(1);
    expect(() =>
      validateAcquisitionCandidate(semanticRepair!.payload),
    ).not.toThrow();
    expect(
      semanticRepair!.payload.operations.some(
        (operation) =>
          operation.op === "set_field" &&
          operation.object_key === "job" &&
          operation.key === "name",
      ),
    ).toBe(false);

    const invalid = acquisitionBuildPayloadSchema.parse(starter);
    expect(() => validateAcquisitionCandidate(invalid)).not.toThrow();

    await expect(
      generateCandidate("jobs", carpenterRequest, decisions, {
        execution: executionForPlan(
          carpenterPlan({
            crossObjectLeakage: true,
            crossObjectLeakageLabel: "Customer preferred contact name",
          }),
        ),
        allowFallback: false,
        allowRecovery: false,
      }),
    ).rejects.toMatchObject({ code: "cross_object_field_leakage" });

    const needsMoreDetail = executionForPlan({
      schema_version: 1,
      state: "needs_more_detail",
      understanding: "I need a little more detail.",
      revision_prompt: "Describe the work you want to organise.",
    });
    await expect(
      generateCandidate("jobs", carpenterRequest, decisions, {
        execution: needsMoreDetail,
      }),
    ).resolves.toMatchObject({ proposal: { source: "fallback" } });
    expect(needsMoreDetail.calls).toBe(1);
  });
});
