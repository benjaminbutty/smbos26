import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createAdminClient } from "../../db/supabase/admin";
import type { Database } from "../../db/supabase/database.types";

type SessionClient = SupabaseClient<Database>;
type TrustedClient = SupabaseClient<Database>;

const contextSchema = z
  .object({
    businessId: z.uuid(),
    actorId: z.uuid(),
  })
  .strict();

const settingsSchema = z
  .object({
    business_id: z.uuid(),
    is_enabled: z.boolean(),
    daily_request_limit: z.number().int().positive().max(1_000),
    daily_input_token_limit: z.number().int().positive().max(100_000_000),
    daily_output_token_limit: z.number().int().positive().max(50_000_000),
    daily_cost_limit_microusd: z.number().int().positive().max(1_000_000_000),
    created_at: z.string(),
    updated_at: z.string(),
    updated_by: z.uuid().nullable(),
  })
  .strict();

const usageSummarySchema = z
  .object({
    usage_day: z.iso.date(),
    request_count: z.number().int().nonnegative(),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cost_microusd: z.number().int().nonnegative(),
  })
  .strict();

const auditRunSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    actor_id: z.uuid(),
    usage_day: z.iso.date(),
    task_key: z.string().min(1).max(80),
    task_version: z.number().int().positive(),
    purpose_label: z.string().min(1).max(120),
    policy_key: z.string().min(1).max(80),
    provider_key: z.string().min(1).max(80),
    model_key: z.string().min(1).max(120),
    status: z.enum(["reserved", "succeeded", "failed", "cancelled", "expired"]),
    outcome_code: z.string().min(1).max(80).nullable(),
    reserved_request_count: z.literal(1),
    reserved_input_tokens: z.number().int().positive(),
    reserved_output_tokens: z.number().int().positive(),
    reserved_cost_microusd: z.number().int().nonnegative(),
    actual_input_tokens: z.number().int().nonnegative().nullable(),
    actual_output_tokens: z.number().int().nonnegative().nullable(),
    actual_cost_microusd: z.number().int().nonnegative().nullable(),
    charged_input_tokens: z.number().int().nonnegative(),
    charged_output_tokens: z.number().int().nonnegative(),
    charged_cost_microusd: z.number().int().nonnegative(),
    provider_attempt_count: z.number().int().nonnegative().max(5),
    provider_invocation_started: z.boolean(),
    usage_complete: z.boolean(),
    usage_overrun: z.boolean(),
    reserved_at: z.string(),
    settled_at: z.string().nullable(),
  })
  .strict();

const reservationRequestSchema = z
  .object({
    executionId: z.uuid(),
    taskKey: z.string().min(1).max(80),
    taskVersion: z.number().int().positive(),
    purposeLabel: z.string().trim().min(1).max(120),
    policyKey: z.string().min(1).max(80),
    providerKey: z.string().min(1).max(80),
    modelKey: z.string().min(1).max(120),
    reservedInputTokens: z.number().int().positive().max(50_000_000),
    reservedOutputTokens: z.number().int().positive().max(5_000_000),
    inputMicrousdPerMillion: z.number().int().nonnegative().max(1_000_000_000),
    outputMicrousdPerMillion: z.number().int().nonnegative().max(1_000_000_000),
  })
  .strict();

const reservationSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    usage_day: z.iso.date(),
    status: z.enum(["reserved", "succeeded", "failed", "cancelled", "expired"]),
    reserved_request_count: z.literal(1),
    reserved_input_tokens: z.number().int().positive(),
    reserved_output_tokens: z.number().int().positive(),
    reserved_cost_microusd: z.number().int().nonnegative(),
    reserved_at: z.string(),
  })
  .strict();

const settlementRequestSchema = z
  .object({
    executionId: z.uuid(),
    status: z.enum(["succeeded", "failed", "cancelled"]),
    outcomeCode: z
      .string()
      .min(1)
      .max(80)
      .regex(/^ai_[a-z0-9_]+$/),
    actualInputTokens: z.number().int().nonnegative().nullable(),
    actualOutputTokens: z.number().int().nonnegative().nullable(),
    providerAttemptCount: z.number().int().nonnegative().max(5),
    providerInvocationStarted: z.boolean(),
    usageComplete: z.boolean(),
  })
  .strict();

const settlementSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    status: z.enum(["succeeded", "failed", "cancelled"]),
    outcome_code: z.string().min(1).max(80),
    actual_input_tokens: z.number().int().nonnegative().nullable(),
    actual_output_tokens: z.number().int().nonnegative().nullable(),
    actual_cost_microusd: z.number().int().nonnegative().nullable(),
    charged_input_tokens: z.number().int().nonnegative(),
    charged_output_tokens: z.number().int().nonnegative(),
    charged_cost_microusd: z.number().int().nonnegative(),
    provider_attempt_count: z.number().int().nonnegative().max(5),
    provider_invocation_started: z.boolean(),
    usage_complete: z.boolean(),
    usage_overrun: z.boolean(),
    settled_at: z.string(),
  })
  .strict();

export type BusinessAiSettings = z.infer<typeof settingsSchema>;
export type BusinessAiUsageSummary = z.infer<typeof usageSummarySchema>;
export type BusinessAiAuditRun = z.infer<typeof auditRunSchema>;
export type AiReservationRequest = z.infer<typeof reservationRequestSchema>;
export type AiReservation = z.infer<typeof reservationSchema>;
export type AiSettlementRequest = z.infer<typeof settlementRequestSchema>;
export type AiSettlement = z.infer<typeof settlementSchema>;

type PostgrestErrorShape = {
  code?: string;
  message?: string;
};

function accountingErrorCode(error: PostgrestErrorShape | null): string {
  const match = error?.message?.match(/ai_[a-z0-9_]+/);
  return match?.[0] ?? error?.code ?? "ai_accounting_request_failed";
}

export class AiAccountingServiceError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(message: string, cause: PostgrestErrorShape | unknown) {
    super(message);
    this.name = "AiAccountingServiceError";
    this.cause = cause;
    this.code =
      typeof cause === "object" && cause !== null
        ? accountingErrorCode(cause as PostgrestErrorShape)
        : "ai_accounting_request_failed";
  }
}

export interface AiAccountingStore {
  readSettings(): Promise<BusinessAiSettings>;
  reserve(request: AiReservationRequest): Promise<AiReservation>;
  settle(request: AiSettlementRequest): Promise<AiSettlement>;
}

export class SupabaseAiAccountingService implements AiAccountingStore {
  readonly #sessionClient: SessionClient;
  #trustedClient: TrustedClient | undefined;
  readonly #businessId: string;
  readonly #actorId: string;

  constructor(
    sessionClient: SessionClient,
    context: { businessId: string; actorId: string },
  ) {
    const parsed = contextSchema.parse(context);
    this.#sessionClient = sessionClient;
    this.#businessId = parsed.businessId;
    this.#actorId = parsed.actorId;
  }

  #getTrustedClient(): TrustedClient {
    this.#trustedClient ??= createAdminClient();
    return this.#trustedClient;
  }

  async readSettings(): Promise<BusinessAiSettings> {
    const { data, error } = await this.#sessionClient.rpc(
      "get_business_ai_settings",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
      },
    );
    if (error || !data) {
      throw new AiAccountingServiceError(
        "Could not load AI usage settings.",
        error,
      );
    }
    const settings = settingsSchema.parse(data[0]);
    if (settings.business_id !== this.#businessId || data.length !== 1) {
      throw new AiAccountingServiceError(
        "The AI settings response did not match this Business.",
        { message: "ai_accounting_response_mismatch" },
      );
    }
    return settings;
  }

  async updateSettings(input: {
    isEnabled: boolean;
    dailyRequestLimit: number;
    dailyInputTokenLimit: number;
    dailyOutputTokenLimit: number;
    dailyCostLimitMicrousd: number;
  }): Promise<BusinessAiSettings> {
    const requested = z
      .object({
        isEnabled: z.boolean(),
        dailyRequestLimit: z.number().int().positive().max(1_000),
        dailyInputTokenLimit: z.number().int().positive().max(100_000_000),
        dailyOutputTokenLimit: z.number().int().positive().max(50_000_000),
        dailyCostLimitMicrousd: z.number().int().positive().max(1_000_000_000),
      })
      .strict()
      .parse(input);
    const { data, error } = await this.#sessionClient.rpc(
      "update_business_ai_settings",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
        requested_is_enabled: requested.isEnabled,
        requested_daily_request_limit: requested.dailyRequestLimit,
        requested_daily_input_token_limit: requested.dailyInputTokenLimit,
        requested_daily_output_token_limit: requested.dailyOutputTokenLimit,
        requested_daily_cost_limit_microusd: requested.dailyCostLimitMicrousd,
      },
    );
    if (error || !data) {
      throw new AiAccountingServiceError(
        "Could not update AI usage settings.",
        error,
      );
    }
    const settings = settingsSchema.parse(data[0]);
    if (settings.business_id !== this.#businessId || data.length !== 1) {
      throw new AiAccountingServiceError(
        "The AI settings response did not match this Business.",
        { message: "ai_accounting_response_mismatch" },
      );
    }
    return settings;
  }

  async readUsageSummary(): Promise<BusinessAiUsageSummary> {
    const { data, error } = await this.#sessionClient.rpc(
      "get_business_ai_usage_summary",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
      },
    );
    if (error || !data) {
      throw new AiAccountingServiceError(
        "Could not load the AI usage summary.",
        error,
      );
    }
    if (data.length !== 1) {
      throw new AiAccountingServiceError(
        "The AI usage response was incomplete.",
        { message: "ai_accounting_response_mismatch" },
      );
    }
    return usageSummarySchema.parse(data[0]);
  }

  async listAuditRuns(): Promise<BusinessAiAuditRun[]> {
    const { data, error } = await this.#sessionClient.rpc(
      "list_business_ai_execution_runs",
      {
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
      },
    );
    if (error || !data) {
      throw new AiAccountingServiceError(
        "Could not load the AI execution audit.",
        error,
      );
    }
    return z.array(auditRunSchema).max(50).parse(data);
  }

  async reserve(input: AiReservationRequest): Promise<AiReservation> {
    const request = reservationRequestSchema.parse(input);
    const { data, error } = await this.#getTrustedClient().rpc(
      "reserve_business_ai_execution",
      {
        requested_execution_id: request.executionId,
        expected_business_id: this.#businessId,
        expected_actor_id: this.#actorId,
        requested_task_key: request.taskKey,
        requested_task_version: request.taskVersion,
        requested_purpose_label: request.purposeLabel,
        requested_policy_key: request.policyKey,
        requested_provider_key: request.providerKey,
        requested_model_key: request.modelKey,
        requested_reserved_input_tokens: request.reservedInputTokens,
        requested_reserved_output_tokens: request.reservedOutputTokens,
        requested_input_microusd_per_million: request.inputMicrousdPerMillion,
        requested_output_microusd_per_million: request.outputMicrousdPerMillion,
      },
    );
    if (error || !data) {
      throw new AiAccountingServiceError("Could not reserve AI usage.", error);
    }
    const reservation = reservationSchema.parse(data[0]);
    if (
      data.length !== 1 ||
      reservation.id !== request.executionId ||
      reservation.business_id !== this.#businessId
    ) {
      throw new AiAccountingServiceError(
        "The AI reservation response was invalid.",
        { message: "ai_accounting_response_mismatch" },
      );
    }
    return reservation;
  }

  async settle(input: AiSettlementRequest): Promise<AiSettlement> {
    const request = settlementRequestSchema.parse(input);
    const args = {
      requested_execution_id: request.executionId,
      expected_business_id: this.#businessId,
      requested_status: request.status,
      requested_outcome_code: request.outcomeCode,
      requested_actual_input_tokens: request.actualInputTokens,
      requested_actual_output_tokens: request.actualOutputTokens,
      requested_provider_attempt_count: request.providerAttemptCount,
      requested_provider_invocation_started: request.providerInvocationStarted,
      requested_usage_complete: request.usageComplete,
    };
    const { data, error } = await this.#getTrustedClient().rpc(
      "settle_business_ai_execution",
      args as unknown as Database["public"]["Functions"]["settle_business_ai_execution"]["Args"],
    );
    if (error || !data) {
      throw new AiAccountingServiceError("Could not settle AI usage.", error);
    }
    const settlement = settlementSchema.parse(data[0]);
    if (
      data.length !== 1 ||
      settlement.id !== request.executionId ||
      settlement.business_id !== this.#businessId
    ) {
      throw new AiAccountingServiceError(
        "The AI settlement response was invalid.",
        { message: "ai_accounting_response_mismatch" },
      );
    }
    return settlement;
  }
}
