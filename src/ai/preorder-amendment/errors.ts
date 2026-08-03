import "server-only";

export const builderPreorderAmendmentProposalErrorCodes = [
  "ai_preorder_amendment_request_invalid",
  "ai_preorder_amendment_context_stale",
  "ai_preorder_amendment_no_changes",
  "ai_preorder_amendment_failed",
] as const;

export type BuilderPreorderAmendmentProposalErrorCode =
  (typeof builderPreorderAmendmentProposalErrorCodes)[number];

const safeMessages: Readonly<
  Record<BuilderPreorderAmendmentProposalErrorCode, string>
> = {
  ai_preorder_amendment_request_invalid:
    "The preorder amendment request was not valid.",
  ai_preorder_amendment_context_stale:
    "The Business changed while this proposal was prepared. Please try again.",
  ai_preorder_amendment_no_changes:
    "The proposed preorder changes do not change the current setup.",
  ai_preorder_amendment_failed:
    "The preorder proposal could not be created safely.",
};

export class BuilderPreorderAmendmentProposalError extends Error {
  readonly code: BuilderPreorderAmendmentProposalErrorCode;
  override readonly cause: unknown;

  constructor(
    code: BuilderPreorderAmendmentProposalErrorCode,
    options?: { cause?: unknown },
  ) {
    super(safeMessages[code]);
    this.name = "BuilderPreorderAmendmentProposalError";
    this.code = code;
    this.cause = options?.cause;
  }

  toJSON() {
    return Object.freeze({ code: this.code, message: this.message });
  }
}
