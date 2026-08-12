import {
  deterministicTableViewRoles,
  formConfigSchema,
  normalizeTableViewConfig,
  pageLayoutSchema,
  parseViewConfig,
  type TableViewConfigV2,
} from "../../experience/schemas";
import { graphKeySchema } from "../../graph/schemas";
import {
  configurationOperationsSchema,
  setFieldOperationSchema,
  setFormOperationSchema,
  setObjectOperationSchema,
  setPageOperationSchema,
  setRelationshipOperationSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../schemas";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  builderConfigurationDraftOutputSchema,
  builderConfigurationDraftTaskInputBaseSchema,
  type BuilderConfigurationDraftOutput,
  type BuilderConfigurationDraftReadyTaskInput,
  type BuilderConfigurationDraftTaskInput,
  type DraftField,
  type DraftFieldReference,
  type DraftForm,
  type DraftFormReference,
  type DraftObject,
  type DraftObjectReference,
  type DraftPage,
  type DraftRelationship,
  type DraftView,
  type DraftViewReference,
} from "../../../ai/configuration-drafting/schemas";
import { validateConfigurationDraftOutput } from "../../../ai/configuration-drafting/validation";
import {
  configurationDraftCompilerInputSchema,
  configurationDraftCompilerOutputSchema,
  type ConfigurationDraftCompilerOutput,
} from "./contracts";
import { ConfigurationDraftCompilerError } from "./errors";
import {
  createGraphKeyAllocator,
  createPageSlugAllocator,
  normaliseGraphKeyBase,
} from "./key-allocation";

type SnapshotObject = ConfigurationSnapshotV1["object_definitions"][number];
type SnapshotField = ConfigurationSnapshotV1["field_definitions"][number];
type SnapshotRelationship =
  ConfigurationSnapshotV1["relationship_definitions"][number];
type SnapshotView = ConfigurationSnapshotV1["views"][number];
type SnapshotForm = ConfigurationSnapshotV1["forms"][number];

type DraftCompilerTaskInput = BuilderConfigurationDraftTaskInput;

interface SnapshotIndex {
  objectsByKey: ReadonlyMap<string, SnapshotObject>;
  fieldsByObjectKey: ReadonlyMap<string, ReadonlyMap<string, SnapshotField>>;
  fieldsByKey: ReadonlyMap<string, ReadonlyArray<SnapshotField>>;
  relationshipsByKey: ReadonlyMap<string, SnapshotRelationship>;
  viewsByKey: ReadonlyMap<string, SnapshotView>;
  formsByKey: ReadonlyMap<string, SnapshotForm>;
  objectKeys: ReadonlySet<string>;
  relationshipKeys: ReadonlySet<string>;
  viewKeys: ReadonlySet<string>;
  formKeys: ReadonlySet<string>;
  pageKeys: ReadonlySet<string>;
  pageSlugs: ReadonlySet<string>;
}

interface ObjectBinding {
  readonly key: string;
  readonly source: "existing" | "draft";
  readonly snapshot?: SnapshotObject;
  readonly draft?: DraftObject;
}

interface FieldBinding {
  readonly key: string;
  readonly objectKey: string;
  readonly fieldType: DraftField["field_type"];
  readonly required: boolean;
  readonly hasDefault: boolean;
  readonly source: "existing" | "draft";
  readonly snapshot?: SnapshotField;
}

interface FormBinding {
  readonly key: string;
  readonly objectKey: string;
  readonly mode: DraftForm["mode"];
  readonly audience: DraftForm["audience"];
  readonly source: "existing" | "draft";
  readonly snapshot?: SnapshotForm;
}

interface ViewBinding {
  readonly key: string;
  readonly objectKey: string;
  readonly viewType: DraftView["view_type"];
  readonly audience: DraftView["audience"];
  readonly source: "existing" | "draft";
  readonly snapshot?: SnapshotView;
}

interface CompiledFormField {
  field: string;
  label?: string;
  help_text?: string;
  hidden: false;
}

function fail(
  code:
    | "configuration_draft_compile_input_invalid"
    | "configuration_draft_compile_snapshot_invalid"
    | "configuration_draft_compile_snapshot_inconsistent"
    | "configuration_draft_compile_existing_reference_missing"
    | "configuration_draft_compile_existing_reference_inactive"
    | "configuration_draft_compile_existing_reference_mismatch"
    | "configuration_draft_compile_object_label_conflict"
    | "configuration_draft_compile_field_label_conflict"
    | "configuration_draft_compile_key_unavailable"
    | "configuration_draft_compile_slug_unavailable"
    | "configuration_draft_compile_position_unavailable"
    | "configuration_draft_compile_operations_invalid",
): never {
  throw new ConfigurationDraftCompilerError(code);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareNumericReferenceSuffix(left: string, right: string): number {
  const leftSuffix = left.slice(left.lastIndexOf("_") + 1);
  const rightSuffix = right.slice(right.lastIndexOf("_") + 1);
  const leftTrimmed = leftSuffix.replace(/^0+/, "") || "0";
  const rightTrimmed = rightSuffix.replace(/^0+/, "") || "0";
  if (leftTrimmed.length !== rightTrimmed.length) {
    return leftTrimmed.length < rightTrimmed.length ? -1 : 1;
  }
  return compareStrings(leftTrimmed, rightTrimmed);
}

function sourceSequence(
  taskInput: DraftCompilerTaskInput,
): ReadonlyMap<string, number> {
  if (taskInput.ready_plan.state !== "ready") {
    fail("configuration_draft_compile_input_invalid");
  }
  const readyPlan: BuilderConfigurationDraftReadyTaskInput["ready_plan"] =
    taskInput.ready_plan;
  return new Map(
    readyPlan.plan.steps.map((step) => [step.reference, step.sequence]),
  );
}

function minimumSourceSequence(
  references: ReadonlyArray<string>,
  sequences: ReadonlyMap<string, number>,
): number {
  return references.reduce(
    (minimum, reference) =>
      Math.min(minimum, sequences.get(reference) ?? Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER,
  );
}

function compareDraftEntities(
  left: {
    reference: string;
    source_step_references: ReadonlyArray<string>;
  },
  right: {
    reference: string;
    source_step_references: ReadonlyArray<string>;
  },
  leftBase: string,
  rightBase: string,
  sequences: ReadonlyMap<string, number>,
): number {
  const sequenceDifference =
    minimumSourceSequence(left.source_step_references, sequences) -
    minimumSourceSequence(right.source_step_references, sequences);
  if (sequenceDifference !== 0) {
    return sequenceDifference;
  }

  const baseDifference = compareStrings(leftBase, rightBase);
  if (baseDifference !== 0) {
    return baseDifference;
  }

  const suffixDifference = compareNumericReferenceSuffix(
    left.reference,
    right.reference,
  );
  return suffixDifference !== 0
    ? suffixDifference
    : compareStrings(left.reference, right.reference);
}

function normaliseLabel(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

function assertGraphKey(value: string): void {
  if (!graphKeySchema.safeParse(value).success) {
    fail("configuration_draft_compile_snapshot_inconsistent");
  }
}

function assertPageSlug(value: string): void {
  if (
    value.length < 1 ||
    value.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    fail("configuration_draft_compile_snapshot_inconsistent");
  }
}

function assertUnique<T>(
  rows: ReadonlyArray<T>,
  key: (row: T) => string,
  id: (row: T) => string,
): void {
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const row of rows) {
    const rowKey = key(row);
    const rowId = id(row);
    if (keys.has(rowKey) || ids.has(rowId)) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    keys.add(rowKey);
    ids.add(rowId);
  }
}

function createSnapshotIndex(snapshot: ConfigurationSnapshotV1): SnapshotIndex {
  const objectByKey = new Map<string, SnapshotObject>();
  const objectById = new Map<string, SnapshotObject>();
  assertUnique(
    snapshot.object_definitions,
    (row) => row.key,
    (row) => row.id,
  );
  for (const object of snapshot.object_definitions) {
    assertGraphKey(object.key);
    objectByKey.set(object.key, object);
    objectById.set(object.id, object);
  }

  const fieldsByObjectKey = new Map<string, Map<string, SnapshotField>>();
  const fieldsByKey = new Map<string, SnapshotField[]>();
  const fieldIds = new Set<string>();
  for (const field of snapshot.field_definitions) {
    assertGraphKey(field.key);
    if (fieldIds.has(field.id)) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    fieldIds.add(field.id);
    const object = objectById.get(field.object_definition_id);
    if (!object || object.key !== field.object_key) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    const fieldsForObject =
      fieldsByObjectKey.get(field.object_key) ?? new Map();
    if (fieldsForObject.has(field.key)) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    fieldsForObject.set(field.key, field);
    fieldsByObjectKey.set(field.object_key, fieldsForObject);
    const fieldsWithKey = fieldsByKey.get(field.key) ?? [];
    fieldsWithKey.push(field);
    fieldsByKey.set(field.key, fieldsWithKey);
  }

  const relationshipsByKey = new Map<string, SnapshotRelationship>();
  assertUnique(
    snapshot.relationship_definitions,
    (row) => row.key,
    (row) => row.id,
  );
  for (const relationship of snapshot.relationship_definitions) {
    assertGraphKey(relationship.key);
    const source = objectById.get(relationship.source_object_definition_id);
    const target = objectById.get(relationship.target_object_definition_id);
    if (
      !source ||
      !target ||
      source.key !== relationship.source_object_key ||
      target.key !== relationship.target_object_key
    ) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    relationshipsByKey.set(relationship.key, relationship);
  }

  const viewsByKey = new Map<string, SnapshotView>();
  assertUnique(
    snapshot.views,
    (row) => row.key,
    (row) => row.id,
  );
  for (const view of snapshot.views) {
    assertGraphKey(view.key);
    const object = objectById.get(view.object_definition_id);
    if (!object || object.key !== view.object_key) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    viewsByKey.set(view.key, view);
  }

  const formsByKey = new Map<string, SnapshotForm>();
  assertUnique(
    snapshot.forms,
    (row) => row.key,
    (row) => row.id,
  );
  for (const form of snapshot.forms) {
    assertGraphKey(form.key);
    const object = objectById.get(form.object_definition_id);
    if (!object || object.key !== form.object_key) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    formsByKey.set(form.key, form);
  }

  const pageKeys = new Set<string>();
  const pageSlugs = new Set<string>();
  const pageIds = new Set<string>();
  for (const page of snapshot.pages) {
    assertGraphKey(page.key);
    assertPageSlug(page.slug);
    if (
      pageKeys.has(page.key) ||
      pageSlugs.has(page.slug) ||
      pageIds.has(page.id)
    ) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    pageKeys.add(page.key);
    pageSlugs.add(page.slug);
    pageIds.add(page.id);
  }

  return {
    objectsByKey: objectByKey,
    fieldsByObjectKey,
    fieldsByKey,
    relationshipsByKey,
    viewsByKey,
    formsByKey,
    objectKeys: new Set(objectByKey.keys()),
    relationshipKeys: new Set(relationshipsByKey.keys()),
    viewKeys: new Set(viewsByKey.keys()),
    formKeys: new Set(formsByKey.keys()),
    pageKeys,
    pageSlugs,
  };
}

function asReadOnlyFields(
  fields: ReadonlyMap<string, SnapshotField> | undefined,
): ReadonlyArray<SnapshotField> {
  return fields ? [...fields.values()] : [];
}

class ConfigurationDraftCompiler {
  readonly #taskInput: DraftCompilerTaskInput;
  readonly #draft: BuilderConfigurationDraftOutput;
  readonly #index: SnapshotIndex;
  readonly #sequences: ReadonlyMap<string, number>;
  readonly #objectsByDraftReference = new Map<string, ObjectBinding>();
  readonly #fieldsByDraftReference = new Map<string, FieldBinding>();
  readonly #formsByDraftReference = new Map<string, FormBinding>();
  readonly #viewsByDraftReference = new Map<string, ViewBinding>();
  readonly #relationshipKeysByDraftReference = new Map<string, string>();
  readonly #pageIdentitiesByDraftReference = new Map<
    string,
    { key: string; slug: string }
  >();
  readonly #objectAllocator;
  readonly #relationshipAllocator;
  readonly #viewAllocator;
  readonly #formAllocator;
  readonly #pageAllocator;
  readonly #pageSlugAllocator;

  constructor(
    taskInput: DraftCompilerTaskInput,
    draft: BuilderConfigurationDraftOutput,
    snapshot: ConfigurationSnapshotV1,
  ) {
    this.#taskInput = taskInput;
    this.#draft = draft;
    this.#index = createSnapshotIndex(snapshot);
    this.#sequences = sourceSequence(taskInput);
    this.#objectAllocator = createGraphKeyAllocator(this.#index.objectKeys);
    this.#relationshipAllocator = createGraphKeyAllocator(
      this.#index.relationshipKeys,
    );
    this.#viewAllocator = createGraphKeyAllocator(this.#index.viewKeys);
    this.#formAllocator = createGraphKeyAllocator(this.#index.formKeys);
    this.#pageAllocator = createGraphKeyAllocator(this.#index.pageKeys);
    this.#pageSlugAllocator = createPageSlugAllocator(this.#index.pageSlugs);
  }

  compile(): ConfigurationDraftCompilerOutput {
    this.assertObjectLabelGuards();
    this.allocateObjects();
    this.assertFieldLabelGuards();
    this.allocateFields();
    this.allocateRelationships();
    this.allocateForms();
    this.allocateViews();
    this.allocatePages();

    const operations = this.buildOperations();
    try {
      return configurationDraftCompilerOutputSchema.parse({
        schema_version: 1,
        operations: configurationOperationsSchema.parse(operations),
      });
    } catch {
      fail("configuration_draft_compile_operations_invalid");
    }
  }

  private assertObjectLabelGuards(): void {
    const objectLabels = new Set<string>();
    for (const object of this.#index.objectsByKey.values()) {
      objectLabels.add(normaliseLabel(object.singular_label));
      objectLabels.add(normaliseLabel(object.plural_label));
    }
    for (const object of this.#draft.objects) {
      if (
        objectLabels.has(normaliseLabel(object.singular_label)) ||
        objectLabels.has(normaliseLabel(object.plural_label))
      ) {
        fail("configuration_draft_compile_object_label_conflict");
      }
    }
  }

  private assertFieldLabelGuards(): void {
    for (const field of this.#draft.fields) {
      const object = this.resolveObjectReference(field.object_reference);
      const existingFields = this.#index.fieldsByObjectKey.get(object.key);
      if (
        existingFields &&
        asReadOnlyFields(existingFields).some(
          (candidate) =>
            normaliseLabel(candidate.label) === normaliseLabel(field.label),
        )
      ) {
        fail("configuration_draft_compile_field_label_conflict");
      }
    }
  }

  private allocateObjects(): void {
    const objects = [...this.#draft.objects].sort((left, right) =>
      compareDraftEntities(
        left,
        right,
        normaliseGraphKeyBase(left.singular_label, "object"),
        normaliseGraphKeyBase(right.singular_label, "object"),
        this.#sequences,
      ),
    );
    for (const object of objects) {
      this.#objectsByDraftReference.set(object.reference, {
        key: this.#objectAllocator.allocate(object.singular_label, "object"),
        source: "draft",
        draft: object,
      });
    }
  }

  private allocateFields(): void {
    const fieldsByObject = new Map<string, DraftField[]>();
    for (const field of this.#draft.fields) {
      const object = this.resolveObjectReference(field.object_reference);
      const fields = fieldsByObject.get(object.key) ?? [];
      fields.push(field);
      fieldsByObject.set(object.key, fields);
    }

    for (const [objectKey, fields] of fieldsByObject) {
      const snapshotFields = this.#index.fieldsByObjectKey.get(objectKey);
      const allocator = createGraphKeyAllocator(
        snapshotFields ? [...snapshotFields.keys()] : [],
      );
      const sortedFields = fields.sort((left, right) =>
        compareDraftEntities(
          left,
          right,
          normaliseGraphKeyBase(left.label, "field"),
          normaliseGraphKeyBase(right.label, "field"),
          this.#sequences,
        ),
      );
      for (const field of sortedFields) {
        this.#fieldsByDraftReference.set(field.reference, {
          key: allocator.allocate(field.label, "field"),
          objectKey,
          fieldType: field.field_type,
          required: field.required,
          hasDefault: false,
          source: "draft",
        });
      }
    }
  }

  private allocateRelationships(): void {
    const relationships = [...this.#draft.relationships].sort((left, right) =>
      compareDraftEntities(
        left,
        right,
        normaliseGraphKeyBase(this.relationshipBase(left), "relationship"),
        normaliseGraphKeyBase(this.relationshipBase(right), "relationship"),
        this.#sequences,
      ),
    );
    for (const relationship of relationships) {
      this.#relationshipKeysByDraftReference.set(
        relationship.reference,
        this.#relationshipAllocator.allocate(
          this.relationshipBase(relationship),
          "relationship",
        ),
      );
    }
  }

  private allocateForms(): void {
    const forms = [...this.#draft.forms].sort((left, right) =>
      compareDraftEntities(
        left,
        right,
        normaliseGraphKeyBase(this.formBase(left), "form"),
        normaliseGraphKeyBase(this.formBase(right), "form"),
        this.#sequences,
      ),
    );
    for (const form of forms) {
      const object = this.resolveObjectReference(form.object_reference);
      this.#formsByDraftReference.set(form.reference, {
        key: this.#formAllocator.allocate(
          `${object.key}_${form.mode}_${form.audience}`,
          "form",
        ),
        objectKey: object.key,
        mode: form.mode,
        audience: form.audience,
        source: "draft",
      });
    }
  }

  private allocateViews(): void {
    const views = [...this.#draft.views].sort((left, right) =>
      compareDraftEntities(
        left,
        right,
        normaliseGraphKeyBase(this.viewBase(left), "view"),
        normaliseGraphKeyBase(this.viewBase(right), "view"),
        this.#sequences,
      ),
    );
    for (const view of views) {
      const object = this.resolveObjectReference(view.object_reference);
      this.#viewsByDraftReference.set(view.reference, {
        key: this.#viewAllocator.allocate(
          `${object.key}_${view.view_type}`,
          "view",
        ),
        objectKey: object.key,
        viewType: view.view_type,
        audience: view.audience,
        source: "draft",
      });
    }
  }

  private allocatePages(): void {
    const pages = [...this.#draft.pages].sort((left, right) =>
      compareDraftEntities(
        left,
        right,
        normaliseGraphKeyBase(left.title, "page"),
        normaliseGraphKeyBase(right.title, "page"),
        this.#sequences,
      ),
    );
    for (const page of pages) {
      this.#pageIdentitiesByDraftReference.set(page.reference, {
        key: this.#pageAllocator.allocate(page.title, "page"),
        slug: this.#pageSlugAllocator.allocate(page.title),
      });
    }
  }

  private relationshipBase(relationship: DraftRelationship): string {
    const source = this.resolveObjectReference(
      relationship.source_object_reference,
    );
    const target = this.resolveObjectReference(
      relationship.target_object_reference,
    );
    return `${source.key}_${relationship.source_label}_${target.key}`;
  }

  private formBase(form: DraftForm): string {
    const object = this.resolveObjectReference(form.object_reference);
    return `${object.key}_${form.mode}_${form.audience}`;
  }

  private viewBase(view: DraftView): string {
    const object = this.resolveObjectReference(view.object_reference);
    return `${object.key}_${view.view_type}`;
  }

  private resolveObjectReference(
    reference: DraftObjectReference,
  ): ObjectBinding {
    if (reference.source === "existing") {
      const object = this.#index.objectsByKey.get(reference.object_key);
      if (!object) {
        fail("configuration_draft_compile_existing_reference_missing");
      }
      if (!object.is_active) {
        fail("configuration_draft_compile_existing_reference_inactive");
      }
      return { key: object.key, source: "existing", snapshot: object };
    }

    const object = this.#objectsByDraftReference.get(
      reference.object_reference,
    );
    if (!object) {
      fail("configuration_draft_compile_input_invalid");
    }
    return object;
  }

  private resolveFieldReference(reference: DraftFieldReference): FieldBinding {
    if (reference.source === "existing") {
      const object = this.#index.objectsByKey.get(reference.object_key);
      if (!object) {
        fail("configuration_draft_compile_existing_reference_missing");
      }
      if (!object.is_active) {
        fail("configuration_draft_compile_existing_reference_inactive");
      }
      const fieldsForObject = this.#index.fieldsByObjectKey.get(object.key);
      const field = fieldsForObject?.get(reference.field_key);
      if (!field) {
        const sameKeyElsewhere = this.#index.fieldsByKey.get(
          reference.field_key,
        );
        if (
          sameKeyElsewhere?.some(
            (candidate) => candidate.object_key !== object.key,
          )
        ) {
          fail("configuration_draft_compile_existing_reference_mismatch");
        }
        fail("configuration_draft_compile_existing_reference_missing");
      }
      if (!field.is_active) {
        fail("configuration_draft_compile_existing_reference_inactive");
      }
      return {
        key: field.key,
        objectKey: object.key,
        fieldType: field.field_type,
        required: field.required,
        hasDefault: field.default_value !== null,
        source: "existing",
        snapshot: field,
      };
    }

    const field = this.#fieldsByDraftReference.get(reference.field_reference);
    if (!field) {
      fail("configuration_draft_compile_input_invalid");
    }
    return field;
  }

  private resolveFormReference(reference: DraftFormReference): FormBinding {
    if (reference.source === "existing") {
      const form = this.#index.formsByKey.get(reference.form_key);
      if (!form) {
        fail("configuration_draft_compile_existing_reference_missing");
      }
      if (!form.is_active) {
        fail("configuration_draft_compile_existing_reference_inactive");
      }
      const object = this.#index.objectsByKey.get(form.object_key);
      if (!object || !object.is_active) {
        fail("configuration_draft_compile_existing_reference_inactive");
      }
      const contextForm = this.#taskInput.business_context.forms.find(
        (candidate) => candidate.key === form.key,
      );
      if (
        !contextForm ||
        contextForm.object_key !== form.object_key ||
        contextForm.mode !== form.mode ||
        contextForm.audience !== form.audience
      ) {
        fail("configuration_draft_compile_existing_reference_mismatch");
      }
      return {
        key: form.key,
        objectKey: form.object_key,
        mode: form.mode,
        audience: form.audience,
        source: "existing",
        snapshot: form,
      };
    }

    const form = this.#formsByDraftReference.get(reference.form_reference);
    if (!form) {
      fail("configuration_draft_compile_input_invalid");
    }
    return form;
  }

  private resolveViewReference(reference: DraftViewReference): ViewBinding {
    if (reference.source === "existing") {
      const view = this.#index.viewsByKey.get(reference.view_key);
      if (!view) {
        fail("configuration_draft_compile_existing_reference_missing");
      }
      if (!view.is_active) {
        fail("configuration_draft_compile_existing_reference_inactive");
      }
      const object = this.#index.objectsByKey.get(view.object_key);
      if (!object || !object.is_active) {
        fail("configuration_draft_compile_existing_reference_inactive");
      }
      const contextView = this.#taskInput.business_context.views.find(
        (candidate) => candidate.key === view.key,
      );
      if (
        !contextView ||
        contextView.object_key !== view.object_key ||
        contextView.audience !== view.audience ||
        contextView.view_type !== view.view_type
      ) {
        fail("configuration_draft_compile_existing_reference_mismatch");
      }
      return {
        key: view.key,
        objectKey: view.object_key,
        viewType: view.view_type,
        audience: view.audience,
        source: "existing",
        snapshot: view,
      };
    }

    const view = this.#viewsByDraftReference.get(reference.view_reference);
    if (!view) {
      fail("configuration_draft_compile_input_invalid");
    }
    return view;
  }

  private assertFieldForObject(field: FieldBinding, objectKey: string): void {
    if (field.objectKey !== objectKey) {
      fail(
        field.source === "existing"
          ? "configuration_draft_compile_existing_reference_mismatch"
          : "configuration_draft_compile_input_invalid",
      );
    }
  }

  private assertFormCompatibility(
    form: FormBinding,
    expected: {
      objectKey: string;
      mode?: DraftForm["mode"];
      audience?: DraftForm["audience"];
    },
  ): void {
    if (
      form.objectKey !== expected.objectKey ||
      (expected.mode !== undefined && form.mode !== expected.mode) ||
      (expected.audience !== undefined && form.audience !== expected.audience)
    ) {
      fail(
        form.source === "existing"
          ? "configuration_draft_compile_existing_reference_mismatch"
          : "configuration_draft_compile_input_invalid",
      );
    }
  }

  private assertViewCompatibility(
    view: ViewBinding,
    expectedAudience: DraftView["audience"],
  ): void {
    if (view.audience !== expectedAudience) {
      fail(
        view.source === "existing"
          ? "configuration_draft_compile_existing_reference_mismatch"
          : "configuration_draft_compile_input_invalid",
      );
    }
  }

  private compileObjectOperations(): Array<
    Extract<ConfigurationOperation, { op: "set_object" }>
  > {
    return this.#draft.objects
      .map((object) => {
        const binding = this.#objectsByDraftReference.get(object.reference);
        if (!binding) {
          fail("configuration_draft_compile_input_invalid");
        }
        return setObjectOperationSchema.parse({
          op: "set_object",
          key: binding.key,
          singular_label: object.singular_label,
          plural_label: object.plural_label,
          description: object.description,
          icon: null,
          is_active: true,
        });
      })
      .sort((left, right) => compareStrings(left.key, right.key));
  }

  private positionForField(field: DraftField, objectKey: string): number {
    const existingFields = asReadOnlyFields(
      this.#index.fieldsByObjectKey.get(objectKey),
    );
    const existingObject = this.#index.objectsByKey.get(objectKey);
    if (!existingObject) {
      const position = this.#draft.fields
        .filter(
          (candidate) =>
            candidate.object_reference.source === "draft" &&
            this.resolveObjectReference(candidate.object_reference).key ===
              objectKey,
        )
        .sort((left, right) =>
          compareDraftEntities(
            left,
            right,
            normaliseGraphKeyBase(left.label, "field"),
            normaliseGraphKeyBase(right.label, "field"),
            this.#sequences,
          ),
        )
        .findIndex((candidate) => candidate.reference === field.reference);
      if (position < 0 || !Number.isSafeInteger(position)) {
        fail("configuration_draft_compile_position_unavailable");
      }
      return position;
    }

    let maximum = -1;
    for (const snapshotField of existingFields) {
      if (snapshotField.position < 0) {
        continue;
      }
      if (!Number.isSafeInteger(snapshotField.position)) {
        fail("configuration_draft_compile_position_unavailable");
      }
      maximum = Math.max(maximum, snapshotField.position);
    }
    const sortedNewFields = this.#draft.fields
      .filter(
        (candidate) =>
          candidate.object_reference.source === "existing" &&
          candidate.object_reference.object_key === objectKey,
      )
      .sort((left, right) =>
        compareDraftEntities(
          left,
          right,
          normaliseGraphKeyBase(left.label, "field"),
          normaliseGraphKeyBase(right.label, "field"),
          this.#sequences,
        ),
      );
    const offset = sortedNewFields.findIndex(
      (candidate) => candidate.reference === field.reference,
    );
    if (offset < 0 || maximum > Number.MAX_SAFE_INTEGER - offset - 1) {
      fail("configuration_draft_compile_position_unavailable");
    }
    return maximum + offset + 1;
  }

  private settingsForField(field: DraftField): Record<string, unknown> {
    if (field.settings === null) {
      return {};
    }
    if ("options" in field.settings) {
      return { options: field.settings.options };
    }
    if ("currency" in field.settings) {
      return { currency: field.settings.currency };
    }
    return {};
  }

  private compileFieldOperations(): Array<
    Extract<ConfigurationOperation, { op: "set_field" }>
  > {
    return this.#draft.fields
      .map((field) => {
        const binding = this.#fieldsByDraftReference.get(field.reference);
        if (!binding) {
          fail("configuration_draft_compile_input_invalid");
        }
        const position = this.positionForField(field, binding.objectKey);
        return setFieldOperationSchema.parse({
          op: "set_field",
          object_key: binding.objectKey,
          key: binding.key,
          label: field.label,
          field_type: field.field_type,
          required: field.required,
          default_value: null,
          settings_json: this.settingsForField(field),
          position,
          is_active: true,
        });
      })
      .sort(
        (left, right) =>
          compareStrings(left.object_key, right.object_key) ||
          left.position - right.position ||
          compareStrings(left.key, right.key),
      );
  }

  private compileRelationshipOperations(): Array<
    Extract<ConfigurationOperation, { op: "set_relationship" }>
  > {
    return this.#draft.relationships
      .map((relationship) => {
        const source = this.resolveObjectReference(
          relationship.source_object_reference,
        );
        const target = this.resolveObjectReference(
          relationship.target_object_reference,
        );
        const key = this.#relationshipKeysByDraftReference.get(
          relationship.reference,
        );
        if (!key) {
          fail("configuration_draft_compile_input_invalid");
        }
        return setRelationshipOperationSchema.parse({
          op: "set_relationship",
          key,
          source_object_key: source.key,
          target_object_key: target.key,
          source_label: relationship.source_label,
          target_label: relationship.target_label,
          cardinality: relationship.cardinality,
          is_required: relationship.is_required,
          is_active: true,
        });
      })
      .sort((left, right) => compareStrings(left.key, right.key));
  }

  private compileFormFields(form: DraftForm, objectKey: string) {
    const included = new Set<string>();
    const fields = form.fields.map((configuredField) => {
      const field = this.resolveFieldReference(configuredField.field_reference);
      this.assertFieldForObject(field, objectKey);
      included.add(field.key);
      const compiled: {
        field: string;
        label?: string;
        help_text?: string;
        hidden: false;
      } = { field: field.key, hidden: false };
      if (configuredField.label !== null) {
        compiled.label = configuredField.label;
      }
      if (configuredField.help_text !== null) {
        compiled.help_text = configuredField.help_text;
      }
      return compiled;
    });

    if (form.mode === "create") {
      for (const field of asReadOnlyFields(
        this.#index.fieldsByObjectKey.get(objectKey),
      )) {
        if (
          field.is_active &&
          field.required &&
          field.default_value === null &&
          !included.has(field.key)
        ) {
          fail("configuration_draft_compile_existing_reference_mismatch");
        }
      }
      for (const draftField of this.#draft.fields) {
        const binding = this.#fieldsByDraftReference.get(draftField.reference);
        if (
          binding?.objectKey === objectKey &&
          binding.required &&
          !included.has(binding.key)
        ) {
          fail("configuration_draft_compile_existing_reference_mismatch");
        }
      }
    }

    return fields;
  }

  private existingFieldBindingsByObject(): Map<string, FieldBinding[]> {
    const fieldsByObject = new Map<string, FieldBinding[]>();
    const fields = [...this.#draft.fields].sort((left, right) =>
      compareDraftEntities(
        left,
        right,
        normaliseGraphKeyBase(left.label, "field"),
        normaliseGraphKeyBase(right.label, "field"),
        this.#sequences,
      ),
    );
    for (const field of fields) {
      if (field.object_reference.source !== "existing") {
        continue;
      }
      const binding = this.#fieldsByDraftReference.get(field.reference);
      if (!binding) {
        fail("configuration_draft_compile_input_invalid");
      }
      const fields = fieldsByObject.get(binding.objectKey) ?? [];
      fields.push(binding);
      fieldsByObject.set(binding.objectKey, fields);
    }
    return fieldsByObject;
  }

  private primaryTableSurface(objectKey: string): {
    view: SnapshotView;
    config: TableViewConfigV2;
  } | null {
    const candidates = [...this.#index.viewsByKey.values()].filter(
      (view) =>
        view.object_key === objectKey &&
        view.view_type === "table" &&
        view.audience === "internal" &&
        view.is_active,
    );
    if (candidates.length === 0) {
      return null;
    }

    let roles: Map<string, "primary" | "saved">;
    try {
      roles = deterministicTableViewRoles(candidates);
    } catch {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    const view = candidates.find(
      (candidate) => roles.get(candidate.key) === "primary",
    );
    if (!view) {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
    try {
      return {
        view,
        config: normalizeTableViewConfig(
          view.config_json,
          roles.get(view.key) ?? "primary",
        ),
      };
    } catch {
      fail("configuration_draft_compile_snapshot_inconsistent");
    }
  }

  private tableMutationConfig(
    source: SnapshotView,
    config: TableViewConfigV2,
  ): Record<string, unknown> {
    const sourceConfig = source.config_json;
    const isCanonical =
      typeof sourceConfig === "object" &&
      sourceConfig !== null &&
      !Array.isArray(sourceConfig) &&
      sourceConfig.schema_version === 2;
    if (isCanonical) {
      return config;
    }
    return {
      fields: config.fields,
      title_field: config.title_field,
      ...(config.column_widths ? { column_widths: config.column_widths } : {}),
      ...(config.create_form_key
        ? { create_form_key: config.create_form_key }
        : {}),
      ...(config.edit_form_key ? { edit_form_key: config.edit_form_key } : {}),
      include_archived: config.include_archived,
    };
  }

  private existingTableFormOperations(
    surface: { view: SnapshotView; config: TableViewConfigV2 },
    objectKey: string,
    newFields: readonly FieldBinding[],
  ): Array<Extract<ConfigurationOperation, { op: "set_form" }>> {
    const references = [
      ...(surface.config.create_form_key
        ? [{ key: surface.config.create_form_key, mode: "create" as const }]
        : []),
      ...(surface.config.edit_form_key
        ? [{ key: surface.config.edit_form_key, mode: "edit" as const }]
        : []),
    ];
    const seen = new Set<string>();

    return references.flatMap(({ key, mode }) => {
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);

      const form = this.#index.formsByKey.get(key);
      if (
        !form ||
        !form.is_active ||
        form.audience !== "internal" ||
        form.mode !== mode ||
        form.object_key !== objectKey ||
        form.object_definition_id !== surface.view.object_definition_id
      ) {
        fail("configuration_draft_compile_existing_reference_mismatch");
      }

      let config: ReturnType<typeof formConfigSchema.parse>;
      try {
        config = formConfigSchema.parse(form.config_json);
      } catch {
        fail("configuration_draft_compile_existing_reference_mismatch");
      }

      const configured = new Set(config.fields.map((field) => field.field));
      const additions = newFields
        .filter((field) => !configured.has(field.key))
        .map((field) => ({ field: field.key, hidden: false }));
      if (additions.length === 0) {
        return [];
      }

      return [
        setFormOperationSchema.parse({
          op: "set_form",
          key: form.key,
          name: form.name,
          object_key: form.object_key,
          mode: form.mode,
          config_json: {
            ...config,
            fields: [...config.fields, ...additions],
          },
          audience: form.audience,
          is_active: form.is_active,
        }),
      ];
    });
  }

  private existingTableViewOperation(
    surface: { view: SnapshotView; config: TableViewConfigV2 },
    newFields: readonly FieldBinding[],
  ): Extract<ConfigurationOperation, { op: "set_view" }> | null {
    const existingColumns = new Set(
      surface.config.columns.flatMap((column) =>
        column.kind === "field" ? [column.field_key] : [],
      ),
    );
    const additions = newFields
      .filter((field) => !existingColumns.has(field.key))
      .map((field) => ({ kind: "field" as const, field_key: field.key }));
    if (additions.length === 0) {
      return null;
    }

    const columns = [...surface.config.columns, ...additions];
    const config = normalizeTableViewConfig({
      ...surface.config,
      columns,
      fields: columns.flatMap((column) =>
        column.kind === "field" ? [column.field_key] : [],
      ),
    });
    return setViewOperationSchema.parse({
      op: "set_view",
      key: surface.view.key,
      name: surface.view.name,
      view_type: surface.view.view_type,
      object_key: surface.view.object_key,
      config_json: this.tableMutationConfig(surface.view, config),
      audience: surface.view.audience,
      is_active: surface.view.is_active,
    });
  }

  private existingTableSurfaceOperations(): {
    forms: Array<Extract<ConfigurationOperation, { op: "set_form" }>>;
    views: Array<Extract<ConfigurationOperation, { op: "set_view" }>>;
  } {
    const forms: Array<Extract<ConfigurationOperation, { op: "set_form" }>> =
      [];
    const views: Array<Extract<ConfigurationOperation, { op: "set_view" }>> =
      [];
    const fieldsByObject = this.existingFieldBindingsByObject();

    for (const objectKey of [...fieldsByObject.keys()].sort()) {
      const newFields = fieldsByObject.get(objectKey);
      if (!newFields || newFields.length === 0) {
        continue;
      }
      const surface = this.primaryTableSurface(objectKey);
      if (!surface) {
        continue;
      }
      forms.push(
        ...this.existingTableFormOperations(surface, objectKey, newFields),
      );
      const view = this.existingTableViewOperation(surface, newFields);
      if (view) {
        views.push(view);
      }
    }

    return { forms, views };
  }

  private formKeyForView(
    reference: DraftFormReference,
    objectKey: string,
    mode: DraftForm["mode"],
    audience: DraftForm["audience"],
  ): string {
    const form = this.resolveFormReference(reference);
    this.assertFormCompatibility(form, { objectKey, mode, audience });
    return form.key;
  }

  private fieldKeyForView(
    reference: DraftFieldReference,
    objectKey: string,
  ): string {
    const field = this.resolveFieldReference(reference);
    this.assertFieldForObject(field, objectKey);
    return field.key;
  }

  private compileViewConfig(view: DraftView, objectKey: string) {
    switch (view.view_type) {
      case "table": {
        const config: {
          fields: string[];
          title_field?: string;
          create_form_key?: string;
          edit_form_key?: string;
          include_archived: false;
        } = {
          fields: view.configuration.fields.map((field) =>
            this.fieldKeyForView(field, objectKey),
          ),
          include_archived: false,
        };
        if (view.configuration.title_field !== null) {
          config.title_field = this.fieldKeyForView(
            view.configuration.title_field,
            objectKey,
          );
        }
        if (view.configuration.create_form_reference !== null) {
          config.create_form_key = this.formKeyForView(
            view.configuration.create_form_reference,
            objectKey,
            "create",
            view.audience,
          );
        }
        if (view.configuration.edit_form_reference !== null) {
          config.edit_form_key = this.formKeyForView(
            view.configuration.edit_form_reference,
            objectKey,
            "edit",
            view.audience,
          );
        }
        return parseViewConfig(view.view_type, config);
      }
      case "list": {
        const config: {
          primary_field: string;
          secondary_fields: string[];
          create_form_key?: string;
          edit_form_key?: string;
          include_archived: false;
        } = {
          primary_field: this.fieldKeyForView(
            view.configuration.primary_field,
            objectKey,
          ),
          secondary_fields: view.configuration.secondary_fields.map((field) =>
            this.fieldKeyForView(field, objectKey),
          ),
          include_archived: false,
        };
        if (view.configuration.create_form_reference !== null) {
          config.create_form_key = this.formKeyForView(
            view.configuration.create_form_reference,
            objectKey,
            "create",
            view.audience,
          );
        }
        if (view.configuration.edit_form_reference !== null) {
          config.edit_form_key = this.formKeyForView(
            view.configuration.edit_form_reference,
            objectKey,
            "edit",
            view.audience,
          );
        }
        return parseViewConfig(view.view_type, config);
      }
      case "cards": {
        const imageField =
          view.configuration.image_field === null
            ? null
            : this.resolveFieldReference(view.configuration.image_field);
        if (imageField && imageField.fieldType !== "file") {
          fail("configuration_draft_compile_existing_reference_mismatch");
        }
        if (imageField) {
          this.assertFieldForObject(imageField, objectKey);
        }
        const config: {
          title_field: string;
          subtitle_field?: string;
          image_field?: string;
          supporting_fields: string[];
          create_form_key?: string;
          edit_form_key?: string;
          include_archived: false;
        } = {
          title_field: this.fieldKeyForView(
            view.configuration.title_field,
            objectKey,
          ),
          supporting_fields: view.configuration.supporting_fields.map((field) =>
            this.fieldKeyForView(field, objectKey),
          ),
          include_archived: false,
        };
        if (view.configuration.subtitle_field !== null) {
          config.subtitle_field = this.fieldKeyForView(
            view.configuration.subtitle_field,
            objectKey,
          );
        }
        if (imageField) {
          config.image_field = imageField.key;
        }
        if (view.configuration.create_form_reference !== null) {
          config.create_form_key = this.formKeyForView(
            view.configuration.create_form_reference,
            objectKey,
            "create",
            view.audience,
          );
        }
        if (view.configuration.edit_form_reference !== null) {
          config.edit_form_key = this.formKeyForView(
            view.configuration.edit_form_reference,
            objectKey,
            "edit",
            view.audience,
          );
        }
        return parseViewConfig(view.view_type, config);
      }
      case "detail": {
        const config: {
          fields: string[];
          title_field?: string;
          edit_form_key?: string;
          include_archived: false;
        } = {
          fields: view.configuration.fields.map((field) =>
            this.fieldKeyForView(field, objectKey),
          ),
          include_archived: false,
        };
        if (view.configuration.title_field !== null) {
          config.title_field = this.fieldKeyForView(
            view.configuration.title_field,
            objectKey,
          );
        }
        if (view.configuration.edit_form_reference !== null) {
          config.edit_form_key = this.formKeyForView(
            view.configuration.edit_form_reference,
            objectKey,
            "edit",
            view.audience,
          );
        }
        return parseViewConfig(view.view_type, config);
      }
    }
  }

  private compileFormOperations(): Array<
    Extract<ConfigurationOperation, { op: "set_form" }>
  > {
    const explicit = this.#draft.forms
      .map((form) => {
        const binding = this.#formsByDraftReference.get(form.reference);
        if (!binding) {
          fail("configuration_draft_compile_input_invalid");
        }
        const config: {
          fields: CompiledFormField[];
          submit_label?: string;
        } = {
          fields: this.compileFormFields(form, binding.objectKey),
        };
        if (form.submit_label !== null) {
          config.submit_label = form.submit_label;
        }
        return setFormOperationSchema.parse({
          op: "set_form",
          key: binding.key,
          name: form.name,
          object_key: binding.objectKey,
          mode: form.mode,
          config_json: formConfigSchema.parse(config),
          audience: form.audience,
          is_active: true,
        });
      })
      .sort((left, right) => compareStrings(left.key, right.key));
    const implicit = this.existingTableSurfaceOperations().forms;
    return [...explicit, ...implicit].sort((left, right) =>
      compareStrings(left.key, right.key),
    );
  }

  private compileViewOperations(): Array<
    Extract<ConfigurationOperation, { op: "set_view" }>
  > {
    const explicit = this.#draft.views
      .map((view) => {
        const binding = this.#viewsByDraftReference.get(view.reference);
        if (!binding) {
          fail("configuration_draft_compile_input_invalid");
        }
        return setViewOperationSchema.parse({
          op: "set_view",
          key: binding.key,
          name: view.name,
          view_type: view.view_type,
          object_key: binding.objectKey,
          config_json: this.compileViewConfig(view, binding.objectKey),
          audience: view.audience,
          is_active: true,
        });
      })
      .sort((left, right) => compareStrings(left.key, right.key));
    const implicit = this.existingTableSurfaceOperations().views;
    return [...explicit, ...implicit].sort((left, right) =>
      compareStrings(left.key, right.key),
    );
  }

  private compilePageBlock(
    block: DraftPage["blocks"][number],
    audience: DraftPage["audience"],
  ) {
    switch (block.type) {
      case "heading":
        return { ...block };
      case "text":
        return { ...block };
      case "divider":
        return { ...block };
      case "view": {
        const view = this.resolveViewReference(block.view_reference);
        this.assertViewCompatibility(view, audience);
        return { type: "view" as const, view_key: view.key };
      }
      case "form": {
        const form = this.resolveFormReference(block.form_reference);
        this.assertFormCompatibility(form, {
          objectKey: form.objectKey,
          mode: "create",
          audience,
        });
        return { type: "form" as const, form_key: form.key };
      }
    }
  }

  private compilePageOperations(): Array<
    Extract<ConfigurationOperation, { op: "set_page" }>
  > {
    return this.#draft.pages
      .map((page) => {
        const identity = this.#pageIdentitiesByDraftReference.get(
          page.reference,
        );
        if (!identity) {
          fail("configuration_draft_compile_input_invalid");
        }
        const layout = pageLayoutSchema.parse({
          blocks: page.blocks.map((block) =>
            this.compilePageBlock(block, page.audience),
          ),
        });
        return setPageOperationSchema.parse({
          op: "set_page",
          key: identity.key,
          title: page.title,
          slug: identity.slug,
          audience: page.audience,
          layout_json: layout,
          status: "draft",
          is_active: true,
        });
      })
      .sort((left, right) => compareStrings(left.key, right.key));
  }

  private buildOperations(): ConfigurationOperation[] {
    return [
      ...this.compileObjectOperations(),
      ...this.compileFieldOperations(),
      ...this.compileRelationshipOperations(),
      ...this.compileFormOperations(),
      ...this.compileViewOperations(),
      ...this.compilePageOperations(),
    ];
  }
}

export function compileConfigurationDraft(
  input: unknown,
): ConfigurationDraftCompilerOutput {
  const envelope =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;
  if (
    !envelope ||
    !Object.prototype.hasOwnProperty.call(envelope, "taskInput") ||
    !Object.prototype.hasOwnProperty.call(envelope, "draft") ||
    !Object.prototype.hasOwnProperty.call(envelope, "snapshot") ||
    Object.keys(envelope).some(
      (key) => !["taskInput", "draft", "snapshot"].includes(key),
    )
  ) {
    fail("configuration_draft_compile_input_invalid");
  }

  const taskInput = builderConfigurationDraftTaskInputBaseSchema.safeParse(
    envelope.taskInput,
  );
  const draft = builderConfigurationDraftOutputSchema.safeParse(envelope.draft);
  if (!taskInput.success || !draft.success) {
    fail("configuration_draft_compile_input_invalid");
  }

  let validatedDraft: BuilderConfigurationDraftOutput;
  try {
    validatedDraft = validateConfigurationDraftOutput(
      taskInput.data,
      draft.data,
    );
  } catch {
    fail("configuration_draft_compile_input_invalid");
  }

  const snapshot = configurationSnapshotV1Schema.safeParse(envelope.snapshot);
  if (!snapshot.success) {
    fail("configuration_draft_compile_snapshot_invalid");
  }

  const parsedCompilerInput = configurationDraftCompilerInputSchema.safeParse({
    taskInput: taskInput.data,
    draft: draft.data,
    snapshot: snapshot.data,
  });
  if (!parsedCompilerInput.success) {
    fail("configuration_draft_compile_input_invalid");
  }

  try {
    return new ConfigurationDraftCompiler(
      parsedCompilerInput.data.taskInput,
      validatedDraft,
      parsedCompilerInput.data.snapshot,
    ).compile();
  } catch (error) {
    if (error instanceof ConfigurationDraftCompilerError) {
      throw error;
    }
    fail("configuration_draft_compile_operations_invalid");
  }
}

export const compileConfigurationDraftV1 = compileConfigurationDraft;
