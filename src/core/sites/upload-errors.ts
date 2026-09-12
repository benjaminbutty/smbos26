export type SiteUploadServiceErrorCode =
  | "unavailable"
  | "invalid_request"
  | "rate_limited"
  | "expired"
  | "not_found"
  | "integrity_failed"
  | "quota_exceeded"
  | "claim_lost"
  | "provider_failed";

export class SiteUploadServiceError extends Error {
  readonly code: SiteUploadServiceErrorCode;

  constructor(
    code: SiteUploadServiceErrorCode,
    message = "The upload session is unavailable.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SiteUploadServiceError";
    this.code = code;
  }
}
