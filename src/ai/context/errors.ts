export const aiBusinessContextErrorCodes = [
  "ai_context_unauthorized",
  "ai_context_not_found",
  "ai_context_inconsistent",
  "ai_context_too_large",
  "ai_context_failed",
] as const;

export type AiBusinessContextErrorCode =
  (typeof aiBusinessContextErrorCodes)[number];

const safeMessages: Readonly<Record<AiBusinessContextErrorCode, string>> = {
  ai_context_unauthorized:
    "You do not have permission to load this Business context.",
  ai_context_not_found: "This Business context could not be found.",
  ai_context_inconsistent:
    "This Business context could not be assembled safely.",
  ai_context_too_large: "This Business context is too large to use safely.",
  ai_context_failed: "This Business context could not be loaded.",
};

export interface PublicAiBusinessContextError {
  code: AiBusinessContextErrorCode;
  message: string;
}

export class AiBusinessContextError extends Error {
  readonly code: AiBusinessContextErrorCode;
  override readonly cause: unknown;

  constructor(code: AiBusinessContextErrorCode, options?: { cause?: unknown }) {
    super(safeMessages[code]);
    this.name = "AiBusinessContextError";
    this.code = code;
    this.cause = options?.cause;
  }

  toPublicError(): PublicAiBusinessContextError {
    return Object.freeze({
      code: this.code,
      message: this.message,
    });
  }

  toJSON(): PublicAiBusinessContextError {
    return this.toPublicError();
  }
}
