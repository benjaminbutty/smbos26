import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  AiAccountingStore,
  BusinessAiSettings,
} from "../src/ai/accounting/service";
import { createBuilderOrchestrationService } from "../src/ai/builder/service";
import type {
  BuilderAiRuntime,
  BuilderExecutionCore,
} from "../src/ai/builder/runtime";
import type { PreparedAiExecution } from "../src/ai/execution";
import {
  openAiBuilderPlanningPolicy,
  openAiBuilderPreorderAmendmentPolicy,
} from "../src/ai/policies";
import {
  BUILDER_PREORDER_AMENDMENT_PROPOSAL_TITLE,
  builderPreorderAmendmentProposalResultSchema,
} from "../src/ai/preorder-amendment/contracts";
import { BuilderPreorderAmendmentProposalError } from "../src/ai/preorder-amendment/errors";
import { createBuilderPreorderAmendmentProposalService } from "../src/ai/preorder-amendment/proposal-service";
import { resolvePreorderTarget } from "../src/ai/preorder-amendment/targeting";
import { validateBuilderPreorderAmendmentOutput } from "../src/ai/preorder-amendment/validation";
import type { ProposeConfigurationChangeInput } from "../src/core/configuration/schemas";
import { composePreorderQuestionAmendment } from "../src/core/configuration/manual-amendments/service";
import type { Database } from "../src/db/supabase/database.types";
import {
  preorderAmendmentAuthoritative,
  preorderAmendmentDraft,
  preorderAmendmentFixtureIds,
  preorderAmendmentReadyPlan,
  preorderAmendmentSnapshot,
  preorderAmendmentSource,
  preorderAmendmentTaskInput,
} from "./support/preorder-amendment-fixtures";

type Client = SupabaseClient<Database>;

const enabledSettings = {
  business_id: preorderAmendmentFixtureIds.business,
  is_enabled: true,
  daily_request_limit: 100,
  daily_input_token_limit: 1_000_000,
  daily_output_token_limit: 1_000_000,
  daily_cost_limit_microusd: 100_000_000,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  updated_by: null,
} satisfies BusinessAiSettings;

function proposalResponse(input: ProposeConfigurationChangeInput): never {
  return {
    id: preorderAmendmentFixtureIds.proposal,
    business_id: preorderAmendmentFixtureIds.business,
    requested_by: preorderAmendmentFixtureIds.actor,
    status: "proposed" as const,
    kind: "change" as const,
    base_version_id: input.expectedBaseVersionId,
    base_head_revision: input.expectedHeadRevision,
    title: input.title,
    description: input.description,
    operations_schema_version: 1 as const,
    operations_json: input.operations,
  } as never;
}

function proposalRequest() {
  const authoritative = preorderAmendmentAuthoritative();
  return {
    businessId: preorderAmendmentFixtureIds.business,
    expectedCurrentness: {
      baseVersionId: preorderAmendmentFixtureIds.version,
      headRevision: 1,
    },
    taskInput: preorderAmendmentTaskInput(authoritative),
    draft: preorderAmendmentDraft(),
  };
}

function accounting(): AiAccountingStore {
  return {
    readSettings: vi.fn(async () => enabledSettings),
    reserve: vi.fn(async () => ({}) as never),
    settle: vi.fn(async () => ({}) as never),
  };
}

describe("Builder preorder amendment proposal boundary", () => {
  it("performs two exact-head reads, one trusted composition and one M5 proposal", async () => {
    const first = preorderAmendmentAuthoritative();
    const second = preorderAmendmentAuthoritative();
    const loadContext = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const proposeChangeSet = vi.fn(
      async (input: ProposeConfigurationChangeInput) => proposalResponse(input),
    );
    const createProposalAdapter = vi.fn(() => ({ proposeChangeSet }));
    const service = createBuilderPreorderAmendmentProposalService({
      loadContext,
      createProposalAdapter,
    });

    const result = await service.propose({} as Client, proposalRequest());

    expect(loadContext).toHaveBeenCalledTimes(2);
    expect(createProposalAdapter).toHaveBeenCalledWith(
      {},
      second.executionContext,
    );
    expect(proposeChangeSet).toHaveBeenCalledTimes(1);
    expect(proposeChangeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedBaseVersionId: preorderAmendmentFixtureIds.version,
        expectedHeadRevision: 1,
        title: BUILDER_PREORDER_AMENDMENT_PROPOSAL_TITLE,
        operations: expect.arrayContaining([
          expect.objectContaining({ op: "set_field", key: "phone" }),
          expect.objectContaining({
            op: "set_preorder_experience",
            key: "bakery_preorder",
          }),
        ]),
      }),
    );
    const manualOperations = composePreorderQuestionAmendment(
      preorderAmendmentSnapshot(),
      {
        intent: "update_preorder_question",
        preorderKey: "bakery_preorder",
        target: "customer",
        fieldKey: "phone",
        label: "Phone",
        helpText: "We will only call about your order.",
        required: false,
      },
    ).operations;
    expect(proposeChangeSet).toHaveBeenCalledWith(
      expect.objectContaining({ operations: manualOperations }),
    );
    expect(result).toMatchObject({
      schema_version: 1,
      proposal_id: preorderAmendmentFixtureIds.proposal,
      status: "proposed",
      base_version_id: preorderAmendmentFixtureIds.version,
      base_head_revision: 1,
      operation_count: 2,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("fails closed on second-read drift without retrying or proposing", async () => {
    const first = preorderAmendmentAuthoritative();
    const changedSource = preorderAmendmentSource();
    changedSource.business.name = "Changed Bakery";
    const second = preorderAmendmentAuthoritative({ source: changedSource });
    const loadContext = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const proposeChangeSet = vi.fn(async () => ({}) as never);
    const service = createBuilderPreorderAmendmentProposalService({
      loadContext,
      createProposalAdapter: vi.fn(() => ({ proposeChangeSet })),
    });

    await expect(
      service.propose({} as Client, proposalRequest()),
    ).rejects.toMatchObject({
      code: "ai_preorder_amendment_context_stale",
    });
    expect(loadContext).toHaveBeenCalledTimes(2);
    expect(proposeChangeSet).not.toHaveBeenCalled();
  });

  it("exposes only finite safe proposal errors", () => {
    const error = new BuilderPreorderAmendmentProposalError(
      "ai_preorder_amendment_request_invalid",
      { cause: { marker: "private-input" } },
    );
    expect(error.toJSON()).toEqual({
      code: "ai_preorder_amendment_request_invalid",
      message: "The preorder amendment request was not valid.",
    });
    expect(JSON.stringify(error)).not.toContain("private-input");
  });

  it("rejects a request when more than one active preorder could be targeted", () => {
    const snapshot = preorderAmendmentSnapshot();
    const existing = snapshot.preorder_experiences[0]!;
    snapshot.preorder_experiences.push({
      ...existing,
      id: "70000000-0000-4000-8000-000000000021",
      key: "second_preorder",
    });
    const input = preorderAmendmentTaskInput(
      preorderAmendmentAuthoritative({
        source: preorderAmendmentSource(snapshot),
      }),
    );

    expect(() =>
      validateBuilderPreorderAmendmentOutput(input, preorderAmendmentDraft()),
    ).toThrowError(
      expect.objectContaining({ diagnosticCode: "preorder_key_ambiguous" }),
    );
  });

  it("accepts one exact active preorder key from the request scope", () => {
    const snapshot = preorderAmendmentSnapshot();
    const existing = snapshot.preorder_experiences[0]!;
    snapshot.preorder_experiences.push({
      ...existing,
      id: "70000000-0000-4000-8000-000000000024",
      key: "second_preorder",
    });
    const authoritative = preorderAmendmentAuthoritative({
      source: preorderAmendmentSource(snapshot),
    });
    const input = preorderAmendmentTaskInput(authoritative, {
      ownerRequest: "Make phone optional for bakery_preorder.",
      preorderScope: {
        preorder_key: "bakery_preorder",
        selection: "explicit_request",
      },
    });

    expect(() =>
      validateBuilderPreorderAmendmentOutput(input, preorderAmendmentDraft()),
    ).not.toThrow();
  });

  it.each([
    ["unknown", "forged_preorder", "preorder_key_unknown_or_inactive"],
    ["inactive", "archived_preorder", "preorder_key_unknown_or_inactive"],
  ] as const)(
    "fails safely for an %s preorder key",
    (kind, key, diagnosticCode) => {
      const snapshot = preorderAmendmentSnapshot();
      if (kind === "inactive") {
        snapshot.preorder_experiences.push({
          ...snapshot.preorder_experiences[0]!,
          id: "70000000-0000-4000-8000-000000000025",
          key,
          is_active: false,
        });
      }
      const input = preorderAmendmentTaskInput(
        preorderAmendmentAuthoritative({
          source: preorderAmendmentSource(snapshot),
        }),
        {
          ownerRequest: `Make phone optional for preorder_key=${key}.`,
          preorderScope: { preorder_key: key, selection: "explicit_request" },
        },
      );

      expect(() =>
        validateBuilderPreorderAmendmentOutput(
          input,
          preorderAmendmentDraft({ preorder_key: key }),
        ),
      ).toThrowError(expect.objectContaining({ diagnosticCode }));
    },
  );

  it("fails closed when an explicit active preorder key is duplicated", () => {
    const input = preorderAmendmentTaskInput();
    const duplicateContext = {
      ...input.business_context,
      preorder_experiences: [
        ...input.business_context.preorder_experiences,
        { ...input.business_context.preorder_experiences[0]! },
      ],
    };

    expect(
      resolvePreorderTarget(
        duplicateContext,
        "Make phone optional for preorder_key=bakery_preorder.",
      ),
    ).toEqual({ state: "unknown" });
  });

  it("rejects a draft that switches away from the authorized preorder", () => {
    const snapshot = preorderAmendmentSnapshot();
    const existing = snapshot.preorder_experiences[0]!;
    snapshot.preorder_experiences.push({
      ...existing,
      id: "70000000-0000-4000-8000-000000000026",
      key: "second_preorder",
    });
    const input = preorderAmendmentTaskInput(
      preorderAmendmentAuthoritative({
        source: preorderAmendmentSource(snapshot),
      }),
      {
        ownerRequest: "Make phone optional for bakery_preorder.",
        preorderScope: {
          preorder_key: "bakery_preorder",
          selection: "explicit_request",
        },
      },
    );

    expect(() =>
      validateBuilderPreorderAmendmentOutput(
        input,
        preorderAmendmentDraft({ preorder_key: "second_preorder" }),
      ),
    ).toThrowError(
      expect.objectContaining({
        diagnosticCode: "preorder_key_scope_mismatch",
      }),
    );
  });
});

describe("Builder Phase 9A orchestration seam", () => {
  it("returns clarification without amendment execution when active preorders are ambiguous", async () => {
    const snapshot = preorderAmendmentSnapshot();
    const existing = snapshot.preorder_experiences[0]!;
    snapshot.preorder_experiences.push({
      ...existing,
      id: "70000000-0000-4000-8000-000000000022",
      key: "second_preorder",
    });
    const authoritative = preorderAmendmentAuthoritative({
      source: preorderAmendmentSource(snapshot),
    });
    const prepared: PreparedAiExecution = {
      descriptor: {
        taskKey: "builder_plan_v1",
        taskVersion: 1,
        purposeLabel: "test",
        policy: openAiBuilderPlanningPolicy,
      },
    };
    const execution: BuilderExecutionCore = {
      prepare: vi.fn(() => prepared),
      executePrepared: vi.fn(async () => ({
        output: preorderAmendmentReadyPlan(),
        metadata: {
          taskKey: "builder_plan_v1",
          taskVersion: 1,
          purposeLabel: "test",
          providerKey: "openai",
          modelKey: "gpt-5.6-terra",
          attempts: 1,
          usage: { inputTokens: 10, outputTokens: 10, complete: true },
        },
        accounting: {
          attemptsStarted: 1,
          inputTokens: 10,
          outputTokens: 10,
          usageReported: true,
          usageComplete: true,
          providerInvocationStarted: true,
          failureBeforeProviderInvocation: false,
        },
      })),
    };
    const preorderProposalService = { propose: vi.fn() };
    const accountingStore = accounting();
    const service = createBuilderOrchestrationService({
      loadContext: vi
        .fn()
        .mockResolvedValueOnce(authoritative)
        .mockResolvedValueOnce(authoritative),
      createRuntime: vi.fn(() => ({}) as BuilderAiRuntime),
      createExecution: vi.fn(() => execution),
      createAccounting: vi.fn(() => accountingStore),
      proposalService: { propose: vi.fn() },
      preorderAmendmentProposalService: preorderProposalService,
      generateExecutionId: vi
        .fn()
        .mockReturnValue("70000000-0000-4000-8000-000000000023"),
    });

    const result = await service.run({} as Client, {
      businessId: preorderAmendmentFixtureIds.business,
      ownerRequest: "Make the phone question optional.",
    });

    expect(result).toMatchObject({
      state: "needs_clarification",
      clarification: {
        questions: [
          {
            question: "Which collection experience should this change?",
          },
        ],
      },
    });
    expect(execution.prepare).toHaveBeenCalledTimes(1);
    expect(accountingStore.reserve).toHaveBeenCalledTimes(1);
    expect(accountingStore.settle).toHaveBeenCalledTimes(1);
    expect(preorderProposalService.propose).not.toHaveBeenCalled();
  });

  it("routes an active configure_preorder plan to the amendment task and proposal boundary", async () => {
    const snapshot = preorderAmendmentSnapshot();
    const existing = snapshot.preorder_experiences[0]!;
    snapshot.preorder_experiences.push({
      ...existing,
      id: "70000000-0000-4000-8000-000000000027",
      key: "second_preorder",
    });
    const authoritative = preorderAmendmentAuthoritative({
      source: preorderAmendmentSource(snapshot),
    });
    const planningOutput = preorderAmendmentReadyPlan();
    const amendmentOutput = preorderAmendmentDraft();
    const preparedOutputs = new WeakMap<object, unknown>();
    const preparedTasks: string[] = [];
    const planningInputs: unknown[] = [];
    const amendmentInputs: unknown[] = [];
    const execution: BuilderExecutionCore = {
      prepare: vi.fn((taskKey, input): PreparedAiExecution => {
        preparedTasks.push(taskKey);
        if (taskKey === "builder_plan_v1") {
          planningInputs.push(input);
        } else {
          amendmentInputs.push(input);
        }
        const prepared = {
          descriptor: {
            taskKey,
            taskVersion: 1,
            purposeLabel: "test",
            policy:
              taskKey === "builder_plan_v1"
                ? openAiBuilderPlanningPolicy
                : openAiBuilderPreorderAmendmentPolicy,
          },
        } satisfies PreparedAiExecution;
        preparedOutputs.set(prepared, {
          output:
            taskKey === "builder_plan_v1" ? planningOutput : amendmentOutput,
        });
        return prepared;
      }),
      executePrepared: vi.fn(async (prepared) => ({
        output:
          preparedOutputs.get(prepared) &&
          (preparedOutputs.get(prepared) as { output: unknown }).output,
        metadata: {
          taskKey: prepared.descriptor.taskKey,
          taskVersion: 1,
          purposeLabel: "test",
          providerKey: "openai",
          modelKey: "gpt-5.6-terra",
          attempts: 1,
          usage: { inputTokens: 10, outputTokens: 10, complete: true },
        },
        accounting: {
          attemptsStarted: 1,
          inputTokens: 10,
          outputTokens: 10,
          usageReported: true,
          usageComplete: true,
          providerInvocationStarted: true,
          failureBeforeProviderInvocation: false,
        },
      })),
    };
    const proposal = builderPreorderAmendmentProposalResultSchema.parse({
      schema_version: 1,
      proposal_id: preorderAmendmentFixtureIds.proposal,
      status: "proposed",
      base_version_id: preorderAmendmentFixtureIds.version,
      base_head_revision: 1,
      operation_count: 2,
      summary: "Make the phone question optional.",
    });
    const preorderProposalService = {
      propose: vi.fn(async (_client: Client, input: unknown) => {
        expect(input).toMatchObject({
          businessId: preorderAmendmentFixtureIds.business,
          expectedCurrentness: {
            baseVersionId: preorderAmendmentFixtureIds.version,
            headRevision: 1,
          },
          draft: amendmentOutput,
        });
        return proposal;
      }),
    };
    const service = createBuilderOrchestrationService({
      loadContext: vi
        .fn()
        .mockResolvedValueOnce(authoritative)
        .mockResolvedValueOnce(authoritative),
      createRuntime: vi.fn(() => ({}) as BuilderAiRuntime),
      createExecution: vi.fn(() => execution),
      createAccounting: vi.fn(() => accounting()),
      proposalService: { propose: vi.fn() },
      preorderAmendmentProposalService: preorderProposalService,
      generateExecutionId: vi
        .fn()
        .mockReturnValueOnce("70000000-0000-4000-8000-000000000019")
        .mockReturnValueOnce("70000000-0000-4000-8000-000000000020"),
    });

    const result = await service.run({} as Client, {
      businessId: preorderAmendmentFixtureIds.business,
      ownerRequest: "Make the phone question optional for bakery_preorder.",
    });

    expect(preparedTasks).toEqual([
      "builder_plan_v1",
      "builder_preorder_amendment_v1",
    ]);
    expect(planningInputs[0]).toMatchObject({
      owner_request: "Make the phone question optional for bakery_preorder.",
    });
    expect(amendmentInputs[0]).toMatchObject({
      owner_request: "Make the phone question optional for bakery_preorder.",
      ready_plan: planningOutput,
      preorder_scope: {
        preorder_key: "bakery_preorder",
        selection: "explicit_request",
      },
    });
    expect(preorderProposalService.propose).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      schema_version: 1,
      state: "proposed",
      proposal_id: preorderAmendmentFixtureIds.proposal,
      status: "proposed",
      base_version_id: preorderAmendmentFixtureIds.version,
      base_head_revision: 1,
      operation_count: 2,
      summary: "Make the phone question optional.",
    });
  });
});
