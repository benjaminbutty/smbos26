import "server-only";

export const aiBuilderErrorCodes = [
  "ai_builder_request_invalid",
  "ai_builder_context_stale",
  "ai_builder_runtime_invalid",
  "ai_builder_internal_failed",
] as const;

export type AiBuilderErrorCode = (typeof aiBuilderErrorCodes)[number];

const safeMessages: Readonly<Record<AiBuilderErrorCode, string>> = {
  ai_builder_request_invalid: "The Builder request was not valid.",
  ai_builder_context_stale:
    "The Business changed while Builder was preparing this request. Please try again.",
  ai_builder_runtime_invalid: "The Builder runtime configuration is invalid.",
  ai_builder_internal_failed:
    "The Builder request could not be completed safely.",
};

export interface PublicAiBuilderError {
  code: AiBuilderErrorCode;
  message: string;
}

export class AiBuilderError extends Error {
  readonly code: AiBuilderErrorCode;
  override readonly cause: unknown;

  constructor(code: AiBuilderErrorCode, options?: { cause?: unknown }) {
    super(safeMessages[code]);
    this.name = "AiBuilderError";
    this.code = code;
    this.cause = options?.cause;
  }

  toPublicError(): PublicAiBuilderError {
    return Object.freeze({
      code: this.code,
      message: this.message,
    });
  }

  toJSON(): PublicAiBuilderError {
    return this.toPublicError();
  }
}
