import "server-only";

export const aiPlanningErrorCodes = [
  "ai_plan_request_invalid",
  "ai_plan_context_stale",
  "ai_plan_failed",
] as const;

export type AiPlanningErrorCode = (typeof aiPlanningErrorCodes)[number];

const safeMessages: Readonly<Record<AiPlanningErrorCode, string>> = {
  ai_plan_request_invalid: "The Business request was not valid.",
  ai_plan_context_stale:
    "The Business changed while this plan was prepared. Please try again.",
  ai_plan_failed: "The Business request could not be planned safely.",
};

export class AiPlanningError extends Error {
  readonly code: AiPlanningErrorCode;
  override readonly cause: unknown;

  constructor(code: AiPlanningErrorCode, options?: { cause?: unknown }) {
    super(safeMessages[code]);
    this.name = "AiPlanningError";
    this.code = code;
    this.cause = options?.cause;
  }

  toJSON(): { code: AiPlanningErrorCode; message: string } {
    return Object.freeze({ code: this.code, message: this.message });
  }
}
