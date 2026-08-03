import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
  BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  OPENAI_BUILDER_PREORDER_AMENDMENT_MODEL_KEY,
  OPENAI_BUILDER_PREORDER_AMENDMENT_REASONING_EFFORT,
  disabledExecutionPolicies,
  openAiBuilderPreorderAmendmentPolicy,
} from "../src/ai/policies";
import {
  builderPreorderAmendmentOutputSchema,
  builderPreorderAmendmentTaskInputBaseSchema,
} from "../src/ai/preorder-amendment/schemas";
import { builderPreorderAmendmentTaskV1 } from "../src/ai/preorder-amendment/task";
import {
  BuilderPreorderAmendmentValidationError,
  validateBuilderPreorderAmendmentOutput,
} from "../src/ai/preorder-amendment/validation";
import {
  builderPreorderAmendmentEvaluationScenarios,
  builderPreorderAmendmentEvaluationPlans,
} from "../src/ai/evaluation/preorder-amendment/scenarios";
import { evaluateBuilderPreorderAmendment } from "../src/ai/evaluation/preorder-amendment/evaluator";
import {
  BUILDER_PREORDER_AMENDMENT_QUALIFICATION_HARD_CEILING_MICROUSD,
  BUILDER_PREORDER_AMENDMENT_RELIABILITY_HARD_CEILING_MICROUSD,
  deriveBuilderPreorderAmendmentQualificationEnvelope,
  deriveBuilderPreorderAmendmentReliabilityEnvelope,
} from "../src/ai/evaluation/preorder-amendment/envelope";
import { syntheticBusinessContext } from "../evaluations/fixtures/synthetic-business-context";
import {
  runLiveBuilderPreorderAmendmentQualification,
  runLiveBuilderPreorderAmendmentReliability,
} from "../src/ai/evaluation/preorder-amendment/live";

function inputFor(
  scenario: (typeof builderPreorderAmendmentEvaluationScenarios)[number],
) {
  return builderPreorderAmendmentTaskInputBaseSchema.parse({
    schema_version: 1,
    owner_request: scenario.owner_request,
    business_context: syntheticBusinessContext,
    ready_plan: builderPreorderAmendmentEvaluationPlans[scenario.id],
    preorder_scope: {
      preorder_key: "bakery_preorder",
      selection: "sole_active",
    },
  });
}

describe("Builder preorder amendment task and evaluation", () => {
  it("has exactly eight frozen synthetic scenarios", () => {
    expect(builderPreorderAmendmentEvaluationScenarios).toHaveLength(8);
    expect(
      builderPreorderAmendmentEvaluationScenarios.map(({ id }) => id),
    ).toEqual([
      "phone_optional",
      "remove_sunday",
      "cutoff_to_72",
      "remove_sunday_cutoff_72",
      "occasion_optional_short",
      "gift_message_optional_long",
      "existing_question_wording_help",
      "phone_optional_and_occasion",
    ]);
    expect(Object.isFrozen(builderPreorderAmendmentEvaluationScenarios)).toBe(
      true,
    );
  });

  it("accepts each code-owned output through the real semantic validator", () => {
    for (const scenario of builderPreorderAmendmentEvaluationScenarios) {
      const input = inputFor(scenario);
      expect(() =>
        validateBuilderPreorderAmendmentOutput(input, scenario.expected_output),
      ).not.toThrow();
      const report = evaluateBuilderPreorderAmendment(
        scenario,
        scenario.expected_output,
        {
          attempts: 1,
          inputTokens: 100,
          outputTokens: 50,
          elapsedMs: 1,
        },
      );
      expect(report.passed).toBe(true);
    }
  });

  it("keeps the output strict, source-referenced and free of trusted fields", () => {
    const scenario = builderPreorderAmendmentEvaluationScenarios[4]!;
    expect(
      builderPreorderAmendmentOutputSchema.safeParse({
        ...scenario.expected_output,
        business_id: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
    expect(
      builderPreorderAmendmentOutputSchema.safeParse({
        ...scenario.expected_output,
        amendments: [
          {
            ...scenario.expected_output.amendments[0],
            field_key: "forged_key",
            position: 3,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicated properties, uncovered steps and no-ops", () => {
    const phone = builderPreorderAmendmentEvaluationScenarios[0]!;
    const input = inputFor(phone);
    const duplicate = {
      ...phone.expected_output,
      amendments: [
        ...phone.expected_output.amendments,
        phone.expected_output.amendments[0]!,
      ],
    };
    expect(() =>
      validateBuilderPreorderAmendmentOutput(input, duplicate),
    ).toThrow(BuilderPreorderAmendmentValidationError);

    const noOp = {
      ...phone.expected_output,
      amendments: [
        {
          ...phone.expected_output.amendments[0]!,
          required: true,
        },
      ],
    };
    expect(() => validateBuilderPreorderAmendmentOutput(input, noOp)).toThrow(
      "bounded semantic checks",
    );
  });

  it("derives the separate disabled and Terra policy envelope", () => {
    expect(
      disabledExecutionPolicies[BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY],
    ).toMatchObject({
      maxInputBytes: 256 * 1024,
      maxBillableInputTokens: 80_000,
      maxOutputTokens: 4_096,
      timeoutMs: 30_000,
      maxAttempts: 2,
    });
    expect(openAiBuilderPreorderAmendmentPolicy).toMatchObject({
      key: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
      modelKey: OPENAI_BUILDER_PREORDER_AMENDMENT_MODEL_KEY,
      providerKey: "openai",
    });
    expect(OPENAI_BUILDER_PREORDER_AMENDMENT_REASONING_EFFORT).toBe("medium");
    expect(deriveBuilderPreorderAmendmentQualificationEnvelope()).toMatchObject(
      {
        reservedCostMicrousdPerExecution: 522_880,
        reservedCostMicrousd: 4_183_040,
        hardCeilingMicrousd:
          BUILDER_PREORDER_AMENDMENT_QUALIFICATION_HARD_CEILING_MICROUSD,
      },
    );
    expect(deriveBuilderPreorderAmendmentReliabilityEnvelope()).toMatchObject({
      reservedCostMicrousd: 12_549_120,
      hardCeilingMicrousd:
        BUILDER_PREORDER_AMENDMENT_RELIABILITY_HARD_CEILING_MICROUSD,
    });
    expect(builderPreorderAmendmentTaskV1.policyKey).toBe(
      BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
    );
  });

  it("runs both live gates only through injected execution and exact opt-in flags", async () => {
    const execute = vi.fn(async (_taskKey: string, input: unknown) => {
      const parsed = builderPreorderAmendmentTaskInputBaseSchema.parse(input);
      const scenario = builderPreorderAmendmentEvaluationScenarios.find(
        ({ owner_request }) => owner_request === parsed.owner_request,
      );
      if (!scenario) throw new Error("Unknown synthetic scenario.");
      return {
        output: scenario.expected_output,
        accounting: {
          attemptsStarted: 1,
          inputTokens: 100,
          outputTokens: 50,
          usageReported: true,
          usageComplete: true,
          providerInvocationStarted: true,
          failureBeforeProviderInvocation: false,
        },
      } as never;
    });
    const emit = vi.fn();
    const now = vi.fn().mockReturnValue(1);
    const qualification = await runLiveBuilderPreorderAmendmentQualification(
      {
        RUN_LIVE_OPENAI_PREORDER_AMENDMENT_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic",
      },
      { execute, emit, now },
    );
    expect(qualification).toMatchObject({ ran: true, passed: true });
    expect(execute).toHaveBeenCalledTimes(8);
    expect(emit).toHaveBeenCalledTimes(9);

    const reliability = await runLiveBuilderPreorderAmendmentReliability(
      {
        RUN_LIVE_OPENAI_PREORDER_AMENDMENT_RELIABILITY: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic",
      },
      { execute, emit: vi.fn(), now },
    );
    expect(reliability).toMatchObject({ ran: true, passed: true });
    expect(execute).toHaveBeenCalledTimes(32);

    const disabled = await runLiveBuilderPreorderAmendmentQualification(
      {
        RUN_LIVE_OPENAI_PREORDER_AMENDMENT_QUALIFICATION: "1",
        AI_PROVIDER: "disabled",
        OPENAI_API_KEY: "synthetic",
      },
      { execute },
    );
    expect(disabled).toEqual({ ran: false, passed: false, reports: [] });
  });

  it("stops each live gate after the first failed scenario", async () => {
    const failedOutput = {
      ...builderPreorderAmendmentEvaluationScenarios[0]!.expected_output,
      amendments: [
        {
          ...builderPreorderAmendmentEvaluationScenarios[0]!.expected_output
            .amendments[0]!,
          required: true,
        },
      ],
    };
    const execute = vi.fn(
      async () =>
        ({
          output: failedOutput,
          accounting: {
            attemptsStarted: 1,
            inputTokens: 100,
            outputTokens: 50,
            usageReported: true,
            usageComplete: true,
            providerInvocationStarted: true,
            failureBeforeProviderInvocation: false,
          },
        }) as never,
    );

    const qualification = await runLiveBuilderPreorderAmendmentQualification(
      {
        RUN_LIVE_OPENAI_PREORDER_AMENDMENT_QUALIFICATION: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic",
      },
      { execute, emit: vi.fn(), now: () => 1 },
    );
    expect(qualification).toMatchObject({ ran: true, passed: false });
    expect(execute).toHaveBeenCalledTimes(1);

    execute.mockClear();
    const reliability = await runLiveBuilderPreorderAmendmentReliability(
      {
        RUN_LIVE_OPENAI_PREORDER_AMENDMENT_RELIABILITY: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "synthetic",
      },
      { execute, emit: vi.fn(), now: () => 1 },
    );
    expect(reliability).toMatchObject({ ran: true, passed: false });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
