import "server-only";

export const openAiInvalidRequestReasonCodes = [
  "local_schema_adaptation",
  "provider_schema_rejected",
  "provider_response_format_rejected",
  "provider_model_rejected",
  "provider_parameter_rejected",
  "provider_invalid_request_unknown",
] as const;

export type OpenAiInvalidRequestReasonCode =
  (typeof openAiInvalidRequestReasonCodes)[number];

const safeMessage =
  "The OpenAI invalid-request stage was classified internally.";

export class OpenAiInvalidRequestDiagnostic extends Error {
  readonly reasonCode: OpenAiInvalidRequestReasonCode;

  constructor(reasonCode: OpenAiInvalidRequestReasonCode) {
    super(safeMessage);
    this.name = "OpenAiInvalidRequestDiagnostic";
    this.reasonCode = reasonCode;
  }
}
