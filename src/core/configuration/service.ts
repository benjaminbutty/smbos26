import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import {
  configurationDisplayContextSchema,
  configurationValidationResultSchema,
  proposeConfigurationChangeSchema,
  semanticDiffSchema,
  type ProposeConfigurationChangeInput,
} from "./schemas";

type ConfigurationChangeSet =
  Database["public"]["Tables"]["configuration_change_sets"]["Row"];
type SessionClient = SupabaseClient<Database>;

const contextSchema = z
  .object({
    businessId: z.uuid(),
    actorId: z.uuid(),
  })
  .strict();

const changeSetIdSchema = z.uuid();

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
  configuration_change_set_not_applicable:
    "This configuration proposal is not ready to be applied.",
  configuration_change_set_not_validatable:
    "This configuration proposal can no longer be validated.",
  configuration_head_version_mismatch:
    "The active configuration history is inconsistent. No changes were applied.",
  configuration_owner_or_admin_required:
    "Owner or Admin access is required for configuration changes.",
  configuration_projection_out_of_sync:
    "Configuration changed outside the version engine. No proposal was changed.",
  configuration_proposal_no_changes:
    "The proposal does not change the current configuration.",
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
