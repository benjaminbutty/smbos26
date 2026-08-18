import {
  AcquisitionCandidateQualityError,
  acquisitionCandidateQualityCodes,
  type AcquisitionCandidateQualityCode,
} from "./quality";

export const acquisitionRefinementDiagnosticStages = [
  "candidate_generation",
  "reconciliation",
] as const;

export type AcquisitionRefinementDiagnosticStage =
  (typeof acquisitionRefinementDiagnosticStages)[number];

export type AcquisitionRefinementDiagnosticCode =
  `quality_${AcquisitionCandidateQualityCode}` | "quality_unclassified";

const qualityCodes = new Set<string>(acquisitionCandidateQualityCodes);

export function classifyAcquisitionRefinementDiagnostic(
  error: unknown,
  stage: AcquisitionRefinementDiagnosticStage,
): {
  stage: AcquisitionRefinementDiagnosticStage;
  code: AcquisitionRefinementDiagnosticCode;
} | null {
  if (!(error instanceof AcquisitionCandidateQualityError)) return null;
  const code = qualityCodes.has(error.code)
    ? (`quality_${error.code}` as AcquisitionRefinementDiagnosticCode)
    : "quality_unclassified";
  return { stage, code };
}

export function emitAcquisitionRefinementDiagnostic(
  error: unknown,
  stage: AcquisitionRefinementDiagnosticStage,
): void {
  const diagnostic = classifyAcquisitionRefinementDiagnostic(error, stage);
  if (!diagnostic) return;
  console.info(
    JSON.stringify({
      event: "acquisition_refinement_diagnostic",
      ...diagnostic,
    }),
  );
}
