import type { AiBusinessModelContextV1 } from "../context/schemas";
import {
  BuilderConfigurationDraftValidationError,
  type BuilderConfigurationDraftDiagnosticCode,
} from "./diagnostics";
import {
  BUILDER_CONFIGURATION_DRAFT_MAX_OUTPUT_BYTES,
  builderConfigurationDraftOutputSchema,
  builderConfigurationDraftTaskInputBaseSchema,
  type BuilderConfigurationDraftReadyTaskInput,
  type BuilderConfigurationDraftOutput,
  type BuilderConfigurationDraftTaskInput,
  type DraftField,
  type DraftFieldReference,
  type DraftForm,
  type DraftFormReference,
  type DraftObjectReference,
  type DraftView,
  type DraftViewReference,
} from "./schemas";
import { validateBuilderPlanOutput } from "../planning/validation";
import type {
  BuilderPlanOutput,
  BuilderPlanTaskInput,
} from "../planning/schemas";

const acceptedConfigurationCategories = new Set([
  "define_object",
  "define_field",
  "define_relationship",
  "configure_view",
  "configure_form",
  "configure_page",
] as const);

type DraftSourceCategory =
  | "define_object"
  | "define_field"
  | "define_relationship"
  | "configure_view"
  | "configure_form"
  | "configure_page";

type ReadyPlanStep =
  BuilderConfigurationDraftReadyTaskInput["ready_plan"]["plan"]["steps"][number];

interface PlanStepScope {
  existingObjectKeys: ReadonlySet<string>;
  draftConceptReferences: ReadonlySet<string>;
}

function isAcceptedConfigurationCategory(
  category: string,
): category is DraftSourceCategory {
  return acceptedConfigurationCategories.has(category as DraftSourceCategory);
}

function fail(code: BuilderConfigurationDraftDiagnosticCode): never {
  throw new BuilderConfigurationDraftValidationError(code);
}

function parseInput(input: unknown): BuilderConfigurationDraftTaskInput {
  try {
    return builderConfigurationDraftTaskInputBaseSchema.parse(input);
  } catch {
    fail("input_plan_invalid");
  }
}

/**
 * Validates the trusted planning boundary required by this task. This is
 * intentionally separate from output validation so the task schema can use it
 * in a pre-provider refinement without importing any execution or I/O code.
 */
export function validateConfigurationDraftInput(
  input: unknown,
): BuilderConfigurationDraftReadyTaskInput {
  const parsedInput = parseInput(input);
  const planningInput: BuilderPlanTaskInput = {
    schema_version: 1,
    owner_request: parsedInput.owner_request,
    business_context: parsedInput.business_context,
  };

  let validatedPlan: BuilderPlanOutput;
  try {
    validatedPlan = validateBuilderPlanOutput(
      planningInput,
      parsedInput.ready_plan,
    );
  } catch {
    fail("input_plan_invalid");
  }

  if (validatedPlan.state !== "ready") {
    fail("input_plan_not_ready");
  }
  const readyPlan = validatedPlan;
  if (readyPlan.unsupported_requirements.length > 0) {
    fail("input_plan_invalid");
  }

  for (const step of readyPlan.plan.steps) {
    if (step.lane !== "configuration") {
      fail("input_plan_not_configuration_only");
    }
    if (!isAcceptedConfigurationCategory(step.category)) {
      fail("input_category_not_supported");
    }
  }

  return {
    ...parsedInput,
    ready_plan: readyPlan,
  };
}

type ContextObject = AiBusinessModelContextV1["objects"][number];
type ContextField = ContextObject["fields"][number];
type ContextView = AiBusinessModelContextV1["views"][number];
type ContextForm = AiBusinessModelContextV1["forms"][number];

interface ResolvedObject {
  identity: string;
  objectKey?: string;
  draftReference?: string;
}

interface ResolvedField {
  identity: string;
  object: ResolvedObject;
  fieldType: ContextField["field_type"] | DraftField["field_type"];
  required: boolean;
  hasDefault: boolean;
}

interface ResolvedForm {
  identity: string;
  object: ResolvedObject;
  audience: ContextForm["audience"];
  mode: ContextForm["mode"];
}

interface ResolvedView {
  identity: string;
  object: ResolvedObject;
  audience: ContextView["audience"];
}

function normaliseLabel(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

function validateSourceSteps(
  input: BuilderConfigurationDraftReadyTaskInput,
  output: BuilderConfigurationDraftOutput,
): Map<string, ReadyPlanStep> {
  const steps = new Map(
    input.ready_plan.plan.steps.map((step) => [step.reference, step]),
  );
  const expectedCategories: ReadonlyArray<{
    references: ReadonlyArray<string>;
    category: DraftSourceCategory;
  }> = [
    ...output.objects.map((entity) => ({
      references: entity.source_step_references,
      category: "define_object" as const,
    })),
    ...output.fields.map((entity) => ({
      references: entity.source_step_references,
      category: "define_field" as const,
    })),
    ...output.relationships.map((entity) => ({
      references: entity.source_step_references,
      category: "define_relationship" as const,
    })),
    ...output.views.map((entity) => ({
      references: entity.source_step_references,
      category: "configure_view" as const,
    })),
    ...output.forms.map((entity) => ({
      references: entity.source_step_references,
      category: "configure_form" as const,
    })),
    ...output.pages.map((entity) => ({
      references: entity.source_step_references,
      category: "configure_page" as const,
    })),
  ];
  const covered = new Set<string>();

  for (const entity of expectedCategories) {
    for (const reference of entity.references) {
      const step = steps.get(reference);
      if (!step) {
        fail("unknown_source_step");
      }
      if (step.lane !== "configuration" || step.category !== entity.category) {
        fail("source_step_category_mismatch");
      }
      covered.add(reference);
    }
  }

  if (
    input.ready_plan.plan.steps.some((step) => !covered.has(step.reference))
  ) {
    fail("source_step_uncovered");
  }

  return steps;
}

function buildPlanStepScopes(
  input: BuilderConfigurationDraftReadyTaskInput,
): Map<string, PlanStepScope> {
  const conceptsByReference = new Map(
    input.ready_plan.plan.concepts.map((concept) => [
      concept.reference,
      concept,
    ]),
  );

  return new Map(
    input.ready_plan.plan.steps.map((step) => {
      const existingObjectKeys = new Set(step.existing_object_keys);
      const draftConceptReferences = new Set<string>();

      for (const conceptReference of step.affected_concepts) {
        const concept = conceptsByReference.get(conceptReference);
        if (concept?.disposition === "existing") {
          existingObjectKeys.add(concept.existing_object_key);
        } else if (concept?.disposition === "new") {
          draftConceptReferences.add(concept.reference);
        }
      }

      return [
        step.reference,
        { existingObjectKeys, draftConceptReferences },
      ] as const;
    }),
  );
}

function validateDraftObjectConcepts(
  input: BuilderConfigurationDraftReadyTaskInput,
  output: BuilderConfigurationDraftOutput,
  steps: ReadonlyMap<string, ReadyPlanStep>,
): Map<string, string> {
  const conceptsByReference = new Map(
    input.ready_plan.plan.concepts.map((concept) => [
      concept.reference,
      concept,
    ]),
  );
  const conceptByDraftObjectReference = new Map<string, string>();
  const representedConcepts = new Set<string>();

  for (const object of output.objects) {
    const concept = conceptsByReference.get(object.concept_reference);
    if (!concept) {
      fail("draft_concept_unknown");
    }
    if (concept.disposition !== "new") {
      fail("draft_concept_not_new");
    }
    if (representedConcepts.has(object.concept_reference)) {
      fail("duplicate_draft_concept");
    }
    representedConcepts.add(object.concept_reference);
    conceptByDraftObjectReference.set(
      object.reference,
      object.concept_reference,
    );
  }

  for (const step of steps.values()) {
    if (step.category !== "define_object") {
      continue;
    }
    for (const conceptReference of step.affected_concepts) {
      const concept = conceptsByReference.get(conceptReference);
      if (
        concept?.disposition === "new" &&
        ![...conceptByDraftObjectReference.values()].includes(concept.reference)
      ) {
        fail("draft_concept_uncovered");
      }
    }
  }

  return conceptByDraftObjectReference;
}

function validateUniqueLocalReferences(
  output: BuilderConfigurationDraftOutput,
): void {
  const references = [
    ...output.objects.map(({ reference }) => reference),
    ...output.fields.map(({ reference }) => reference),
    ...output.relationships.map(({ reference }) => reference),
    ...output.views.map(({ reference }) => reference),
    ...output.forms.map(({ reference }) => reference),
    ...output.pages.map(({ reference }) => reference),
  ];
  if (new Set(references).size !== references.length) {
    fail("duplicate_local_reference");
  }
}

function contextObjects(
  context: AiBusinessModelContextV1,
): Map<string, ContextObject> {
  return new Map(context.objects.map((object) => [object.key, object]));
}

function validateOutputSize(output: BuilderConfigurationDraftOutput): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    fail("output_contract_invalid");
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    BUILDER_CONFIGURATION_DRAFT_MAX_OUTPUT_BYTES
  ) {
    fail("output_too_large");
  }
}

export function validateConfigurationDraftOutput(
  input: unknown,
  output: unknown,
): BuilderConfigurationDraftOutput {
  const parsedInput = validateConfigurationDraftInput(input);
  let parsedOutput: BuilderConfigurationDraftOutput;
  try {
    parsedOutput = builderConfigurationDraftOutputSchema.parse(output);
  } catch {
    fail("output_contract_invalid");
  }

  validateOutputSize(parsedOutput);
  if (
    parsedOutput.objects.length +
      parsedOutput.fields.length +
      parsedOutput.relationships.length +
      parsedOutput.views.length +
      parsedOutput.forms.length +
      parsedOutput.pages.length ===
    0
  ) {
    fail("draft_empty");
  }

  validateUniqueLocalReferences(parsedOutput);
  const sourceSteps = validateSourceSteps(parsedInput, parsedOutput);
  const stepScopes = buildPlanStepScopes(parsedInput);
  const draftObjectConcepts = validateDraftObjectConcepts(
    parsedInput,
    parsedOutput,
    sourceSteps,
  );

  const objectsByReference = new Map(
    parsedOutput.objects.map((object) => [object.reference, object]),
  );
  const fieldsByReference = new Map(
    parsedOutput.fields.map((field) => [field.reference, field]),
  );
  const formsByReference = new Map(
    parsedOutput.forms.map((form) => [form.reference, form]),
  );
  const viewsByReference = new Map(
    parsedOutput.views.map((view) => [view.reference, view]),
  );
  const objectsByKey = contextObjects(parsedInput.business_context);

  function validateSourceObjectScope(
    sourceStepReferences: ReadonlyArray<string>,
    object: ResolvedObject,
  ): void {
    for (const sourceStepReference of sourceStepReferences) {
      const scope = stepScopes.get(sourceStepReference);
      if (!scope) {
        fail("unknown_source_step");
      }

      const authorized = object.objectKey
        ? scope.existingObjectKeys.has(object.objectKey)
        : object.draftReference
          ? (() => {
              const conceptReference = draftObjectConcepts.get(
                object.draftReference,
              );
              return (
                conceptReference !== undefined &&
                scope.draftConceptReferences.has(conceptReference)
              );
            })()
          : false;
      if (!authorized) {
        fail("source_step_scope_mismatch");
      }
    }
  }

  function validateDraftObjectSourceScope(object: {
    concept_reference: string;
    source_step_references: ReadonlyArray<string>;
  }): void {
    for (const sourceStepReference of object.source_step_references) {
      const scope = stepScopes.get(sourceStepReference);
      if (
        !scope ||
        !scope.draftConceptReferences.has(object.concept_reference)
      ) {
        fail("source_step_scope_mismatch");
      }
    }
  }

  function resolveObject(reference: DraftObjectReference): ResolvedObject {
    if (reference.source === "existing") {
      const object = objectsByKey.get(reference.object_key);
      if (!object || !object.is_active) {
        fail("existing_object_unknown_or_inactive");
      }
      return {
        identity: `existing:object:${object.key}`,
        objectKey: object.key,
      };
    }

    if (!objectsByReference.has(reference.object_reference)) {
      fail("draft_object_unknown");
    }
    return {
      identity: `draft:object:${reference.object_reference}`,
      draftReference: reference.object_reference,
    };
  }

  for (const object of parsedOutput.objects) {
    validateDraftObjectSourceScope(object);
  }

  function resolveExistingField(
    reference: Extract<DraftFieldReference, { source: "existing" }>,
  ): ResolvedField {
    const object = objectsByKey.get(reference.object_key);
    if (!object || !object.is_active) {
      fail("existing_object_unknown_or_inactive");
    }
    const field = object.fields.find(
      (candidate) => candidate.key === reference.field_key,
    );
    if (!field) {
      const belongsToOtherObject = parsedInput.business_context.objects.some(
        (candidateObject) =>
          candidateObject.key !== reference.object_key &&
          candidateObject.fields.some(
            (candidateField) => candidateField.key === reference.field_key,
          ),
      );
      if (belongsToOtherObject) {
        fail("field_object_mismatch");
      }
      fail("existing_field_unknown_or_inactive");
    }
    if (!field.is_active) {
      fail("existing_field_unknown_or_inactive");
    }
    return {
      identity: `existing:field:${object.key}:${field.key}`,
      object: {
        identity: `existing:object:${object.key}`,
        objectKey: object.key,
      },
      fieldType: field.field_type,
      required: field.required,
      hasDefault: field.has_default,
    };
  }

  function resolveField(reference: DraftFieldReference): ResolvedField {
    if (reference.source === "existing") {
      return resolveExistingField(reference);
    }
    const field = fieldsByReference.get(reference.field_reference);
    if (!field) {
      fail("draft_field_unknown");
    }
    const object = resolveObject(field.object_reference);
    return {
      identity: `draft:field:${field.reference}`,
      object,
      fieldType: field.field_type,
      required: field.required,
      hasDefault: false,
    };
  }

  function resolveExistingForm(
    reference: Extract<DraftFormReference, { source: "existing" }>,
  ): ResolvedForm {
    const form = parsedInput.business_context.forms.find(
      (candidate) => candidate.key === reference.form_key,
    );
    if (!form || !form.is_active) {
      fail("existing_form_unknown_or_inactive");
    }
    return {
      identity: `existing:form:${form.key}`,
      object: resolveObject({
        source: "existing",
        object_key: form.object_key,
      }),
      audience: form.audience,
      mode: form.mode,
    };
  }

  function resolveForm(reference: DraftFormReference): ResolvedForm {
    if (reference.source === "existing") {
      return resolveExistingForm(reference);
    }
    const form = formsByReference.get(reference.form_reference);
    if (!form) {
      fail("draft_form_unknown");
    }
    return {
      identity: `draft:form:${form.reference}`,
      object: resolveObject(form.object_reference),
      audience: form.audience,
      mode: form.mode,
    };
  }

  function resolveExistingView(
    reference: Extract<DraftViewReference, { source: "existing" }>,
  ): ResolvedView {
    const view = parsedInput.business_context.views.find(
      (candidate) => candidate.key === reference.view_key,
    );
    if (!view || !view.is_active) {
      fail("existing_view_unknown_or_inactive");
    }
    return {
      identity: `existing:view:${view.key}`,
      object: resolveObject({
        source: "existing",
        object_key: view.object_key,
      }),
      audience: view.audience,
    };
  }

  function resolveView(reference: DraftViewReference): ResolvedView {
    if (reference.source === "existing") {
      return resolveExistingView(reference);
    }
    const view = viewsByReference.get(reference.view_reference);
    if (!view) {
      fail("draft_view_unknown");
    }
    return {
      identity: `draft:view:${view.reference}`,
      object: resolveObject(view.object_reference),
      audience: view.audience,
    };
  }

  function validateObjectIntentLabels(): void {
    const labelOwners = new Map<string, string>();
    for (const object of parsedOutput.objects) {
      for (const value of [object.singular_label, object.plural_label]) {
        const label = normaliseLabel(value);
        const owner = labelOwners.get(label);
        if (owner !== undefined && owner !== object.reference) {
          fail("duplicate_object_label_intent");
        }
        labelOwners.set(label, object.reference);
      }
    }
  }

  function validateFieldIntentLabels(): void {
    const labelsByObject = new Map<string, Set<string>>();
    for (const field of parsedOutput.fields) {
      const object = resolveObject(field.object_reference);
      const labels = labelsByObject.get(object.identity) ?? new Set<string>();
      const label = normaliseLabel(field.label);
      if (labels.has(label)) {
        fail("duplicate_field_label_intent");
      }
      labels.add(label);
      labelsByObject.set(object.identity, labels);
    }
  }

  validateObjectIntentLabels();
  validateFieldIntentLabels();

  const resolvedFields = new Map<string, ResolvedField>();
  for (const field of parsedOutput.fields) {
    const targetObject = resolveObject(field.object_reference);
    validateSourceObjectScope(field.source_step_references, targetObject);
    resolvedFields.set(
      field.reference,
      resolveField({
        source: "draft",
        field_reference: field.reference,
      }),
    );
  }

  function validateViewFieldReference(
    targetObject: ResolvedObject,
    reference: DraftFieldReference,
  ): string {
    const field = resolveField(reference);
    if (field.object.identity !== targetObject.identity) {
      fail("view_field_object_mismatch");
    }
    return field.identity;
  }

  function validateViewFieldReferences(
    targetObject: ResolvedObject,
    references: ReadonlyArray<DraftFieldReference>,
  ): Set<string> {
    const identities = new Set<string>();
    for (const reference of references) {
      const identity = validateViewFieldReference(targetObject, reference);
      if (identities.has(identity)) {
        fail("duplicate_view_field_reference");
      }
      identities.add(identity);
    }
    return identities;
  }

  function validateViewForms(
    view: DraftView,
    targetObject: ResolvedObject,
    forms: ReadonlyArray<{
      reference: DraftFormReference;
      mode: "create" | "edit";
    }>,
  ): void {
    for (const entry of forms) {
      const form = resolveForm(entry.reference);
      if (
        form.object.identity !== targetObject.identity ||
        form.audience !== view.audience ||
        form.mode !== entry.mode
      ) {
        fail("view_form_mismatch");
      }
    }
  }

  for (const view of parsedOutput.views) {
    const targetObject = resolveObject(view.object_reference);
    validateSourceObjectScope(view.source_step_references, targetObject);
    switch (view.view_type) {
      case "table":
        validateViewFieldReferences(targetObject, view.configuration.fields);
        if (view.configuration.title_field !== null) {
          validateViewFieldReference(
            targetObject,
            view.configuration.title_field,
          );
        }
        validateViewForms(view, targetObject, [
          ...(view.configuration.create_form_reference !== null
            ? [
                {
                  reference: view.configuration.create_form_reference,
                  mode: "create" as const,
                },
              ]
            : []),
          ...(view.configuration.edit_form_reference !== null
            ? [
                {
                  reference: view.configuration.edit_form_reference,
                  mode: "edit" as const,
                },
              ]
            : []),
        ]);
        break;
      case "list": {
        const primaryIdentity = validateViewFieldReference(
          targetObject,
          view.configuration.primary_field,
        );
        const secondaryIdentities = validateViewFieldReferences(
          targetObject,
          view.configuration.secondary_fields,
        );
        if (secondaryIdentities.has(primaryIdentity)) {
          fail("duplicate_view_field_reference");
        }
        validateViewForms(view, targetObject, [
          ...(view.configuration.create_form_reference !== null
            ? [
                {
                  reference: view.configuration.create_form_reference,
                  mode: "create" as const,
                },
              ]
            : []),
          ...(view.configuration.edit_form_reference !== null
            ? [
                {
                  reference: view.configuration.edit_form_reference,
                  mode: "edit" as const,
                },
              ]
            : []),
        ]);
        break;
      }
      case "cards":
        validateViewFieldReferences(targetObject, [
          view.configuration.title_field,
          ...(view.configuration.subtitle_field !== null
            ? [view.configuration.subtitle_field]
            : []),
          ...(view.configuration.image_field !== null
            ? [view.configuration.image_field]
            : []),
          ...view.configuration.supporting_fields,
        ]);
        if (
          view.configuration.image_field !== null &&
          resolveField(view.configuration.image_field).fieldType !== "file"
        ) {
          fail("cards_image_field_invalid");
        }
        validateViewForms(view, targetObject, [
          ...(view.configuration.create_form_reference !== null
            ? [
                {
                  reference: view.configuration.create_form_reference,
                  mode: "create" as const,
                },
              ]
            : []),
          ...(view.configuration.edit_form_reference !== null
            ? [
                {
                  reference: view.configuration.edit_form_reference,
                  mode: "edit" as const,
                },
              ]
            : []),
        ]);
        break;
      case "detail":
        validateViewFieldReferences(targetObject, view.configuration.fields);
        if (view.configuration.title_field !== null) {
          validateViewFieldReference(
            targetObject,
            view.configuration.title_field,
          );
        }
        validateViewForms(view, targetObject, [
          ...(view.configuration.edit_form_reference !== null
            ? [
                {
                  reference: view.configuration.edit_form_reference,
                  mode: "edit" as const,
                },
              ]
            : []),
        ]);
        break;
    }
  }

  function validateCreateFormCoverage(
    form: DraftForm,
    targetObject: ResolvedObject,
    includedFields: ReadonlySet<string>,
  ): void {
    if (form.mode !== "create") {
      return;
    }

    if (targetObject.draftReference) {
      for (const field of parsedOutput.fields) {
        const resolved = resolvedFields.get(field.reference);
        if (
          resolved?.object.identity === targetObject.identity &&
          resolved.required &&
          !includedFields.has(resolved.identity)
        ) {
          fail("required_create_form_field_missing");
        }
      }
      return;
    }

    const object = targetObject.objectKey
      ? objectsByKey.get(targetObject.objectKey)
      : undefined;
    if (!object) {
      fail("existing_object_unknown_or_inactive");
    }
    for (const field of object.fields) {
      if (
        field.is_active &&
        field.required &&
        !field.has_default &&
        !includedFields.has(`existing:field:${object.key}:${field.key}`)
      ) {
        fail("required_create_form_field_missing");
      }
    }
    for (const field of parsedOutput.fields) {
      const resolved = resolvedFields.get(field.reference);
      if (
        resolved?.object.identity === targetObject.identity &&
        resolved.required &&
        !includedFields.has(resolved.identity)
      ) {
        fail("required_create_form_field_missing");
      }
    }
  }

  for (const form of parsedOutput.forms) {
    const targetObject = resolveObject(form.object_reference);
    validateSourceObjectScope(form.source_step_references, targetObject);
    const identities = new Set<string>();
    for (const configuredField of form.fields) {
      const field = resolveField(configuredField.field_reference);
      if (identities.has(field.identity)) {
        fail("duplicate_form_field_reference");
      }
      identities.add(field.identity);
      if (field.object.identity !== targetObject.identity) {
        fail("form_field_object_mismatch");
      }
    }
    validateCreateFormCoverage(form, targetObject, identities);
  }

  for (const page of parsedOutput.pages) {
    for (const block of page.blocks) {
      if (block.type === "view") {
        const view = resolveView(block.view_reference);
        if (view.audience !== page.audience) {
          fail("page_block_audience_mismatch");
        }
        validateSourceObjectScope(page.source_step_references, view.object);
      } else if (block.type === "form") {
        const form = resolveForm(block.form_reference);
        if (form.audience !== page.audience || form.mode !== "create") {
          fail("page_block_audience_mismatch");
        }
        validateSourceObjectScope(page.source_step_references, form.object);
      }
    }
  }

  for (const relationship of parsedOutput.relationships) {
    const sourceObject = resolveObject(relationship.source_object_reference);
    const targetObject = resolveObject(relationship.target_object_reference);
    validateSourceObjectScope(
      relationship.source_step_references,
      sourceObject,
    );
    validateSourceObjectScope(
      relationship.source_step_references,
      targetObject,
    );
  }

  return parsedOutput;
}
