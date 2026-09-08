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
  composeDirectPageAction,
  DirectPageComposerError,
  type ComposedDirectPageAction,
} from "./composer";
import {
  directPageCurrentnessSchema,
  directPageIntentSchema,
  type DirectPageCurrentness,
} from "./schemas";

type SessionClient = SupabaseClient<Database>;
type ConfigurationChangeSet = Tables<"configuration_change_sets">;

const contextSchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid() })
  .strict();

const serviceMessages: Readonly<Record<string, string>> = {
  direct_configuration_stale:
    "This Page changed after it was loaded. Reload and try again.",
  direct_configuration_change_incompatible:
    "That Page change could not be applied safely. Reload and try again.",
  direct_configuration_timeout:
    "Saving took too long. Your edits are still here. Try again.",
  direct_page_action_shape_invalid:
    "That Page change was not a permitted Page Workspace action.",
};

function errorCode(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";
  const code =
    message.match(/(?:direct|configuration)_[a-z0-9_]+/)?.[0] ??
    (typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "direct_page_request_failed");

  // PostgreSQL's statement-timeout code is safe to expose as a stable Page
  // action outcome. The transaction rolls back, and the editor keeps its
  // candidate, so an owner can retry without losing the change.
  return code === "57014" ? "direct_configuration_timeout" : code;
}

export class DirectPageServiceError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    const code = errorCode(cause);
    super(serviceMessages[code] ?? message);
    this.name = "DirectPageServiceError";
    this.code = code;
    this.cause = cause;
  }
}

export function isDirectPageActionError(error: unknown): boolean {
  return (
    error instanceof DirectPageComposerError ||
    error instanceof DirectPageServiceError
  );
}

export interface DirectPageConfigurationState {
  currentness: DirectPageCurrentness;
  snapshot: ConfigurationSnapshotV1;
}

export interface AppliedDirectPageAction {
  changeSet: ConfigurationChangeSet;
  composed: ComposedDirectPageAction;
  currentness: DirectPageCurrentness;
  snapshot: ConfigurationSnapshotV1;
}

function parseContext(context: { businessId: string; actorId: string }) {
  return contextSchema.parse(context);
}

async function configurationState(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): Promise<DirectPageConfigurationState> {
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

export async function loadDirectPageConfiguration(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): Promise<DirectPageConfigurationState> {
  try {
    return await configurationState(client, context);
  } catch (error) {
    if (error instanceof ConfigurationChangeServiceError) {
      throw error;
    }
    throw new DirectPageServiceError(
      "Could not load the current Page configuration.",
      error,
    );
  }
}

function assertCurrentness(
  actual: DirectPageCurrentness,
  expected: DirectPageCurrentness,
): void {
  if (
    actual.expectedBaseVersionId !== expected.expectedBaseVersionId ||
    actual.expectedHeadRevision !== expected.expectedHeadRevision
  ) {
    throw new DirectPageServiceError(
      "This Page changed after it was loaded. Reload and try again.",
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
    throw new DirectPageServiceError(
      "The Page change response did not match the authenticated request.",
      { message: "direct_page_response_invalid" },
    );
  }
  return data;
}

function rpcError(message: string, error: PostgrestError | null): never {
  throw new DirectPageServiceError(message, error);
}

export async function applyDirectPageAction(
  client: SessionClient,
  context: { businessId: string; actorId: string },
  input: { currentness: unknown; intent: unknown },
): Promise<AppliedDirectPageAction> {
  const parsedContext = parseContext(context);
  const configuration = new ConfigurationChangeService(client, parsedContext);
  const expected = directPageCurrentnessSchema.parse(input.currentness);
  const intent = directPageIntentSchema.parse(input.intent);
  const state = await configurationState(client, parsedContext);
  assertCurrentness(state.currentness, expected);

  let composed: ComposedDirectPageAction;
  try {
    composed = composeDirectPageAction(state.snapshot, intent);
  } catch (error) {
    if (error instanceof DirectPageComposerError) {
      throw error;
    }
    throw new DirectPageServiceError(
      "The Page change could not be prepared safely.",
      error,
    );
  }

  const { data, error } = await client.rpc(
    "apply_direct_page_configuration_change",
    {
      expected_business_id: parsedContext.businessId,
      expected_actor_id: parsedContext.actorId,
      expected_base_version_id: expected.expectedBaseVersionId,
      expected_head_revision: expected.expectedHeadRevision,
      requested_action_kind: composed.actionKind,
      requested_operations: composed.operations,
    },
  );
  if (error || !data) {
    return rpcError("Could not apply the Page change.", error);
  }
  const changeSet = trustedChangeSet(data, parsedContext);
  // The RPC returns the Version committed by this action. Read that exact
  // immutable snapshot so a concurrent later change cannot be mistaken for
  // this caller's acknowledgement.
  const appliedVersionId = changeSet.applied_version_id;
  if (!appliedVersionId) {
    throw new DirectPageServiceError(
      "The Page change response did not include its committed Version.",
      { message: "direct_page_response_invalid" },
    );
  }
  const committedVersion = await configuration.getVersion(appliedVersionId);
  return {
    changeSet,
    composed,
    currentness: {
      expectedBaseVersionId: committedVersion.id,
      expectedHeadRevision: changeSet.base_head_revision + 1,
    },
    snapshot: configurationSnapshotV1Schema.parse(
      committedVersion.snapshot_json,
    ),
  };
}
