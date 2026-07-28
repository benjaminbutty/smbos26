import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import {
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

export class ConfigurationChangeServiceError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(message: string, error: PostgrestErrorShape | unknown) {
    super(
      typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
        ? `${message} ${error.message}${
            "details" in error && typeof error.details === "string"
              ? ` (${error.details})`
              : ""
          }`
        : message,
    );
    this.name = "ConfigurationChangeServiceError";
    this.cause = error;
    this.code =
      typeof error === "object" && error !== null
        ? engineErrorCode(error as PostgrestErrorShape)
        : "configuration_request_failed";
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
  semanticDiffSchema.parse(changeSet.semantic_diff_json);
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
}
