import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../../../db/supabase/database.types";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../service";
import {
  composeDirectTableAction,
  DirectTableComposerError,
  type ComposedDirectTableAction,
} from "./composer";
import {
  directTableCurrentnessSchema,
  directTableIntentSchema,
  directTableUndoIntentSchema,
  type DirectTableCurrentness,
  type DirectTableUndoIntent,
} from "./schemas";

type SessionClient = SupabaseClient<Database>;
type ConfigurationChangeSet = Tables<"configuration_change_sets">;

const contextSchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

const serviceMessages: Readonly<Record<string, string>> = {
  direct_configuration_stale:
    "Setup changed after this page was loaded. Reload and try again.",
  direct_configuration_change_incompatible:
    "That Table change could not be applied safely. Reload and try again.",
  direct_configuration_undo_incompatible:
    "That change cannot be undone from the current Table history.",
  direct_table_action_shape_invalid:
    "That Table change was not a permitted Table Workspace action.",
  direct_table_undo_not_available:
    "That change cannot be undone from the current Table history.",
};

function errorCode(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";
  return (
    message.match(/(?:direct|configuration)_[a-z0-9_]+/)?.[0] ??
    (typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "direct_table_request_failed")
  );
}

export class DirectTableServiceError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    const code = errorCode(cause);
    super(serviceMessages[code] ?? message);
    this.name = "DirectTableServiceError";
    this.code = code;
    this.cause = cause;
  }
}

export function isDirectTableActionError(error: unknown): boolean {
  return (
    error instanceof DirectTableComposerError ||
    error instanceof DirectTableServiceError
  );
}

export interface DirectTableConfigurationState {
  currentness: DirectTableCurrentness;
  snapshot: ConfigurationSnapshotV1;
}

export interface AppliedDirectTableAction {
  changeSet: ConfigurationChangeSet;
  composed: ComposedDirectTableAction | null;
  currentness: DirectTableCurrentness;
}

function parseContext(context: { businessId: string; actorId: string }) {
  return contextSchema.parse(context);
}

async function configurationState(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): Promise<DirectTableConfigurationState> {
  const parsed = parseContext(context);
  const configuration = new ConfigurationChangeService(client, parsed);
  const head = await configuration.getActiveHead();
  const version = await configuration.getVersion(head.active_version_id);
  return {
    currentness: {
      expectedBaseVersionId: head.active_version_id,
      expectedHeadRevision: head.head_revision,
    },
    snapshot: configurationSnapshotV1Schema.parse(version.snapshot_json),
  };
}

export async function loadDirectTableConfiguration(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): Promise<DirectTableConfigurationState> {
  try {
    return await configurationState(client, context);
  } catch (error) {
    if (error instanceof ConfigurationChangeServiceError) {
      throw error;
    }
    throw new DirectTableServiceError(
      "Could not load the current Table configuration.",
      error,
    );
  }
}

function assertCurrentness(
  actual: DirectTableCurrentness,
  expected: DirectTableCurrentness,
): void {
  if (
    actual.expectedBaseVersionId !== expected.expectedBaseVersionId ||
    actual.expectedHeadRevision !== expected.expectedHeadRevision
  ) {
    throw new DirectTableServiceError(
      "Setup changed after this page was loaded. Reload and try again.",
      { message: "direct_configuration_stale" },
    );
  }
}

function trustedChangeSet(
  data: ConfigurationChangeSet | null,
  context: { businessId: string; actorId: string },
): ConfigurationChangeSet {
  if (
    !data ||
    data.business_id !== context.businessId ||
    data.requested_by !== context.actorId ||
    data.status !== "applied" ||
    !data.applied_version_id
  ) {
    throw new DirectTableServiceError(
      "The Table change response did not match the authenticated request.",
      { message: "direct_table_response_invalid" },
    );
  }
  return data;
}

function rpcError(message: string, error: PostgrestError | null): never {
  throw new DirectTableServiceError(message, error);
}

export async function applyDirectTableAction(
  client: SessionClient,
  context: { businessId: string; actorId: string },
  input: { currentness: unknown; intent: unknown },
): Promise<AppliedDirectTableAction> {
  const parsedContext = parseContext(context);
  const expected = directTableCurrentnessSchema.parse(input.currentness);
  const intent = directTableIntentSchema.parse(input.intent);
  const state = await configurationState(client, parsedContext);
  assertCurrentness(state.currentness, expected);

  let composed: ComposedDirectTableAction;
  try {
    composed = composeDirectTableAction(state.snapshot, intent);
  } catch (error) {
    if (error instanceof DirectTableComposerError) {
      throw error;
    }
    throw new DirectTableServiceError(
      "The Table change could not be prepared safely.",
      error,
    );
  }
  const args = {
    expected_business_id: parsedContext.businessId,
    expected_actor_id: parsedContext.actorId,
    expected_base_version_id: expected.expectedBaseVersionId,
    expected_head_revision: expected.expectedHeadRevision,
    requested_action_kind: composed.actionKind,
    requested_operations: composed.operations,
  };
  const internalWorkspaceActionKinds = new Set([
    "create_connection_property",
    "add_existing_connection_property",
    "rename_connection_property",
    "create_saved_view",
    "duplicate_saved_view",
    "rename_saved_view",
    "update_view_query",
    "archive_saved_view",
  ]);
  const internalWorkspaceAction = internalWorkspaceActionKinds.has(
    composed.actionKind,
  );
  const { data, error } = internalWorkspaceAction
    ? await client.rpc("apply_internal_workspace_configuration_change", args)
    : composed.actionKind === "insert_column" ||
        composed.actionKind === "change_column_type"
      ? await client.rpc("apply_lenni_direct_configuration_change", args)
      : await client.rpc("apply_direct_configuration_change", args);
  if (error || !data) {
    return rpcError("Could not apply the Table change.", error);
  }
  const changeSet = trustedChangeSet(data, parsedContext);
  const next = await configurationState(client, parsedContext);
  return { changeSet, composed, currentness: next.currentness };
}

export async function undoDirectTableAction(
  client: SessionClient,
  context: { businessId: string; actorId: string },
  input: unknown,
): Promise<AppliedDirectTableAction> {
  const parsedContext = parseContext(context);
  const expected: DirectTableUndoIntent =
    directTableUndoIntentSchema.parse(input);
  const state = await configurationState(client, parsedContext);
  assertCurrentness(state.currentness, {
    expectedBaseVersionId: expected.expectedActiveSourceVersionId,
    expectedHeadRevision: expected.expectedHeadRevision,
  });

  const { data, error } = await client.rpc("undo_direct_configuration_change", {
    expected_business_id: parsedContext.businessId,
    expected_actor_id: parsedContext.actorId,
    expected_active_source_version_id: expected.expectedActiveSourceVersionId,
    expected_head_revision: expected.expectedHeadRevision,
  });
  if (error || !data) {
    return rpcError("Could not undo the Table change.", error);
  }
  const changeSet = trustedChangeSet(data, parsedContext);
  const next = await configurationState(client, parsedContext);
  return { changeSet, composed: null, currentness: next.currentness };
}
