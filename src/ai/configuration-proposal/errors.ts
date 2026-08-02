import "server-only";

export const builderConfigurationProposalErrorCodes = [
  "ai_configuration_proposal_request_invalid",
  "ai_configuration_proposal_context_stale",
  "ai_configuration_proposal_compile_failed",
  "ai_configuration_proposal_no_changes",
  "ai_configuration_proposal_failed",
] as const;

export type BuilderConfigurationProposalErrorCode =
  (typeof builderConfigurationProposalErrorCodes)[number];

const safeMessages: Readonly<
  Record<BuilderConfigurationProposalErrorCode, string>
> = {
  ai_configuration_proposal_request_invalid:
    "The configuration proposal request was not valid.",
  ai_configuration_proposal_context_stale:
    "The Business changed while this proposal was prepared. Please try again.",
  ai_configuration_proposal_compile_failed:
    "The proposed setup could not be compiled safely.",
  ai_configuration_proposal_no_changes:
    "The proposed setup does not change the current Business configuration.",
  ai_configuration_proposal_failed:
    "The configuration proposal could not be created safely.",
};

export interface PublicBuilderConfigurationProposalError {
  code: BuilderConfigurationProposalErrorCode;
  message: string;
}

export class BuilderConfigurationProposalError extends Error {
  readonly code: BuilderConfigurationProposalErrorCode;
  override readonly cause: unknown;

  constructor(
    code: BuilderConfigurationProposalErrorCode,
    options?: { cause?: unknown },
  ) {
    super(safeMessages[code]);
    this.name = "BuilderConfigurationProposalError";
    this.code = code;
    this.cause = options?.cause;
  }

  toPublicError(): PublicBuilderConfigurationProposalError {
    return Object.freeze({
      code: this.code,
      message: this.message,
    });
  }

  toJSON(): PublicBuilderConfigurationProposalError {
    return this.toPublicError();
  }
}
