import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import {
  configurationSnapshotV1Schema,
  createSnapshotConfigurationDefinitionSource,
  type ConfigurationDefinitionSource,
} from "./definition-source";
import {
  configurationDisplayContextSchema,
  configurationValidationResultSchema,
  prepareConfigurationRollbackRequestSchema,
  proposeConfigurationChangeSchema,
  semanticDiffSchema,
  type PrepareConfigurationRollbackInput,
  type ProposeConfigurationChangeInput,
} from "./schemas";

type ConfigurationChangeSet =
  Database["public"]["Tables"]["configuration_change_sets"]["Row"];
type ConfigurationVersion =
  Database["public"]["Tables"]["configuration_versions"]["Row"];
type ConfigurationHead =
  Database["public"]["Tables"]["business_configuration_heads"]["Row"];
type ConfigurationPage = Database["public"]["Tables"]["pages"]["Row"];
type SessionClient = SupabaseClient<Database>;

export interface ConfigurationSnapshotCount {
  active: number;
  label: string;
  total: number;
}

const snapshotCollectionLabels = {
  object_definitions: "Business items",
  field_definitions: "Questions and fields",
  relationship_definitions: "Connections",
  views: "Screens",
  forms: "Forms",
  pages: "Pages",
  preorder_experiences: "Preorder setups",
  preorder_experience_locations: "Preorder locations",
} as const;

const contextSchema = z
  .object({
    businessId: z.uuid(),
    actorId: z.uuid(),
  })
  .strict();

const changeSetIdSchema = z.uuid();
const versionIdSchema = z.uuid();

const previewChangeSetSchema = z
  .object({
    applied_at: z.string().nullable(),
    applied_by: z.uuid().nullable(),
    applied_version_id: z.uuid().nullable(),
    base_head_revision: z.number().int().positive(),
    base_version_id: z.uuid(),
    business_id: z.uuid(),
    candidate_checksum: z.string().regex(/^[a-f0-9]{64}$/),
    candidate_snapshot_json: configurationSnapshotV1Schema,
    closed_at: z.string().nullable(),
    closed_by: z.uuid().nullable(),
    created_at: z.string(),
    description: z.string().nullable(),
    display_context_json: configurationDisplayContextSchema,
    id: z.uuid(),
    id_allocations_json: z.record(z.string(), z.uuid()),
    kind: z.enum(["change", "rollback"]),
    operations_json: z.unknown(),
    operations_schema_version: z.literal(1),
    requested_by: z.uuid(),
    rollback_target_version_id: z.uuid().nullable(),
    semantic_diff_json: semanticDiffSchema,
    status: z.enum(["proposed", "validated"]),
    title: z.string().min(1).max(120),
    updated_at: z.string(),
    validated_at: z.string().nullable(),
    validated_by: z.uuid().nullable(),
    validation_result_json: configurationValidationResultSchema.nullable(),
  })
  .strict();

export interface ConfigurationPreviewContext {
  proposalId: string;
  businessId: string;
  title: string;
  kind: "change" | "rollback";
  status: "proposed" | "validated";
  candidateChecksum: string;
  semanticDiff: z.infer<typeof semanticDiffSchema>;
  definitionSource: ConfigurationDefinitionSource;
  pages: ConfigurationPage[];
}

type PostgrestErrorShape = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

function engineErrorCode(error: PostgrestErrorShape): string {
  const match = error.message?.match(/configuration_[a-z0-9_]+/);
  return match?.[0] ?? error.code ?? "configuration_request_failed";
}

const engineErrorMessages: Readonly<Record<string, string>> = {
  configuration_actor_context_mismatch:
    "The authenticated configuration actor did not match the trusted request context.",
  configuration_candidate_replay_failed:
    "The stored configuration proposal could not be reproduced safely.",
  configuration_candidate_replay_mismatch:
    "The stored configuration proposal failed its integrity check.",
  configuration_preview_unavailable:
    "This configuration proposal is no longer available to preview.",
  configuration_preview_not_found:
    "This configuration proposal could not be found.",
  configuration_preview_stale:
    "This preview is out of date because the active configuration changed.",
  configuration_change_set_not_applicable:
    "This configuration proposal is not ready to be applied.",
  configuration_change_set_not_validatable:
    "This configuration proposal can no longer be validated.",
  configuration_head_version_mismatch:
    "The active configuration history is inconsistent. No changes were applied.",
  configuration_owner_or_admin_required:
    "Owner or Admin access is required for configuration changes.",
  configuration_proposal_stale:
    "Setup changed after this page was loaded. Reload and try again.",
  configuration_projection_out_of_sync:
    "Configuration changed outside the version engine. No proposal was changed.",
  configuration_proposal_no_changes:
    "The proposal does not change the current configuration.",
  configuration_rollback_target_invalid:
    "Select an earlier configuration version to prepare this rollback.",
  configuration_rollback_target_not_found:
    "The selected configuration version could not be found for this Business.",
  configuration_validation_engine_failure:
    "Configuration validation could not complete safely.",
};

export class ConfigurationChangeServiceError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(message: string, error: PostgrestErrorShape | unknown) {
    const code =
      typeof error === "object" && error !== null
        ? engineErrorCode(error as PostgrestErrorShape)
        : "configuration_request_failed";
    super(engineErrorMessages[code] ?? message);
    this.name = "ConfigurationChangeServiceError";
    this.cause = error;
    this.code = code;
  }
}

const controlledReadErrorCodes = new Set([
  "configuration_authentication_required",
  "configuration_change_set_not_found",
  "configuration_owner_or_admin_required",
  "configuration_version_not_found",
]);

export function isControlledConfigurationReadError(error: unknown): boolean {
  return (
    error instanceof z.ZodError ||
    (error instanceof ConfigurationChangeServiceError &&
      controlledReadErrorCodes.has(error.code))
  );
}

function assertTrustedResponse(
  changeSet: ConfigurationChangeSet,
  expectedBusinessId: string,
): ConfigurationChangeSet {
  if (changeSet.business_id !== expectedBusinessId) {
    throw new ConfigurationChangeServiceError(
      "The configuration change response did not match this Business.",
      { message: "configuration_response_business_mismatch" },
    );
  }
  configurationDisplayContextSchema.parse(changeSet.display_context_json);
  semanticDiffSchema.parse(changeSet.semantic_diff_json);
  if (changeSet.validation_result_json !== null) {
    const result = configurationValidationResultSchema.parse(
      changeSet.validation_result_json,
    );
    if (
      ((changeSet.status === "validated" ||
        changeSet.status === "applied" ||
        changeSet.status === "conflicted") &&
        result.outcome !== "valid") ||
      (changeSet.status === "rejected" && result.outcome !== "invalid")
    ) {
      throw new ConfigurationChangeServiceError(
        "The configuration validation response was inconsistent.",
        { message: "configuration_response_validation_mismatch" },
      );
    }
  } else if (
    changeSet.status === "validated" ||
    changeSet.status === "rejected" ||
    changeSet.status === "applied"
  ) {
    throw new ConfigurationChangeServiceError(
      "The configuration validation response was incomplete.",
      { message: "configuration_response_validation_missing" },
    );
  }
  return changeSet;
}

function assertTrustedVersion(
  version: ConfigurationVersion,
  expectedBusinessId: string,
): ConfigurationVersion {
  if (version.business_id !== expectedBusinessId) {
    throw new ConfigurationChangeServiceError(
      "The configuration version response did not match this Business.",
      { message: "configuration_response_business_mismatch" },
    );
  }
  if (
    version.snapshot_schema_version !== 1 ||
    !/^[a-f0-9]{64}$/.test(version.snapshot_checksum)
  ) {
    throw new ConfigurationChangeServiceError(
      "The configuration version metadata was invalid.",
      { message: "configuration_response_version_invalid" },
    );
  }
  configurationSnapshotV1Schema.parse(version.snapshot_json);
  return version;
}

export function summarizeConfigurationSnapshot(
  snapshotJson: ConfigurationVersion["snapshot_json"],
): ConfigurationSnapshotCount[] {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotJson);
  return (
    Object.keys(snapshotCollectionLabels) as Array<
      keyof typeof snapshotCollectionLabels
    >
  ).map((collection) => {
    const rows = snapshot[collection];
    return {
      active: rows.filter((row) => row.is_active).length,
      label: snapshotCollectionLabels[collection],
      total: rows.length,
    };
  });
}

export class ConfigurationChangeService {
  readonly #client: SessionClient;
  readonly #businessId: string;
  readonly #actorId: string;

  constructor(
    client: SessionClient,
    context: { businessId: string; actorId: string },
  ) {
    const parsed = contextSchema.parse(context);
    this.#client = client;
    this.#businessId = parsed.businessId;
    this.#actorId = parsed.actorId;
  }

  async proposeChangeSet(
    input: ProposeConfigurationChangeInput,
  ): Promise<ConfigurationChangeSet> {
    const proposal = proposeConfigurationChangeSchema.parse(input);
    const { data, error } = await this.#client.rpc(
      "propose_configuration_change",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
        expected_base_version_id: proposal.expectedBaseVersionId,
        expected_head_revision: proposal.expectedHeadRevision,
        requested_title: proposal.title,
        requested_description: proposal.description as string,
        requested_operations: proposal.operations,
      },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not create the configuration proposal.",
        error,
      );
    }
    if (data.requested_by !== this.#actorId) {
      throw new ConfigurationChangeServiceError(
        "The configuration proposal actor did not match the session.",
        { message: "configuration_response_actor_mismatch" },
      );
    }
    return assertTrustedResponse(data, this.#businessId);
  }

  async listChangeSets(): Promise<ConfigurationChangeSet[]> {
    const { data, error } = await this.#client.rpc(
      "list_configuration_change_sets",
      { expected_business_id: this.#businessId },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not list configuration proposals.",
        error,
      );
    }
    return data.map((changeSet) =>
      assertTrustedResponse(changeSet, this.#businessId),
    );
  }

  async listVersions(): Promise<ConfigurationVersion[]> {
    const { data, error } = await this.#client.rpc(
      "list_configuration_versions",
      { expected_business_id: this.#businessId },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not list configuration versions.",
        error,
      );
    }
    return data.map((version) =>
      assertTrustedVersion(version, this.#businessId),
    );
  }

  async getActiveHead(): Promise<ConfigurationHead> {
    const { data, error } = await this.#client
      .from("business_configuration_heads")
      .select("*")
      .eq("business_id", this.#businessId)
      .maybeSingle();
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not load the active configuration version.",
        error,
      );
    }
    if (data.business_id !== this.#businessId) {
      throw new ConfigurationChangeServiceError(
        "The active configuration response did not match this Business.",
        { message: "configuration_response_business_mismatch" },
      );
    }
    return data;
  }

  async getProposalCurrentness(): Promise<{
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
  }> {
    const head = await this.getActiveHead();
    return {
      expectedBaseVersionId: head.active_version_id,
      expectedHeadRevision: head.head_revision,
    };
  }

  async getVersion(versionId: string): Promise<ConfigurationVersion> {
    const { data, error } = await this.#client.rpc(
      "get_configuration_version",
      {
        expected_business_id: this.#businessId,
        requested_version_id: versionIdSchema.parse(versionId),
      },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not load the configuration version.",
        error,
      );
    }
    return assertTrustedVersion(data, this.#businessId);
  }

  async prepareRollback(
    input: PrepareConfigurationRollbackInput,
  ): Promise<ConfigurationChangeSet> {
    const rollback = prepareConfigurationRollbackRequestSchema.parse(input);
    const { data, error } = await this.#client.rpc(
      "prepare_configuration_rollback",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
        expected_active_source_version_id: rollback.expectedBaseVersionId,
        expected_head_revision: rollback.expectedHeadRevision,
        requested_target_version_id: rollback.targetVersionId,
        requested_title: rollback.title,
        requested_description: rollback.description as string,
      },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not prepare the configuration rollback.",
        error,
      );
    }
    if (
      data.requested_by !== this.#actorId ||
      data.kind !== "rollback" ||
      data.status !== "proposed" ||
      data.base_version_id !== rollback.expectedBaseVersionId ||
      data.base_head_revision !== rollback.expectedHeadRevision ||
      data.rollback_target_version_id !== rollback.targetVersionId
    ) {
      throw new ConfigurationChangeServiceError(
        "The rollback proposal response did not match the trusted request.",
        { message: "configuration_response_rollback_mismatch" },
      );
    }
    return assertTrustedResponse(data, this.#businessId);
  }

  async getChangeSet(changeSetId: string): Promise<ConfigurationChangeSet> {
    const { data, error } = await this.#client.rpc(
      "get_configuration_change_set",
      {
        expected_business_id: this.#businessId,
        requested_change_set_id: changeSetIdSchema.parse(changeSetId),
      },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not load the configuration proposal.",
        error,
      );
    }
    return assertTrustedResponse(data, this.#businessId);
  }

  async loadPreview(changeSetId: string): Promise<ConfigurationPreviewContext> {
    const { data, error } = await this.#client.rpc(
      "load_configuration_preview",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
        requested_change_set_id: changeSetIdSchema.parse(changeSetId),
      },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not load the configuration preview.",
        error,
      );
    }

    const preview = previewChangeSetSchema.parse(data);
    if (preview.business_id !== this.#businessId) {
      throw new ConfigurationChangeServiceError(
        "The configuration preview did not match this Business.",
        { message: "configuration_response_business_mismatch" },
      );
    }
    const definitionSource = createSnapshotConfigurationDefinitionSource(
      preview.candidate_snapshot_json,
      { businessId: this.#businessId },
    );

    return Object.freeze({
      proposalId: preview.id,
      businessId: preview.business_id,
      title: preview.title,
      kind: preview.kind,
      status: preview.status,
      candidateChecksum: preview.candidate_checksum,
      semanticDiff: preview.semantic_diff_json,
      definitionSource,
      pages: await definitionSource.listPages(),
    });
  }

  async abandonChangeSet(changeSetId: string): Promise<ConfigurationChangeSet> {
    const { data, error } = await this.#client.rpc(
      "abandon_configuration_change_set",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
        requested_change_set_id: changeSetIdSchema.parse(changeSetId),
      },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not abandon the configuration proposal.",
        error,
      );
    }
    return assertTrustedResponse(data, this.#businessId);
  }

  async validateChangeSet(
    changeSetId: string,
  ): Promise<ConfigurationChangeSet> {
    const { data, error } = await this.#client.rpc(
      "validate_configuration_change",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
        requested_change_set_id: changeSetIdSchema.parse(changeSetId),
      },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not validate the configuration proposal.",
        error,
      );
    }
    return assertTrustedResponse(data, this.#businessId);
  }

  async applyChangeSet(changeSetId: string): Promise<ConfigurationChangeSet> {
    const { data, error } = await this.#client.rpc(
      "apply_configuration_change",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
        requested_change_set_id: changeSetIdSchema.parse(changeSetId),
      },
    );
    if (error || !data) {
      throw new ConfigurationChangeServiceError(
        "Could not apply the configuration proposal.",
        error,
      );
    }
    return assertTrustedResponse(data, this.#businessId);
  }
}
