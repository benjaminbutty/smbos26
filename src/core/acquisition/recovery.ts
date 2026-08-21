import {
  setFormOperationSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../configuration/schemas";
import { formConfigSchema, parseViewConfig } from "../experience/schemas";
import {
  AcquisitionCandidateQualityError,
  acquisitionCandidateQualityCodes,
  findAcquisitionCandidateMechanicalRepairAnalysis,
  type AcquisitionCandidateQualityCode,
} from "./quality";
import {
  acquisitionBuildPayloadSchema,
  type AcquisitionBuildPayload,
} from "./schemas";
import {
  acquisitionRequiredIdentityRepairManifestSchema,
  acquisitionScopedFieldRepairOutputSchema,
  type AcquisitionRequiredIdentityRepairManifest,
  AcquisitionScopedRepairManifestError,
} from "./scoped-repair";

export const acquisitionRecoverableQualityCodes = [
  "cross_object_field_leakage",
  "relationship_scalar_duplication",
  "semantically_redundant_field",
] as const;

export type AcquisitionRecoverableQualityCode =
  (typeof acquisitionRecoverableQualityCodes)[number];

export type AcquisitionRecoveryResult = Readonly<{
  payload: AcquisitionBuildPayload;
  code: AcquisitionRecoverableQualityCode;
  removed_field_count: number;
}>;

export const acquisitionRecoveryFailureCodes = [
  "no_mechanical_repair_fields",
  "required_field",
  "form_would_be_invalid",
  "view_would_be_invalid",
  "repaired_candidate_invalid",
] as const;

export type AcquisitionRecoveryFailureCode =
  | (typeof acquisitionRecoveryFailureCodes)[number]
  | `second_quality_failure:${AcquisitionCandidateQualityCode}`;

export type AcquisitionRecoveryAttempt =
  | Readonly<{ status: "not_applicable" }>
  | Readonly<{
      status: "refused";
      failure_code: (typeof acquisitionRecoveryFailureCodes)[number];
    }>
  | Readonly<{ status: "recovered"; recovery: AcquisitionRecoveryResult }>;

export type AcquisitionRecoveryDiagnostics = Readonly<{
  quality_flagged_field_count: number;
  mechanical_repair_field_count: number;
  related_field_equivalence_match_count: number;
}>;

export type AnalyzedAcquisitionRecoveryAttempt = Readonly<{
  attempt: AcquisitionRecoveryAttempt;
  diagnostics: AcquisitionRecoveryDiagnostics;
}>;

const emptyRecoveryDiagnostics: AcquisitionRecoveryDiagnostics = Object.freeze({
  quality_flagged_field_count: 0,
  mechanical_repair_field_count: 0,
  related_field_equivalence_match_count: 0,
});

const recoverableQualityCodeSet = new Set<string>(
  acquisitionRecoverableQualityCodes,
);

function fieldIdentity(objectKey: string, fieldKey: string): string {
  return `${objectKey}:${fieldKey}`;
}

function remainingFieldKeys(
  operations: readonly ConfigurationOperation[],
  objectKey: string,
  removedFields: ReadonlySet<string>,
): string[] {
  return operations
    .filter(
      (
        operation,
      ): operation is Extract<ConfigurationOperation, { op: "set_field" }> =>
        operation.op === "set_field" &&
        operation.object_key === objectKey &&
        operation.is_active &&
        !removedFields.has(fieldIdentity(operation.object_key, operation.key)),
    )
    .map((operation) => operation.key);
}

function removeFieldsFromForm(
  operation: Extract<ConfigurationOperation, { op: "set_form" }>,
  removedFields: ReadonlySet<string>,
): Extract<ConfigurationOperation, { op: "set_form" }> | null {
  const config = formConfigSchema.parse(operation.config_json);
  const fields = config.fields.filter(
    (field) =>
      !removedFields.has(fieldIdentity(operation.object_key, field.field)),
  );
  if (fields.length === 0) return null;
  return setFormOperationSchema.parse({
    ...operation,
    config_json: formConfigSchema.parse({ ...config, fields }),
  });
}

function removeFieldsFromView(
  operation: Extract<ConfigurationOperation, { op: "set_view" }>,
  operations: readonly ConfigurationOperation[],
  removedFields: ReadonlySet<string>,
): Extract<ConfigurationOperation, { op: "set_view" }> | null {
  const config = parseViewConfig(operation.view_type, operation.config_json);
  const availableFields = remainingFieldKeys(
    operations,
    operation.object_key,
    removedFields,
  );
  if (availableFields.length === 0) return null;

  if (operation.view_type === "table" && "columns" in config) {
    const touchesView = config.columns.some(
      (column) =>
        column.kind === "field" &&
        removedFields.has(
          fieldIdentity(operation.object_key, column.field_key),
        ),
    );
    if (!touchesView) return operation;
    const columns = config.columns.filter(
      (column) =>
        column.kind !== "field" ||
        !removedFields.has(
          fieldIdentity(operation.object_key, column.field_key),
        ),
    );
    const fieldColumns = columns.filter(
      (column): column is Extract<typeof column, { kind: "field" }> =>
        column.kind === "field",
    );
    if (fieldColumns.length === 0) return null;
    const titleField = removedFields.has(
      fieldIdentity(operation.object_key, config.title_field),
    )
      ? fieldColumns[0]!.field_key
      : config.title_field;
    return setViewOperationSchema.parse({
      ...operation,
      config_json: {
        ...config,
        columns,
        fields: fieldColumns.map((column) => column.field_key),
        title_field: titleField,
      },
    });
  }

  if (operation.view_type === "table" && "fields" in config) {
    const touchesView = config.fields.some((field) =>
      removedFields.has(fieldIdentity(operation.object_key, field)),
    );
    if (!touchesView) return operation;
    const fields = config.fields.filter(
      (field) => !removedFields.has(fieldIdentity(operation.object_key, field)),
    );
    if (fields.length === 0) return null;
    return setViewOperationSchema.parse({
      ...operation,
      config_json: {
        ...config,
        fields,
        title_field:
          config.title_field &&
          !removedFields.has(
            fieldIdentity(operation.object_key, config.title_field),
          )
            ? config.title_field
            : fields[0],
      },
    });
  }

  if (operation.view_type === "list" && "primary_field" in config) {
    const touchesView =
      removedFields.has(
        fieldIdentity(operation.object_key, config.primary_field),
      ) ||
      config.secondary_fields.some((field) =>
        removedFields.has(fieldIdentity(operation.object_key, field)),
      );
    if (!touchesView) return operation;
    const primaryField = removedFields.has(
      fieldIdentity(operation.object_key, config.primary_field),
    )
      ? availableFields[0]!
      : config.primary_field;
    return setViewOperationSchema.parse({
      ...operation,
      config_json: {
        ...config,
        primary_field: primaryField,
        secondary_fields: config.secondary_fields.filter(
          (field) =>
            !removedFields.has(fieldIdentity(operation.object_key, field)),
        ),
      },
    });
  }

  if (operation.view_type === "cards" && "supporting_fields" in config) {
    const touchesView =
      removedFields.has(
        fieldIdentity(operation.object_key, config.title_field),
      ) ||
      (config.subtitle_field !== undefined &&
        removedFields.has(
          fieldIdentity(operation.object_key, config.subtitle_field),
        )) ||
      (config.image_field !== undefined &&
        removedFields.has(
          fieldIdentity(operation.object_key, config.image_field),
        )) ||
      config.supporting_fields.some((field) =>
        removedFields.has(fieldIdentity(operation.object_key, field)),
      );
    if (!touchesView) return operation;
    const titleField = removedFields.has(
      fieldIdentity(operation.object_key, config.title_field),
    )
      ? availableFields[0]!
      : config.title_field;
    return setViewOperationSchema.parse({
      ...operation,
      config_json: {
        ...config,
        title_field: titleField,
        ...(config.subtitle_field
          ? {
              subtitle_field: removedFields.has(
                fieldIdentity(operation.object_key, config.subtitle_field),
              )
                ? undefined
                : config.subtitle_field,
            }
          : {}),
        ...(config.image_field
          ? {
              image_field: removedFields.has(
                fieldIdentity(operation.object_key, config.image_field),
              )
                ? undefined
                : config.image_field,
            }
          : {}),
        supporting_fields: config.supporting_fields.filter(
          (field) =>
            !removedFields.has(fieldIdentity(operation.object_key, field)),
        ),
      },
    });
  }

  if (operation.view_type === "detail" && "fields" in config) {
    const touchesView = config.fields.some((field) =>
      removedFields.has(fieldIdentity(operation.object_key, field)),
    );
    if (!touchesView) return operation;
    const fields = config.fields.filter(
      (field) => !removedFields.has(fieldIdentity(operation.object_key, field)),
    );
    if (fields.length === 0) return null;
    return setViewOperationSchema.parse({
      ...operation,
      config_json: {
        ...config,
        fields,
        ...(config.title_field
          ? {
              title_field: removedFields.has(
                fieldIdentity(operation.object_key, config.title_field),
              )
                ? fields[0]
                : config.title_field,
            }
          : {}),
      },
    });
  }

  return operation;
}

function updateTrackedInformation(
  payload: AcquisitionBuildPayload,
  removedFields: ReadonlySet<string>,
): AcquisitionBuildPayload["proposal"] {
  const objects = new Map(
    payload.operations
      .filter(
        (
          operation,
        ): operation is Extract<ConfigurationOperation, { op: "set_object" }> =>
          operation.op === "set_object" && operation.is_active,
      )
      .map((operation) => [operation.key, operation]),
  );
  const removedLabels = new Map<string, Set<string>>();
  for (const operation of payload.operations) {
    if (operation.op !== "set_field" || !operation.is_active) continue;
    if (
      !removedFields.has(fieldIdentity(operation.object_key, operation.key))
    ) {
      continue;
    }
    const labels = removedLabels.get(operation.object_key) ?? new Set<string>();
    labels.add(
      operation.label.normalize("NFKC").trim().toLocaleLowerCase("en"),
    );
    removedLabels.set(operation.object_key, labels);
  }

  return {
    ...payload.proposal,
    concepts: payload.proposal.concepts.map((concept) => {
      const object = [...objects.values()].find(
        (candidate) =>
          candidate.plural_label === concept.name ||
          candidate.singular_label === concept.name,
      );
      if (!object) return concept;
      const labels = removedLabels.get(object.key);
      if (!labels) return concept;
      return {
        ...concept,
        tracked_information: concept.tracked_information.filter(
          (label) =>
            !labels.has(label.normalize("NFKC").trim().toLocaleLowerCase("en")),
        ),
      };
    }),
  };
}

function removeRedundantFields(
  payload: AcquisitionBuildPayload,
  removedFields: ReadonlySet<string>,
  options: Readonly<{ allowRequiredFields?: boolean }> = {},
):
  | Readonly<{ status: "repaired"; payload: AcquisitionBuildPayload }>
  | Extract<AcquisitionRecoveryAttempt, { status: "refused" }> {
  const remainingObjects = new Set(
    payload.operations
      .filter(
        (
          operation,
        ): operation is Extract<ConfigurationOperation, { op: "set_object" }> =>
          operation.op === "set_object" && operation.is_active,
      )
      .map((operation) => operation.key),
  );
  const nextOperations: ConfigurationOperation[] = [];

  try {
    for (const operation of payload.operations) {
      if (
        operation.op === "set_field" &&
        removedFields.has(fieldIdentity(operation.object_key, operation.key))
      ) {
        if (operation.required && !options.allowRequiredFields) {
          return { status: "refused", failure_code: "required_field" };
        }
        continue;
      }
      if (operation.op === "set_form") {
        const next = removeFieldsFromForm(operation, removedFields);
        if (!next) {
          return {
            status: "refused",
            failure_code: "form_would_be_invalid",
          };
        }
        nextOperations.push(next);
        continue;
      }
      if (operation.op === "set_view") {
        const next = removeFieldsFromView(
          operation,
          payload.operations,
          removedFields,
        );
        if (!next) {
          return {
            status: "refused",
            failure_code: "view_would_be_invalid",
          };
        }
        nextOperations.push(next);
        continue;
      }
      nextOperations.push(operation);
    }

    if (remainingObjects.size === 0) {
      return {
        status: "refused",
        failure_code: "repaired_candidate_invalid",
      };
    }
    return {
      status: "repaired",
      payload: acquisitionBuildPayloadSchema.parse({
        proposal: updateTrackedInformation(payload, removedFields),
        operations: nextOperations,
      }),
    };
  } catch {
    return {
      status: "refused",
      failure_code: "repaired_candidate_invalid",
    };
  }
}

export function analyzeAcquisitionCandidateRecovery(
  payloadInput: unknown,
  error: unknown,
): AnalyzedAcquisitionRecoveryAttempt {
  if (!(error instanceof AcquisitionCandidateQualityError)) {
    return {
      attempt: { status: "not_applicable" },
      diagnostics: emptyRecoveryDiagnostics,
    };
  }
  if (!recoverableQualityCodeSet.has(error.code)) {
    return {
      attempt: { status: "not_applicable" },
      diagnostics: emptyRecoveryDiagnostics,
    };
  }

  const code = error.code as AcquisitionRecoverableQualityCode;
  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  const analysis = findAcquisitionCandidateMechanicalRepairAnalysis(
    payload,
    code,
  );
  const fields = analysis.fields;
  const diagnostics = Object.freeze({
    quality_flagged_field_count: analysis.quality_flagged_field_count,
    mechanical_repair_field_count: analysis.mechanical_repair_field_count,
    related_field_equivalence_match_count:
      analysis.related_field_equivalence_match_count,
  });
  if (fields.length === 0) {
    return {
      attempt: {
        status: "refused",
        failure_code: "no_mechanical_repair_fields",
      },
      diagnostics,
    };
  }
  const removedFields = new Set(
    fields.map(({ object_key, key }) => fieldIdentity(object_key, key)),
  );
  const repaired = removeRedundantFields(payload, removedFields);
  if (repaired.status === "refused") {
    return { attempt: repaired, diagnostics };
  }
  return {
    attempt: {
      status: "recovered",
      recovery: Object.freeze({
        payload: repaired.payload,
        code,
        removed_field_count: fields.length,
      }),
    },
    diagnostics,
  };
}

export function attemptAcquisitionCandidateRecovery(
  payloadInput: unknown,
  error: unknown,
): AcquisitionRecoveryAttempt {
  return analyzeAcquisitionCandidateRecovery(payloadInput, error).attempt;
}

export function recoverAcquisitionCandidate(
  payloadInput: unknown,
  error: unknown,
): AcquisitionRecoveryResult | null {
  const attempt = attemptAcquisitionCandidateRecovery(payloadInput, error);
  return attempt.status === "recovered" ? attempt.recovery : null;
}

function assertManifestMatchesPayload(
  payload: AcquisitionBuildPayload,
  manifest: AcquisitionRequiredIdentityRepairManifest,
): void {
  if (manifest.owner_scope.category !== payload.proposal.category) {
    throw new AcquisitionScopedRepairManifestError("scope_invalid");
  }

  const objects = payload.operations
    .filter(
      (
        operation,
      ): operation is Extract<ConfigurationOperation, { op: "set_object" }> =>
        operation.op === "set_object" && operation.is_active,
    )
    .map(({ key, singular_label, plural_label }) => ({
      object_key: key,
      singular_label,
      plural_label,
    }));
  if (
    JSON.stringify(objects) !==
    JSON.stringify(manifest.owner_scope.business_areas)
  ) {
    throw new AcquisitionScopedRepairManifestError("scope_invalid");
  }

  const relationships = payload.operations
    .filter(
      (
        operation,
      ): operation is Extract<
        ConfigurationOperation,
        { op: "set_relationship" }
      > => operation.op === "set_relationship" && operation.is_active,
    )
    .map(
      ({
        key,
        source_object_key,
        target_object_key,
        source_label,
        target_label,
        cardinality,
      }) => ({
        relationship_key: key,
        source_object_key,
        target_object_key,
        source_label,
        target_label,
        cardinality,
      }),
    );
  if (
    JSON.stringify(relationships) !==
    JSON.stringify(manifest.owner_scope.connections)
  ) {
    throw new AcquisitionScopedRepairManifestError("scope_invalid");
  }
  if (
    JSON.stringify(payload.proposal.not_included) !==
    JSON.stringify(manifest.owner_scope.unsupported_requirements)
  ) {
    throw new AcquisitionScopedRepairManifestError("scope_invalid");
  }
}

/**
 * Apply only the model's allow-listed Field removals, then return the
 * candidate for the caller's complete authoritative validation pass.
 */
export function applyAcquisitionScopedFieldRepair(
  payloadInput: unknown,
  manifestInput: unknown,
  outputInput: unknown,
): AcquisitionBuildPayload {
  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  const manifest =
    acquisitionRequiredIdentityRepairManifestSchema.parse(manifestInput);
  const output = acquisitionScopedFieldRepairOutputSchema.parse(outputInput);
  assertManifestMatchesPayload(payload, manifest);

  const allowedFields = new Map(
    manifest.affected_fields.map((field) => [
      fieldIdentity(field.object_key, field.field_key),
      field,
    ]),
  );
  const removedFields = new Set<string>();
  for (const field of output.fields) {
    const identity = fieldIdentity(field.object_key, field.field_key);
    if (!allowedFields.has(identity)) {
      throw new AcquisitionScopedRepairManifestError("scope_invalid");
    }
    removedFields.add(identity);
  }

  const repaired = removeRedundantFields(payload, removedFields, {
    allowRequiredFields: true,
  });
  if (repaired.status === "refused") {
    throw new AcquisitionScopedRepairManifestError("scope_invalid");
  }
  return acquisitionBuildPayloadSchema.parse(repaired.payload);
}

export function isAcquisitionRecoveryQualityCode(
  value: string,
): value is AcquisitionRecoverableQualityCode {
  return recoverableQualityCodeSet.has(value);
}

export function isAcquisitionRecoveryFailureCode(
  value: string,
): value is AcquisitionRecoveryFailureCode {
  if (acquisitionRecoveryFailureCodes.includes(value as never)) return true;
  if (!value.startsWith("second_quality_failure:")) return false;
  const qualityCode = value.slice("second_quality_failure:".length);
  return acquisitionCandidateQualityCodes.includes(qualityCode as never);
}
