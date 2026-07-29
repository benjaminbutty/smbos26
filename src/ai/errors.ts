import "server-only";

export const aiExecutionErrorCodes = [
  "ai_disabled",
  "ai_task_not_found",
  "ai_input_invalid",
  "ai_input_too_large",
  "ai_provider_unavailable",
  "ai_rate_limited",
  "ai_timeout",
  "ai_output_invalid",
  "ai_attempts_exhausted",
  "ai_execution_failed",
  "ai_budget_exceeded",
  "ai_accounting_unavailable",
  "ai_accounting_failed",
] as const;

export type AiExecutionErrorCode = (typeof aiExecutionErrorCodes)[number];

const safeMessages: Readonly<Record<AiExecutionErrorCode, string>> = {
  ai_disabled: "AI execution is not configured.",
  ai_task_not_found: "This AI task is not available.",
  ai_input_invalid: "The AI request was not valid.",
  ai_input_too_large: "The AI request is too large.",
  ai_provider_unavailable: "The AI service is temporarily unavailable.",
  ai_rate_limited: "The AI service is temporarily busy.",
  ai_timeout: "The AI request timed out.",
  ai_output_invalid: "The AI service returned an invalid result.",
  ai_attempts_exhausted: "The AI service could not complete the request.",
  ai_execution_failed: "The AI request could not be completed safely.",
  ai_budget_exceeded: "This Business has reached its AI usage limit.",
  ai_accounting_unavailable: "AI usage controls are temporarily unavailable.",
  ai_accounting_failed: "The AI request could not be recorded safely.",
};

export interface PublicAiExecutionError {
  code: AiExecutionErrorCode;
  message: string;
}

export interface AiExecutionAccounting {
  attemptsStarted: number;
  inputTokens: number;
  outputTokens: number;
  usageReported: boolean;
  usageComplete: boolean;
  providerInvocationStarted: boolean;
  failureBeforeProviderInvocation: boolean;
}

export class AiExecutionError extends Error {
  readonly code: AiExecutionErrorCode;
  readonly accounting: AiExecutionAccounting | undefined;
  override readonly cause: unknown;

  constructor(
    code: AiExecutionErrorCode,
    options?: { accounting?: AiExecutionAccounting; cause?: unknown },
  ) {
    super(safeMessages[code]);
    this.name = "AiExecutionError";
    this.code = code;
    this.cause = options?.cause;
    this.accounting = options?.accounting
      ? Object.freeze({ ...options.accounting })
      : undefined;
  }

  toPublicError(): PublicAiExecutionError {
    return Object.freeze({
      code: this.code,
      message: this.message,
    });
  }

  toJSON(): PublicAiExecutionError {
    return this.toPublicError();
  }
}
