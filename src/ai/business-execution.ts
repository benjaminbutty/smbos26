import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/supabase/database.types";
import {
  deriveAiReservationEnvelope,
  type AiReservationEnvelope,
} from "./accounting/cost";
import {
  AiAccountingServiceError,
  SupabaseAiAccountingService,
  type AiAccountingStore,
  type AiSettlementRequest,
} from "./accounting/service";
import {
  AiExecutionError,
  type AiExecutionAccounting,
  type AiExecutionErrorCode,
} from "./errors";
import {
  aiExecutionService,
  type AiExecutionResult,
  type PreparedAiExecution,
} from "./execution";

interface ExecutionCore {
  prepare(taskKey: string, input: unknown): PreparedAiExecution;
  executePrepared(prepared: PreparedAiExecution): Promise<AiExecutionResult>;
}

interface OrchestratorDependencies {
  accounting: AiAccountingStore;
  execution: ExecutionCore;
  generateExecutionId(): string;
}

function mapReservationError(error: unknown): AiExecutionError {
  if (error instanceof AiAccountingServiceError) {
    if (error.code === "ai_disabled") {
      return new AiExecutionError("ai_disabled", { cause: error });
    }
    if (error.code === "ai_budget_exceeded") {
      return new AiExecutionError("ai_budget_exceeded", { cause: error });
    }
  }
  return new AiExecutionError("ai_accounting_unavailable", { cause: error });
}

function settlementRequest(
  executionId: string,
  status: "succeeded" | "failed" | "cancelled",
  outcomeCode: string,
  accounting: AiExecutionAccounting,
): AiSettlementRequest {
  const cancelled = status === "cancelled";
  return {
    executionId,
    status,
    outcomeCode,
    actualInputTokens: cancelled
      ? 0
      : accounting.usageReported
        ? accounting.inputTokens
        : null,
    actualOutputTokens: cancelled
      ? 0
      : accounting.usageReported
        ? accounting.outputTokens
        : null,
    providerAttemptCount: cancelled ? 0 : accounting.attemptsStarted,
    providerInvocationStarted: cancelled
      ? false
      : accounting.providerInvocationStarted,
    usageComplete: cancelled ? true : accounting.usageComplete,
  };
}

async function settleWithRetry(
  accounting: AiAccountingStore,
  request: AiSettlementRequest,
): Promise<void> {
  let firstCause: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await accounting.settle(request);
      return;
    } catch (cause) {
      firstCause ??= cause;
      if (attempt === 2) {
        throw new AggregateError(
          [firstCause, cause],
          "AI usage settlement failed after an idempotent retry.",
          { cause },
        );
      }
    }
  }
}

function fallbackAccounting(): AiExecutionAccounting {
  return Object.freeze({
    attemptsStarted: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageReported: false,
    usageComplete: true,
    providerInvocationStarted: false,
    failureBeforeProviderInvocation: true,
  });
}

export function createBusinessAiExecutionOrchestrator(
  overrides: Partial<OrchestratorDependencies> &
    Pick<OrchestratorDependencies, "accounting">,
) {
  const dependencies: OrchestratorDependencies = {
    accounting: overrides.accounting,
    execution: overrides.execution ?? aiExecutionService,
    generateExecutionId:
      overrides.generateExecutionId ?? (() => crypto.randomUUID()),
  };

  return Object.freeze({
    async execute(taskKey: string, input: unknown): Promise<AiExecutionResult> {
      const prepared = dependencies.execution.prepare(taskKey, input);
      let envelope: AiReservationEnvelope;
      try {
        envelope = deriveAiReservationEnvelope(prepared.descriptor.policy);
      } catch (cause) {
        throw new AiExecutionError("ai_execution_failed", { cause });
      }

      let settings;
      try {
        settings = await dependencies.accounting.readSettings();
      } catch (cause) {
        throw new AiExecutionError("ai_accounting_unavailable", { cause });
      }
      if (!settings.is_enabled) {
        throw new AiExecutionError("ai_disabled");
      }

      const executionId = dependencies.generateExecutionId();
      try {
        await dependencies.accounting.reserve({
          executionId,
          taskKey: prepared.descriptor.taskKey,
          taskVersion: prepared.descriptor.taskVersion,
          purposeLabel: prepared.descriptor.purposeLabel,
          policyKey: prepared.descriptor.policy.key,
          providerKey: prepared.descriptor.policy.providerKey,
          modelKey: prepared.descriptor.policy.modelKey,
          reservedInputTokens: envelope.reservedInputTokens,
          reservedOutputTokens: envelope.reservedOutputTokens,
          inputMicrousdPerMillion: envelope.inputMicrousdPerMillion,
          outputMicrousdPerMillion: envelope.outputMicrousdPerMillion,
        });
      } catch (cause) {
        throw mapReservationError(cause);
      }

      try {
        const result = await dependencies.execution.executePrepared(prepared);
        try {
          await settleWithRetry(
            dependencies.accounting,
            settlementRequest(
              executionId,
              "succeeded",
              "ai_succeeded",
              result.accounting,
            ),
          );
        } catch (cause) {
          throw new AiExecutionError("ai_accounting_failed", { cause });
        }
        return result;
      } catch (cause) {
        if (
          cause instanceof AiExecutionError &&
          cause.code === "ai_accounting_failed"
        ) {
          throw cause;
        }
        const executionError =
          cause instanceof AiExecutionError
            ? cause
            : new AiExecutionError("ai_execution_failed", { cause });
        const usage = executionError.accounting ?? fallbackAccounting();
        const status = usage.providerInvocationStarted ? "failed" : "cancelled";
        const outcomeCode: AiExecutionErrorCode | "ai_cancelled" =
          status === "cancelled" ? "ai_cancelled" : executionError.code;
        try {
          await settleWithRetry(
            dependencies.accounting,
            settlementRequest(executionId, status, outcomeCode, usage),
          );
        } catch (settlementCause) {
          throw new AiExecutionError("ai_accounting_failed", {
            cause: new AggregateError(
              [executionError, settlementCause],
              "AI execution failed and its settlement could not be recorded.",
            ),
          });
        }
        throw executionError;
      }
    },
  });
}

export function createBusinessAiExecutionService(
  sessionClient: SupabaseClient<Database>,
  context: { businessId: string; actorId: string },
) {
  return createBusinessAiExecutionOrchestrator({
    accounting: new SupabaseAiAccountingService(sessionClient, context),
  });
}
