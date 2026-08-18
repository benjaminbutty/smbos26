import { isDeepStrictEqual } from "node:util";

import { pageLayoutSchema, parseViewConfig } from "../experience/schemas";
import {
  setFormOperationSchema,
  setPageOperationSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../configuration/schemas";
import {
  isScalarConnectionDuplicate,
  removeSemanticallyRedundantIdentityFields,
  validateAcquisitionCandidate,
} from "./quality";
import {
  acquisitionBuildPayloadSchema,
  type AcquisitionBuildPayload,
  type AcquisitionProposal,
  type AcquisitionRefinementSummary,
} from "./schemas";

type ObjectOperation = Extract<ConfigurationOperation, { op: "set_object" }>;
type FieldOperation = Extract<ConfigurationOperation, { op: "set_field" }>;
type RelationshipOperation = Extract<
  ConfigurationOperation,
  { op: "set_relationship" }
>;
type ViewOperation = Extract<ConfigurationOperation, { op: "set_view" }>;
type FormOperation = Extract<ConfigurationOperation, { op: "set_form" }>;

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "area",
  "before",
  "between",
  "change",
  "changes",
  "each",
  "for",
  "from",
  "have",
  "into",
  "keep",
  "making",
  "need",
  "needs",
  "new",
  "of",
  "on",
  "column",
  "columns",
  "connection",
  "connections",
  "field",
  "fields",
  "form",
  "forms",
  "object",
  "objects",
  "page",
  "pages",
  "relationship",
  "relationships",
  "table",
  "tables",
  "view",
  "views",
  "please",
  "separate",
  "should",
  "the",
  "to",
  "want",
  "with",
]);

function normalise(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

function tokens(value: string): string[] {
  return normalise(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function operationKey(operation: ConfigurationOperation): string {
  switch (operation.op) {
    case "set_object":
      return `object:${operation.key}`;
    case "set_field":
      return `field:${operation.object_key}:${operation.key}`;
    case "set_relationship":
      return `relationship:${operation.key}`;
    case "set_view":
      return `view:${operation.key}`;
    case "set_form":
      return `form:${operation.key}`;
    case "set_page":
      return `page:${operation.key}`;
    case "set_preorder_experience":
      return `preorder:${operation.key}`;
  }
}

function operationObjects(
  operations: readonly ConfigurationOperation[],
): ReadonlyMap<string, ObjectOperation> {
  return new Map(
    operations
      .filter(
        (operation): operation is ObjectOperation =>
          operation.op === "set_object",
      )
      .map((operation) => [operation.key, operation]),
  );
}

function operationSearchText(
  operation: ConfigurationOperation,
  objects: ReadonlyMap<string, ObjectOperation>,
): string {
  switch (operation.op) {
    case "set_object":
      return [
        operation.key,
        operation.singular_label,
        operation.plural_label,
      ].join(" ");
    case "set_field":
      return [
        operation.object_key,
        objects.get(operation.object_key)?.singular_label ?? "",
        operation.key,
        operation.label,
      ].join(" ");
    case "set_relationship":
      return [
        operation.key,
        operation.source_object_key,
        operation.target_object_key,
        objects.get(operation.source_object_key)?.singular_label ?? "",
        objects.get(operation.target_object_key)?.singular_label ?? "",
        operation.source_label,
        operation.target_label,
      ].join(" ");
    case "set_view":
      return [operation.key, operation.name, operation.object_key].join(" ");
    case "set_form":
      return [operation.key, operation.name, operation.object_key].join(" ");
    case "set_page":
      return [operation.key, operation.title, operation.slug].join(" ");
    case "set_preorder_experience":
      return operation.key;
  }
}

function operationMatchesTerms(
  operation: ConfigurationOperation,
  terms: ReadonlySet<string>,
  objects: ReadonlyMap<string, ObjectOperation>,
): boolean {
  return tokens(operationSearchText(operation, objects)).some((token) =>
    terms.has(token),
  );
}

function allowsDirectObjectUpdate(
  operation: ConfigurationOperation,
  refinement: string,
): boolean {
  return (
    operation.op !== "set_object" ||
    /\b(?:rename|renamed|call|label|name|singular|plural)\b/i.test(refinement)
  );
}

function removalSelectors(refinement: string): string[] {
  const selectors: string[] = [];
  const patterns = [
    /\b(?:remove|delete|drop|archive|without|no longer need|don['’]t need|do not need)\b([^.!?;]+)/gi,
    /\breplace\b([^.!?;]+?)\s+with\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of refinement.matchAll(pattern)) {
      const selector = match[1]?.trim();
      if (selector) selectors.push(selector);
    }
  }
  return selectors;
}

function selectorMatchesOperation(
  selector: string,
  operation: ConfigurationOperation,
  objects: ReadonlyMap<string, ObjectOperation>,
): boolean {
  const selectorTokens = unique(tokens(selector));
  if (selectorTokens.length === 0) return false;
  const operationTokens = new Set(
    tokens(operationSearchText(operation, objects)),
  );
  const matches = selectorTokens.filter((token) => operationTokens.has(token));
  return matches.length >= Math.min(2, selectorTokens.length);
}

function operationReferences(
  operation: ConfigurationOperation,
  keys: ReadonlySet<string>,
): boolean {
  const text = JSON.stringify(operation);
  return [...keys].some((key) => text.includes(`"${key}"`));
}

function removeExplicitOperations(
  operations: readonly ConfigurationOperation[],
  selectors: readonly string[],
): { operations: ConfigurationOperation[]; removedKeys: Set<string> } {
  if (selectors.length === 0)
    return { operations: [...operations], removedKeys: new Set() };
  const objects = operationObjects(operations);
  const removedKeys = new Set<string>();
  for (const operation of operations) {
    if (
      selectors.some((selector) =>
        selectorMatchesOperation(selector, operation, objects),
      )
    ) {
      removedKeys.add(operationKey(operation));
    }
  }

  const removedObjectKeys = new Set(
    operations
      .filter(
        (operation): operation is ObjectOperation =>
          operation.op === "set_object",
      )
      .filter((operation) => removedKeys.has(operationKey(operation)))
      .map((operation) => operation.key),
  );
  const removedFieldKeys = new Set(
    operations
      .filter(
        (operation): operation is FieldOperation =>
          operation.op === "set_field",
      )
      .filter((operation) => removedKeys.has(operationKey(operation)))
      .map((operation) => `${operation.object_key}:${operation.key}`),
  );
  const removedRelationshipKeys = new Set(
    operations
      .filter(
        (operation): operation is RelationshipOperation =>
          operation.op === "set_relationship",
      )
      .filter((operation) => removedKeys.has(operationKey(operation)))
      .map((operation) => operation.key),
  );
  const removedFormKeys = new Set(
    operations
      .filter(
        (operation): operation is FormOperation => operation.op === "set_form",
      )
      .filter((operation) => removedKeys.has(operationKey(operation)))
      .map((operation) => operation.key),
  );
  const removedViewKeys = new Set(
    operations
      .filter(
        (operation): operation is ViewOperation => operation.op === "set_view",
      )
      .filter((operation) => removedKeys.has(operationKey(operation)))
      .map((operation) => operation.key),
  );

  const result: ConfigurationOperation[] = [];
  for (const operation of operations) {
    if (removedKeys.has(operationKey(operation))) continue;
    if (
      operation.op === "set_field" &&
      removedObjectKeys.has(operation.object_key)
    )
      continue;
    if (
      operation.op === "set_relationship" &&
      (removedObjectKeys.has(operation.source_object_key) ||
        removedObjectKeys.has(operation.target_object_key))
    ) {
      removedKeys.add(operationKey(operation));
      continue;
    }
    if (
      (operation.op === "set_form" || operation.op === "set_view") &&
      removedObjectKeys.has(operation.object_key)
    ) {
      removedKeys.add(operationKey(operation));
      if (operation.op === "set_form") removedFormKeys.add(operation.key);
      if (operation.op === "set_view") removedViewKeys.add(operation.key);
      continue;
    }
    if (
      operation.op === "set_form" &&
      operation.config_json.fields.some((field) =>
        removedFieldKeys.has(`${operation.object_key}:${field.field}`),
      )
    ) {
      removedKeys.add(operationKey(operation));
      removedFormKeys.add(operation.key);
      continue;
    }
    if (operation.op === "set_view") {
      const config = parseViewConfig(
        operation.view_type,
        operation.config_json,
      );
      const usesRemovedField =
        ("fields" in config &&
          config.fields.some((field) =>
            removedFieldKeys.has(`${operation.object_key}:${field}`),
          )) ||
        ("title_field" in config &&
          config.title_field !== null &&
          removedFieldKeys.has(
            `${operation.object_key}:${config.title_field}`,
          )) ||
        ("columns" in config &&
          config.columns.some((column) =>
            column.kind === "field"
              ? removedFieldKeys.has(
                  `${operation.object_key}:${column.field_key}`,
                )
              : removedRelationshipKeys.has(column.relationship_key),
          ));
      if (usesRemovedField) {
        removedKeys.add(operationKey(operation));
        removedViewKeys.add(operation.key);
        continue;
      }
    }
    if (operation.op === "set_page") {
      const blocks = operation.layout_json.blocks.filter((block) => {
        if (block.type === "view") return !removedViewKeys.has(block.view_key);
        if (block.type === "form" || block.type === "public_form") {
          return !removedFormKeys.has(block.form_key);
        }
        return true;
      });
      if (blocks.length === 0) {
        removedKeys.add(operationKey(operation));
        continue;
      }
      result.push(
        setPageOperationSchema.parse({
          ...operation,
          layout_json: pageLayoutSchema.parse({ blocks }),
        }),
      );
      continue;
    }
    result.push(operation);
  }
  return { operations: result, removedKeys };
}

function addDependencies(
  selected: Set<string>,
  operations: readonly ConfigurationOperation[],
  existingObjectKeys: ReadonlySet<string> = new Set(),
): void {
  let changed = true;
  while (changed) {
    changed = false;
    const selectedOperations = operations.filter((operation) =>
      selected.has(operationKey(operation)),
    );
    const selectedObjects = new Set<string>();
    const selectedFields = new Set<string>();
    const requiredFields = new Set<string>();
    const selectedRelationships = new Set<string>();
    const selectedForms = new Set<string>();
    const selectedViews = new Set<string>();
    const requiredObjects = new Set<string>();
    for (const operation of selectedOperations) {
      if (operation.op === "set_object") selectedObjects.add(operation.key);
      if (operation.op === "set_field") {
        selectedFields.add(`${operation.object_key}:${operation.key}`);
        requiredObjects.add(operation.object_key);
      }
      if (operation.op === "set_relationship") {
        selectedRelationships.add(operation.key);
        requiredObjects.add(operation.source_object_key);
        requiredObjects.add(operation.target_object_key);
      }
      if (operation.op === "set_form") {
        selectedForms.add(operation.key);
        requiredObjects.add(operation.object_key);
        for (const field of operation.config_json.fields) {
          requiredFields.add(`${operation.object_key}:${field.field}`);
        }
      }
      if (operation.op === "set_view") {
        selectedViews.add(operation.key);
        requiredObjects.add(operation.object_key);
        const config = parseViewConfig(
          operation.view_type,
          operation.config_json,
        );
        if ("fields" in config) {
          for (const field of config.fields) {
            requiredFields.add(`${operation.object_key}:${field}`);
          }
        }
        if ("title_field" in config && config.title_field) {
          requiredFields.add(`${operation.object_key}:${config.title_field}`);
        }
        if ("columns" in config) {
          for (const column of config.columns) {
            if (column.kind === "field") {
              requiredFields.add(`${operation.object_key}:${column.field_key}`);
            }
          }
        }
      }
      if (operation.op === "set_page") {
        for (const block of operation.layout_json.blocks) {
          if (block.type !== "booking") continue;
          requiredObjects.add(block.config.booking_object_key);
          requiredObjects.add(block.config.customer_object_key);
          if (block.config.subject_object_key)
            requiredObjects.add(block.config.subject_object_key);
          if (block.config.service_object_key)
            requiredObjects.add(block.config.service_object_key);
        }
      }
    }
    for (const operation of operations) {
      if (selected.has(operationKey(operation))) continue;
      const depends =
        (operation.op === "set_object" &&
          requiredObjects.has(operation.key) &&
          !existingObjectKeys.has(operation.key)) ||
        (operation.op === "set_field" &&
          (selectedObjects.has(operation.object_key) ||
            requiredFields.has(`${operation.object_key}:${operation.key}`))) ||
        ((operation.op === "set_form" || operation.op === "set_view") &&
          selectedObjects.has(operation.object_key)) ||
        (operation.op === "set_relationship" &&
          (selectedObjects.has(operation.source_object_key) ||
            selectedObjects.has(operation.target_object_key))) ||
        (operation.op === "set_form" &&
          operation.config_json.fields.some((field) =>
            selectedFields.has(`${operation.object_key}:${field.field}`),
          )) ||
        (operation.op === "set_view" &&
          operationReferences(
            operation,
            new Set([
              ...selectedFields,
              ...selectedRelationships,
              ...selectedForms,
            ]),
          )) ||
        (operation.op === "set_page" &&
          operationReferences(
            operation,
            new Set([...selectedViews, ...selectedForms]),
          ));
      if (depends) {
        selected.add(operationKey(operation));
        changed = true;
      }
    }
  }
}

function pruneRedundantSuggestedFields(
  current: readonly ConfigurationOperation[],
  suggested: readonly ConfigurationOperation[],
  selected: Set<string>,
): void {
  const currentObjects = operationObjects(current);
  const currentFields = new Map<string, FieldOperation[]>();
  for (const operation of current) {
    if (operation.op !== "set_field" || !operation.is_active) continue;
    const fields = currentFields.get(operation.object_key) ?? [];
    fields.push(operation);
    currentFields.set(operation.object_key, fields);
  }

  const redundantFieldKeys = new Set<string>();
  const retainedFields = new Map(
    [...currentFields].map(([objectKey, fields]) => [objectKey, [...fields]]),
  );
  for (const operation of suggested) {
    if (
      operation.op !== "set_field" ||
      !operation.is_active ||
      !selected.has(operationKey(operation)) ||
      current.some(
        (currentOperation) =>
          operationKey(currentOperation) === operationKey(operation),
      )
    ) {
      continue;
    }
    const object = currentObjects.get(operation.object_key);
    if (!object) continue;
    const fields = retainedFields.get(operation.object_key) ?? [];
    const nextFields = [...fields, operation];
    if (
      removeSemanticallyRedundantIdentityFields(object, nextFields).length <
      nextFields.length
    ) {
      redundantFieldKeys.add(operationKey(operation));
      continue;
    }
    fields.push(operation);
    retainedFields.set(operation.object_key, fields);
  }

  if (redundantFieldKeys.size === 0) return;
  for (const key of redundantFieldKeys) selected.delete(key);

  const removedFields = new Set(
    [...redundantFieldKeys].map((key) => key.slice("field:".length)),
  );
  const surfacesToDrop = new Set<string>();
  for (const operation of suggested) {
    const operationKeyValue = operationKey(operation);
    if (!selected.has(operationKeyValue)) continue;
    if (operation.op === "set_form") {
      const referencesRemovedField = operation.config_json.fields.some(
        (field) => removedFields.has(`${operation.object_key}:${field.field}`),
      );
      if (referencesRemovedField) {
        selected.delete(operationKeyValue);
        surfacesToDrop.add(operationKeyValue);
      }
    } else if (operation.op === "set_view") {
      const config = parseViewConfig(
        operation.view_type,
        operation.config_json,
      );
      const referencesRemovedField =
        ("fields" in config &&
          config.fields.some((field) =>
            removedFields.has(`${operation.object_key}:${field}`),
          )) ||
        ("title_field" in config &&
          config.title_field !== null &&
          removedFields.has(`${operation.object_key}:${config.title_field}`)) ||
        ("columns" in config &&
          config.columns.some(
            (column) =>
              column.kind === "field" &&
              removedFields.has(`${operation.object_key}:${column.field_key}`),
          ));
      if (referencesRemovedField) {
        selected.delete(operationKeyValue);
        surfacesToDrop.add(operationKeyValue);
      }
    }
  }
  for (const operation of suggested) {
    const operationKeyValue = operationKey(operation);
    if (
      operation.op === "set_page" &&
      selected.has(operationKeyValue) &&
      operationReferences(operation, surfacesToDrop)
    ) {
      selected.delete(operationKeyValue);
    }
  }
}

function removeRelationshipScalarDuplicates(
  operations: readonly ConfigurationOperation[],
  relationshipKeysToCheck: ReadonlySet<string>,
): ConfigurationOperation[] {
  const objects = operationObjects(operations);
  const relationships = operations.filter(
    (operation): operation is RelationshipOperation =>
      operation.op === "set_relationship" && operation.is_active,
  );
  const duplicateFieldKeys = new Set<string>();
  for (const relationship of relationships) {
    if (!relationshipKeysToCheck.has(operationKey(relationship))) continue;
    const source = objects.get(relationship.source_object_key);
    const target = objects.get(relationship.target_object_key);
    if (!source || !target) continue;
    for (const operation of operations) {
      if (operation.op !== "set_field" || !operation.is_active) continue;
      if (
        (operation.object_key === source.key &&
          isScalarConnectionDuplicate(operation, target)) ||
        (operation.object_key === target.key &&
          isScalarConnectionDuplicate(operation, source))
      ) {
        duplicateFieldKeys.add(operationKey(operation));
      }
    }
  }
  if (duplicateFieldKeys.size === 0) return [...operations];

  const removedFormKeys = new Set<string>();
  const removedViewKeys = new Set<string>();
  const firstPass: ConfigurationOperation[] = [];
  for (const operation of operations) {
    if (operation.op === "set_field") {
      if (!duplicateFieldKeys.has(operationKey(operation))) {
        firstPass.push(operation);
      }
      continue;
    }
    if (operation.op === "set_form") {
      const remainingFields = operation.config_json.fields.filter(
        (field) =>
          !duplicateFieldKeys.has(
            operationKey({
              op: "set_field",
              object_key: operation.object_key,
              key: field.field,
              label: "",
              field_type: "short_text",
              required: false,
              default_value: null,
              settings_json: {},
              position: 0,
              is_active: true,
            }),
          ),
      );
      if (remainingFields.length === 0) {
        removedFormKeys.add(operation.key);
        continue;
      }
      if (remainingFields.length !== operation.config_json.fields.length) {
        firstPass.push(
          setFormOperationSchema.parse({
            ...operation,
            config_json: {
              ...operation.config_json,
              fields: remainingFields,
            },
          }),
        );
      } else {
        firstPass.push(operation);
      }
      continue;
    }
    if (operation.op === "set_view") {
      const config = parseViewConfig(
        operation.view_type,
        operation.config_json,
      );
      const referencesDuplicate =
        ("fields" in config &&
          config.fields.some((field) =>
            duplicateFieldKeys.has(`field:${operation.object_key}:${field}`),
          )) ||
        ("title_field" in config &&
          duplicateFieldKeys.has(
            `field:${operation.object_key}:${config.title_field}`,
          )) ||
        ("columns" in config &&
          config.columns.some(
            (column) =>
              column.kind === "field" &&
              duplicateFieldKeys.has(
                `field:${operation.object_key}:${column.field_key}`,
              ),
          ));
      if (referencesDuplicate) {
        removedViewKeys.add(operation.key);
        continue;
      }
    }
    firstPass.push(operation);
  }

  return firstPass.flatMap<ConfigurationOperation>((operation) => {
    if (operation.op !== "set_page") return [operation];
    const blocks = operation.layout_json.blocks.filter((block) => {
      if (block.type === "view") return !removedViewKeys.has(block.view_key);
      if (block.type === "form" || block.type === "public_form") {
        return !removedFormKeys.has(block.form_key);
      }
      return true;
    });
    if (blocks.length === 0) return [];
    if (blocks.length === operation.layout_json.blocks.length)
      return [operation];
    return [
      setPageOperationSchema.parse({
        ...operation,
        layout_json: pageLayoutSchema.parse({ blocks }),
      }),
    ];
  });
}

function includeRequiredFieldsInRetainedForms(
  operations: readonly ConfigurationOperation[],
  suggested: readonly ConfigurationOperation[],
): {
  operations: ConfigurationOperation[];
  updatedFormKeys: Set<string>;
} {
  const requiredFieldsByObject = new Map<string, FieldOperation[]>();
  for (const operation of operations) {
    if (
      operation.op !== "set_field" ||
      !operation.is_active ||
      !operation.required
    ) {
      continue;
    }
    const fields = requiredFieldsByObject.get(operation.object_key) ?? [];
    fields.push(operation);
    requiredFieldsByObject.set(operation.object_key, fields);
  }

  const suggestedForms = suggested.filter(
    (operation): operation is FormOperation =>
      operation.op === "set_form" && operation.is_active,
  );
  const updatedFormKeys = new Set<string>();
  const reconciled = operations.map((operation) => {
    if (operation.op !== "set_form" || !operation.is_active) return operation;
    const requiredFields = requiredFieldsByObject.get(operation.object_key);
    if (!requiredFields) return operation;

    const presentFields = new Set(
      operation.config_json.fields.map((entry) => entry.field),
    );
    const missingFields = requiredFields.filter(
      (field) => !presentFields.has(field.key),
    );
    if (missingFields.length === 0) return operation;

    const matchingSuggestedForms = suggestedForms.filter(
      (form) => form.object_key === operation.object_key,
    );
    const fields = [...operation.config_json.fields];
    for (const field of missingFields) {
      const suggestedEntry = matchingSuggestedForms
        .flatMap((form) => form.config_json.fields)
        .find((entry) => entry.field === field.key);
      fields.push(suggestedEntry ?? { field: field.key, hidden: false });
    }
    updatedFormKeys.add(operationKey(operation));
    return setFormOperationSchema.parse({
      ...operation,
      config_json: { ...operation.config_json, fields },
    });
  });

  return { operations: reconciled, updatedFormKeys };
}

function mergeOperations(
  current: readonly ConfigurationOperation[],
  suggested: readonly ConfigurationOperation[],
  refinement: string,
): {
  operations: ConfigurationOperation[];
  summary: AcquisitionRefinementSummary;
} {
  const selectors = removalSelectors(refinement);
  const removed = removeExplicitOperations(current, selectors);
  const currentByKey = new Map(
    current.map((operation) => [operationKey(operation), operation]),
  );
  const suggestedObjects = operationObjects(suggested);
  const refinementTerms = new Set(tokens(refinement));
  const selectedAdditions = new Set<string>();
  for (const operation of suggested) {
    const key = operationKey(operation);
    const selectedByRefinement = operationMatchesTerms(
      operation,
      refinementTerms,
      suggestedObjects,
    );
    if (
      selectedByRefinement &&
      (!currentByKey.has(key) ||
        (operation.op !== "set_relationship" &&
          allowsDirectObjectUpdate(operation, refinement)))
    ) {
      selectedAdditions.add(key);
    }
  }
  addDependencies(
    selectedAdditions,
    suggested,
    new Set(
      current
        .filter(
          (operation): operation is ObjectOperation =>
            operation.op === "set_object" && operation.is_active,
        )
        .map((operation) => operation.key),
    ),
  );
  pruneRedundantSuggestedFields(current, suggested, selectedAdditions);

  const removedKeys = removed.removedKeys;
  const suggestedByKey = new Map(
    suggested.map((operation) => [operationKey(operation), operation]),
  );
  let merged: ConfigurationOperation[] = [];
  const updatedKeys = new Set<string>();
  for (const operation of removed.operations) {
    const key = operationKey(operation);
    const next = suggestedByKey.get(key);
    const directUpdate =
      next !== undefined &&
      next.op !== "set_relationship" &&
      operationMatchesTerms(next, refinementTerms, suggestedObjects) &&
      allowsDirectObjectUpdate(next, refinement);
    const dependentUpdate = selectedAdditions.has(key);
    if (
      next &&
      !removedKeys.has(key) &&
      !isDeepStrictEqual(operation, next) &&
      (directUpdate || dependentUpdate)
    ) {
      merged.push(next);
      updatedKeys.add(key);
    } else {
      merged.push(operation);
    }
  }
  for (const operation of suggested) {
    const key = operationKey(operation);
    if (
      !currentByKey.has(key) &&
      selectedAdditions.has(key) &&
      !removedKeys.has(key)
    ) {
      merged.push(operation);
    }
  }

  merged = removeRelationshipScalarDuplicates(
    merged,
    new Set(
      [...selectedAdditions].filter((key) => key.startsWith("relationship:")),
    ),
  );

  const requiredFieldReconciliation = includeRequiredFieldsInRetainedForms(
    merged,
    suggested,
  );
  merged = requiredFieldReconciliation.operations;
  for (const key of requiredFieldReconciliation.updatedFormKeys) {
    updatedKeys.add(key);
  }

  const currentKeys = new Set(current.map(operationKey));
  const mergedKeys = new Set(merged.map(operationKey));
  const added = merged
    .filter((operation) => !currentKeys.has(operationKey(operation)))
    .map((operation) => operationLabel(operation, operationObjects(merged)));
  const updated = merged
    .filter((operation) => updatedKeys.has(operationKey(operation)))
    .map((operation) => operationLabel(operation, operationObjects(merged)));
  const removedLabels = current
    .filter((operation) => !mergedKeys.has(operationKey(operation)))
    .map((operation) => operationLabel(operation, operationObjects(current)));
  const preservedCount = current.filter((operation) =>
    mergedKeys.has(operationKey(operation)),
  ).length;
  const summary: AcquisitionRefinementSummary = {
    headline:
      added.length > 0 || updated.length > 0 || removedLabels.length > 0
        ? "Updated only the areas you asked about."
        : "Kept your existing setup and found no unrelated changes.",
    added: unique(added).slice(0, 12),
    updated: unique(updated).slice(0, 12),
    removed: unique(removedLabels).slice(0, 12),
    preserved:
      preservedCount > 0
        ? ["Your other business areas and Connections stayed in place."]
        : [],
  };
  return { operations: merged, summary };
}

function operationLabel(
  operation: ConfigurationOperation,
  objects: ReadonlyMap<string, ObjectOperation>,
): string {
  switch (operation.op) {
    case "set_object":
      return operation.plural_label;
    case "set_field":
      return `${objects.get(operation.object_key)?.singular_label ?? operation.object_key}: ${operation.label}`;
    case "set_relationship":
      return `${objects.get(operation.source_object_key)?.singular_label ?? operation.source_object_key} ↔ ${objects.get(operation.target_object_key)?.singular_label ?? operation.target_object_key}`;
    case "set_view":
      return `View: ${operation.name}`;
    case "set_form":
      return `Form: ${operation.name}`;
    case "set_page":
      return `Page: ${operation.title}`;
    case "set_preorder_experience":
      return "Preorder experience";
  }
}

function mergeProposal(
  current: AcquisitionProposal,
  suggested: AcquisitionProposal,
  summary: AcquisitionRefinementSummary,
): AcquisitionProposal {
  const keep = <T extends { name: string }>(
    currentItems: readonly T[],
    suggestedItems: readonly T[],
  ): T[] => {
    const result = [...currentItems];
    const seen = new Set(result.map((item) => normalise(item.name)));
    for (const item of suggestedItems) {
      if (seen.has(normalise(item.name))) continue;
      result.push(item);
      seen.add(normalise(item.name));
    }
    return result.slice(0, 8);
  };
  const removedExact = (name: string, prefix?: string): boolean =>
    summary.removed.some(
      (item) =>
        normalise(item) === normalise(prefix ? `${prefix}: ${name}` : name),
    );
  const removedRelationshipPairs = summary.removed
    .filter((item) => item.includes("↔"))
    .map((item) =>
      item
        .split("↔")
        .map((part) => tokens(part)[0])
        .filter((value): value is string => Boolean(value)),
    );
  const connections = unique(
    [...current.connections, ...suggested.connections].map(
      (connection) => connection.text,
    ),
  )
    .filter((text) => {
      const lower = normalise(text);
      return !removedRelationshipPairs.some(
        (pair) =>
          pair.length === 2 &&
          pair.every(
            (endpoint) =>
              lower.includes(endpoint) || lower.includes(`${endpoint}s`),
          ),
      );
    })
    .map((text) => ({ text }))
    .slice(0, 10);
  const filteredConcepts = current.concepts
    .filter((concept) => !removedExact(concept.name))
    .map((concept) => {
      const conceptTokens = new Set(tokens(concept.name));
      const removedFields = summary.removed.flatMap((item) => {
        const separator = item.indexOf(":");
        if (separator < 0) return [];
        const objectTokens = tokens(item.slice(0, separator));
        if (!objectTokens.some((token) => conceptTokens.has(token))) return [];
        return [item.slice(separator + 1).trim()];
      });
      return {
        ...concept,
        tracked_information: concept.tracked_information.filter(
          (field) =>
            !removedFields.some((removedField) =>
              tokens(removedField).some((token) =>
                tokens(field).includes(token),
              ),
            ),
        ),
      };
    });
  const concepts = keep(
    filteredConcepts,
    suggested.concepts.filter((concept) => !removedExact(concept.name)),
  ).slice(0, 6);
  const pages = keep(
    current.pages.filter((page) => !removedExact(page.name, "Page")),
    suggested.pages.filter((page) => !removedExact(page.name, "Page")),
  ).slice(0, 3);
  const views = keep(
    current.views.filter((view) => !removedExact(view.name, "View")),
    suggested.views.filter((view) => !removedExact(view.name, "View")),
  );
  return {
    ...current,
    concepts,
    connections,
    views,
    pages,
    landing_page_key:
      pages.length > 0
        ? (current.landing_page_key ?? suggested.landing_page_key)
        : null,
    not_included: unique([
      ...current.not_included,
      ...suggested.not_included,
    ]).slice(0, 8),
    refinement_summary: summary,
  };
}

export function reconcileAcquisitionRefinement(
  currentInput: unknown,
  suggestedInput: unknown,
  refinementInput: unknown,
): AcquisitionBuildPayload {
  const current = acquisitionBuildPayloadSchema.parse(currentInput);
  const suggested = acquisitionBuildPayloadSchema.parse(suggestedInput);
  const refinement = String(refinementInput).trim();
  const merged = mergeOperations(
    current.operations,
    suggested.operations,
    refinement,
  );
  const operations = merged.operations.map((operation) => {
    if (operation.op !== "set_view" || operation.view_type !== "table")
      return operation;
    return setViewOperationSchema.parse({
      ...operation,
      config_json: parseViewConfig(operation.view_type, operation.config_json),
    });
  });
  return validateAcquisitionCandidate(
    acquisitionBuildPayloadSchema.parse({
      proposal: mergeProposal(
        current.proposal,
        suggested.proposal,
        merged.summary,
      ),
      operations,
    }),
  );
}
