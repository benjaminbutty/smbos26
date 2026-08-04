import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../../../db/supabase/database.types";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../service";
import {
  builderUndoPresentationSchema,
  type BuilderUndoPresentation,
} from "./contracts";

type SessionClient = SupabaseClient<Database>;
type ConfigurationHead = Tables<"business_configuration_heads">;
type ConfigurationVersion = Tables<"configuration_versions">;
type ConfigurationChangeSet = Tables<"configuration_change_sets">;

const builderUndoRequestSchema = z
  .object({
    businessId: z.uuid(),
    actorId: z.uuid(),
    sourceVersionId: z.uuid(),
  })
  .strict();

export type BuilderUndoErrorCode =
  | "builder_undo_not_found"
  | "builder_undo_not_eligible"
  | "builder_undo_invalid";

const builderUndoErrorMessages: Readonly<Record<BuilderUndoErrorCode, string>> =
  {
    builder_undo_not_found:
      "The requested configuration version could not be found for this Business.",
    builder_undo_not_eligible:
      "This configuration version cannot be undone from the latest-change Builder action.",
    builder_undo_invalid:
      "The latest configuration undo context could not be verified safely.",
  };

export class BuilderUndoError extends Error {
  readonly code: BuilderUndoErrorCode;
  override readonly cause: unknown;

  constructor(code: BuilderUndoErrorCode, cause?: unknown) {
    super(builderUndoErrorMessages[code]);
    this.name = "BuilderUndoError";
    this.code = code;
    this.cause = cause;
  }
}

interface InternalBuilderUndoContextBase {
  activeHead: ConfigurationHead;
  sourceVersion: ConfigurationVersion;
  sourceProposalTitle: string | null;
}

export type BuilderUndoContext =
  | (InternalBuilderUndoContextBase & {
      state: "eligible";
      parentVersion: ConfigurationVersion;
    })
  | (InternalBuilderUndoContextBase & {
      state: "superseded" | "baseline" | "active_rollback";
      parentVersion: null;
    });

export interface PreparedBuilderUndo {
  proposalId: string;
}

function sourceIsActive(
  head: ConfigurationHead,
  source: ConfigurationVersion,
): boolean {
  return (
    source.id === head.active_version_id &&
    source.version_number === head.head_revision
  );
}

function verifySourceProposal(
  source: ConfigurationVersion,
  sourceChangeSet: ConfigurationChangeSet | null,
): string | null {
  if (source.source_change_set_id === null) {
    return null;
  }
  if (
    sourceChangeSet === null ||
    sourceChangeSet.business_id !== source.business_id ||
    sourceChangeSet.id !== source.source_change_set_id ||
    sourceChangeSet.kind !== "change" ||
    sourceChangeSet.status !== "applied" ||
    sourceChangeSet.applied_version_id !== source.id
  ) {
    throw new BuilderUndoError("builder_undo_invalid");
  }
  return sourceChangeSet.title;
}

/**
 * Derive latest-change eligibility from already tenant-scoped authoritative
 * rows. This function never chooses a target: an eligible result carries only
 * the source's immediate parent that was loaded by the caller.
 */
export function deriveBuilderUndoContext(input: {
  activeHead: ConfigurationHead;
  businessId: string;
  parentVersion: ConfigurationVersion | null;
  sourceChangeSet: ConfigurationChangeSet | null;
  sourceVersion: ConfigurationVersion;
}): BuilderUndoContext {
  const request = builderUndoRequestSchema.pick({ businessId: true }).parse({
    businessId: input.businessId,
  });
  const { activeHead, parentVersion, sourceChangeSet, sourceVersion } = input;

  if (
    sourceVersion.business_id !== request.businessId ||
    activeHead.business_id !== request.businessId
  ) {
    throw new BuilderUndoError("builder_undo_not_found");
  }

  const base = {
    activeHead,
    sourceVersion,
    sourceProposalTitle: null as string | null,
  };

  if (!sourceIsActive(activeHead, sourceVersion)) {
    return { ...base, parentVersion: null, state: "superseded" };
  }
  if (sourceVersion.kind === "baseline") {
    return { ...base, parentVersion: null, state: "baseline" };
  }
  if (sourceVersion.kind === "rollback") {
    return { ...base, parentVersion: null, state: "active_rollback" };
  }
  if (sourceVersion.parent_version_id === null) {
    return { ...base, parentVersion: null, state: "baseline" };
  }
  if (sourceVersion.kind !== "change") {
    throw new BuilderUndoError("builder_undo_invalid");
  }
  if (
    parentVersion === null ||
    parentVersion.business_id !== sourceVersion.business_id ||
    parentVersion.id !== sourceVersion.parent_version_id ||
    parentVersion.version_number >= sourceVersion.version_number
  ) {
    throw new BuilderUndoError("builder_undo_invalid");
  }

  return {
    ...base,
    parentVersion,
    sourceProposalTitle: verifySourceProposal(sourceVersion, sourceChangeSet),
    state: "eligible",
  };
}

export function presentBuilderUndoContext(
  context: BuilderUndoContext,
): BuilderUndoPresentation {
  if (context.state === "eligible") {
    return builderUndoPresentationSchema.parse({
      state: "eligible",
      source_proposal_title: context.sourceProposalTitle,
      source_version_number: context.sourceVersion.version_number,
      previous_version_number: context.parentVersion.version_number,
    });
  }
  return builderUndoPresentationSchema.parse({
    state: context.state,
    source_version_number: context.sourceVersion.version_number,
  });
}

async function loadTenantScopedUndoRows(
  client: SessionClient,
  request: z.infer<typeof builderUndoRequestSchema>,
): Promise<BuilderUndoContext> {
  const configuration = new ConfigurationChangeService(client, {
    businessId: request.businessId,
    actorId: request.actorId,
  });
  const activeHead = await configuration.getActiveHead();
  const sourceVersion = await configuration.getVersion(request.sourceVersionId);

  if (!sourceIsActive(activeHead, sourceVersion)) {
    return deriveBuilderUndoContext({
      activeHead,
      businessId: request.businessId,
      parentVersion: null,
      sourceChangeSet: null,
      sourceVersion,
    });
  }

  if (
    sourceVersion.kind !== "change" ||
    sourceVersion.parent_version_id === null
  ) {
    return deriveBuilderUndoContext({
      activeHead,
      businessId: request.businessId,
      parentVersion: null,
      sourceChangeSet: null,
      sourceVersion,
    });
  }

  const [parentVersion, sourceChangeSet] = await Promise.all([
    configuration.getVersion(sourceVersion.parent_version_id),
    sourceVersion.source_change_set_id
      ? configuration.getChangeSet(sourceVersion.source_change_set_id)
      : Promise.resolve(null),
  ]);

  return deriveBuilderUndoContext({
    activeHead,
    businessId: request.businessId,
    parentVersion,
    sourceChangeSet,
    sourceVersion,
  });
}

export async function loadBuilderUndoContext(
  client: SessionClient,
  input: { actorId: string; businessId: string; sourceVersionId: string },
): Promise<BuilderUndoContext> {
  let request: z.infer<typeof builderUndoRequestSchema>;
  try {
    request = builderUndoRequestSchema.parse(input);
  } catch (cause) {
    throw new BuilderUndoError("builder_undo_not_found", cause);
  }

  try {
    return await loadTenantScopedUndoRows(client, request);
  } catch (cause) {
    if (cause instanceof BuilderUndoError) {
      throw cause;
    }
    throw cause;
  }
}

export async function prepareLatestConfigurationUndo(
  client: SessionClient,
  input: { actorId: string; businessId: string; sourceVersionId: string },
): Promise<PreparedBuilderUndo> {
  const context = await loadBuilderUndoContext(client, input);
  if (context.state !== "eligible") {
    throw new BuilderUndoError("builder_undo_not_eligible");
  }

  const configuration = new ConfigurationChangeService(client, {
    businessId: input.businessId,
    actorId: input.actorId,
  });
  const proposal = await configuration.prepareRollback({
    expectedBaseVersionId: context.activeHead.active_version_id,
    expectedHeadRevision: context.activeHead.head_revision,
    targetVersionId: context.parentVersion.id,
    title: "Undo latest configuration change",
    description: `Restore the setup from immediately before Version ${context.sourceVersion.version_number}. Nothing changes until this rollback proposal is validated and applied.`,
  });

  if (
    proposal.kind !== "rollback" ||
    proposal.status !== "proposed" ||
    proposal.base_version_id !== context.sourceVersion.id ||
    proposal.base_head_revision !== context.activeHead.head_revision ||
    proposal.rollback_target_version_id !== context.parentVersion.id ||
    proposal.requested_by !== input.actorId
  ) {
    throw new BuilderUndoError("builder_undo_invalid");
  }

  return Object.freeze({ proposalId: proposal.id });
}

export function isBuilderUndoStaleError(error: unknown): boolean {
  return (
    error instanceof ConfigurationChangeServiceError &&
    error.code === "configuration_proposal_stale"
  );
}
