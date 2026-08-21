import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.restoreAllMocks();
});

import type { AiExecutionResult } from "../src/ai/execution";
import { AiExecutionError } from "../src/ai/errors";
import type { AcquisitionExecutionCore } from "../src/ai/acquisition-planning/runtime";
import { runAcquisitionHardGateScenario } from "../src/ai/evaluation/acquisition/live";
import { runAcquisitionCorrectionQualificationScenario } from "../src/ai/evaluation/acquisition/correction-qualification-live";
import { acquisitionEvaluationScenarios } from "../src/ai/evaluation/acquisition/scenarios";
import { generateCandidate } from "../src/core/acquisition/service";
import { interpretAcquisitionRequest } from "../src/core/acquisition/interpreter";
import { acquisitionBuildPayloadSchema } from "../src/core/acquisition/schemas";
import {
  analyzeAcquisitionCandidateRecovery,
  attemptAcquisitionCandidateRecovery,
  applyAcquisitionScopedFieldRepair,
  recoverAcquisitionCandidate,
} from "../src/core/acquisition/recovery";
import { buildAcquisitionRequiredIdentityRepairManifest } from "../src/core/acquisition/scoped-repair";
import { createScopedCorrectionQualificationFixture } from "../src/ai/evaluation/acquisition/scoped-correction-fixture";
import { composeStarterComposition } from "../src/core/acquisition/composer";
import {
  formConfigSchema,
  parseViewConfig,
} from "../src/core/experience/schemas";
import {
  AcquisitionCandidateQualityError,
  findAcquisitionCandidateMechanicalRepairAnalysis,
  validateAcquisitionCandidate,
} from "../src/core/acquisition/quality";
import type {
  AcquisitionPlanningOutput,
  AcquisitionReadyPlan,
  AcquisitionRequiredIdentityCorrectionOutput,
} from "../src/ai/acquisition-planning/schemas";

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
  output:
    | AcquisitionPlanningOutput
    | AcquisitionRequiredIdentityCorrectionOutput
    | Error,
): AcquisitionExecutionCore & {
  calls: number;
  inputs: readonly unknown[];
  taskKeys: readonly string[];
} {
  return executionForPlans([output]);
}

function executionForPlans(
  outputs: readonly (
    | AcquisitionPlanningOutput
    | AcquisitionRequiredIdentityCorrectionOutput
    | Error
  )[],
): AcquisitionExecutionCore & {
  calls: number;
  inputs: readonly unknown[];
  taskKeys: readonly string[];
} {
  const state: { calls: number; inputs: unknown[]; taskKeys: string[] } = {
    calls: 0,
    inputs: [],
    taskKeys: [],
  };
  return {
    get calls() {
      return state.calls;
    },
    get inputs() {
      return state.inputs;
    },
    get taskKeys() {
      return state.taskKeys;
    },
    async execute(taskKey, input) {
      state.calls += 1;
      state.inputs.push(input);
      state.taskKeys.push(taskKey);
      const output = outputs[state.calls - 1];
      if (!output)
        throw new Error("Unexpected acquisition planning execution.");
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

function scopedRepair(fieldKey = "customer_name") {
  return {
    schema_version: 1 as const,
    action: "remove_fields" as const,
    fields: [{ object_key: "job", field_key: fieldKey }],
  } satisfies AcquisitionRequiredIdentityCorrectionOutput;
}

function carpenterPlan(
  options: {
    crossObjectLeakage?: boolean;
    crossObjectLeakageLabel?: string;
    crossObjectLeakageRequired?: boolean;
    relationshipScalarDuplicate?: boolean;
    workerRoleOnJob?: boolean;
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
    ...(options.workerRoleOnJob
      ? [
          {
            label: "Worker role",
            field_type: "short_text" as const,
            required: false,
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

function relatedFieldEquivalencePlan(options: {
  relatedTable: "Customer" | "Worker";
  relatedFieldLabel: string;
  candidateFieldLabel: string;
  fieldType: "short_text" | "email" | "phone" | "long_text";
  replaceRelatedFieldLabel?: string;
  candidateRequired?: boolean;
  additionalCandidateFieldLabel?: string;
}): AcquisitionReadyPlan {
  const plan = carpenterPlan() as AcquisitionReadyPlan;
  const field = (label: string, required: boolean) => ({
    label,
    field_type: options.fieldType,
    required,
    options: null,
    currency: null,
  });
  return {
    ...plan,
    tables: plan.tables.map((table) => {
      if (table.singular_name === options.relatedTable) {
        const replaced = options.replaceRelatedFieldLabel
          ? table.fields.map((candidate) =>
              candidate.label === options.replaceRelatedFieldLabel
                ? field(options.relatedFieldLabel, candidate.required)
                : candidate,
            )
          : [...table.fields, field(options.relatedFieldLabel, false)];
        return { ...table, fields: replaced };
      }
      if (table.singular_name !== "Job") return table;
      return {
        ...table,
        fields: [
          ...table.fields,
          field(
            options.candidateFieldLabel,
            options.candidateRequired ?? false,
          ),
          ...(options.additionalCandidateFieldLabel
            ? [field(options.additionalCandidateFieldLabel, false)]
            : []),
        ],
      };
    }),
  };
}

async function interpretedCandidate(
  plan: AcquisitionReadyPlan,
): Promise<ReturnType<typeof acquisitionBuildPayloadSchema.parse>> {
  return interpretAcquisitionRequest(
    "jobs",
    carpenterRequest,
    executionForPlan(plan),
    { validate: false },
  );
}

function crossObjectQualityError(): AcquisitionCandidateQualityError {
  return new AcquisitionCandidateQualityError(
    "cross_object_field_leakage",
    "bounded cross-object test failure",
  );
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
  it("builds a sanitized locked manifest and applies only an allow-listed Field repair", () => {
    const starter = composeStarterComposition("jobs", carpenterRequest);
    const jobTitle = starter.operations.find(
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "job" &&
        operation.key === "title",
    );
    if (!jobTitle || jobTitle.op !== "set_field") {
      throw new Error("The jobs starter must expose a job title field.");
    }
    const candidate = acquisitionBuildPayloadSchema.parse({
      proposal: { ...starter.proposal, source: "tailored" },
      operations: [
        ...starter.operations,
        {
          ...jobTitle,
          key: "customer_name",
          label: "Customer name",
          required: true,
        },
        {
          ...jobTitle,
          key: "worker_role",
          label: "Worker role",
          required: false,
        },
      ],
    });
    const manifest = buildAcquisitionRequiredIdentityRepairManifest(
      candidate,
      "cross_object_field_leakage",
      "required_field",
    );

    expect(manifest).not.toHaveProperty("owner_request");
    expect(manifest).not.toHaveProperty("raw_model_output");
    expect(JSON.stringify(manifest)).not.toMatch(
      /record|credential|reasoning/i,
    );
    expect(
      manifest.owner_scope.business_areas.map(({ object_key }) => object_key),
    ).toEqual(["customer", "job", "quote", "task"]);
    expect(manifest.affected_fields).toEqual([
      expect.objectContaining({
        object_key: "job",
        field_key: "customer_name",
        required: true,
      }),
    ]);
    expect(manifest.owner_scope.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_object_key: "customer",
          target_object_key: "job",
          cardinality: "one_to_many",
        }),
      ]),
    );
    expect(manifest.owner_scope.unsupported_requirements).toEqual(
      starter.proposal.not_included,
    );

    const repaired = applyAcquisitionScopedFieldRepair(candidate, manifest, {
      schema_version: 1,
      action: "remove_fields",
      fields: [{ object_key: "job", field_key: "customer_name" }],
    });
    expect(() => validateAcquisitionCandidate(repaired)).not.toThrow();
    expect(
      repaired.operations.some(
        (operation) =>
          operation.op === "set_field" &&
          operation.object_key === "job" &&
          operation.key === "worker_role",
      ),
    ).toBe(true);
    expect(
      repaired.operations.some(
        (operation) =>
          operation.op === "set_field" &&
          operation.object_key === "job" &&
          operation.key === "customer_name",
      ),
    ).toBe(false);
    expect(
      repaired.operations.find(
        (operation) =>
          operation.op === "set_field" &&
          operation.object_key === "job" &&
          operation.key === "title",
      ),
    ).toMatchObject({ required: true });

    expect(() =>
      applyAcquisitionScopedFieldRepair(candidate, manifest, {
        schema_version: 1,
        action: "remove_fields",
        fields: [{ object_key: "job", field_key: "title" }],
      }),
    ).toThrow();
    expect(() =>
      applyAcquisitionScopedFieldRepair(
        candidate,
        {
          ...manifest,
          owner_scope: {
            ...manifest.owner_scope,
            connections: manifest.owner_scope.connections.map((connection) => ({
              ...connection,
              cardinality: "many_to_many",
            })),
          },
        },
        {
          schema_version: 1,
          action: "remove_fields",
          fields: [{ object_key: "job", field_key: "customer_name" }],
        },
      ),
    ).toThrow();
    expect(() =>
      applyAcquisitionScopedFieldRepair(
        candidate,
        {
          ...manifest,
          owner_scope: {
            ...manifest.owner_scope,
            business_areas: manifest.owner_scope.business_areas.filter(
              ({ object_key }) => object_key !== "quote",
            ),
          },
        },
        {
          schema_version: 1,
          action: "remove_fields",
          fields: [{ object_key: "job", field_key: "customer_name" }],
        },
      ),
    ).toThrow();
    expect(() =>
      applyAcquisitionScopedFieldRepair(
        candidate,
        {
          ...manifest,
          owner_scope: {
            ...manifest.owner_scope,
            unsupported_requirements: [
              ...manifest.owner_scope.unsupported_requirements,
              "Unexpected unsupported requirement",
            ],
          },
        },
        {
          schema_version: 1,
          action: "remove_fields",
          fields: [{ object_key: "job", field_key: "customer_name" }],
        },
      ),
    ).toThrow();
    expect(() =>
      buildAcquisitionRequiredIdentityRepairManifest(
        candidate,
        "relationship_scalar_duplication",
        "required_field",
      ),
    ).toThrow();
  });

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

  it("does not pre-delete a required exact cross-object identity Field", async () => {
    const execution = executionForPlan(
      carpenterPlan({
        crossObjectLeakage: true,
        crossObjectLeakageRequired: true,
      }),
    );
    const canonicalisations: number[] = [];

    const payload = await interpretAcquisitionRequest(
      "jobs",
      carpenterRequest,
      execution,
      {
        validate: false,
        onCanonicalisation: ({ removedFieldCount }) => {
          canonicalisations.push(removedFieldCount);
        },
      },
    );

    expect(execution.calls).toBe(1);
    expect(
      payload.operations.find(
        (operation) =>
          operation.op === "set_field" && operation.label === "Customer name",
      ),
    ).toMatchObject({ required: true });
    expect(canonicalisations).toEqual([]);

    const hardExecution = executionForPlans([
      carpenterPlan({
        crossObjectLeakage: true,
        crossObjectLeakageRequired: true,
      }),
      scopedRepair(),
    ]);
    await expect(
      runAcquisitionHardGateScenario(carpenterScenario, hardExecution),
    ).resolves.toMatchObject({
      hard_passed: true,
      correction_plan_attempted: true,
      correction_plan_succeeded: true,
    });
    expect(hardExecution.calls).toBe(2);
    expect(hardExecution.taskKeys).toEqual([
      "acquisition_workspace_plan_v1",
      "acquisition_required_identity_correction_v1",
    ]);
    expect(hardExecution.inputs).toHaveLength(2);
    expect(hardExecution.inputs[1]).toMatchObject({
      schema_version: 1,
      correction_reason: "required_cross_object_identity_must_use_connection",
      validator_code: "cross_object_field_leakage",
      recovery_failure_code: "required_field",
      allowed_correction_scope: "remove_only_listed_identity_fields",
      affected_fields: [
        expect.objectContaining({
          object_key: "job",
          field_key: "customer_name",
          required: true,
        }),
      ],
    });
    expect(hardExecution.inputs[1]).not.toHaveProperty("owner_request");
    expect(hardExecution.inputs[1]).not.toHaveProperty("tables");
    expect(JSON.stringify(hardExecution.inputs[1])).not.toMatch(
      /operational|record|raw_output|reasoning|credential/i,
    );

    const productionExecution = executionForPlans([
      carpenterPlan({
        crossObjectLeakage: true,
        crossObjectLeakageRequired: true,
      }),
      scopedRepair(),
    ]);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(
      generateCandidate("jobs", carpenterRequest, decisions, {
        execution: productionExecution,
      }),
    ).resolves.toMatchObject({ proposal: { source: "tailored" } });
    expect(productionExecution.calls).toBe(2);
    expect(loggedEvents(info)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "repair_failed",
          recovery_failure_code: "required_field",
        }),
        expect.objectContaining({ event: "correction_plan_attempted" }),
        expect.objectContaining({ event: "correction_plan_tailored_success" }),
      ]),
    );
    info.mockRestore();
  });

  it("runs correction qualification through the dedicated task and full deterministic gates", async () => {
    const execution = executionForPlan(scopedRepair());

    await expect(
      runAcquisitionCorrectionQualificationScenario(
        carpenterScenario,
        execution,
      ),
    ).resolves.toMatchObject({
      hard_passed: true,
      quality_passed: true,
      hard_findings: [],
      quality_findings: [],
    });
    expect(execution.calls).toBe(1);
    expect(execution.taskKeys).toEqual([
      "acquisition_required_identity_correction_v1",
    ]);
  });

  it("keeps every correction qualification scenario inside its locked fixture scope", async () => {
    for (const scenario of acquisitionEvaluationScenarios) {
      const candidate = createScopedCorrectionQualificationFixture(scenario);
      const manifest = buildAcquisitionRequiredIdentityRepairManifest(
        candidate,
        "cross_object_field_leakage",
        "required_field",
      );
      const execution = executionForPlan({
        schema_version: 1,
        action: "remove_fields",
        fields: manifest.affected_fields.map(({ object_key, field_key }) => ({
          object_key,
          field_key,
        })),
      });
      const result = await runAcquisitionCorrectionQualificationScenario(
        scenario,
        execution,
      );
      expect(result).toMatchObject({
        hard_passed: true,
        quality_passed: true,
        hard_findings: [],
        quality_findings: [],
      });
      expect(execution.inputs[0]).not.toHaveProperty("owner_request");
      expect(execution.inputs[0]).not.toHaveProperty("tables");
    }
  });

  it("canonicalises an optional exact identity without reporting raw first-pass success", async () => {
    const execution = executionForPlan(
      carpenterPlan({ crossObjectLeakage: true }),
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
    const eventNames = loggedEvents(info).map((event) => event.event);
    expect(eventNames).toContain("precomposition_canonicalisation_applied");
    expect(eventNames).not.toContain("first_pass_tailored_success");
    expect(eventNames).not.toContain("repair_attempted");
    expect(eventNames).not.toContain("final_fallback");
    info.mockRestore();
  });

  it("preserves richer related information for the authoritative validator", async () => {
    const result = await runAcquisitionHardGateScenario(
      carpenterScenario,
      executionForPlan(
        carpenterPlan({
          crossObjectLeakage: true,
          crossObjectLeakageLabel: "Customer site address",
        }),
      ),
    );

    expect(result).toMatchObject({
      hard_passed: false,
      diagnostic_code: "quality_cross_object_field_leakage",
      recovery_failure_code: "no_mechanical_repair_fields",
    });

    const workerExecution = executionForPlan(
      carpenterPlan({ workerRoleOnJob: true }),
    );
    const workerPayload = await generateCandidate(
      "jobs",
      carpenterRequest,
      decisions,
      { execution: workerExecution },
    );
    expect(workerPayload.proposal.source).toBe("tailored");
    expect(
      workerPayload.operations.some(
        (operation) =>
          operation.op === "set_field" && operation.label === "Worker role",
      ),
    ).toBe(true);
    expect(workerExecution.calls).toBe(1);
  });

  it.each([
    [
      "Customer full name",
      relatedFieldEquivalencePlan({
        relatedTable: "Customer",
        relatedFieldLabel: "Full name",
        candidateFieldLabel: "Customer full name",
        fieldType: "short_text",
        replaceRelatedFieldLabel: "Name",
      }),
    ],
    [
      "Worker phone number",
      relatedFieldEquivalencePlan({
        relatedTable: "Worker",
        relatedFieldLabel: "Phone number",
        candidateFieldLabel: "Worker phone number",
        fieldType: "phone",
      }),
    ],
  ])(
    "recovers the optional exact related-Field equivalent %s only after composition",
    async (_label, plan) => {
      const info = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      const payload = await generateCandidate(
        "jobs",
        carpenterRequest,
        decisions,
        { execution: executionForPlan(plan) },
      );

      expect(payload.proposal.source).toBe("tailored");
      expect(() => validateAcquisitionCandidate(payload)).not.toThrow();
      const events = loggedEvents(info);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "repair_succeeded",
            quality_flagged_field_count: 1,
            mechanical_repair_field_count: 1,
            related_field_equivalence_match_count: 1,
          }),
        ]),
      );
      expect(events.map(({ event }) => event)).not.toContain(
        "precomposition_canonicalisation_applied",
      );
    },
  );

  it("retains the existing exact Customer email address canonicalisation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const payload = await generateCandidate(
      "jobs",
      carpenterRequest,
      decisions,
      {
        execution: executionForPlan(
          relatedFieldEquivalencePlan({
            relatedTable: "Customer",
            relatedFieldLabel: "Email address",
            candidateFieldLabel: "Customer email address",
            fieldType: "email",
            replaceRelatedFieldLabel: "Email",
          }),
        ),
      },
    );

    expect(payload.proposal.source).toBe("tailored");
    expect(loggedEvents(info)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "precomposition_canonicalisation_applied",
          removed_field_count: 1,
        }),
      ]),
    );
  });

  it.each([
    ["Customer site address", "Address", "short_text"],
    ["Customer delivery address", "Address", "short_text"],
    ["Customer shipping address", "Address", "short_text"],
    ["Customer billing contact", "Contact", "short_text"],
    ["Customer emergency contact", "Contact", "short_text"],
    ["Customer snapshot name", "Name", "short_text"],
    ["Customer historical name", "Name", "short_text"],
    ["Worker role", "Role", "short_text"],
    ["Customer full name", "Full name", "long_text"],
  ] as const)(
    "preserves contextual, richer, or wrong-type identity %s",
    async (candidateFieldLabel, relatedFieldLabel, fieldType) => {
      const candidate = await interpretedCandidate(
        relatedFieldEquivalencePlan({
          relatedTable: candidateFieldLabel.startsWith("Worker")
            ? "Worker"
            : "Customer",
          relatedFieldLabel,
          candidateFieldLabel,
          fieldType,
          ...(relatedFieldLabel === "Name"
            ? { replaceRelatedFieldLabel: "Name" }
            : {}),
        }),
      );
      const analysis = findAcquisitionCandidateMechanicalRepairAnalysis(
        candidate,
        "cross_object_field_leakage",
      );

      expect(analysis.fields).toEqual([]);
      expect(analysis.related_field_equivalence_match_count).toBe(0);
    },
  );

  it("refuses settings and key conflicts even when labels and types match", async () => {
    const candidate = await interpretedCandidate(
      relatedFieldEquivalencePlan({
        relatedTable: "Customer",
        relatedFieldLabel: "Full name",
        candidateFieldLabel: "Customer full name",
        fieldType: "short_text",
        replaceRelatedFieldLabel: "Name",
      }),
    );
    const settingsMismatch = acquisitionBuildPayloadSchema.parse({
      ...candidate,
      operations: candidate.operations.map((operation) =>
        operation.op === "set_field" &&
        operation.object_key === "job" &&
        operation.label === "Customer full name"
          ? { ...operation, settings_json: { format: "alternate" } }
          : operation,
      ),
    });
    const keyConflict = acquisitionBuildPayloadSchema.parse({
      ...candidate,
      operations: candidate.operations.map((operation) =>
        operation.op === "set_field" &&
        operation.object_key === "job" &&
        operation.label === "Customer full name"
          ? { ...operation, key: "customer_role" }
          : operation,
      ),
    });

    for (const payload of [settingsMismatch, keyConflict]) {
      expect(
        findAcquisitionCandidateMechanicalRepairAnalysis(
          payload,
          "cross_object_field_leakage",
        ),
      ).toMatchObject({
        mechanical_repair_field_count: 0,
        related_field_equivalence_match_count: 0,
      });
    }
  });

  it("refuses ambiguous related Fields, Objects, and Connections", async () => {
    const candidate = await interpretedCandidate(
      relatedFieldEquivalencePlan({
        relatedTable: "Customer",
        relatedFieldLabel: "Full name",
        candidateFieldLabel: "Customer full name",
        fieldType: "short_text",
        replaceRelatedFieldLabel: "Name",
      }),
    );
    const relatedField = candidate.operations.find(
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "customer" &&
        operation.label === "Full name",
    );
    const connection = candidate.operations.find(
      (operation) =>
        operation.op === "set_relationship" &&
        [operation.source_object_key, operation.target_object_key].includes(
          "customer",
        ) &&
        [operation.source_object_key, operation.target_object_key].includes(
          "job",
        ),
    );
    if (
      !relatedField ||
      relatedField.op !== "set_field" ||
      !connection ||
      connection.op !== "set_relationship"
    ) {
      throw new Error("Fixture is incomplete.");
    }
    const multipleFields = acquisitionBuildPayloadSchema.parse({
      ...candidate,
      operations: [
        ...candidate.operations,
        {
          ...relatedField,
          key: "customer_full_name",
          label: "Customer full name",
          position: relatedField.position + 20,
        },
      ],
    });
    const multipleConnections = acquisitionBuildPayloadSchema.parse({
      ...candidate,
      operations: [
        ...candidate.operations,
        {
          ...connection,
          key: "secondary_customer_job",
          source_label: "has secondary jobs",
          target_label: "secondary customer",
        },
      ],
    });
    const secondCustomer = candidate.operations.find(
      (operation) =>
        operation.op === "set_object" && operation.key === "customer",
    );
    if (!secondCustomer) throw new Error("Customer fixture is incomplete.");
    const multipleObjects = acquisitionBuildPayloadSchema.parse({
      ...candidate,
      operations: [
        ...candidate.operations,
        {
          ...secondCustomer,
          key: "customer_profile",
          singular_label: "Customer Profile",
          plural_label: "Customer Profiles",
        },
        {
          ...relatedField,
          object_key: "customer_profile",
          key: "full_name",
          position: 0,
        },
        {
          ...connection,
          key: "customer_profile_job",
          source_object_key: "customer_profile",
          source_label: "has jobs",
          target_label: "customer profile",
        },
      ],
    });

    for (const payload of [
      multipleFields,
      multipleConnections,
      multipleObjects,
    ]) {
      expect(
        findAcquisitionCandidateMechanicalRepairAnalysis(
          payload,
          "cross_object_field_leakage",
        ),
      ).toMatchObject({
        mechanical_repair_field_count: 0,
        related_field_equivalence_match_count: 0,
      });
    }
  });

  it("does not create required-Field correction eligibility", async () => {
    const plan = relatedFieldEquivalencePlan({
      relatedTable: "Customer",
      relatedFieldLabel: "Full name",
      candidateFieldLabel: "Customer full name",
      fieldType: "short_text",
      replaceRelatedFieldLabel: "Name",
      candidateRequired: true,
    });
    const candidate = await interpretedCandidate(plan);
    const analyzed = analyzeAcquisitionCandidateRecovery(
      candidate,
      crossObjectQualityError(),
    );

    expect(analyzed).toMatchObject({
      attempt: {
        status: "refused",
        failure_code: "no_mechanical_repair_fields",
      },
      diagnostics: {
        quality_flagged_field_count: 1,
        mechanical_repair_field_count: 0,
        related_field_equivalence_match_count: 0,
      },
    });
    await expect(
      runAcquisitionHardGateScenario(carpenterScenario, executionForPlan(plan)),
    ).resolves.toMatchObject({
      hard_passed: false,
      recovery_failure_code: "no_mechanical_repair_fields",
      correction_plan_attempted: false,
    });
  });

  it("keeps Form and View refusal safeguards authoritative", async () => {
    const candidate = await interpretedCandidate(
      relatedFieldEquivalencePlan({
        relatedTable: "Customer",
        relatedFieldLabel: "Full name",
        candidateFieldLabel: "Customer full name",
        fieldType: "short_text",
        replaceRelatedFieldLabel: "Name",
      }),
    );
    const duplicate = candidate.operations.find(
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "job" &&
        operation.label === "Customer full name",
    );
    if (!duplicate) throw new Error("Duplicate fixture is incomplete.");
    let changedForm = false;
    const invalidForm = acquisitionBuildPayloadSchema.parse({
      ...candidate,
      operations: candidate.operations.map((operation) => {
        if (
          changedForm ||
          operation.op !== "set_form" ||
          operation.object_key !== "job"
        ) {
          return operation;
        }
        changedForm = true;
        const config = formConfigSchema.parse(operation.config_json);
        return {
          ...operation,
          config_json: {
            ...config,
            fields: config.fields.filter(
              (field) => field.field === duplicate.key,
            ),
          },
        };
      }),
    });
    let changedView = false;
    const invalidView = acquisitionBuildPayloadSchema.parse({
      ...candidate,
      operations: candidate.operations.map((operation) => {
        if (
          changedView ||
          operation.op !== "set_view" ||
          operation.object_key !== "job" ||
          operation.view_type !== "table"
        ) {
          return operation;
        }
        const config = parseViewConfig(
          operation.view_type,
          operation.config_json,
        );
        if (!("columns" in config)) return operation;
        const column = config.columns.find(
          (candidateColumn) =>
            candidateColumn.kind === "field" &&
            candidateColumn.field_key === duplicate.key,
        );
        if (!column) return operation;
        changedView = true;
        return {
          ...operation,
          config_json: {
            ...config,
            columns: [column],
            fields: [duplicate.key],
            title_field: duplicate.key,
          },
        };
      }),
    });

    expect(
      attemptAcquisitionCandidateRecovery(
        invalidForm,
        crossObjectQualityError(),
      ),
    ).toEqual({ status: "refused", failure_code: "form_would_be_invalid" });
    expect(
      attemptAcquisitionCandidateRecovery(
        invalidView,
        crossObjectQualityError(),
      ),
    ).toEqual({ status: "refused", failure_code: "view_would_be_invalid" });
  });

  it("fails closed when complete validation finds richer information after equivalence removal", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const payload = await generateCandidate(
      "jobs",
      carpenterRequest,
      decisions,
      {
        execution: executionForPlan(
          relatedFieldEquivalencePlan({
            relatedTable: "Customer",
            relatedFieldLabel: "Full name",
            candidateFieldLabel: "Customer full name",
            fieldType: "short_text",
            replaceRelatedFieldLabel: "Name",
            additionalCandidateFieldLabel: "Customer site address",
          }),
        ),
      },
    );

    expect(payload.proposal.source).toBe("fallback");
    expect(loggedEvents(info)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "repair_failed",
          recovery_failure_code:
            "second_quality_failure:cross_object_field_leakage",
          quality_flagged_field_count: 2,
          mechanical_repair_field_count: 1,
          related_field_equivalence_match_count: 1,
        }),
      ]),
    );
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

  it("falls back after one failed recovery pass without replanning for another failure class", async () => {
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

  it("fails closed after an invalid correction plan and cannot execute a third provider call", async () => {
    const requiredLeak = carpenterPlan({
      crossObjectLeakage: true,
      crossObjectLeakageRequired: true,
    });
    const execution = executionForPlans([requiredLeak, requiredLeak]);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const payload = await generateCandidate(
      "jobs",
      carpenterRequest,
      decisions,
      { execution },
    );

    expect(payload.proposal.source).toBe("fallback");
    expect(execution.calls).toBe(2);
    expect(loggedEvents(info)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "correction_plan_attempted" }),
        expect.objectContaining({ event: "correction_plan_failed" }),
        expect.objectContaining({ event: "final_fallback" }),
      ]),
    );

    const hardExecution = executionForPlans([requiredLeak, requiredLeak]);
    await expect(
      runAcquisitionHardGateScenario(carpenterScenario, hardExecution),
    ).resolves.toMatchObject({
      hard_passed: false,
      correction_plan_attempted: true,
      correction_plan_succeeded: false,
      recovery_failure_code: "required_field",
    });
    expect(hardExecution.calls).toBe(2);
    info.mockRestore();
  });

  it("falls back after a correction-plan provider failure without a third execution", async () => {
    const execution = executionForPlans([
      carpenterPlan({
        crossObjectLeakage: true,
        crossObjectLeakageRequired: true,
      }),
      new AiExecutionError("ai_provider_unavailable"),
    ]);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      generateCandidate("jobs", carpenterRequest, decisions, { execution }),
    ).resolves.toMatchObject({ proposal: { source: "fallback" } });
    expect(execution.calls).toBe(2);
    expect(loggedEvents(info)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "correction_plan_failed",
          reason: "planning_unavailable",
        }),
        expect.objectContaining({ event: "final_fallback" }),
      ]),
    );
    info.mockRestore();
  });

  it.each([
    "ai_disabled",
    "ai_provider_unavailable",
    "ai_rate_limited",
    "ai_timeout",
    "ai_output_invalid",
    "ai_refused",
    "ai_content_filtered",
  ] as const)("does not replan for provider failure %s", async (code) => {
    const execution = executionForPlan(new AiExecutionError(code));
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
    expect(eventNames).not.toContain("correction_plan_attempted");
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
    expect(
      attemptAcquisitionCandidateRecovery(
        starter,
        new AcquisitionCandidateQualityError(
          "duplicate_object_label",
          "non-allow-listed test failure",
        ),
      ),
    ).toEqual({ status: "not_applicable" });

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
