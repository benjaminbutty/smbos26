import { calculateAiTokenCostMicrousd } from "../../accounting/cost";
import { openAiBuilderConfigurationDraftingPolicy } from "../../policies";
import {
  builderConfigurationDraftOutputSchema,
  type BuilderConfigurationDraftOutput,
  type DraftFieldReference,
  type DraftFormReference,
  type DraftObjectReference,
} from "../../configuration-drafting/schemas";
import {
  configurationDraftingReportSchema,
  type ConfigurationDraftingGateFailureCode,
  type ConfigurationDraftingReport,
} from "./schemas";
import {
  type ConfigurationDraftingScenario,
  type ExpectedField,
  type ExpectedFieldReference,
  type ExpectedObjectReference,
  type ExpectedPageBlock,
} from "./scenarios";

export interface ConfigurationDraftingExecutionMetadata {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete: boolean;
  elapsedMs: number;
}

interface ResolvedObject {
  identity: string;
  reference: DraftObjectReference;
}

interface ResolvedField {
  identity: string;
  objectIdentity: string;
  label: string;
  fieldType: BuilderConfigurationDraftOutput["fields"][number]["field_type"];
  required: boolean;
  settings: BuilderConfigurationDraftOutput["fields"][number]["settings"];
}

interface ResolvedForm {
  reference: string;
  identity: string;
  objectIdentity: string;
  name: string;
  mode: "create" | "edit";
  audience: "internal" | "public";
  fieldIdentities: readonly string[];
}

interface ResolvedView {
  reference: string;
  identity: string;
  objectIdentity: string;
  name: string;
  viewType: "table" | "list" | "cards" | "detail";
  audience: "internal" | "public";
  fieldIdentities: readonly string[];
  titleField: string | null;
  primaryField: string | null;
  subtitleField: string | null;
  imageField: string | null;
  supportingFields: readonly string[];
  createFormReference: DraftFormReference | null;
  editFormReference: DraftFormReference | null;
}

function normalise(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

function objectIdentity(reference: ExpectedObjectReference): string {
  return reference.source === "new"
    ? `new:${reference.concept_reference}`
    : `existing:${reference.object_key}`;
}

function expectedFieldIdentity(reference: ExpectedFieldReference): string {
  return reference.source === "existing"
    ? `existing-field:${reference.object_key}:${reference.field_key}`
    : `new-field:${objectIdentity(reference.object)}:${normalise(reference.label)}`;
}

function addFailure(
  failures: Set<ConfigurationDraftingGateFailureCode>,
  code: ConfigurationDraftingGateFailureCode,
): void {
  failures.add(code);
}

function setDifference<T>(left: readonly T[], right: readonly T[]): boolean {
  const rightSet = new Set(right);
  return (
    left.length !== right.length || left.some((value) => !rightSet.has(value))
  );
}

function normalisedOptions(options: readonly string[]): string[] {
  return options.map(normalise).toSorted();
}

function settingsEqual(
  actual: BuilderConfigurationDraftOutput["fields"][number]["settings"],
  expected: ExpectedField["settings"],
): boolean {
  if (actual === null || expected === null) {
    return actual === expected;
  }
  if ("currency" in actual || "currency" in expected) {
    return (
      "currency" in actual &&
      "currency" in expected &&
      actual.currency === expected.currency
    );
  }
  return (
    "options" in actual &&
    "options" in expected &&
    normalisedOptions(actual.options).length === expected.options.length &&
    normalisedOptions(actual.options).every(
      (option, index) => option === normalisedOptions(expected.options)[index],
    )
  );
}

export function evaluateConfigurationDraft(
  scenario: ConfigurationDraftingScenario,
  output: BuilderConfigurationDraftOutput,
  metadata: ConfigurationDraftingExecutionMetadata,
): ConfigurationDraftingReport {
  const parsedOutput = builderConfigurationDraftOutputSchema.parse(output);
  const failures = new Set<ConfigurationDraftingGateFailureCode>();
  const expected = scenario.expected;
  const outputObjectsByReference = new Map(
    parsedOutput.objects.map((object) => [object.reference, object]),
  );
  const contextObjectsByKey = new Map(
    scenario.task_input.business_context.objects.map((object) => [
      object.key,
      object,
    ]),
  );

  const expectedCounts = {
    objects: expected.objects.length,
    fields: expected.fields.length,
    relationships: expected.relationships.length,
    views: expected.views.length,
    forms: expected.forms.length,
    pages: expected.pages.length,
  };
  const actualCounts = {
    objects: parsedOutput.objects.length,
    fields: parsedOutput.fields.length,
    relationships: parsedOutput.relationships.length,
    views: parsedOutput.views.length,
    forms: parsedOutput.forms.length,
    pages: parsedOutput.pages.length,
  };
  for (const family of Object.keys(
    expectedCounts,
  ) as (keyof typeof expectedCounts)[]) {
    if (actualCounts[family] !== expectedCounts[family]) {
      addFailure(failures, "entity_count_mismatch");
    }
    if (expectedCounts[family] === 0 && actualCounts[family] > 0) {
      addFailure(failures, "unexpected_entity_family");
      addFailure(failures, "adjacent_scope_added");
    }
  }

  function resolveObjectReference(
    reference: DraftObjectReference,
  ): ResolvedObject | undefined {
    if (reference.source === "existing") {
      const contextObject = contextObjectsByKey.get(reference.object_key);
      if (!contextObject?.is_active) {
        addFailure(failures, "existing_reference_mismatch");
        return undefined;
      }
      return {
        identity: `existing:${reference.object_key}`,
        reference,
      };
    }
    const object = outputObjectsByReference.get(reference.object_reference);
    if (!object) {
      addFailure(failures, "existing_reference_mismatch");
      return undefined;
    }
    return {
      identity: `new:${object.concept_reference}`,
      reference,
    };
  }

  function resolveFieldReference(
    reference: DraftFieldReference,
  ): string | undefined {
    if (reference.source === "existing") {
      const contextObject = contextObjectsByKey.get(reference.object_key);
      const contextField = contextObject?.fields.find(
        (field) => field.key === reference.field_key && field.is_active,
      );
      if (!contextObject?.is_active || !contextField) {
        addFailure(failures, "existing_reference_mismatch");
        return undefined;
      }
      return `existing-field:${reference.object_key}:${reference.field_key}`;
    }
    const field = resolvedFieldsByReference.get(reference.field_reference);
    if (!field) {
      addFailure(failures, "existing_reference_mismatch");
      return undefined;
    }
    return field.identity;
  }

  const resolvedFieldsByReference = new Map<string, ResolvedField>();
  for (const field of parsedOutput.fields) {
    const resolvedObject = resolveObjectReference(field.object_reference);
    if (!resolvedObject) {
      continue;
    }
    resolvedFieldsByReference.set(field.reference, {
      identity: `new-field:${resolvedObject.identity}:${normalise(field.label)}`,
      objectIdentity: resolvedObject.identity,
      label: field.label,
      fieldType: field.field_type,
      required: field.required,
      settings: field.settings,
    });
  }

  for (const objectExpectation of expected.objects) {
    if (objectExpectation.reference.source !== "new") {
      continue;
    }
    const actual = parsedOutput.objects.find(
      (object) =>
        object.concept_reference ===
        (objectExpectation.reference.source === "new"
          ? objectExpectation.reference.concept_reference
          : ""),
    );
    if (!actual) {
      addFailure(failures, "object_concept_mismatch");
      continue;
    }
    if (
      normalise(actual.singular_label) !==
        normalise(objectExpectation.singular_label) ||
      (objectExpectation.plural_label !== undefined &&
        normalise(actual.plural_label) !==
          normalise(objectExpectation.plural_label))
    ) {
      addFailure(failures, "object_label_mismatch");
    }
  }
  for (const actual of parsedOutput.objects) {
    const expectedObject = expected.objects.find(
      ({ reference }) =>
        reference.source === "new" &&
        reference.concept_reference === actual.concept_reference,
    );
    if (!expectedObject) {
      addFailure(failures, "object_concept_mismatch");
      addFailure(failures, "adjacent_scope_added");
    }
  }

  const expectedFieldsByIdentity = new Map<string, ExpectedField>();
  for (const field of expected.fields) {
    expectedFieldsByIdentity.set(expectedFieldIdentity(field.reference), field);
  }
  const actualFieldsByIdentity = new Map<string, ResolvedField>();
  for (const field of resolvedFieldsByReference.values()) {
    actualFieldsByIdentity.set(field.identity, field);
  }
  const expectedFieldKeys = [...expectedFieldsByIdentity.keys()];
  const actualFieldKeys = [...actualFieldsByIdentity.keys()];
  if (setDifference(expectedFieldKeys, actualFieldKeys)) {
    addFailure(failures, "field_set_mismatch");
  }
  if (actualFieldKeys.some((key) => !expectedFieldsByIdentity.has(key))) {
    addFailure(failures, "adjacent_scope_added");
  }
  for (const actualField of actualFieldsByIdentity.values()) {
    const sameLabelExpected = expected.fields.find(
      (field) => normalise(field.label) === normalise(actualField.label),
    );
    if (
      sameLabelExpected &&
      actualField.objectIdentity !==
        objectIdentity(
          sameLabelExpected.reference.source === "new"
            ? sameLabelExpected.reference.object
            : {
                source: "existing",
                object_key: sameLabelExpected.reference.object_key,
              },
        )
    ) {
      addFailure(failures, "field_object_mismatch");
    }
  }
  for (const [identity, expectedField] of expectedFieldsByIdentity) {
    const actualField = actualFieldsByIdentity.get(identity);
    if (!actualField) {
      continue;
    }
    if (actualField.fieldType !== expectedField.field_type) {
      addFailure(failures, "field_type_mismatch");
    }
    if (actualField.required !== expectedField.required) {
      addFailure(failures, "field_requiredness_mismatch");
    }
    if (!settingsEqual(actualField.settings, expectedField.settings)) {
      addFailure(failures, "field_settings_mismatch");
    }
  }
  if (
    expected.forbid_status_field &&
    parsedOutput.fields.some((field) => field.field_type === "status")
  ) {
    addFailure(failures, "forbidden_status_field");
  }

  const actualRelationships = parsedOutput.relationships.map(
    (relationship) => ({
      source: resolveObjectReference(relationship.source_object_reference)
        ?.identity,
      target: resolveObjectReference(relationship.target_object_reference)
        ?.identity,
      sourceLabel: normalise(relationship.source_label),
      targetLabel: normalise(relationship.target_label),
      cardinality: relationship.cardinality,
      isRequired: relationship.is_required,
    }),
  );
  const expectedRelationships = expected.relationships.map((relationship) => ({
    source: objectIdentity(relationship.source),
    target: objectIdentity(relationship.target),
    sourceLabel:
      relationship.source_label === undefined
        ? undefined
        : normalise(relationship.source_label),
    targetLabel:
      relationship.target_label === undefined
        ? undefined
        : normalise(relationship.target_label),
    cardinality: relationship.cardinality,
    isRequired: relationship.is_required,
  }));
  const relationshipMatches = (
    actualRelationship: (typeof actualRelationships)[number],
    expectedRelationship: (typeof expectedRelationships)[number],
  ): boolean =>
    actualRelationship.source === expectedRelationship.source &&
    actualRelationship.target === expectedRelationship.target &&
    (expectedRelationship.sourceLabel === undefined ||
      actualRelationship.sourceLabel === expectedRelationship.sourceLabel) &&
    (expectedRelationship.targetLabel === undefined ||
      actualRelationship.targetLabel === expectedRelationship.targetLabel) &&
    actualRelationship.cardinality === expectedRelationship.cardinality &&
    actualRelationship.isRequired === expectedRelationship.isRequired;
  if (
    actualRelationships.length !== expectedRelationships.length ||
    expectedRelationships.some(
      (expectedRelationship) =>
        !actualRelationships.some((actualRelationship) =>
          relationshipMatches(actualRelationship, expectedRelationship),
        ),
    )
  ) {
    addFailure(failures, "relationship_mismatch");
  }
  if (
    actualRelationships.some(
      (actualRelationship) =>
        !expectedRelationships.some((expectedRelationship) =>
          relationshipMatches(actualRelationship, expectedRelationship),
        ),
    )
  ) {
    addFailure(failures, "adjacent_scope_added");
  }

  const resolvedFormsByReference = new Map<string, ResolvedForm>();
  for (const form of parsedOutput.forms) {
    const object = resolveObjectReference(form.object_reference);
    if (!object) continue;
    const fieldIdentities = form.fields
      .map(({ field_reference }) => resolveFieldReference(field_reference))
      .filter((identity): identity is string => identity !== undefined);
    resolvedFormsByReference.set(form.reference, {
      reference: form.reference,
      identity: `form:${form.reference}`,
      objectIdentity: object.identity,
      name: form.name,
      mode: form.mode,
      audience: form.audience,
      fieldIdentities,
    });
  }

  function expectedFormFieldSet(form: {
    fields: readonly ExpectedFieldReference[];
  }): string[] {
    return form.fields.map(expectedFieldIdentity).toSorted();
  }

  function sameFieldSet(
    expectedFields: readonly string[],
    actualFields: readonly string[],
  ): boolean {
    return !setDifference(expectedFields.toSorted(), actualFields.toSorted());
  }

  const matchedFormsByExpectedReference = new Map<string, ResolvedForm>();
  for (const expectedForm of expected.forms) {
    const scopedForms = [...resolvedFormsByReference.values()].filter(
      (form) => form.objectIdentity === objectIdentity(expectedForm.object),
    );
    const namedForms =
      expectedForm.name === undefined
        ? scopedForms
        : scopedForms.filter(
            (form) => normalise(form.name) === normalise(expectedForm.name!),
          );
    const structurallyMatchingForms = namedForms.filter(
      (form) =>
        form.mode === expectedForm.mode &&
        form.audience === expectedForm.audience &&
        sameFieldSet(expectedFormFieldSet(expectedForm), form.fieldIdentities),
    );
    const exactForm =
      structurallyMatchingForms.length === 1
        ? structurallyMatchingForms[0]
        : undefined;
    const diagnosticForm =
      exactForm ??
      (namedForms.length === 1
        ? namedForms[0]
        : expectedForm.name === undefined && scopedForms.length === 1
          ? scopedForms[0]
          : undefined);
    const actualForm = diagnosticForm;
    if (!actualForm) {
      addFailure(failures, "form_mismatch");
      continue;
    }
    if (
      actualForm.mode !== expectedForm.mode ||
      actualForm.audience !== expectedForm.audience
    ) {
      addFailure(failures, "form_mismatch");
    }
    if (
      !sameFieldSet(
        expectedFormFieldSet(expectedForm),
        actualForm.fieldIdentities,
      )
    ) {
      addFailure(failures, "form_field_set_mismatch");
    }
    if (exactForm) {
      matchedFormsByExpectedReference.set(expectedForm.reference, exactForm);
    } else if (
      actualForm.mode === expectedForm.mode &&
      actualForm.audience === expectedForm.audience &&
      expectedForm.name !== undefined &&
      normalise(actualForm.name) !== normalise(expectedForm.name)
    ) {
      addFailure(failures, "form_mismatch");
    }
  }
  if (
    [...resolvedFormsByReference.values()].some(
      (actualForm) =>
        ![...matchedFormsByExpectedReference.values()].some(
          (matchedForm) => matchedForm.reference === actualForm.reference,
        ),
    )
  ) {
    addFailure(failures, "adjacent_scope_added");
  }

  function formReferenceMatches(
    actualReference: DraftFormReference | null,
    expectedReference: string | null | undefined,
  ): boolean {
    if (expectedReference === undefined) return true;
    if (expectedReference === null) return actualReference === null;
    if (actualReference === null) return false;
    if (actualReference.source === "existing") return false;
    const expectedForm = matchedFormsByExpectedReference.get(expectedReference);
    return (
      expectedForm !== undefined &&
      actualReference.form_reference === expectedForm.reference
    );
  }

  const resolvedViewsByReference = new Map<string, ResolvedView>();
  for (const view of parsedOutput.views) {
    const object = resolveObjectReference(view.object_reference);
    if (!object) continue;
    let fieldReferences: readonly DraftFieldReference[];
    let titleField: DraftFieldReference | null = null;
    let primaryField: DraftFieldReference | null = null;
    let subtitleField: DraftFieldReference | null = null;
    let imageField: DraftFieldReference | null = null;
    let supportingFields: readonly DraftFieldReference[] = [];
    let createFormReference: DraftFormReference | null = null;
    let editFormReference: DraftFormReference | null = null;
    switch (view.view_type) {
      case "table":
        fieldReferences = view.configuration.fields;
        titleField = view.configuration.title_field;
        createFormReference = view.configuration.create_form_reference;
        editFormReference = view.configuration.edit_form_reference;
        break;
      case "list":
        primaryField = view.configuration.primary_field;
        fieldReferences = [
          view.configuration.primary_field,
          ...view.configuration.secondary_fields,
        ];
        createFormReference = view.configuration.create_form_reference;
        editFormReference = view.configuration.edit_form_reference;
        break;
      case "cards":
        titleField = view.configuration.title_field;
        subtitleField = view.configuration.subtitle_field;
        imageField = view.configuration.image_field;
        supportingFields = view.configuration.supporting_fields;
        fieldReferences = [
          view.configuration.title_field,
          ...(view.configuration.subtitle_field
            ? [view.configuration.subtitle_field]
            : []),
          ...(view.configuration.image_field
            ? [view.configuration.image_field]
            : []),
          ...view.configuration.supporting_fields,
        ];
        createFormReference = view.configuration.create_form_reference;
        editFormReference = view.configuration.edit_form_reference;
        break;
      case "detail":
        fieldReferences = view.configuration.fields;
        titleField = view.configuration.title_field;
        editFormReference = view.configuration.edit_form_reference;
        break;
    }
    const fieldIdentities = fieldReferences
      .map(resolveFieldReference)
      .filter((identity): identity is string => identity !== undefined);
    const resolveOptionalField = (
      reference: DraftFieldReference | null,
    ): string | null =>
      reference === null ? null : (resolveFieldReference(reference) ?? null);
    resolvedViewsByReference.set(view.reference, {
      reference: view.reference,
      identity: `view:${view.reference}`,
      objectIdentity: object.identity,
      name: view.name,
      viewType: view.view_type,
      audience: view.audience,
      fieldIdentities,
      titleField: resolveOptionalField(titleField),
      primaryField: resolveOptionalField(primaryField),
      subtitleField: resolveOptionalField(subtitleField),
      imageField: resolveOptionalField(imageField),
      supportingFields: supportingFields
        .map(resolveFieldReference)
        .filter((identity): identity is string => identity !== undefined),
      createFormReference:
        createFormReference === null ? null : createFormReference,
      editFormReference: editFormReference === null ? null : editFormReference,
    });
  }

  function expectedViewFieldSet(view: {
    fields: readonly ExpectedFieldReference[];
  }): string[] {
    return view.fields.map(expectedFieldIdentity).toSorted();
  }

  const matchedViewsByExpectedReference = new Map<string, ResolvedView>();
  for (const expectedView of expected.views) {
    const scopedViews = [...resolvedViewsByReference.values()].filter(
      (view) => view.objectIdentity === objectIdentity(expectedView.object),
    );
    const namedViews =
      expectedView.name === undefined
        ? scopedViews
        : scopedViews.filter(
            (view) => normalise(view.name) === normalise(expectedView.name!),
          );
    const structurallyMatchingViews = namedViews.filter(
      (view) =>
        view.viewType === expectedView.view_type &&
        view.audience === expectedView.audience &&
        sameFieldSet(expectedViewFieldSet(expectedView), view.fieldIdentities),
    );
    const exactView =
      structurallyMatchingViews.length === 1
        ? structurallyMatchingViews[0]
        : undefined;
    const diagnosticView =
      exactView ??
      (namedViews.length === 1
        ? namedViews[0]
        : expectedView.name === undefined && scopedViews.length === 1
          ? scopedViews[0]
          : undefined);
    const actualView = diagnosticView;
    if (!actualView) {
      addFailure(failures, "view_mismatch");
      continue;
    }
    if (
      actualView.viewType !== expectedView.view_type ||
      actualView.audience !== expectedView.audience
    ) {
      addFailure(failures, "view_mismatch");
    }
    if (
      !sameFieldSet(
        expectedViewFieldSet(expectedView),
        actualView.fieldIdentities,
      )
    ) {
      addFailure(failures, "view_field_set_mismatch");
    }
    const expectedTitle =
      expectedView.view_type === "list"
        ? expectedView.primary_field
        : expectedView.title_field;
    const actualTitleField =
      expectedView.view_type === "list"
        ? actualView.primaryField
        : actualView.titleField;
    if (
      expectedTitle !== undefined &&
      actualTitleField !== expectedFieldIdentityOrNull(expectedTitle)
    ) {
      addFailure(failures, "view_mismatch");
    }
    if (
      expectedView.view_type === "cards" &&
      (actualView.subtitleField !==
        expectedFieldIdentityOrNull(expectedView.subtitle_field) ||
        actualView.imageField !==
          expectedFieldIdentityOrNull(expectedView.image_field) ||
        setDifference(
          expectedView.supporting_fields?.map(expectedFieldIdentity) ?? [],
          [...actualView.supportingFields],
        ))
    ) {
      addFailure(failures, "view_mismatch");
    }
    if (
      !formReferenceMatches(
        actualView.createFormReference,
        expectedView.create_form_reference,
      ) ||
      !formReferenceMatches(
        actualView.editFormReference,
        expectedView.edit_form_reference,
      )
    ) {
      addFailure(failures, "view_form_link_mismatch");
    }
    if (exactView) {
      matchedViewsByExpectedReference.set(expectedView.reference, exactView);
    }
  }
  if (
    [...resolvedViewsByReference.values()].some(
      (actualView) =>
        ![...matchedViewsByExpectedReference.values()].some(
          (matchedView) => matchedView.reference === actualView.reference,
        ),
    )
  ) {
    addFailure(failures, "adjacent_scope_added");
  }

  function expectedFieldIdentityOrNull(
    reference: ExpectedFieldReference | null | undefined,
  ): string | null {
    return reference === undefined || reference === null
      ? null
      : expectedFieldIdentity(reference);
  }

  function pageBlockMatches(
    actualBlock:
      | BuilderConfigurationDraftOutput["pages"][number]["blocks"][number]
      | undefined,
    expectedBlock: ExpectedPageBlock,
  ): boolean {
    if (!actualBlock || actualBlock.type !== expectedBlock.type) return false;
    switch (expectedBlock.type) {
      case "heading":
        return (
          actualBlock.type === "heading" &&
          (expectedBlock.text === undefined ||
            normalise(actualBlock.text) === normalise(expectedBlock.text)) &&
          actualBlock.level === expectedBlock.level
        );
      case "text":
        return (
          actualBlock.type === "text" &&
          (expectedBlock.text === undefined ||
            normalise(actualBlock.text) === normalise(expectedBlock.text))
        );
      case "form":
        if (actualBlock.type !== "form") return false;
        if (expectedBlock.existing_form_key) {
          return (
            actualBlock.form_reference.source === "existing" &&
            actualBlock.form_reference.form_key ===
              expectedBlock.existing_form_key
          );
        }
        if (expectedBlock.form_reference) {
          if (actualBlock.form_reference.source !== "draft") return false;
          const form = matchedFormsByExpectedReference.get(
            expectedBlock.form_reference,
          );
          return (
            form !== undefined &&
            actualBlock.form_reference.form_reference === form.reference
          );
        }
        return false;
      case "view": {
        if (actualBlock.type !== "view") return false;
        if (actualBlock.view_reference.source !== "draft") return false;
        const view = matchedViewsByExpectedReference.get(
          expectedBlock.view_reference,
        );
        return (
          view !== undefined &&
          actualBlock.view_reference.view_reference === view.reference
        );
      }
    }
  }

  for (const [index, expectedPage] of expected.pages.entries()) {
    const actualPage = parsedOutput.pages[index];
    if (!actualPage) {
      addFailure(failures, "page_mismatch");
      continue;
    }
    if (
      (expectedPage.title !== undefined &&
        normalise(actualPage.title) !== normalise(expectedPage.title)) ||
      actualPage.audience !== expectedPage.audience
    ) {
      addFailure(failures, "page_mismatch");
    }
    if (
      actualPage.blocks.length !== expectedPage.blocks.length ||
      expectedPage.blocks.some(
        (expectedBlock, blockIndex) =>
          !pageBlockMatches(actualPage.blocks[blockIndex], expectedBlock),
      )
    ) {
      addFailure(failures, "page_block_mismatch");
    }
    for (const block of actualPage.blocks) {
      if (block.type !== "form") continue;
      const formReference = block.form_reference;
      if (formReference.source !== "existing") continue;
      const form = scenario.task_input.business_context.forms.find(
        (candidate) => candidate.key === formReference.form_key,
      );
      if (!form?.is_active) addFailure(failures, "existing_reference_mismatch");
    }
  }

  if (!metadata.usageComplete) {
    addFailure(failures, "usage_accounting_incomplete");
  }

  const estimatedCostMicrousd = calculateAiTokenCostMicrousd({
    inputTokens: metadata.inputTokens,
    outputTokens: metadata.outputTokens,
    inputMicrousdPerMillion:
      openAiBuilderConfigurationDraftingPolicy.inputMicrousdPerMillion,
    outputMicrousdPerMillion:
      openAiBuilderConfigurationDraftingPolicy.outputMicrousdPerMillion,
  });

  return Object.freeze(
    configurationDraftingReportSchema.parse({
      schema_version: 1,
      scenario_id: scenario.id,
      passed: failures.size === 0,
      object_count: parsedOutput.objects.length,
      field_count: parsedOutput.fields.length,
      relationship_count: parsedOutput.relationships.length,
      view_count: parsedOutput.views.length,
      form_count: parsedOutput.forms.length,
      page_count: parsedOutput.pages.length,
      attempts: metadata.attempts,
      usage_complete: metadata.usageComplete,
      input_tokens: metadata.inputTokens,
      output_tokens: metadata.outputTokens,
      estimated_cost_microusd: estimatedCostMicrousd,
      elapsed_ms: Math.max(0, Math.round(metadata.elapsedMs)),
      failed_gate_codes: [...failures].sort(),
    }),
  );
}
