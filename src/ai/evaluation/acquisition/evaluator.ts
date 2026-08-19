import type { AcquisitionBuildPayload } from "../../../core/acquisition/schemas";
import {
  classifyAcquisitionCandidateDiagnostic,
  type AcquisitionCandidateDiagnosticCode,
} from "../../../core/acquisition/diagnostics";
import type {
  AcquisitionEvaluationScenario,
  AcquisitionRelationshipExpectation,
} from "./scenarios";

export type AcquisitionEvaluationResult = {
  hard_findings: string[];
  quality_findings: string[];
  hard_passed: boolean;
  quality_passed: boolean;
  diagnostic_code?: AcquisitionCandidateDiagnosticCode;
};

function normaliseIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function identityContainsAlias(identity: string, alias: string): boolean {
  const normalisedIdentity = normaliseIdentity(identity);
  const normalisedAlias = normaliseIdentity(alias);
  if (!normalisedIdentity || !normalisedAlias) return false;
  return ` ${normalisedIdentity} `.includes(` ${normalisedAlias} `);
}

function includesEvery(
  haystack: string,
  needles: readonly (string | readonly string[])[],
): boolean {
  return needles.every((needle) =>
    typeof needle === "string"
      ? haystack.includes(needle)
      : needle.some((alternative) => haystack.includes(alternative)),
  );
}

function objectKeysForAliases(
  payload: AcquisitionBuildPayload,
  aliases: readonly string[],
): Set<string> {
  return new Set(
    payload.operations
      .filter((operation) => operation.op === "set_object")
      .filter((operation) =>
        aliases.some(
          (alias) =>
            identityContainsAlias(operation.singular_label, alias) ||
            identityContainsAlias(operation.plural_label, alias),
        ),
      )
      .map((operation) => operation.key),
  );
}

function relationshipMatches(
  payload: AcquisitionBuildPayload,
  expectation: AcquisitionRelationshipExpectation,
): boolean {
  const sourceKeys = objectKeysForAliases(
    payload,
    expectation.sourceConceptAliases,
  );
  const targetKeys = objectKeysForAliases(
    payload,
    expectation.targetConceptAliases,
  );
  if (sourceKeys.size === 0 || targetKeys.size === 0) return false;

  return payload.operations.some((operation) => {
    if (
      operation.op !== "set_relationship" ||
      operation.cardinality !== expectation.cardinality
    ) {
      return false;
    }
    if (
      sourceKeys.has(operation.source_object_key) &&
      targetKeys.has(operation.target_object_key)
    ) {
      return true;
    }
    return (
      expectation.cardinality === "many_to_many" &&
      sourceKeys.has(operation.target_object_key) &&
      targetKeys.has(operation.source_object_key)
    );
  });
}

function qualityFindings(
  scenario: AcquisitionEvaluationScenario,
  payload: AcquisitionBuildPayload,
): string[] {
  const findings: string[] = [];
  const conceptText = payload.proposal.concepts
    .map(({ name }) => name.toLocaleLowerCase("en"))
    .join(" ");
  if (!includesEvery(conceptText, scenario.requiredConcepts)) {
    findings.push("required_concepts");
  }
  if (
    scenario.forbiddenConcepts?.some((value) => conceptText.includes(value))
  ) {
    findings.push("forbidden_concept");
  }
  if (scenario.requiresLineItemQuantity) {
    const lineObjects = payload.operations
      .filter(
        (operation) =>
          operation.op === "set_object" &&
          /(?:item|line)/i.test(
            `${operation.singular_label} ${operation.plural_label}`,
          ),
      )
      .map(({ key }) => key);
    if (
      lineObjects.length === 0 ||
      !payload.operations.some(
        (operation) =>
          operation.op === "set_field" &&
          lineObjects.includes(operation.object_key) &&
          /quantity|amount/i.test(operation.label) &&
          operation.field_type === "number",
      )
    ) {
      findings.push("line_item_quantity_missing");
    }
  }
  for (const relationship of scenario.requiredRelationships ?? []) {
    if (!relationshipMatches(payload, relationship)) {
      findings.push(`required_relationship_semantics:${relationship.code}`);
    }
  }
  return findings;
}

export function evaluateAcquisitionScenario(
  scenario: AcquisitionEvaluationScenario,
  payload: AcquisitionBuildPayload,
): AcquisitionEvaluationResult {
  const hard_findings: string[] = [];
  const excludedText = payload.proposal.not_included
    .join(" ")
    .toLocaleLowerCase("en");

  if (payload.proposal.source !== "tailored")
    hard_findings.push("not_tailored");
  if (
    scenario.requiredUnsupported &&
    !scenario.requiredUnsupported.some((value) => excludedText.includes(value))
  ) {
    hard_findings.push("unsupported_not_disclosed");
  }
  const proposalText = JSON.stringify(payload.proposal);
  if (
    /\b(?:schema|uuid|json|database|cardinality|foreign key)\b/i.test(
      proposalText,
    )
  ) {
    hard_findings.push("technical_owner_language");
  }
  if (
    payload.proposal.pages.length === 0 &&
    payload.proposal.landing_page_key !== null
  ) {
    hard_findings.push("landing_page_without_page");
  }
  if (
    payload.operations.some((operation) =>
      JSON.stringify(operation).toLocaleLowerCase("en").includes("location"),
    )
  ) {
    hard_findings.push("location_added");
  }
  if (
    payload.operations.some(
      (operation) =>
        operation.op === "set_field" && operation.field_type === "currency",
    )
  ) {
    hard_findings.push("currency_invented");
  }

  const quality_findings = qualityFindings(scenario, payload);
  return {
    hard_findings,
    quality_findings,
    hard_passed: hard_findings.length === 0,
    quality_passed: quality_findings.length === 0,
  };
}

export function productionCompositionFailureResult(
  error: unknown,
): AcquisitionEvaluationResult {
  const diagnostic = classifyAcquisitionCandidateDiagnostic(
    error,
    "candidate_generation",
    { category: "other", source: "tailored" },
  );
  const hard_findings = [`production_composition_failed:${diagnostic.code}`];
  return {
    hard_findings,
    quality_findings: [],
    hard_passed: false,
    quality_passed: true,
    diagnostic_code: diagnostic.code,
  };
}
