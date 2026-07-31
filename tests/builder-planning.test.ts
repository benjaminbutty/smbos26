import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  AiAccountingStore,
  BusinessAiSettings,
} from "../src/ai/accounting/service";
import { createBusinessAiExecutionOrchestrator } from "../src/ai/business-execution";
import {
  projectAiBusinessModelContext,
  serializeAiBusinessModelContext,
  type AiBusinessContextSource,
} from "../src/ai/context/projector";
import type { StructuredAiProviderRequest } from "../src/ai/contracts";
import { createAiExecutionService } from "../src/ai/execution";
import { AiExecutionError } from "../src/ai/errors";
import { AiPlanningError } from "../src/ai/planning/errors";
import {
  BuilderPlanValidationError,
  type BuilderPlanValidationDiagnosticCode,
} from "../src/ai/planning/diagnostics";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
  type BuilderPlanOutput,
} from "../src/ai/planning/schemas";
import { createBuilderPlanningService } from "../src/ai/planning/service";
import {
  BUILDER_PLANNING_INSTRUCTION,
  builderPlanTaskV1,
} from "../src/ai/planning/task";
import { validateBuilderPlanOutput } from "../src/ai/planning/validation";
import {
  aiExecutionPolicies,
  registeredAiTasks,
  structuredAiProviders,
} from "../src/ai/registry";
import { BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY } from "../src/ai/policies";
import type { AuthoritativeAiBusinessContext } from "../src/core/configuration/builder-context-source";
import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";
import type { Database } from "../src/db/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const ids = {
  actor: "90000000-0000-4000-8000-000000000001",
  business: "90000000-0000-4000-8000-000000000002",
  version: "90000000-0000-4000-8000-000000000003",
  location: "a0000000-0000-4000-8000-000000000001",
  otherLocation: "a0000000-0000-4000-8000-000000000002",
  object: "10000000-0000-4000-8000-000000000001",
} as const;

function snapshot(): ConfigurationSnapshotV1 {
  return {
    schema_version: 1,
    object_definitions: [
      {
        id: ids.object,
        key: "order",
        singular_label: "Order",
        plural_label: "Orders",
        description: "Customer orders",
        kind: "custom",
        semantic_type: null,
        icon: null,
        is_active: true,
      },
    ],
    field_definitions: [],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [],
    preorder_experiences: [],
    preorder_experience_locations: [],
  };
}

function source(
  options: { revision?: number; locationName?: string } = {},
): AiBusinessContextSource {
  return {
    business: {
      name: "Example Bakery",
      businessType: "bakery",
      timezone: "Europe/London",
    },
    access: {
      role: "owner",
      capabilities: ["manage_configuration"],
    },
    activeConfiguration: {
      versionNumber: options.revision ?? 2,
      revision: options.revision ?? 2,
      snapshot: snapshot(),
    },
    locations: [
      {
        reference: ids.location,
        name: options.locationName ?? "Bedford",
        timezone: "Europe/London",
        isActive: true,
      },
    ],
  };
}

function authoritative(
  options: {
    revision?: number;
    versionId?: string;
    locationName?: string;
  } = {},
): AuthoritativeAiBusinessContext {
  return {
    executionContext: {
      businessId: ids.business,
      actorId: ids.actor,
    },
    currentness: {
      baseVersionId: options.versionId ?? ids.version,
      headRevision: options.revision ?? 2,
    },
    source: source(options),
  };
}

function taskInput() {
  return builderPlanTaskInputSchema.parse({
    schema_version: 1,
    owner_request: "Add a simple catering enquiry form.",
    business_context: projectAiBusinessModelContext(source()).modelContext,
  });
}

function clarificationOutput(): Extract<
  BuilderPlanOutput,
  { state: "needs_clarification" }
> {
  return {
    schema_version: 1,
    state: "needs_clarification",
    understanding: "You want customers to send catering enquiries.",
    known_requirements: ["Customers need a catering enquiry form."],
    assumptions: [],
    questions: [
      {
        reference: "question_1",
        question: "Which details should customers provide?",
        reason: "This determines the questions on the enquiry form.",
        response_style: "multiple_choice",
        options: ["Event date", "Guest count", "Budget"],
      },
    ],
    unsupported_requirements: [],
  };
}

function readyOutput(): Extract<BuilderPlanOutput, { state: "ready" }> {
  return {
    schema_version: 1,
    state: "ready",
    understanding: "You want a clearer internal Order screen.",
    assumptions: [
      {
        reference: "assumption_1",
        statement: "The existing Order concept should remain the source.",
        impact: "low",
        requires_owner_confirmation: false,
      },
    ],
    plan: {
      outcome: "Staff can review the existing Order information clearly.",
      concepts: [
        {
          reference: "concept_1",
          label: "Order",
          disposition: "existing",
          existing_object_key: "order",
          purpose: "Keep customer order information together.",
        },
      ],
      user_journeys: [
        {
          reference: "journey_1",
          name: "Review an order",
          actor: "Staff member",
          trigger: "A staff member opens Orders.",
          steps: ["Open an order.", "Review its collection details."],
          outcome: "The staff member understands what must be prepared.",
        },
      ],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          lane: "configuration",
          category: "configure_view",
          summary: "Configure an owner-reviewed Order screen.",
          dependencies: [],
          affected_concepts: ["concept_1"],
          existing_object_keys: ["order"],
          location_references: [],
          materiality: "medium",
          requires_owner_confirmation: true,
        },
      ],
    },
    unsupported_requirements: [],
  };
}

function locationReadyOutput(
  category: "create_location" | "update_location",
): Extract<BuilderPlanOutput, { state: "ready" }> {
  return {
    schema_version: 1,
    state: "ready",
    understanding:
      category === "update_location"
        ? "You want to rename the existing Bedford Location."
        : "You want to add a Cambridge Location.",
    assumptions: [],
    plan: {
      outcome:
        category === "update_location"
          ? "The Bedford Location has the proposed owner-reviewed name."
          : "A Cambridge Location is available after later owner confirmation.",
      concepts: [],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          lane: "operational",
          category,
          summary:
            category === "update_location"
              ? "Rename the Bedford Location."
              : "Create a Cambridge Location.",
          dependencies: [],
          affected_concepts: [],
          existing_object_keys: [],
          location_references:
            category === "update_location" ? [ids.location] : [],
          materiality: "medium",
          requires_owner_confirmation: true,
        },
      ],
    },
    unsupported_requirements: [],
  };
}

function fakeExecutionResult(output: BuilderPlanOutput) {
  return {
    output,
    accounting: {
      attemptsStarted: 1,
      inputTokens: 90,
      outputTokens: 30,
      usageReported: true,
      usageComplete: true,
      providerInvocationStarted: true,
      failureBeforeProviderInvocation: false,
    },
    metadata: {
      taskKey: "builder_plan_v1",
      taskVersion: 1,
      purposeLabel: "Plan a bounded Business request",
      providerKey: "test",
      modelKey: "test",
      attempts: 1,
      usage: { inputTokens: 90, outputTokens: 30, complete: true },
      requestMetadata: { must_not_escape: "provider detail" },
    },
  };
}

function expectValidationDiagnostic(
  action: () => unknown,
  diagnosticCode: BuilderPlanValidationDiagnosticCode,
): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(BuilderPlanValidationError);
  expect((thrown as BuilderPlanValidationError).diagnosticCode).toBe(
    diagnosticCode,
  );
}

describe("builder_plan_v1 strict schemas and semantics", () => {
  it("accepts valid clarification and ready outputs", () => {
    expect(
      validateBuilderPlanOutput(taskInput(), clarificationOutput()),
    ).toEqual(clarificationOutput());
    expect(validateBuilderPlanOutput(taskInput(), readyOutput())).toEqual(
      readyOutput(),
    );
  });

  it("accepts concept-free Location plans and the unchanged configuration fixture", () => {
    const updateLocation = locationReadyOutput("update_location");
    const createLocation = locationReadyOutput("create_location");

    expect(validateBuilderPlanOutput(taskInput(), updateLocation)).toEqual(
      updateLocation,
    );
    expect(updateLocation.plan.steps[0]).toMatchObject({
      affected_concepts: [],
      location_references: [ids.location],
    });
    expect(validateBuilderPlanOutput(taskInput(), createLocation)).toEqual(
      createLocation,
    );
    expect(createLocation.plan.steps[0]).toMatchObject({
      existing_object_keys: [],
      location_references: [],
    });
    expect(validateBuilderPlanOutput(taskInput(), readyOutput())).toEqual(
      readyOutput(),
    );
  });

  it("rejects undeclared concepts and unknown Locations in concept-free plans", () => {
    const undeclaredConcept = locationReadyOutput("create_location");
    undeclaredConcept.plan.steps[0]!.affected_concepts = ["concept_1"];
    expect(() =>
      validateBuilderPlanOutput(taskInput(), undeclaredConcept),
    ).toThrow();

    const unknownLocation = locationReadyOutput("update_location");
    unknownLocation.plan.steps[0]!.location_references = [ids.otherLocation];
    expect(() =>
      validateBuilderPlanOutput(taskInput(), unknownLocation),
    ).toThrow();
  });

  it("requires the deterministic concepts property even when it is empty", () => {
    const output = locationReadyOutput("create_location");
    const { concepts, ...planWithoutConcepts } = output.plan;

    expect(concepts).toEqual([]);
    expect(
      builderPlanOutputSchema.safeParse({
        ...output,
        plan: planWithoutConcepts,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown properties and state-specific fields", () => {
    expect(
      builderPlanOutputSchema.safeParse({
        ...clarificationOutput(),
        plan: readyOutput().plan,
      }).success,
    ).toBe(false);
    expect(
      builderPlanOutputSchema.safeParse({
        ...readyOutput(),
        questions: clarificationOutput().questions,
      }).success,
    ).toBe(false);
    expect(
      builderPlanOutputSchema.safeParse({
        ...readyOutput(),
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("requires one to five clarification questions", () => {
    expect(
      builderPlanOutputSchema.safeParse({
        ...clarificationOutput(),
        questions: [],
      }).success,
    ).toBe(false);
    expect(
      builderPlanOutputSchema.safeParse({
        ...clarificationOutput(),
        questions: Array.from({ length: 6 }, (_, index) => ({
          ...clarificationOutput().questions[0],
          reference: `question_${index + 1}`,
        })),
      }).success,
    ).toBe(false);
  });

  it("enforces free-text and choice option rules", () => {
    expect(
      builderPlanOutputSchema.safeParse({
        ...clarificationOutput(),
        questions: [
          {
            reference: "question_1",
            question: "What should customers tell you?",
            reason: "This defines the form.",
            response_style: "free_text",
            options: ["Not allowed"],
          },
        ],
      }).success,
    ).toBe(false);
    expect(() =>
      validateBuilderPlanOutput(taskInput(), {
        ...clarificationOutput(),
        questions: [
          {
            ...clarificationOutput().questions[0]!,
            response_style: "single_choice",
            options: ["Email", "email"],
          },
        ],
      }),
    ).toThrow();
  });

  it.each([
    [
      "question",
      () => ({
        ...clarificationOutput(),
        questions: [
          clarificationOutput().questions[0]!,
          clarificationOutput().questions[0]!,
        ],
      }),
    ],
    [
      "concept",
      () => ({
        ...readyOutput(),
        plan: {
          ...readyOutput().plan,
          concepts: [
            readyOutput().plan.concepts[0]!,
            readyOutput().plan.concepts[0]!,
          ],
        },
      }),
    ],
    [
      "journey",
      () => ({
        ...readyOutput(),
        plan: {
          ...readyOutput().plan,
          user_journeys: [
            readyOutput().plan.user_journeys[0]!,
            readyOutput().plan.user_journeys[0]!,
          ],
        },
      }),
    ],
    [
      "step",
      () => ({
        ...readyOutput(),
        plan: {
          ...readyOutput().plan,
          steps: [
            readyOutput().plan.steps[0]!,
            { ...readyOutput().plan.steps[0]!, sequence: 2 },
          ],
        },
      }),
    ],
  ])("rejects duplicate %s references", (_label, build) => {
    expect(() =>
      validateBuilderPlanOutput(
        taskInput(),
        builderPlanOutputSchema.parse(build()),
      ),
    ).toThrow();
  });

  it("resolves existing Object and Location references against context", () => {
    const unknownObject = structuredClone(readyOutput());
    const concept = unknownObject.plan.concepts[0]!;
    if (concept.disposition !== "existing") {
      throw new Error("Expected the ready fixture to use an existing concept.");
    }
    concept.existing_object_key = "invented";
    expect(() =>
      validateBuilderPlanOutput(taskInput(), unknownObject),
    ).toThrow();

    const unknownLocation = structuredClone(readyOutput());
    unknownLocation.plan.steps[0]!.location_references = [ids.otherLocation];
    expect(() =>
      validateBuilderPlanOutput(taskInput(), unknownLocation),
    ).toThrow();
  });

  it("keeps new concepts plan-local without an Object key or UUID", () => {
    const validNew = structuredClone(readyOutput());
    validNew.plan.concepts = [
      {
        reference: "concept_1",
        label: "Catering Enquiry",
        disposition: "new",
        purpose: "Capture catering requests.",
      },
    ];
    expect(validateBuilderPlanOutput(taskInput(), validNew)).toEqual(validNew);
    expect(
      builderPlanOutputSchema.safeParse({
        ...validNew,
        plan: {
          ...validNew.plan,
          concepts: [
            {
              ...validNew.plan.concepts[0],
              existing_object_key: "order",
              id: ids.object,
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("requires contiguous sequence and dependencies on earlier steps only", () => {
    const forwardDependency = structuredClone(readyOutput());
    forwardDependency.plan.steps = [
      {
        ...forwardDependency.plan.steps[0]!,
        dependencies: ["step_2"],
      },
      {
        ...forwardDependency.plan.steps[0]!,
        reference: "step_2",
        sequence: 2,
        dependencies: [],
      },
    ];
    expect(() =>
      validateBuilderPlanOutput(taskInput(), forwardDependency),
    ).toThrow();

    const gap = structuredClone(readyOutput());
    gap.plan.steps[0]!.sequence = 2;
    expect(() => validateBuilderPlanOutput(taskInput(), gap)).toThrow();
  });

  it("rejects lane/category mismatches and unknown concept references", () => {
    expect(
      builderPlanOutputSchema.safeParse({
        ...readyOutput(),
        plan: {
          ...readyOutput().plan,
          steps: [
            {
              ...readyOutput().plan.steps[0],
              lane: "operational",
              category: "configure_view",
            },
          ],
        },
      }).success,
    ).toBe(false);

    const unknownConcept = structuredClone(readyOutput());
    unknownConcept.plan.steps[0]!.affected_concepts = ["concept_2"];
    expect(() =>
      validateBuilderPlanOutput(taskInput(), unknownConcept),
    ).toThrow();
  });

  it("surfaces unavailable workflows, rules, and code without planning them", () => {
    const result = clarificationOutput();
    result.unsupported_requirements = [
      {
        reference: "unsupported_1",
        requirement: "Run a workflow after submission.",
        reason_code: "workflow_unavailable",
        explanation: "Workflow execution is not currently available.",
      },
      {
        reference: "unsupported_2",
        requirement: "Execute custom source code.",
        reason_code: "arbitrary_code_unavailable",
        explanation: "Arbitrary code is never an available planning step.",
      },
    ];
    expect(validateBuilderPlanOutput(taskInput(), result)).toEqual(result);
    expect(
      JSON.stringify(builderPlanOutputSchema).toLocaleLowerCase(),
    ).not.toContain("execute_code");
  });

  it("rejects unresolved high-impact ready assumptions and unsupported ready output", () => {
    const highImpact = structuredClone(readyOutput());
    highImpact.assumptions = [
      {
        reference: "assumption_1",
        statement: "Online payment is optional.",
        impact: "high",
        requires_owner_confirmation: false,
      },
    ];
    expect(() => validateBuilderPlanOutput(taskInput(), highImpact)).toThrow();
    expect(
      builderPlanOutputSchema.safeParse({
        ...readyOutput(),
        unsupported_requirements: [
          {
            reference: "unsupported_1",
            requirement: "Take payment.",
            reason_code: "payment_capability_unavailable",
            explanation: "Payment is unavailable.",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a confirmed high-impact ready assumption", () => {
    const confirmed = structuredClone(readyOutput());
    confirmed.assumptions = [
      {
        reference: "assumption_1",
        statement: "The owner will confirm the proposed collection policy.",
        impact: "high",
        requires_owner_confirmation: true,
      },
    ];

    expect(validateBuilderPlanOutput(taskInput(), confirmed)).toEqual(
      confirmed,
    );
  });

  it("reports only finite bounded diagnostics for semantic validation failures", () => {
    const duplicateReference = structuredClone(readyOutput());
    duplicateReference.assumptions = [
      duplicateReference.assumptions[0]!,
      { ...duplicateReference.assumptions[0]! },
    ];
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), duplicateReference),
      "duplicate_reference",
    );

    const duplicateQuestionOption = {
      ...clarificationOutput(),
      questions: [
        {
          ...clarificationOutput().questions[0]!,
          response_style: "single_choice" as const,
          options: ["Email", "email"],
        },
      ],
    };
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), duplicateQuestionOption),
      "duplicate_question_option",
    );

    const highImpact = structuredClone(readyOutput());
    highImpact.assumptions[0]!.impact = "high";
    highImpact.assumptions[0]!.requires_owner_confirmation = false;
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), highImpact),
      "high_impact_assumption_unconfirmed",
    );

    const unknownConceptObject = structuredClone(readyOutput());
    const concept = unknownConceptObject.plan.concepts[0]!;
    if (concept.disposition !== "existing") {
      throw new Error("Expected an existing concept fixture.");
    }
    concept.existing_object_key = "invented";
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), unknownConceptObject),
      "existing_concept_object_unknown",
    );

    const invalidSequence = structuredClone(readyOutput());
    invalidSequence.plan.steps[0]!.sequence = 2;
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), invalidSequence),
      "step_sequence_invalid",
    );

    const forwardDependency = structuredClone(readyOutput());
    forwardDependency.plan.steps = [
      { ...forwardDependency.plan.steps[0]!, dependencies: ["step_2"] },
      {
        ...forwardDependency.plan.steps[0]!,
        reference: "step_2",
        sequence: 2,
      },
    ];
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), forwardDependency),
      "dependency_not_prior",
    );

    const unknownAffectedConcept = structuredClone(readyOutput());
    unknownAffectedConcept.plan.steps[0]!.affected_concepts = ["concept_2"];
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), unknownAffectedConcept),
      "affected_concept_unknown",
    );

    const unknownExistingObject = structuredClone(readyOutput());
    unknownExistingObject.plan.steps[0]!.existing_object_keys = ["invented"];
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), unknownExistingObject),
      "existing_object_unknown",
    );

    const unknownLocation = structuredClone(readyOutput());
    unknownLocation.plan.steps[0]!.location_references = [ids.otherLocation];
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), unknownLocation),
      "location_reference_unknown",
    );

    const unsupportedCategoryInput = structuredClone(taskInput());
    unsupportedCategoryInput.business_context.platform_capabilities.configuration_operation_names =
      [];
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(unsupportedCategoryInput, readyOutput()),
      "category_not_supported",
    );

    const invalidContract = {
      ...readyOutput(),
      unexpected: true,
    } as BuilderPlanOutput;
    expectValidationDiagnostic(
      () => validateBuilderPlanOutput(taskInput(), invalidContract),
      "output_contract_invalid",
    );
  });

  it("bounds owner-readable output and arrays", () => {
    expect(
      builderPlanOutputSchema.safeParse({
        ...readyOutput(),
        understanding: "x".repeat(2_001),
      }).success,
    ).toBe(false);
    expect(
      builderPlanOutputSchema.safeParse({
        ...readyOutput(),
        plan: {
          ...readyOutput().plan,
          concepts: Array.from({ length: 21 }, (_, index) => ({
            reference: `concept_${index + 1}`,
            label: `Concept ${index + 1}`,
            disposition: "new",
            purpose: "A bounded concept.",
          })),
        },
      }).success,
    ).toBe(false);
  });

  it("contains no M5 operation, candidate, SQL, code, or tool fields", () => {
    const jsonSchema = JSON.stringify(
      builderPlanTaskV1.outputSchema.toJSONSchema(),
    );
    for (const forbidden of [
      '"operations"',
      '"candidate"',
      '"sql"',
      '"code"',
      '"tool"',
      '"apply"',
      '"publish"',
    ]) {
      expect(jsonSchema.toLocaleLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps trusted identity and currentness outside serialized task input", () => {
    const input = taskInput();
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(ids.actor);
    expect(serialized).not.toContain(ids.business);
    expect(serialized).not.toContain(ids.version);
    expect(serialized).toContain(ids.location);
    expect(serializeAiBusinessModelContext(input.business_context)).not.toMatch(
      /baseVersionId|headRevision|actorId|businessId/,
    );
  });
});

describe("builder planning task execution and service", () => {
  it("registers a bounded server-owned task and disabled production policy", () => {
    expect(registeredAiTasks.builder_plan_v1).toBe(builderPlanTaskV1);
    expect(
      aiExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    ).toMatchObject({
      key: BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY,
      providerKey: "disabled",
      maxInputBytes: 160 * 1024,
      maxBillableInputTokens: 64_000,
      maxOutputTokens: 4_096,
      timeoutMs: 30_000,
      maxAttempts: 2,
      inputMicrousdPerMillion: 0,
      outputMicrousdPerMillion: 0,
    });
    expect(structuredAiProviders).toEqual({ disabled: expect.anything() });
    expect(BUILDER_PLANNING_INSTRUCTION).not.toMatch(
      /90000000|api[_-]?key|baseVersionId|headRevision/,
    );
    expect(BUILDER_PLANNING_INSTRUCTION).toContain(
      "platform-only Location plan keeps the required concepts array empty",
    );
  });

  it("states the general high-impact assumption confirmation contract", () => {
    expect(BUILDER_PLANNING_INSTRUCTION).toContain(
      'In a ready plan, every assumption with impact="high" must set requires_owner_confirmation=true.',
    );
    expect(BUILDER_PLANNING_INSTRUCTION).toContain(
      'Never return a ready plan containing an impact="high" assumption with requires_owner_confirmation=false.',
    );
    expect(BUILDER_PLANNING_INSTRUCTION).toContain(
      "Do not restate an explicit owner instruction as an assumption.",
    );
    expect(BUILDER_PLANNING_INSTRUCTION).toContain(
      "Prefer no assumption over inventing an unnecessary assumption.",
    );
  });

  it("sends exact structured input and no trusted identity to the provider", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      output: readyOutput(),
      usage: { inputTokens: 50, outputTokens: 20 },
    });
    const service = createAiExecutionService({
      tasks: registeredAiTasks,
      policies: {
        [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]:
          aiExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
      },
      providers: {
        disabled: { key: "disabled", generateStructured },
      },
    });

    await service.execute("builder_plan_v1", taskInput());
    const request = generateStructured.mock
      .calls[0]?.[0] as StructuredAiProviderRequest;
    expect(request.input).toEqual(taskInput());
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain(ids.actor);
    expect(serialized).not.toContain(ids.business);
    expect(serialized).not.toContain(ids.version);
    expect(request.instruction).toBe(BUILDER_PLANNING_INSTRUCTION);
  });

  it("settles semantically hallucinated output as failed with reported usage", async () => {
    const hallucinated = structuredClone(readyOutput());
    const concept = hallucinated.plan.concepts[0]!;
    if (concept.disposition !== "existing") {
      throw new Error("Expected the ready fixture to use an existing concept.");
    }
    concept.existing_object_key = "invented";
    const execution = createAiExecutionService({
      tasks: registeredAiTasks,
      policies: {
        [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]:
          aiExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
      },
      providers: {
        disabled: {
          key: "disabled",
          generateStructured: vi.fn().mockResolvedValue({
            output: hallucinated,
            usage: { inputTokens: 70, outputTokens: 25 },
          }),
        },
      },
    });
    const settle = vi.fn().mockResolvedValue({});
    const accounting = {
      readSettings: vi.fn().mockResolvedValue({
        business_id: ids.business,
        is_enabled: true,
        daily_request_limit: 25,
        daily_input_token_limit: 250_000,
        daily_output_token_limit: 100_000,
        daily_cost_limit_microusd: 5_000_000,
        created_at: "2026-07-30T00:00:00Z",
        updated_at: "2026-07-30T00:00:00Z",
        updated_by: null,
      } satisfies BusinessAiSettings),
      reserve: vi.fn().mockResolvedValue({}),
      settle,
    } as unknown as AiAccountingStore;
    const service = createBusinessAiExecutionOrchestrator({
      accounting,
      execution,
      generateExecutionId: () => "10000000-0000-4000-8000-000000000099",
    });

    let executionError: unknown;
    try {
      await service.execute("builder_plan_v1", taskInput());
    } catch (error) {
      executionError = error;
    }
    expect(executionError).toBeInstanceOf(AiExecutionError);
    expect(executionError).toMatchObject({ code: "ai_output_invalid" });
    expect(JSON.stringify(executionError)).not.toContain(
      "existing_concept_object_unknown",
    );
    expect(JSON.stringify(executionError)).not.toContain(
      "The builder plan referenced an unavailable existing concept Object.",
    );
    expect((executionError as AiExecutionError).toPublicError()).toEqual({
      code: "ai_output_invalid",
      message: "The AI service returned an invalid result.",
    });
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        outcomeCode: "ai_output_invalid",
        actualInputTokens: 70,
        actualOutputTokens: 25,
      }),
    );
    expect(JSON.stringify(settle.mock.calls[0]?.[0])).not.toContain(
      "existing_concept_object_unknown",
    );
    expect(JSON.stringify(settle.mock.calls[0]?.[0])).not.toContain(
      "The existing Order concept should remain the source.",
    );
  });

  it.each([
    ["clarification", clarificationOutput()],
    ["ready plan", readyOutput()],
  ])(
    "returns a valid %s through the planning service",
    async (_label, output) => {
      const loadContext = vi.fn().mockResolvedValue(authoritative());
      const executeTask = vi
        .fn()
        .mockResolvedValue(fakeExecutionResult(output));
      const service = createBuilderPlanningService({
        loadContext,
        executeTask,
      });

      const result = await service.plan({} as SupabaseClient<Database>, {
        businessId: ids.business,
        ownerRequest: "  Improve how staff review orders.  ",
      });

      expect(result.plan).toEqual(output);
      expect(result.currentness).toEqual(authoritative().currentness);
      expect(result.contextBytes).toBeGreaterThan(0);
      expect(result.execution).toEqual({
        attempts: 1,
        inputTokens: 90,
        outputTokens: 30,
        usageComplete: true,
      });
      expect(result).not.toHaveProperty("modelContext");
      expect(result).not.toHaveProperty("metadata");
      expect(executeTask).toHaveBeenCalledWith(
        expect.anything(),
        authoritative().executionContext,
        "builder_plan_v1",
        expect.objectContaining({
          owner_request: "Improve how staff review orders.",
        }),
      );
    },
  );

  it("rejects an invalid owner request before context or execution", async () => {
    const loadContext = vi.fn();
    const executeTask = vi.fn();
    const service = createBuilderPlanningService({
      loadContext,
      executeTask,
    });

    await expect(
      service.plan({} as SupabaseClient<Database>, {
        businessId: ids.business,
        ownerRequest: " ",
      }),
    ).rejects.toMatchObject({ code: "ai_plan_request_invalid" });
    expect(loadContext).not.toHaveBeenCalled();
    expect(executeTask).not.toHaveBeenCalled();
  });

  it.each([
    [
      "configuration",
      authoritative({
        revision: 3,
        versionId: "90000000-0000-4000-8000-000000000004",
      }),
    ],
    ["Location", authoritative({ locationName: "Renamed Bedford" })],
  ])("discards a plan when %s context changes", async (_label, changed) => {
    const loadContext = vi
      .fn()
      .mockResolvedValueOnce(authoritative())
      .mockResolvedValueOnce(changed);
    const service = createBuilderPlanningService({
      loadContext,
      executeTask: vi
        .fn()
        .mockResolvedValue(fakeExecutionResult(readyOutput())),
    });

    await expect(
      service.plan({} as SupabaseClient<Database>, {
        businessId: ids.business,
        ownerRequest: "Improve Orders.",
      }),
    ).rejects.toMatchObject({ code: "ai_plan_context_stale" });
  });

  it("serializes planning errors without request, context, output, or UUIDs", () => {
    const secret = "owner-request-secret";
    const error = new AiPlanningError("ai_plan_failed", {
      cause: {
        secret,
        context: taskInput(),
        output: readyOutput(),
      },
    });
    const serialized = JSON.stringify(error);

    expect(serialized).toBe(
      JSON.stringify({
        code: "ai_plan_failed",
        message: "The Business request could not be planned safely.",
      }),
    );
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(ids.location);
  });
});

describe("builder planning production boundaries", () => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const planningRoot = path.join(repositoryRoot, "src", "ai", "planning");
  const planningSource = fs
    .readdirSync(planningRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name)))
    .join("\n");
  const appSource = fs
    .readdirSync(path.join(repositoryRoot, "src", "app"), {
      recursive: true,
      withFileTypes: true,
    })
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name)))
    .join("\n");

  it("imports no configuration lifecycle or operational mutation service", () => {
    expect(planningSource).not.toMatch(
      /ConfigurationChangeService|proposeChangeSet|validateChangeSet|applyChangeSet|abandonChangeSet|prepareRollback|createGraphService|createLocation|submitPublicPreorder/,
    );
  });

  it("adds no planning route, Server Action, direct SDK use, fetch, or persistence", () => {
    expect(appSource).not.toMatch(
      /builderPlanningService|createBuilderPlanningService|builder_plan_v1/,
    );
    expect(planningSource).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|node:https|openai|anthropic|generativelanguage/i,
    );
    expect(planningSource).not.toMatch(
      /\.from\(["']ai_execution_runs|insert\(|update\(|upsert\(/,
    );
  });
});
