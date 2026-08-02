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
import { compileConfigurationDraft } from "../../core/configuration/draft-compiler/compiler";
import {
  configurationDraftCompilerOutputSchema,
  type ConfigurationDraftCompilerOutput,
  type ConfigurationDraftCompilerInput,
} from "../../core/configuration/draft-compiler/contracts";
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
  BUILDER_CONFIGURATION_PROPOSAL_TITLE,
  builderConfigurationProposalRequestSchema,
  builderConfigurationProposalResultSchema,
  type BuilderConfigurationProposalRequest,
  type BuilderConfigurationProposalResult,
} from "./contracts";
import { BuilderConfigurationProposalError } from "./errors";

type SessionClient = SupabaseClient<Database>;
type ConfigurationProposal = Tables<"configuration_change_sets">;

export interface BuilderConfigurationProposalAdapter {
  proposeChangeSet(
    input: ProposeConfigurationChangeInput,
  ): Promise<ConfigurationProposal>;
}

interface BuilderConfigurationProposalDependencies {
  loadContext(
    client: SessionClient,
    input: { businessId: string },
  ): Promise<AuthoritativeAiBusinessContext>;
  compileDraft(
    input: ConfigurationDraftCompilerInput,
  ): ConfigurationDraftCompilerOutput;
  createProposalAdapter(
    client: SessionClient,
    context: { businessId: string; actorId: string },
  ): BuilderConfigurationProposalAdapter;
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
    description: z.string().max(5000).nullable(),
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
  expected: BuilderConfigurationProposalRequest["expectedCurrentness"],
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

function canonicalJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJsonValue(item)]),
    );
  }
  throw new TypeError("Configuration operations must be JSON serialisable.");
}

function deeplyEqualJson(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalJsonValue(left)) ===
    JSON.stringify(canonicalJsonValue(right))
  );
}

function proposalFailure(cause: unknown): BuilderConfigurationProposalError {
  if (cause instanceof ConfigurationChangeServiceError) {
    if (cause.code === "configuration_proposal_stale") {
      return new BuilderConfigurationProposalError(
        "ai_configuration_proposal_context_stale",
        { cause },
      );
    }
    if (cause.code === "configuration_proposal_no_changes") {
      return new BuilderConfigurationProposalError(
        "ai_configuration_proposal_no_changes",
        { cause },
      );
    }
  }
  return new BuilderConfigurationProposalError(
    "ai_configuration_proposal_failed",
    { cause },
  );
}

function assertProposalResponse(
  response: unknown,
  request: BuilderConfigurationProposalRequest,
  executionContext: { businessId: string; actorId: string },
  operations: ConfigurationDraftCompilerOutput["operations"],
): z.infer<typeof proposalResponseSchema> {
  const parsed = proposalResponseSchema.parse(response);
  const returnedOperations = configurationOperationsSchema.parse(
    parsed.operations_json,
  );
  if (
    parsed.business_id !== executionContext.businessId ||
    parsed.requested_by !== executionContext.actorId ||
    parsed.base_version_id !== request.expectedCurrentness.baseVersionId ||
    parsed.base_head_revision !== request.expectedCurrentness.headRevision ||
    parsed.title !== BUILDER_CONFIGURATION_PROPOSAL_TITLE ||
    parsed.description !== null ||
    !deeplyEqualJson(returnedOperations, operations)
  ) {
    throw new Error("The configuration proposal response was inconsistent.");
  }
  return parsed;
}

function parseRequest(input: unknown): BuilderConfigurationProposalRequest {
  const parsed = builderConfigurationProposalRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new BuilderConfigurationProposalError(
      "ai_configuration_proposal_request_invalid",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function defaultProposalAdapter(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): BuilderConfigurationProposalAdapter {
  const service = new ConfigurationChangeService(client, context);
  return Object.freeze({
    proposeChangeSet: (input: ProposeConfigurationChangeInput) =>
      service.proposeChangeSet(input),
  });
}

export function createBuilderConfigurationProposalService(
  overrides: Partial<BuilderConfigurationProposalDependencies> = {},
) {
  const dependencies: BuilderConfigurationProposalDependencies = {
    loadContext: overrides.loadContext ?? loadAuthoritativeAiBusinessContext,
    compileDraft: overrides.compileDraft ?? compileConfigurationDraft,
    createProposalAdapter:
      overrides.createProposalAdapter ?? defaultProposalAdapter,
  };

  return Object.freeze({
    async propose(
      client: SessionClient,
      input: unknown,
    ): Promise<BuilderConfigurationProposalResult> {
      let request: BuilderConfigurationProposalRequest;
      try {
        request = parseRequest(input);
      } catch (cause) {
        if (cause instanceof BuilderConfigurationProposalError) {
          throw cause;
        }
        throw new BuilderConfigurationProposalError(
          "ai_configuration_proposal_request_invalid",
          { cause },
        );
      }

      const first = await dependencies.loadContext(client, {
        businessId: request.businessId,
      });
      const firstProjection = projectContext(first);
      const suppliedContext = serializeAiBusinessModelContext(
        request.taskInput.business_context,
      );
      if (
        first.executionContext.businessId !== request.businessId ||
        !currentnessMatches(first.currentness, request.expectedCurrentness) ||
        firstProjection.serialized !== suppliedContext
      ) {
        throw new BuilderConfigurationProposalError(
          "ai_configuration_proposal_context_stale",
        );
      }

      let compiled: ConfigurationDraftCompilerOutput;
      try {
        compiled = configurationDraftCompilerOutputSchema.parse(
          dependencies.compileDraft({
            taskInput: request.taskInput,
            draft: request.draft,
            snapshot: first.source.activeConfiguration.snapshot,
          }),
        );
      } catch (cause) {
        throw new BuilderConfigurationProposalError(
          "ai_configuration_proposal_compile_failed",
          { cause },
        );
      }

      const second = await dependencies.loadContext(client, {
        businessId: first.executionContext.businessId,
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
        throw new BuilderConfigurationProposalError(
          "ai_configuration_proposal_context_stale",
        );
      }

      const proposalInput: ProposeConfigurationChangeInput = {
        expectedBaseVersionId: request.expectedCurrentness.baseVersionId,
        expectedHeadRevision: request.expectedCurrentness.headRevision,
        title: BUILDER_CONFIGURATION_PROPOSAL_TITLE,
        description: null,
        operations: compiled.operations,
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
          compiled.operations,
        );
      } catch (cause) {
        throw proposalFailure(cause);
      }

      const result = builderConfigurationProposalResultSchema.parse({
        schema_version: 1,
        proposal_id: proposal.id,
        status: proposal.status,
        base_version_id: proposal.base_version_id,
        base_head_revision: proposal.base_head_revision,
        operation_count: compiled.operations.length,
      });
      return Object.freeze(result);
    },
  });
}

export const builderConfigurationProposalService =
  createBuilderConfigurationProposalService();
