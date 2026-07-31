import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

vi.mock("server-only", () => ({}));

import { deriveAiReservationEnvelope } from "../src/ai/accounting/cost";
import type { StructuredAiProviderRequest } from "../src/ai/contracts";
import {
  BUILDER_EVALUATION_EXPECTED_AGGREGATE_MAX_MICROUSD,
  BUILDER_EVALUATION_HARD_CEILING_MICROUSD,
  BUILDER_EVALUATION_SCENARIO_COUNT,
  deriveBuilderEvaluationEnvelope,
} from "../src/ai/evaluation/envelope";
import { evaluateBuilderPlan } from "../src/ai/evaluation/evaluator";
import {
  liveBuilderEvaluationIsActivated,
  redactBuilderEvaluationFailure,
  runLiveBuilderEvaluation,
} from "../src/ai/evaluation/live";
import { builderEvaluationScenarios } from "../src/ai/evaluation/scenarios";
import {
  builderEvaluationReportSchema,
  builderEvaluationScenarioSchema,
  builderEvaluationTopLevelFailureSchema,
  builderEvaluationProviderFailureSchema,
  type BuilderEvaluationScenarioId,
} from "../src/ai/evaluation/schemas";
import { AiExecutionError } from "../src/ai/errors";
import { createAiExecutionService } from "../src/ai/execution";
import { openAiBuilderPlanningPolicy } from "../src/ai/policies";
import { BuilderPlanValidationError } from "../src/ai/planning/diagnostics";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
  type BuilderPlanOutput,
  type BuilderReadyPlanStep,
} from "../src/ai/planning/schemas";
import { builderPlanTaskV1 } from "../src/ai/planning/task";
import {
  SYNTHETIC_BUSINESS_CONTEXT_BYTES,
  syntheticBusinessContext,
} from "../evaluations/fixtures/synthetic-business-context";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function step(
  reference: string,
  sequence: number,
  lane: "configuration" | "operational",
  category: BuilderReadyPlanStep["category"],
  overrides: Partial<BuilderReadyPlanStep> = {},
): BuilderReadyPlanStep {
  return {
    reference,
    sequence,
    lane,
    category,
    summary: `Synthetic summary ${sequence}.`,
    dependencies: [],
    affected_concepts: [],
    existing_object_keys: [],
    location_references: [],
    materiality: "medium",
    requires_owner_confirmation: true,
    ...overrides,
  } as BuilderReadyPlanStep;
}

function ready(
  steps: BuilderReadyPlanStep[],
  concepts: Extract<
    BuilderPlanOutput,
    { state: "ready" }
  >["plan"]["concepts"] = [],
): Extract<BuilderPlanOutput, { state: "ready" }> {
  return builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding: "Synthetic understanding marker.",
    assumptions: [],
    plan: {
      outcome: "Synthetic outcome marker.",
      concepts,
      user_journeys: [],
      steps,
    },
    unsupported_requirements: [],
  }) as Extract<BuilderPlanOutput, { state: "ready" }>;
}

function clarification(
  reasonCode?:
    | "workflow_unavailable"
    | "rule_engine_unavailable"
    | "external_integration_required"
    | "payment_capability_unavailable",
): Extract<BuilderPlanOutput, { state: "needs_clarification" }> {
  return builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    understanding: "Synthetic clarification understanding marker.",
    known_requirements: [],
    assumptions: [],
    questions: [
      {
        reference: "question_1",
        question: "Synthetic question marker?",
        reason: "Synthetic question reason marker.",
        response_style: "free_text",
      },
    ],
    unsupported_requirements: reasonCode
      ? [
          {
            reference: "unsupported_1",
            requirement: "Synthetic unsupported requirement marker.",
            reason_code: reasonCode,
            explanation: "Synthetic unsupported explanation marker.",
          },
        ]
      : [],
  }) as Extract<BuilderPlanOutput, { state: "needs_clarification" }>;
}

const compliantOutputs: Readonly<
  Record<BuilderEvaluationScenarioId, BuilderPlanOutput>
> = Object.freeze({
  preorder_phone_optional: ready([
    step("step_1", 1, "configuration", "configure_preorder", {
      existing_object_keys: ["customer", "order"],
    }),
  ]),
  preorder_schedule_change: ready([
    step("step_1", 1, "configuration", "configure_preorder", {
      existing_object_keys: ["order"],
    }),
  ]),
  corporate_catering_enquiries: ready(
    [
      step("step_1", 1, "configuration", "define_object", {
        affected_concepts: ["concept_1"],
      }),
      step("step_2", 2, "configuration", "define_field", {
        dependencies: ["step_1"],
        affected_concepts: ["concept_1"],
      }),
      step("step_3", 3, "configuration", "configure_form", {
        dependencies: ["step_2"],
        affected_concepts: ["concept_1"],
      }),
      step("step_4", 4, "configuration", "configure_view", {
        dependencies: ["step_2"],
        affected_concepts: ["concept_1"],
      }),
      step("step_5", 5, "configuration", "configure_page", {
        dependencies: ["step_3"],
        affected_concepts: ["concept_1"],
      }),
    ],
    [
      {
        reference: "concept_1",
        label: "Synthetic Catering Enquiry",
        disposition: "new",
        purpose: "Synthetic concept purpose marker.",
      },
    ],
  ),
  create_cambridge_location: ready([
    step("step_1", 1, "operational", "create_location"),
  ]),
  add_cambridge_preorder_collection: ready([
    step("step_1", 1, "operational", "create_location"),
    step("step_2", 2, "configuration", "configure_preorder", {
      dependencies: ["step_1"],
      existing_object_keys: ["order"],
    }),
  ]),
  automated_weekly_customer_email: clarification("workflow_unavailable"),
  card_payment_at_checkout: clarification("payment_capability_unavailable"),
  ambiguous_bookings: clarification(),
});

function taskInputFor(scenarioId: BuilderEvaluationScenarioId) {
  const scenario = builderEvaluationScenarios.find(
    ({ id }) => id === scenarioId,
  );
  if (!scenario) throw new Error("Synthetic scenario fixture is missing.");
  return builderPlanTaskInputSchema.parse({
    schema_version: 1,
    owner_request: scenario.owner_request,
    business_context: syntheticBusinessContext,
  });
}

function fakeExecutionService(outputs = compliantOutputs) {
  return createAiExecutionService({
    tasks: { builder_plan_v1: builderPlanTaskV1 },
    policies: { builder_planning_v1: openAiBuilderPlanningPolicy },
    providers: {
      openai: {
        key: "openai",
        async generateStructured(request: StructuredAiProviderRequest) {
          const input = builderPlanTaskInputSchema.parse(request.input);
          const scenario = builderEvaluationScenarios.find(
            ({ owner_request }) => owner_request === input.owner_request,
          );
          if (!scenario) throw new Error("Unknown synthetic scenario.");
          return {
            output: structuredClone(outputs[scenario.id]),
            usage: { inputTokens: 1_200, outputTokens: 400 },
          };
        },
      },
    },
    sleep: async () => undefined,
  });
}

describe("bounded builder evaluation definitions", () => {
  it("defines exactly eight unique strict scenarios", () => {
    expect(builderEvaluationScenarios).toHaveLength(8);
    expect(BUILDER_EVALUATION_SCENARIO_COUNT).toBe(8);
    expect(new Set(builderEvaluationScenarios.map(({ id }) => id)).size).toBe(
      8,
    );
    for (const scenario of builderEvaluationScenarios) {
      expect(builderEvaluationScenarioSchema.parse(scenario)).toEqual(scenario);
    }
  });

  it("uses one exact strict, deterministic, bounded synthetic context", () => {
    expect(
      builderPlanTaskInputSchema.shape.business_context.parse(
        syntheticBusinessContext,
      ),
    ).toEqual(syntheticBusinessContext);
    expect(SYNTHETIC_BUSINESS_CONTEXT_BYTES).toBeGreaterThan(0);
    expect(SYNTHETIC_BUSINESS_CONTEXT_BYTES).toBeLessThan(128 * 1024);
    console.info(
      `Synthetic builder evaluation context: ${SYNTHETIC_BUSINESS_CONTEXT_BYTES} bytes (128 KiB hard limit).`,
    );

    const serialized = JSON.stringify(syntheticBusinessContext);
    const withoutAllowedLocationReferences = serialized.replaceAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      "",
    );
    for (const prohibited of [
      /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/,
      /\bsk-[A-Za-z0-9_-]+/,
      /\bBearer\s+[A-Za-z0-9._-]+/i,
      /\b(?:api[_ -]?key|password|secret)\b/i,
      /https?:\/\//i,
      /\bPO-[A-F0-9]{8}\b/,
      /\+?\d[\d ()-]{8,}\d/,
    ]) {
      expect(withoutAllowedLocationReferences).not.toMatch(prohibited);
    }
    expect(syntheticBusinessContext).not.toHaveProperty("records");
    expect(syntheticBusinessContext).not.toHaveProperty("record_relationships");
  });

  it("derives the exact fixed aggregate envelope through trusted integer accounting", () => {
    const perScenario = deriveAiReservationEnvelope(
      openAiBuilderPlanningPolicy,
    ).reservedCostMicrousd;
    const envelope = deriveBuilderEvaluationEnvelope();
    expect(perScenario).toBe(132_864);
    expect(envelope.aggregateMicrousd).toBe(1_062_912);
    expect(envelope.aggregateMicrousd).toBe(
      BUILDER_EVALUATION_EXPECTED_AGGREGATE_MAX_MICROUSD,
    );
    expect(envelope.hardCeilingMicrousd).toBe(
      BUILDER_EVALUATION_HARD_CEILING_MICROUSD,
    );
    expect(envelope.hardCeilingMicrousd).toBe(1_100_000);
  });
});

describe("scenario → production task contract → evaluator", () => {
  it("passes every compliant fixture through structural and semantic validation", async () => {
    const execution = fakeExecutionService();
    for (const scenario of builderEvaluationScenarios) {
      const result = await execution.execute(
        "builder_plan_v1",
        taskInputFor(scenario.id),
      );
      const report = evaluateBuilderPlan(
        scenario,
        builderPlanOutputSchema.parse(result.output),
        {
          attempts: result.accounting.attemptsStarted,
          inputTokens: result.accounting.inputTokens,
          outputTokens: result.accounting.outputTokens,
          elapsedMs: 25,
        },
      );
      expect(report.passed, scenario.id).toBe(true);
      expect(report.failed_gate_codes).toEqual([]);
    }
  });

  it("keeps preorder changes to one existing-capability configuration step", () => {
    for (const scenarioId of [
      "preorder_phone_optional",
      "preorder_schedule_change",
    ] as const) {
      const output = compliantOutputs[scenarioId];
      if (output.state !== "ready") throw new Error("Invalid fixture.");
      expect(output.plan.concepts, scenarioId).toEqual([]);
      expect(output.plan.steps, scenarioId).toHaveLength(1);
      expect(output.plan.steps[0], scenarioId).toMatchObject({
        lane: "configuration",
        category: "configure_preorder",
        dependencies: [],
        affected_concepts: [],
        location_references: [],
      });
      expect(
        evaluateBuilderPlan(
          builderEvaluationScenarios.find(({ id }) => id === scenarioId)!,
          output,
          {
            attempts: 1,
            inputTokens: 1,
            outputTokens: 1,
            elapsedMs: 1,
          },
        ).passed,
      ).toBe(true);
    }
  });

  it("fails missing required categories and forbidden lanes", () => {
    const corporate = builderEvaluationScenarios[2]!;
    const missingPage = ready(
      compliantOutputs.corporate_catering_enquiries.state === "ready"
        ? compliantOutputs.corporate_catering_enquiries.plan.steps.filter(
            ({ category }) => category !== "configure_page",
          )
        : [],
      compliantOutputs.corporate_catering_enquiries.state === "ready"
        ? compliantOutputs.corporate_catering_enquiries.plan.concepts
        : [],
    );
    expect(
      evaluateBuilderPlan(corporate, missingPage, {
        attempts: 1,
        inputTokens: 1,
        outputTokens: 1,
        elapsedMs: 1,
      }).failed_gate_codes,
    ).toContain("configure_page_required");

    const phone = builderEvaluationScenarios[0]!;
    const operational = ready([
      step("step_1", 1, "operational", "create_location"),
    ]);
    expect(
      evaluateBuilderPlan(phone, operational, {
        attempts: 1,
        inputTokens: 1,
        outputTokens: 1,
        elapsedMs: 1,
      }).failed_gate_codes,
    ).toEqual(
      expect.arrayContaining([
        "configuration_step_required",
        "configure_preorder_required",
        "operational_step_forbidden",
      ]),
    );
  });

  it("fails incorrect ready or clarification behavior and unsupported claims", () => {
    const ambiguous = builderEvaluationScenarios[7]!;
    expect(
      evaluateBuilderPlan(
        ambiguous,
        compliantOutputs.create_cambridge_location,
        {
          attempts: 1,
          inputTokens: 1,
          outputTokens: 1,
          elapsedMs: 1,
        },
      ).failed_gate_codes,
    ).toContain("clarification_required");

    const automation = builderEvaluationScenarios[5]!;
    expect(
      evaluateBuilderPlan(automation, clarification(), {
        attempts: 1,
        inputTokens: 1,
        outputTokens: 1,
        elapsedMs: 1,
      }).failed_gate_codes,
    ).toContain("unsupported_automation_reason_required");

    const payment = builderEvaluationScenarios[6]!;
    expect(
      evaluateBuilderPlan(payment, clarification("workflow_unavailable"), {
        attempts: 1,
        inputTokens: 1,
        outputTokens: 1,
        elapsedMs: 1,
      }).failed_gate_codes,
    ).toContain("unsupported_payment_reason_required");
  });

  it("enforces compound Location ordering, dependency, and platform-only concepts", () => {
    const scenario = builderEvaluationScenarios[4]!;
    const invalid = ready(
      [
        step("step_1", 1, "configuration", "configure_preorder"),
        step("step_2", 2, "operational", "create_location"),
      ],
      [
        {
          reference: "concept_1",
          label: "Synthetic Location",
          disposition: "new",
          purpose: "Synthetic invalid concept.",
        },
      ],
    );
    expect(
      evaluateBuilderPlan(scenario, invalid, {
        attempts: 1,
        inputTokens: 1,
        outputTokens: 1,
        elapsedMs: 1,
      }).failed_gate_codes,
    ).toEqual(
      expect.arrayContaining([
        "compound_order_invalid",
        "compound_dependency_required",
        "concepts_must_be_empty",
      ]),
    );

    const compliant = compliantOutputs.add_cambridge_preorder_collection;
    if (compliant.state !== "ready") throw new Error("Invalid fixture.");
    expect(
      evaluateBuilderPlan(scenario, compliant, {
        attempts: 1,
        inputTokens: 1,
        outputTokens: 1,
        elapsedMs: 1,
      }).passed,
    ).toBe(true);
    expect(compliant.plan.concepts).toEqual([]);
    expect(compliant.plan.steps[0]).toMatchObject({
      category: "create_location",
      affected_concepts: [],
      location_references: [],
    });
    expect(compliant.plan.steps[1]).toMatchObject({
      category: "configure_preorder",
      dependencies: ["step_1"],
    });
  });

  it("keeps a Location-only evaluator boundary free of adjacent configuration", () => {
    const scenario = builderEvaluationScenarios[3]!;
    const invalid = ready(
      [
        step("step_1", 1, "operational", "create_location"),
        step("step_2", 2, "configuration", "configure_preorder"),
      ],
      [
        {
          reference: "concept_1",
          label: "Fabricated Location Object",
          disposition: "new",
          purpose: "Invalid platform concept.",
        },
      ],
    );
    invalid.plan.steps[0]!.location_references = [
      "33333333-3333-4333-8333-333333333333",
    ];
    const report = evaluateBuilderPlan(scenario, invalid, {
      attempts: 1,
      inputTokens: 1,
      outputTokens: 1,
      elapsedMs: 1,
    });
    expect(report.passed).toBe(false);
    expect(report.failed_gate_codes).toEqual(
      expect.arrayContaining([
        "configuration_step_forbidden",
        "concepts_must_be_empty",
        "location_existing_reference_forbidden",
      ]),
    );
  });

  it("rejects fabricated Location and Object references through semantic validation", async () => {
    const unknownLocation = structuredClone(
      compliantOutputs.create_cambridge_location,
    );
    if (unknownLocation.state !== "ready") throw new Error("Invalid fixture.");
    unknownLocation.plan.steps[0]!.location_references = [
      "33333333-3333-4333-8333-333333333333",
    ];
    const unknownObject = structuredClone(
      compliantOutputs.preorder_phone_optional,
    );
    if (unknownObject.state !== "ready") throw new Error("Invalid fixture.");
    unknownObject.plan.steps[0]!.existing_object_keys = ["invented_object"];

    for (const [scenarioId, output] of [
      ["create_cambridge_location", unknownLocation],
      ["preorder_phone_optional", unknownObject],
    ] as const) {
      const execution = fakeExecutionService({
        ...compliantOutputs,
        [scenarioId]: output,
      });
      await expect(
        execution.execute("builder_plan_v1", taskInputFor(scenarioId)),
      ).rejects.toMatchObject({ code: "ai_output_invalid" });
    }
  });

  it("returns only the bounded metadata contract", () => {
    const scenario = builderEvaluationScenarios[2]!;
    const report = evaluateBuilderPlan(
      scenario,
      compliantOutputs.corporate_catering_enquiries,
      {
        attempts: 1,
        inputTokens: 1_200,
        outputTokens: 400,
        elapsedMs: 25,
      },
    );
    expect(builderEvaluationReportSchema.parse(report)).toEqual(report);
    const serialized = JSON.stringify(report);
    for (const prohibited of [
      scenario.owner_request,
      "Synthetic Lantern Bakery",
      "Synthetic understanding marker",
      "Synthetic outcome marker",
      "Synthetic Catering Enquiry",
      "Synthetic concept purpose marker",
    ]) {
      expect(serialized).not.toContain(prohibited);
    }
    expect(report).not.toHaveProperty("output");
    expect(report).not.toHaveProperty("context");
    expect(report).not.toHaveProperty("owner_request");
  });
});

describe("live activation, redaction, and source isolation", () => {
  it("constructs no production execution without every explicit live gate", async () => {
    const loadProductionExecution = vi.fn();
    const environments = [
      {
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        RUN_LIVE_OPENAI_EVAL: "1",
        AI_PROVIDER: "disabled",
        OPENAI_API_KEY: "synthetic-key",
      },
      {
        RUN_LIVE_OPENAI_EVAL: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: " ",
      },
    ];
    for (const environment of environments) {
      expect(liveBuilderEvaluationIsActivated(environment)).toBe(false);
      await expect(
        runLiveBuilderEvaluation(environment, { loadProductionExecution }),
      ).resolves.toMatchObject({ ran: false });
    }
    expect(loadProductionExecution).not.toHaveBeenCalled();
  });

  it("emits only approved bounded diagnostics for invalid planning output", () => {
    const semantic = redactBuilderEvaluationFailure(
      new AiExecutionError("ai_output_invalid", {
        cause: new BuilderPlanValidationError("existing_object_unknown"),
      }),
      "preorder_phone_optional",
    );
    const structural = redactBuilderEvaluationFailure(
      new AiExecutionError("ai_output_invalid", {
        cause: new ZodError([
          {
            code: "custom",
            message: "raw structural message marker",
            path: ["secret_path"],
            input: "raw input marker",
          },
        ]),
      }),
      "preorder_schedule_change",
    );
    const unknown = redactBuilderEvaluationFailure(
      {
        code: "ai_output_invalid",
        cause: new Error("raw unknown output marker"),
      },
      "add_cambridge_preorder_collection",
    );
    const provider = redactBuilderEvaluationFailure(
      {
        code: "ai_provider_unavailable",
        cause: new Error("raw provider marker"),
      },
      "corporate_catering_enquiries",
    );
    const emitted = [semantic, structural, unknown, provider];

    expect(emitted).toEqual([
      {
        scenario_id: "preorder_phone_optional",
        error_code: "ai_output_invalid",
        validation_stage: "semantic",
        validation_reason_code: "existing_object_unknown",
      },
      {
        scenario_id: "preorder_schedule_change",
        error_code: "ai_output_invalid",
        validation_stage: "structural",
        validation_reason_code: "output_contract_invalid",
      },
      {
        scenario_id: "add_cambridge_preorder_collection",
        error_code: "ai_output_invalid",
        validation_stage: "unknown",
        validation_reason_code: "unknown_output_invalid",
      },
      {
        scenario_id: "corporate_catering_enquiries",
        error_code: "ai_provider_unavailable",
      },
    ]);
    for (const failure of emitted) {
      expect(builderEvaluationProviderFailureSchema.parse(failure)).toEqual(
        failure,
      );
    }
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain("raw structural message marker");
    expect(serialized).not.toContain("secret_path");
    expect(serialized).not.toContain("raw input marker");
    expect(serialized).not.toContain("raw unknown output marker");
    expect(serialized).not.toContain("raw provider marker");

    expect(
      builderEvaluationTopLevelFailureSchema.parse({
        evaluation_error_code: "evaluation_setup_failed",
      }),
    ).toEqual({ evaluation_error_code: "evaluation_setup_failed" });
  });

  it("uses a scenario-free bounded setup-failure envelope", () => {
    const liveScript = fs.readFileSync(
      path.join(repositoryRoot, "evaluations", "builder-planning.live.eval.ts"),
      "utf8",
    );
    expect(liveScript).toContain("evaluation_error_code");
    expect(liveScript).toContain("evaluation_setup_failed");
    expect(liveScript).not.toContain("preorder_phone_optional");
    expect(liveScript).not.toContain("error.message");
    expect(liveScript).not.toContain("cause");
  });

  it("redacts provider failures and never emits raw provider data or the key", async () => {
    const emitted: unknown[] = [];
    const rawProviderData = "raw-provider-body-marker";
    const key = "synthetic-server-key-marker";
    await runLiveBuilderEvaluation(
      {
        RUN_LIVE_OPENAI_EVAL: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: key,
      },
      {
        loadProductionExecution: async () => ({
          execute: async () => {
            throw {
              code: "ai_provider_unavailable",
              cause: rawProviderData,
              accounting: {
                inputTokens: 12,
                outputTokens: 3,
              },
            };
          },
        }),
        now: () => 10,
        emit: (value) => emitted.push(value),
      },
    );
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain(rawProviderData);
    expect(serialized).not.toContain(key);
    expect(emitted.slice(0, 8)).toEqual(
      builderEvaluationScenarios.map(({ id }) => ({
        scenario_id: id,
        error_code: "ai_provider_unavailable",
      })),
    );
  });

  it("is unreachable from application routes, Server Actions, and client modules", () => {
    const sourceFiles = fs
      .readdirSync(path.join(repositoryRoot, "src"), {
        recursive: true,
        withFileTypes: true,
      })
      .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name));
    const applicationFiles = sourceFiles.filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return (
        file.includes(`${path.sep}src${path.sep}app${path.sep}`) ||
        /^\s*["']use client["'];/m.test(source) ||
        /^\s*["']use server["'];/m.test(source)
      );
    });
    for (const file of applicationFiles) {
      expect(fs.readFileSync(file, "utf8"), file).not.toMatch(
        /ai\/evaluation|builder-planning\.live\.eval|synthetic-business-context/,
      );
    }
  });

  it("contains no persistence, file writing, second prompt/task/model/provider, or mutation surface", () => {
    const evaluationFiles = [
      ...fs
        .readdirSync(path.join(repositoryRoot, "src", "ai", "evaluation"), {
          recursive: true,
          withFileTypes: true,
        })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name)),
      ...fs
        .readdirSync(path.join(repositoryRoot, "evaluations"), {
          recursive: true,
          withFileTypes: true,
        })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name)),
    ];
    const source = evaluationFiles
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /writeFile|appendFile|createWriteStream|\.from\(|\.rpc\(|createAdminClient|SupabaseClient/,
    );
    expect(source).not.toMatch(
      /buildInstruction|RegisteredAiTask|new\s+OpenAiResponsesStructuredProvider|class\s+\w*Provider|ConfigurationChangeService|proposeChangeSet|createLocation|createRecord/,
    );
    expect(source).not.toMatch(/NEXT_PUBLIC_|baseURL|modelOverride/i);
  });
});
