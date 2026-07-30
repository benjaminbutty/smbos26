import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import {
  loadAuthoritativeAiBusinessContext,
  type AuthoritativeAiBusinessContext,
} from "../../core/configuration/builder-context-source";
import { createBusinessAiExecutionService } from "../business-execution";
import {
  projectAiBusinessModelContext,
  serializeAiBusinessModelContext,
} from "../context/projector";
import type { AiExecutionResult } from "../execution";
import { AiPlanningError } from "./errors";
import {
  builderPlanOutputSchema,
  builderPlanTaskInputSchema,
  type BuilderPlanOutput,
} from "./schemas";

type SessionClient = SupabaseClient<Database>;

const planningRequestSchema = z
  .object({
    businessId: z.uuid(),
    ownerRequest: builderPlanTaskInputSchema.shape.owner_request,
  })
  .strict();

interface PlanningServiceDependencies {
  loadContext(
    client: SessionClient,
    input: { businessId: string },
  ): Promise<AuthoritativeAiBusinessContext>;
  executeTask(
    client: SessionClient,
    executionContext: { businessId: string; actorId: string },
    taskKey: "builder_plan_v1",
    input: unknown,
  ): Promise<AiExecutionResult>;
}

export interface BuilderPlanningResult {
  currentness: {
    baseVersionId: string;
    headRevision: number;
  };
  plan: BuilderPlanOutput;
  contextBytes: number;
  execution: {
    attempts: number;
    inputTokens: number;
    outputTokens: number;
    usageComplete: boolean;
  };
}

function project(authoritative: AuthoritativeAiBusinessContext) {
  const projected = projectAiBusinessModelContext(authoritative.source);
  return {
    ...projected,
    serialized: serializeAiBusinessModelContext(projected.modelContext),
  };
}

function contextIsCurrent(
  before: AuthoritativeAiBusinessContext,
  beforeSerialized: string,
  after: AuthoritativeAiBusinessContext,
  afterSerialized: string,
): boolean {
  return (
    before.currentness.baseVersionId === after.currentness.baseVersionId &&
    before.currentness.headRevision === after.currentness.headRevision &&
    beforeSerialized === afterSerialized
  );
}

export function createBuilderPlanningService(
  overrides: Partial<PlanningServiceDependencies> = {},
) {
  const dependencies: PlanningServiceDependencies = {
    loadContext: overrides.loadContext ?? loadAuthoritativeAiBusinessContext,
    executeTask:
      overrides.executeTask ??
      ((client, executionContext, taskKey, input) =>
        createBusinessAiExecutionService(client, executionContext).execute(
          taskKey,
          input,
        )),
  };

  return Object.freeze({
    async plan(
      client: SessionClient,
      input: { businessId: string; ownerRequest: string },
    ): Promise<BuilderPlanningResult> {
      const request = planningRequestSchema.safeParse(input);
      if (!request.success) {
        throw new AiPlanningError("ai_plan_request_invalid", {
          cause: request.error,
        });
      }

      const before = await dependencies.loadContext(client, {
        businessId: request.data.businessId,
      });
      const beforeProjection = project(before);
      const taskInput = builderPlanTaskInputSchema.parse({
        schema_version: 1,
        owner_request: request.data.ownerRequest,
        business_context: beforeProjection.modelContext,
      });

      const result = await dependencies.executeTask(
        client,
        before.executionContext,
        "builder_plan_v1",
        taskInput,
      );
      const plan = builderPlanOutputSchema.parse(result.output);

      const after = await dependencies.loadContext(client, {
        businessId: request.data.businessId,
      });
      const afterProjection = project(after);
      if (
        !contextIsCurrent(
          before,
          beforeProjection.serialized,
          after,
          afterProjection.serialized,
        )
      ) {
        throw new AiPlanningError("ai_plan_context_stale");
      }

      return Object.freeze({
        currentness: before.currentness,
        plan,
        contextBytes: beforeProjection.serializedBytes,
        execution: Object.freeze({
          attempts: result.accounting.attemptsStarted,
          inputTokens: result.accounting.inputTokens,
          outputTokens: result.accounting.outputTokens,
          usageComplete: result.accounting.usageComplete,
        }),
      });
    },
  });
}

export const builderPlanningService = createBuilderPlanningService();
