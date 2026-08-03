import { isDeepStrictEqual } from "node:util";

import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { openAiBuilderPreorderAmendmentPolicy } from "../../policies";
import {
  builderPreorderAmendmentOutputSchema,
  builderPreorderAmendmentTaskInputBaseSchema,
  type BuilderPreorderAmendment,
  type BuilderPreorderAmendmentOutput,
} from "../../preorder-amendment/schemas";
import { validateBuilderPreorderAmendmentOutput } from "../../preorder-amendment/validation";
import {
  builderPreorderAmendmentEvaluationReportSchema,
  type BuilderPreorderAmendmentEvaluationReport,
  type BuilderPreorderAmendmentEvaluationScenario,
} from "./schemas";
import { builderPreorderAmendmentEvaluationPlans } from "./scenarios";
import { syntheticBusinessContext } from "../../../../evaluations/fixtures/synthetic-business-context";

export interface BuilderPreorderAmendmentEvaluationExecutionMetadata {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

type ScenarioMismatchCode =
  | "expected_amendment_missing"
  | "unexpected_amendment"
  | "expected_value_mismatch"
  | "unexpected_adjacent_value"
  | "source_step_coverage_mismatch";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceStepSequence(reference: string): number {
  return Number(reference.slice("step_".length));
}

function canonicalSourceStepReferences(
  references: readonly string[],
): string[] {
  return [...new Set(references)].sort(
    (left, right) =>
      sourceStepSequence(left) - sourceStepSequence(right) ||
      compareText(left, right),
  );
}

function canonicalAmendment(
  amendment: BuilderPreorderAmendment,
): BuilderPreorderAmendment {
  const source_step_references = canonicalSourceStepReferences(
    amendment.source_step_references,
  );
  if (amendment.type === "set_collection_days") {
    return {
      ...amendment,
      days_of_week: [...amendment.days_of_week].sort(
        (left, right) => left - right,
      ),
      source_step_references,
    };
  }
  return { ...amendment, source_step_references };
}

function amendmentMatchKey(amendment: BuilderPreorderAmendment): string {
  switch (amendment.type) {
    case "set_existing_question_requiredness":
    case "set_existing_question_label":
    case "set_existing_question_help_text":
      return `${amendment.type}\u0000${amendment.target}\u0000${amendment.field_key}`;
    default:
      return amendment.type;
  }
}

function amendmentSemanticKey(amendment: BuilderPreorderAmendment): string {
  const matchKey = amendmentMatchKey(amendment);
  if (amendment.type === "add_preorder_question") {
    return `${matchKey}\u0000${amendment.label}`;
  }
  return matchKey;
}

function canonicalAmendments(
  amendments: readonly BuilderPreorderAmendment[],
): BuilderPreorderAmendment[] {
  return amendments
    .map(canonicalAmendment)
    .sort((left, right) =>
      compareText(amendmentSemanticKey(left), amendmentSemanticKey(right)),
    );
}

function amendmentsByMatchKey(
  amendments: readonly BuilderPreorderAmendment[],
): Map<string, BuilderPreorderAmendment[]> {
  const groups = new Map<string, BuilderPreorderAmendment[]>();
  for (const amendment of amendments) {
    const key = amendmentMatchKey(amendment);
    const group = groups.get(key) ?? [];
    group.push(amendment);
    groups.set(key, group);
  }
  return groups;
}

function compareMatchedAmendment(
  expected: BuilderPreorderAmendment,
  actual: BuilderPreorderAmendment,
  failures: Set<ScenarioMismatchCode>,
): void {
  if (
    !isDeepStrictEqual(
      expected.source_step_references,
      actual.source_step_references,
    )
  ) {
    failures.add("source_step_coverage_mismatch");
  }

  if (
    expected.type === "add_preorder_question" &&
    actual.type === "add_preorder_question" &&
    expected.help_text === null &&
    actual.help_text !== null
  ) {
    failures.add("unexpected_adjacent_value");
    const {
      source_step_references: expectedReferences,
      help_text: expectedHelpText,
      ...expectedWithoutHelpText
    } = expected;
    const {
      source_step_references: actualReferences,
      help_text: actualHelpText,
      ...actualWithoutHelpText
    } = actual;
    void expectedReferences;
    void expectedHelpText;
    void actualReferences;
    void actualHelpText;
    if (!isDeepStrictEqual(expectedWithoutHelpText, actualWithoutHelpText)) {
      failures.add("expected_value_mismatch");
    }
    return;
  }

  const { source_step_references: expectedReferences, ...expectedValues } =
    expected;
  const { source_step_references: actualReferences, ...actualValues } = actual;
  void expectedReferences;
  void actualReferences;
  if (!isDeepStrictEqual(expectedValues, actualValues)) {
    failures.add("expected_value_mismatch");
  }
}

function scenarioMismatchCodes(
  expected: BuilderPreorderAmendmentOutput,
  actual: BuilderPreorderAmendmentOutput,
): Set<ScenarioMismatchCode> {
  const failures = new Set<ScenarioMismatchCode>();
  if (
    expected.schema_version !== actual.schema_version ||
    expected.preorder_key !== actual.preorder_key
  ) {
    failures.add("expected_value_mismatch");
  }

  const expectedGroups = amendmentsByMatchKey(
    canonicalAmendments(expected.amendments),
  );
  const actualGroups = amendmentsByMatchKey(
    canonicalAmendments(actual.amendments),
  );
  const keys = new Set([...expectedGroups.keys(), ...actualGroups.keys()]);
  for (const key of [...keys].sort(compareText)) {
    const expectedGroup = expectedGroups.get(key) ?? [];
    const actualGroup = actualGroups.get(key) ?? [];
    if (expectedGroup.length > actualGroup.length) {
      failures.add("expected_amendment_missing");
    }
    if (actualGroup.length > expectedGroup.length) {
      failures.add("unexpected_amendment");
    }
    const matchedCount = Math.min(expectedGroup.length, actualGroup.length);
    for (let index = 0; index < matchedCount; index += 1) {
      compareMatchedAmendment(
        expectedGroup[index]!,
        actualGroup[index]!,
        failures,
      );
    }
  }
  return failures;
}

export function evaluateBuilderPreorderAmendment(
  scenario: BuilderPreorderAmendmentEvaluationScenario,
  outputInput: unknown,
  metadata: BuilderPreorderAmendmentEvaluationExecutionMetadata,
): BuilderPreorderAmendmentEvaluationReport {
  const failures = new Set<
    | "output_contract_invalid"
    | "semantic_validation_failed"
    | ScenarioMismatchCode
  >();
  let output: BuilderPreorderAmendmentOutput | undefined;
  try {
    output = builderPreorderAmendmentOutputSchema.parse(outputInput);
  } catch {
    failures.add("output_contract_invalid");
  }

  if (output) {
    try {
      const plan = builderPreorderAmendmentEvaluationPlans[scenario.id];
      const taskInput = builderPreorderAmendmentTaskInputBaseSchema.parse({
        schema_version: 1,
        owner_request: scenario.owner_request,
        business_context: syntheticBusinessContext,
        ready_plan: plan,
        preorder_scope: {
          preorder_key: "bakery_preorder",
          selection: "sole_active",
        },
      });
      validateBuilderPreorderAmendmentOutput(taskInput, output);
    } catch {
      failures.add("semantic_validation_failed");
    }
    for (const mismatch of scenarioMismatchCodes(
      scenario.expected_output,
      output,
    )) {
      failures.add(mismatch);
    }
  }

  const estimatedCostMicrousd = calculateAiTokenCostMicrousd({
    inputTokens: metadata.inputTokens,
    outputTokens: metadata.outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderPreorderAmendmentPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderPreorderAmendmentPolicy.outputMicrousdPerMillion,
  });
  return Object.freeze(
    builderPreorderAmendmentEvaluationReportSchema.parse({
      scenario_id: scenario.id,
      passed: failures.size === 0,
      amendment_count: output?.amendments.length ?? 0,
      amendment_types: output?.amendments.map(({ type }) => type) ?? [],
      attempts: metadata.attempts,
      input_tokens: metadata.inputTokens,
      output_tokens: metadata.outputTokens,
      estimated_cost_microusd: estimatedCostMicrousd,
      elapsed_ms: Math.max(0, Math.round(metadata.elapsedMs)),
      failed_gate_codes: [...failures].sort(),
    }),
  );
}
