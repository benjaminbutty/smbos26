import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  projectAiBusinessModelContext,
  serializeAiBusinessModelContext,
} from "../context/projector";
import {
  loadAuthoritativeAiBusinessContext,
  type AuthoritativeAiBusinessContext,
} from "../../core/configuration/builder-context-source";
import {
  composePreorderAmendmentBatch,
  ManualAmendmentError,
  type ComposedPreorderAmendmentBatch,
} from "../../core/configuration/manual-amendments/service";
import type { PreorderAmendmentIntent } from "../../core/configuration/manual-amendments/schemas";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../../core/configuration/service";
import {
  configurationOperationsSchema,
  type ProposeConfigurationChangeInput,
} from "../../core/configuration/schemas";
import type { Database, Tables } from "../../db/supabase/database.types";
import {
  BUILDER_PREORDER_AMENDMENT_PROPOSAL_TITLE,
  builderPreorderAmendmentProposalRequestSchema,
  builderPreorderAmendmentProposalResultSchema,
  type BuilderPreorderAmendmentProposalRequest,
  type BuilderPreorderAmendmentProposalResult,
} from "./contracts";
import { BuilderPreorderAmendmentProposalError } from "./errors";
import { builderPreorderAmendmentTaskV1 } from "./task";

type SessionClient = SupabaseClient<Database>;
type ConfigurationProposal = Tables<"configuration_change_sets">;

export interface BuilderPreorderAmendmentProposalAdapter {
  proposeChangeSet(
    input: ProposeConfigurationChangeInput,
  ): Promise<ConfigurationProposal>;
}

interface BuilderPreorderAmendmentProposalDependencies {
  loadContext(
    client: SessionClient,
    input: { businessId: string },
  ): Promise<AuthoritativeAiBusinessContext>;
  compose(
    snapshot: AuthoritativeAiBusinessContext["source"]["activeConfiguration"]["snapshot"],
    input: BuilderPreorderAmendmentProposalRequest["draft"],
  ): ComposedPreorderAmendmentBatch;
  createProposalAdapter(
    client: SessionClient,
    context: { businessId: string; actorId: string },
  ): BuilderPreorderAmendmentProposalAdapter;
}

const proposalResponseSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    requested_by: z.uuid(),
    status: z.literal("proposed"),
    kind: z.literal("change"),
    base_version_id: z.uuid(),
    base_head_revision: z.number().int().positive(),
    title: z.string().min(1).max(120),
    description: z.string().max(5_000).nullable(),
    operations_schema_version: z.literal(1),
    operations_json: z.unknown(),
  })
  .passthrough();

function projectContext(authoritative: AuthoritativeAiBusinessContext) {
  const projected = projectAiBusinessModelContext(authoritative.source);
  return {
    ...projected,
    serialized: serializeAiBusinessModelContext(projected.modelContext),
  };
}

function currentnessMatches(
  actual: AuthoritativeAiBusinessContext["currentness"],
  expected: BuilderPreorderAmendmentProposalRequest["expectedCurrentness"],
): boolean {
  return (
    actual.baseVersionId === expected.baseVersionId &&
    actual.headRevision === expected.headRevision
  );
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

function toTrustedBatch(
  draft: BuilderPreorderAmendmentProposalRequest["draft"],
) {
  const amendments: PreorderAmendmentIntent[] = draft.amendments.map(
    (amendment) => {
      switch (amendment.type) {
        case "set_collection_days":
          return {
            intent: "set_collection_days" as const,
            daysOfWeek: amendment.days_of_week,
          };
        case "set_collection_window":
          return {
            intent: "set_collection_window" as const,
            startTime: amendment.start_time,
            endTime: amendment.end_time,
          };
        case "set_slot_interval_minutes":
          return {
            intent: "set_slot_interval_minutes" as const,
            slotIntervalMinutes: amendment.slot_interval_minutes,
          };
        case "set_slot_capacity":
          return {
            intent: "set_slot_capacity" as const,
            slotCapacity: amendment.slot_capacity,
          };
        case "set_cutoff_hours":
          return {
            intent: "set_cutoff_hours" as const,
            cutoffHours: amendment.cutoff_hours,
          };
        case "set_booking_horizon_days":
          return {
            intent: "set_booking_horizon_days" as const,
            bookingHorizonDays: amendment.booking_horizon_days,
          };
        case "set_existing_question_requiredness":
          return {
            intent: "set_existing_question_requiredness" as const,
            target: amendment.target,
            fieldKey: amendment.field_key,
            required: amendment.required,
          };
        case "set_existing_question_label":
          return {
            intent: "set_existing_question_label" as const,
            target: amendment.target,
            fieldKey: amendment.field_key,
            label: amendment.label,
          };
        case "set_existing_question_help_text":
          return {
            intent: "set_existing_question_help_text" as const,
            target: amendment.target,
            fieldKey: amendment.field_key,
            helpText: amendment.help_text,
          };
        case "add_preorder_question":
          return {
            intent: "add_preorder_question" as const,
            label: amendment.label,
            helpText: amendment.help_text,
            required: amendment.required,
            answerStyle: amendment.answer_style,
          };
      }
    },
  );
  return { preorderKey: draft.preorder_key, amendments };
}

function parseRequest(input: unknown): BuilderPreorderAmendmentProposalRequest {
  const parsed = builderPreorderAmendmentProposalRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new BuilderPreorderAmendmentProposalError(
      "ai_preorder_amendment_request_invalid",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function defaultProposalAdapter(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): BuilderPreorderAmendmentProposalAdapter {
  const service = new ConfigurationChangeService(client, context);
  return Object.freeze({
    proposeChangeSet: (input: ProposeConfigurationChangeInput) =>
      service.proposeChangeSet(input),
  });
}

function proposalFailure(
  cause: unknown,
): BuilderPreorderAmendmentProposalError {
  if (cause instanceof ConfigurationChangeServiceError) {
    if (cause.code === "configuration_proposal_stale") {
      return new BuilderPreorderAmendmentProposalError(
        "ai_preorder_amendment_context_stale",
        { cause },
      );
    }
    if (cause.code === "configuration_proposal_no_changes") {
      return new BuilderPreorderAmendmentProposalError(
        "ai_preorder_amendment_no_changes",
        { cause },
      );
    }
  }
  if (cause instanceof ManualAmendmentError) {
    return new BuilderPreorderAmendmentProposalError(
      "ai_preorder_amendment_failed",
      { cause },
    );
  }
  return new BuilderPreorderAmendmentProposalError(
    "ai_preorder_amendment_failed",
    { cause },
  );
}

function assertProposalResponse(
  response: unknown,
  request: BuilderPreorderAmendmentProposalRequest,
  context: { businessId: string; actorId: string },
  composed: ComposedPreorderAmendmentBatch,
): z.infer<typeof proposalResponseSchema> {
  const parsed = proposalResponseSchema.parse(response);
  const operations = configurationOperationsSchema.parse(
    parsed.operations_json,
  );
  if (
    parsed.business_id !== context.businessId ||
    parsed.requested_by !== context.actorId ||
    parsed.base_version_id !== request.expectedCurrentness.baseVersionId ||
    parsed.base_head_revision !== request.expectedCurrentness.headRevision ||
    parsed.title !== BUILDER_PREORDER_AMENDMENT_PROPOSAL_TITLE ||
    parsed.description !== composed.description ||
    JSON.stringify(operations) !== JSON.stringify(composed.operations)
  ) {
    throw new Error("The preorder proposal response was inconsistent.");
  }
  return parsed;
}

export function createBuilderPreorderAmendmentProposalService(
  overrides: Partial<BuilderPreorderAmendmentProposalDependencies> = {},
) {
  const dependencies: BuilderPreorderAmendmentProposalDependencies = {
    loadContext: overrides.loadContext ?? loadAuthoritativeAiBusinessContext,
    compose:
      overrides.compose ??
      ((snapshot, draft) =>
        composePreorderAmendmentBatch(snapshot, toTrustedBatch(draft))),
    createProposalAdapter:
      overrides.createProposalAdapter ?? defaultProposalAdapter,
  };

  return Object.freeze({
    async propose(
      client: SessionClient,
      input: unknown,
    ): Promise<BuilderPreorderAmendmentProposalResult> {
      let request: BuilderPreorderAmendmentProposalRequest;
      try {
        request = parseRequest(input);
      } catch (cause) {
        if (cause instanceof BuilderPreorderAmendmentProposalError) throw cause;
        throw new BuilderPreorderAmendmentProposalError(
          "ai_preorder_amendment_request_invalid",
          { cause },
        );
      }

      let validatedDraft: typeof request.draft;
      try {
        validatedDraft = builderPreorderAmendmentTaskV1.validateOutput
          ? builderPreorderAmendmentTaskV1.validateOutput(
              request.taskInput,
              request.draft,
            )
          : request.draft;
      } catch (cause) {
        throw new BuilderPreorderAmendmentProposalError(
          "ai_preorder_amendment_request_invalid",
          { cause },
        );
      }

      const first = await dependencies.loadContext(client, {
        businessId: request.businessId,
      });
      const firstProjection = projectContext(first);
      if (
        first.executionContext.businessId !== request.businessId ||
        !currentnessMatches(first.currentness, request.expectedCurrentness) ||
        firstProjection.serialized !==
          serializeAiBusinessModelContext(request.taskInput.business_context)
      ) {
        throw new BuilderPreorderAmendmentProposalError(
          "ai_preorder_amendment_context_stale",
        );
      }

      let composed: ComposedPreorderAmendmentBatch;
      try {
        composed = dependencies.compose(
          first.source.activeConfiguration.snapshot,
          validatedDraft,
        );
      } catch (cause) {
        throw proposalFailure(cause);
      }
      if (composed.noOp) {
        throw new BuilderPreorderAmendmentProposalError(
          "ai_preorder_amendment_no_changes",
        );
      }

      const second = await dependencies.loadContext(client, {
        businessId: request.businessId,
      });
      const secondProjection = projectContext(second);
      if (
        second.executionContext.businessId !== request.businessId ||
        !currentnessMatches(second.currentness, request.expectedCurrentness) ||
        !contextMatches(
          first,
          firstProjection.serialized,
          second,
          secondProjection.serialized,
        )
      ) {
        throw new BuilderPreorderAmendmentProposalError(
          "ai_preorder_amendment_context_stale",
        );
      }

      const proposalInput: ProposeConfigurationChangeInput = {
        expectedBaseVersionId: request.expectedCurrentness.baseVersionId,
        expectedHeadRevision: request.expectedCurrentness.headRevision,
        title: BUILDER_PREORDER_AMENDMENT_PROPOSAL_TITLE,
        description: composed.description,
        operations: composed.operations,
      };
      let proposal: z.infer<typeof proposalResponseSchema>;
      try {
        const adapter = dependencies.createProposalAdapter(
          client,
          second.executionContext,
        );
        proposal = assertProposalResponse(
          await adapter.proposeChangeSet(proposalInput),
          request,
          second.executionContext,
          composed,
        );
      } catch (cause) {
        throw proposalFailure(cause);
      }
      return Object.freeze(
        builderPreorderAmendmentProposalResultSchema.parse({
          schema_version: 1,
          proposal_id: proposal.id,
          status: proposal.status,
          base_version_id: proposal.base_version_id,
          base_head_revision: proposal.base_head_revision,
          operation_count: composed.operations.length,
          summary: composed.description.slice(0, 2_000),
        }),
      );
    },
  });
}

export const builderPreorderAmendmentProposalService =
  createBuilderPreorderAmendmentProposalService();
