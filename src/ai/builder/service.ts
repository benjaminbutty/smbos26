import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SupabaseAiAccountingService,
  type AiAccountingStore,
} from "../accounting/service";
import { createBusinessAiExecutionOrchestrator } from "../business-execution";
import {
  projectAiBusinessModelContext,
  serializeAiBusinessModelContext,
} from "../context/projector";
import {
  builderConfigurationDraftTaskInputSchema,
  builderConfigurationDraftTaskV1,
} from "../configuration-drafting/task";
import {
  builderConfigurationDraftOutputSchema,
  type BuilderConfigurationDraftOutput,
} from "../configuration-drafting/schemas";
import {
  builderPreorderAmendmentOutputSchema,
  builderPreorderAmendmentTaskInputBaseSchema,
} from "../preorder-amendment/schemas";
import { builderPreorderAmendmentTaskV1 } from "../preorder-amendment/task";
import { builderConfigurationProposalService } from "../configuration-proposal/service";
import {
  builderConfigurationProposalResultSchema,
  type BuilderConfigurationProposalRequest,
  type BuilderConfigurationProposalResult,
} from "../configuration-proposal/contracts";
import {
  builderPreorderAmendmentProposalResultSchema,
  type BuilderPreorderAmendmentProposalRequest,
  type BuilderPreorderAmendmentProposalResult,
} from "../preorder-amendment/contracts";
import { builderPreorderAmendmentProposalService } from "../preorder-amendment/proposal-service";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
} from "../planning/schemas";
import { AiBusinessContextError } from "../context/errors";
import type { Database } from "../../db/supabase/database.types";
import {
  BUILDER_ORCHESTRATION_MAX_OWNER_REQUEST_BYTES,
  BUILDER_UNSUPPORTED_MESSAGES,
  builderOrchestrationRequestSchema,
  builderOrchestrationResultSchema,
  type BuilderOrchestrationRequest,
  type BuilderOrchestrationResult,
  type BuilderReadyPlanningOutput,
} from "./contracts";
import { AiBuilderError } from "./errors";
import {
  createBuilderAiRuntime,
  createBuilderExecutionCore,
  type BuilderAiRuntime,
  type BuilderExecutionCore,
} from "./runtime";
import type { AuthoritativeAiBusinessContext } from "../../core/configuration/builder-context-source";
import { loadAuthoritativeAiBusinessContext } from "../../core/configuration/builder-context-source";

type SessionClient = SupabaseClient<Database>;

interface BuilderProposalService {
  propose(
    client: SessionClient,
    input: unknown,
  ): Promise<BuilderConfigurationProposalResult>;
}

interface BuilderPreorderAmendmentProposalService {
  propose(
    client: SessionClient,
    input: unknown,
  ): Promise<BuilderPreorderAmendmentProposalResult>;
}

interface BuilderOrchestrationDependencies {
  loadContext(
    client: SessionClient,
    input: { businessId: string },
  ): Promise<AuthoritativeAiBusinessContext>;
  createRuntime(): BuilderAiRuntime;
  createExecution(runtime: BuilderAiRuntime): BuilderExecutionCore;
  createAccounting(
    client: SessionClient,
    context: { businessId: string; actorId: string },
  ): AiAccountingStore;
  proposalService: BuilderProposalService;
  preorderAmendmentProposalService: BuilderPreorderAmendmentProposalService;
  generateExecutionId(): string;
}

function parseRequest(input: unknown): BuilderOrchestrationRequest {
  const parsed = builderOrchestrationRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new AiBuilderError("ai_builder_request_invalid", {
      cause: parsed.error,
    });
  }
  const byteLength = new TextEncoder().encode(
    parsed.data.ownerRequest,
  ).byteLength;
  if (byteLength > BUILDER_ORCHESTRATION_MAX_OWNER_REQUEST_BYTES) {
    throw new AiBuilderError("ai_builder_request_invalid");
  }
  return parsed.data;
}

function projectContext(authoritative: AuthoritativeAiBusinessContext) {
  const projection = projectAiBusinessModelContext(authoritative.source);
  return Object.freeze({
    ...projection,
    serialized: serializeAiBusinessModelContext(projection.modelContext),
  });
}

function assertInitialContext(
  context: AuthoritativeAiBusinessContext,
  businessId: string,
): void {
  if (context.executionContext.businessId !== businessId) {
    throw new AiBusinessContextError("ai_context_inconsistent");
  }
}

function contextMatches(
  first: AuthoritativeAiBusinessContext,
  firstSerialized: string,
  second: AuthoritativeAiBusinessContext,
  secondSerialized: string,
): boolean {
  return (
    first.executionContext.businessId === second.executionContext.businessId &&
    first.executionContext.actorId === second.executionContext.actorId &&
    first.currentness.baseVersionId === second.currentness.baseVersionId &&
    first.currentness.headRevision === second.currentness.headRevision &&
    firstSerialized === secondSerialized
  );
}

function builderContextStale(): never {
  throw new AiBuilderError("ai_builder_context_stale");
}

function unsupportedResult(
  reasonCode:
    | "operational_plan_unavailable"
    | "mixed_plan_unavailable"
    | "configuration_category_unavailable",
): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state: "unsupported",
    reason_code: reasonCode,
    message: BUILDER_UNSUPPORTED_MESSAGES[reasonCode],
  });
}

function preorderAmbiguityClarification(): BuilderOrchestrationResult {
  return builderOrchestrationResultSchema.parse({
    schema_version: 1,
    state: "needs_clarification",
    clarification: builderPlanOutputSchema.parse({
      schema_version: 1,
      state: "needs_clarification",
      understanding: "The request changes a preorder collection experience.",
      known_requirements: [],
      assumptions: [],
      questions: [
        {
          reference: "question_1",
          question: "Which collection experience should this change?",
          reason:
            "More than one active collection experience is available, so the request needs one clear choice.",
          response_style: "free_text",
        },
      ],
      unsupported_requirements: [],
    }),
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function classifyReadyPlan(
  plan: BuilderReadyPlanningOutput,
  context: ReturnType<typeof projectContext>["modelContext"],
): "configuration_draft" | "preorder_amendment" | BuilderOrchestrationResult {
  const steps = plan.plan.steps;
  const hasOperational = steps.some((step) => step.lane === "operational");
  const hasConfiguration = steps.some((step) => step.lane === "configuration");
  if (hasOperational && hasConfiguration) {
    return unsupportedResult("mixed_plan_unavailable");
  }
  if (hasOperational) {
    return unsupportedResult("operational_plan_unavailable");
  }

  const preorderCategories = new Set(["configure_preorder", "define_field"]);
  if (steps.some((step) => step.category === "configure_preorder")) {
    if (
      steps.some(
        (step) =>
          step.lane !== "configuration" ||
          !preorderCategories.has(step.category),
      )
    ) {
      return unsupportedResult("configuration_category_unavailable");
    }
    if (
      context.preorder_experiences.filter(({ is_active }) => is_active)
        .length === 0
    ) {
      return unsupportedResult("configuration_category_unavailable");
    }
    if (
      context.preorder_experiences.filter(({ is_active }) => is_active).length >
      1
    ) {
      return preorderAmbiguityClarification();
    }
    return "preorder_amendment";
  }

  const acceptedCategories = new Set([
    "define_object",
    "define_field",
    "define_relationship",
    "configure_view",
    "configure_form",
    "configure_page",
  ]);
  if (
    steps.some(
      (step) =>
        step.lane !== "configuration" || !acceptedCategories.has(step.category),
    )
  ) {
    return unsupportedResult("configuration_category_unavailable");
  }
  return "configuration_draft";
}

function planningOutput(output: unknown): BuilderPlanOutput {
  return builderPlanOutputSchema.parse(output);
}

function draftOutput(output: unknown): BuilderConfigurationDraftOutput {
  return builderConfigurationDraftOutputSchema.parse(output);
}

export function createBuilderOrchestrationService(
  overrides: Partial<BuilderOrchestrationDependencies> = {},
) {
  const dependencies: BuilderOrchestrationDependencies = {
    loadContext: overrides.loadContext ?? loadAuthoritativeAiBusinessContext,
    createRuntime:
      overrides.createRuntime ??
      (() =>
        createBuilderAiRuntime({
          AI_PROVIDER: process.env.AI_PROVIDER,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        })),
    createExecution: overrides.createExecution ?? createBuilderExecutionCore,
    createAccounting:
      overrides.createAccounting ??
      ((client, context) => new SupabaseAiAccountingService(client, context)),
    proposalService:
      overrides.proposalService ?? builderConfigurationProposalService,
    preorderAmendmentProposalService:
      overrides.preorderAmendmentProposalService ??
      builderPreorderAmendmentProposalService,
    generateExecutionId:
      overrides.generateExecutionId ?? (() => crypto.randomUUID()),
  };

  return Object.freeze({
    async run(
      client: SessionClient,
      input: unknown,
    ): Promise<BuilderOrchestrationResult> {
      const request = parseRequest(input);
      const initial = await dependencies.loadContext(client, {
        businessId: request.businessId,
      });
      assertInitialContext(initial, request.businessId);
      const initialProjection = projectContext(initial);
      const planningInput = {
        schema_version: 1 as const,
        owner_request: request.ownerRequest,
        business_context: initialProjection.modelContext,
      };

      const runtime = dependencies.createRuntime();
      const execution = dependencies.createExecution(runtime);
      const accounting = dependencies.createAccounting(
        client,
        initial.executionContext,
      );
      const orchestrator = createBusinessAiExecutionOrchestrator({
        accounting,
        execution,
        generateExecutionId: dependencies.generateExecutionId,
      });

      const planningExecution = await orchestrator.execute(
        "builder_plan_v1",
        planningInput,
      );
      const plan = planningOutput(planningExecution.output);

      const afterPlanning = await dependencies.loadContext(client, {
        businessId: request.businessId,
      });
      const afterPlanningProjection = projectContext(afterPlanning);
      if (
        !contextMatches(
          initial,
          initialProjection.serialized,
          afterPlanning,
          afterPlanningProjection.serialized,
        )
      ) {
        builderContextStale();
      }

      if (plan.state === "needs_clarification") {
        return deepFreeze(
          builderOrchestrationResultSchema.parse({
            schema_version: 1,
            state: "needs_clarification",
            clarification: plan,
          }),
        );
      }

      const route = classifyReadyPlan(plan, initialProjection.modelContext);
      if (typeof route !== "string") {
        return deepFreeze(route);
      }

      if (route === "preorder_amendment") {
        const taskInput = builderPreorderAmendmentTaskInputBaseSchema.parse({
          schema_version: 1,
          owner_request: request.ownerRequest,
          business_context: initialProjection.modelContext,
          ready_plan: plan,
        });
        const amendmentExecution = await orchestrator.execute(
          "builder_preorder_amendment_v1",
          taskInput,
        );
        const draft = builderPreorderAmendmentOutputSchema.parse(
          amendmentExecution.output,
        );
        const validatedDraft = builderPreorderAmendmentTaskV1.validateOutput
          ? builderPreorderAmendmentTaskV1.validateOutput(taskInput, draft)
          : draft;
        const proposalInput: BuilderPreorderAmendmentProposalRequest = {
          businessId: request.businessId,
          expectedCurrentness: initial.currentness,
          taskInput,
          draft: validatedDraft,
        };
        const proposal = builderPreorderAmendmentProposalResultSchema.parse(
          await dependencies.preorderAmendmentProposalService.propose(
            client,
            proposalInput,
          ),
        );
        return deepFreeze(
          builderOrchestrationResultSchema.parse({
            schema_version: 1,
            state: "proposed",
            proposal_id: proposal.proposal_id,
            status: proposal.status,
            base_version_id: proposal.base_version_id,
            base_head_revision: proposal.base_head_revision,
            operation_count: proposal.operation_count,
            summary: proposal.summary,
          }),
        );
      }

      const taskInput = builderConfigurationDraftTaskInputSchema.parse({
        schema_version: 1,
        owner_request: request.ownerRequest,
        business_context: initialProjection.modelContext,
        ready_plan: plan,
      });
      const draftExecution = await orchestrator.execute(
        "builder_configuration_draft_v1",
        taskInput,
      );
      const draft = draftOutput(draftExecution.output);
      const validatedDraft = builderConfigurationDraftTaskV1.validateOutput
        ? builderConfigurationDraftTaskV1.validateOutput(taskInput, draft)
        : draft;

      const proposalInput: BuilderConfigurationProposalRequest = {
        businessId: request.businessId,
        expectedCurrentness: initial.currentness,
        taskInput,
        draft: validatedDraft,
      };
      const proposal = builderConfigurationProposalResultSchema.parse(
        await dependencies.proposalService.propose(client, proposalInput),
      );
      return deepFreeze(
        builderOrchestrationResultSchema.parse({
          schema_version: 1,
          state: "proposed",
          proposal_id: proposal.proposal_id,
          status: proposal.status,
          base_version_id: proposal.base_version_id,
          base_head_revision: proposal.base_head_revision,
          operation_count: proposal.operation_count,
          summary: validatedDraft.summary,
        }),
      );
    },
  });
}

export const builderOrchestrationService = createBuilderOrchestrationService();
