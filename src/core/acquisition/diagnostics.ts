import { z } from "zod";

import { AiExecutionError, type AiExecutionErrorCode } from "../../ai/errors";
import { StructuredAiProviderError } from "../../ai/contracts";
import { AcquisitionInterpretationError } from "./interpreter";
import {
  AcquisitionCandidateQualityError,
  acquisitionCandidateQualityCodes,
} from "./quality";
import type { AcquisitionCategory } from "./schemas";

export const acquisitionCandidateDiagnosticStages = [
  "provider_authentication",
  "provider_transport",
  "provider_request",
  "provider_structured_output",
  "provider_output_validation",
  "provider_execution",
  "candidate_composition",
  "candidate_quality",
  "capability_enhancement",
  "unknown",
] as const;

export type AcquisitionCandidateDiagnosticStage =
  (typeof acquisitionCandidateDiagnosticStages)[number];

export type AcquisitionCandidateDiagnosticCode =
  | AiExecutionErrorCode
  | `quality_${(typeof acquisitionCandidateQualityCodes)[number]}`
  | "quality_unclassified"
  | "provider_authentication"
  | "provider_transport_unavailable"
  | "provider_transport_rate_limited"
  | "provider_transport_transient"
  | "provider_request_invalid"
  | "provider_structured_output_invalid"
  | "provider_refused"
  | "provider_incomplete"
  | "provider_content_filtered"
  | "provider_disabled"
  | "provider_execution_failed"
  | "composition_needs_more_detail"
  | "composition_invalid"
  | "capability_invalid"
  | "unclassified";

const qualityCodeSet = new Set<string>(acquisitionCandidateQualityCodes);

export type AcquisitionCandidateDiagnostic = {
  event: "acquisition_candidate_diagnostic";
  stage: AcquisitionCandidateDiagnosticStage;
  code: AcquisitionCandidateDiagnosticCode;
  category: AcquisitionCategory;
  source: "tailored" | "fallback";
};

function providerDiagnostic(
  error: AiExecutionError,
): Pick<AcquisitionCandidateDiagnostic, "stage" | "code"> {
  const failure =
    error.cause instanceof StructuredAiProviderError ? error.cause : null;
  if (failure) {
    if (
      failure.kind === "unavailable" &&
      failure.cause instanceof Error &&
      failure.cause.name === "OpenAiAuthenticationDiagnostic"
    ) {
      return {
        stage: "provider_authentication",
        code: "provider_authentication",
      };
    }
    switch (failure.kind) {
      case "disabled":
        return { stage: "provider_execution", code: "provider_disabled" };
      case "unavailable":
        return {
          stage: "provider_transport",
          code: "provider_transport_unavailable",
        };
      case "rate_limited":
        return {
          stage: "provider_transport",
          code: "provider_transport_rate_limited",
        };
      case "transient":
        return {
          stage: "provider_transport",
          code: "provider_transport_transient",
        };
      case "invalid_request":
        return {
          stage: "provider_request",
          code: "provider_request_invalid",
        };
      case "invalid_response":
        return {
          stage: "provider_structured_output",
          code: "provider_structured_output_invalid",
        };
      case "refused":
        return {
          stage: "provider_structured_output",
          code: "provider_refused",
        };
      case "incomplete":
        return {
          stage: "provider_structured_output",
          code: "provider_incomplete",
        };
      case "content_filtered":
        return {
          stage: "provider_structured_output",
          code: "provider_content_filtered",
        };
    }
  }

  if (error.code === "ai_output_invalid") {
    return {
      stage: "provider_output_validation",
      code: error.code,
    };
  }
  if (
    error.code === "ai_timeout" ||
    error.code === "ai_provider_unavailable" ||
    error.code === "ai_rate_limited" ||
    error.code === "ai_attempts_exhausted"
  ) {
    return { stage: "provider_transport", code: error.code };
  }
  return { stage: "provider_execution", code: error.code };
}

export function classifyAcquisitionCandidateDiagnostic(
  error: unknown,
  stageHint:
    "candidate_generation" | "candidate_quality" | "capability_enhancement",
  context: Pick<AcquisitionCandidateDiagnostic, "category" | "source">,
): AcquisitionCandidateDiagnostic {
  let stage: AcquisitionCandidateDiagnosticStage = "unknown";
  let code: AcquisitionCandidateDiagnosticCode = "unclassified";

  if (stageHint === "capability_enhancement") {
    stage = "capability_enhancement";
    code = "capability_invalid";
  } else if (error instanceof AcquisitionCandidateQualityError) {
    stage = "candidate_quality";
    code = qualityCodeSet.has(error.code)
      ? (`quality_${error.code}` as AcquisitionCandidateDiagnosticCode)
      : "quality_unclassified";
  } else if (error instanceof AiExecutionError) {
    ({ stage, code } = providerDiagnostic(error));
  } else if (error instanceof AcquisitionInterpretationError) {
    stage = "candidate_composition";
    code =
      error.code === "needs_more_detail"
        ? "composition_needs_more_detail"
        : "composition_invalid";
  } else if (error instanceof z.ZodError) {
    stage = "provider_output_validation";
    code = "ai_output_invalid";
  } else if (stageHint === "candidate_quality") {
    stage = "candidate_quality";
    code = "quality_unclassified";
  }

  return {
    event: "acquisition_candidate_diagnostic",
    stage,
    code,
    ...context,
  };
}

export function emitAcquisitionCandidateDiagnostic(
  error: unknown,
  stageHint:
    "candidate_generation" | "candidate_quality" | "capability_enhancement",
  context: Pick<AcquisitionCandidateDiagnostic, "category" | "source">,
): void {
  const diagnostic = classifyAcquisitionCandidateDiagnostic(
    error,
    stageHint,
    context,
  );
  console.info(JSON.stringify(diagnostic));
}
