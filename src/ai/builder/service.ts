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
import { builderConfigurationProposalService } from "../configuration-proposal/service";
import {
  builderConfigurationProposalResultSchema,
  type BuilderConfigurationProposalRequest,
  type BuilderConfigurationProposalResult,
} from "../configuration-proposal/contracts";
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
): BuilderOrchestrationResult | undefined {
  const steps = plan.plan.steps;
  const hasOperational = steps.some((step) => step.lane === "operational");
  const hasConfiguration = steps.some((step) => step.lane === "configuration");
  if (hasOperational && hasConfiguration) {
    return unsupportedResult("mixed_plan_unavailable");
  }
  if (hasOperational) {
    return unsupportedResult("operational_plan_unavailable");
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
  return undefined;
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

      const unsupported = classifyReadyPlan(plan);
      if (unsupported) {
        return deepFreeze(unsupported);
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
