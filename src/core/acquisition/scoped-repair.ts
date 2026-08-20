import { z } from "zod";

import {
  graphFieldTypeSchema,
  graphKeySchema,
  relationshipCardinalitySchema,
} from "../graph/schemas";
import {
  acquisitionBuildPayloadSchema,
  acquisitionCategorySchema,
} from "./schemas";
import {
  findAcquisitionCandidateMechanicalRepairFields,
  type AcquisitionCandidateFieldReference,
} from "./quality";
import type { ConfigurationOperation } from "../configuration/schemas";

const boundedLabel = z.string().trim().min(1).max(120);
const boundedRequirement = z.string().trim().min(1).max(160);

const scopedBusinessAreaSchema = z
  .object({
    object_key: graphKeySchema,
    singular_label: boundedLabel,
    plural_label: boundedLabel,
  })
  .strict();

const scopedConnectionSchema = z
  .object({
    relationship_key: graphKeySchema,
    source_object_key: graphKeySchema,
    target_object_key: graphKeySchema,
    source_label: boundedLabel,
    target_label: boundedLabel,
    cardinality: relationshipCardinalitySchema,
  })
  .strict();

const scopedFieldSchema = z
  .object({
    object_key: graphKeySchema,
    field_key: graphKeySchema,
    label: boundedLabel,
    field_type: graphFieldTypeSchema,
    required: z.boolean(),
  })
  .strict();

export const ACQUISITION_SCOPED_REPAIR_REASON =
  "required_cross_object_identity_must_use_connection" as const;
export const ACQUISITION_SCOPED_REPAIR_VALIDATOR_CODE =
  "cross_object_field_leakage" as const;
export const ACQUISITION_SCOPED_REPAIR_FAILURE_CODE = "required_field" as const;
export const ACQUISITION_SCOPED_REPAIR_SCOPE =
  "remove_only_listed_identity_fields" as const;

/**
 * Server-owned, bounded context for the correction task. It is derived from
 * the composed candidate and contains no owner request, raw model output or
 * operational data.
 */
export const acquisitionRequiredIdentityRepairManifestSchema = z
  .object({
    schema_version: z.literal(1),
    correction_reason: z.literal(ACQUISITION_SCOPED_REPAIR_REASON),
    validator_code: z.literal(ACQUISITION_SCOPED_REPAIR_VALIDATOR_CODE),
    recovery_failure_code: z.literal(ACQUISITION_SCOPED_REPAIR_FAILURE_CODE),
    allowed_correction_scope: z.literal(ACQUISITION_SCOPED_REPAIR_SCOPE),
    owner_scope: z
      .object({
        category: acquisitionCategorySchema,
        business_areas: z.array(scopedBusinessAreaSchema).min(1).max(6),
        connections: z.array(scopedConnectionSchema).max(10),
        unsupported_requirements: z.array(boundedRequirement).max(8),
      })
      .strict(),
    affected_business_areas: z.array(scopedBusinessAreaSchema).min(1).max(6),
    affected_fields: z.array(scopedFieldSchema).min(1).max(12),
  })
  .strict()
  .superRefine((manifest, context) => {
    const areaKeys = new Set(
      manifest.owner_scope.business_areas.map(({ object_key }) => object_key),
    );
    if (
      manifest.owner_scope.business_areas.length !== areaKeys.size ||
      manifest.affected_business_areas.some(
        ({ object_key }) => !areaKeys.has(object_key),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The repair manifest contains an unknown business area.",
        path: ["affected_business_areas"],
      });
    }

    const fieldKeys = new Set<string>();
    for (const field of manifest.affected_fields) {
      const identity = `${field.object_key}:${field.field_key}`;
      if (fieldKeys.has(identity)) {
        context.addIssue({
          code: "custom",
          message: "The repair manifest repeats an affected Field.",
          path: ["affected_fields"],
        });
      }
      fieldKeys.add(identity);
      if (!areaKeys.has(field.object_key)) {
        context.addIssue({
          code: "custom",
          message: "An affected Field points outside the locked scope.",
          path: ["affected_fields"],
        });
      }
    }
  });

export type AcquisitionRequiredIdentityRepairManifest = z.infer<
  typeof acquisitionRequiredIdentityRepairManifestSchema
>;

/** The entire correction model output: only existing Field references. */
export const acquisitionScopedFieldRepairOutputSchema = z
  .object({
    schema_version: z.literal(1),
    action: z.literal("remove_fields"),
    fields: z
      .array(
        z
          .object({
            object_key: graphKeySchema,
            field_key: graphKeySchema,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((output, context) => {
    const identities = output.fields.map(
      ({ object_key, field_key }) => `${object_key}:${field_key}`,
    );
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: "custom",
        message: "The correction output repeats a Field reference.",
        path: ["fields"],
      });
    }
  });

export type AcquisitionScopedFieldRepairOutput = z.infer<
  typeof acquisitionScopedFieldRepairOutputSchema
>;

export class AcquisitionScopedRepairManifestError extends Error {
  constructor(readonly code: "manifest_unavailable" | "scope_invalid") {
    super("The bounded acquisition correction context is not safe to use.");
    this.name = "AcquisitionScopedRepairManifestError";
  }
}

function activeOperations<T extends ConfigurationOperation["op"]>(
  operations: readonly ConfigurationOperation[],
  op: T,
): Extract<ConfigurationOperation, { op: T }>[] {
  return operations.filter(
    (operation): operation is Extract<ConfigurationOperation, { op: T }> =>
      operation.op === op && operation.is_active,
  );
}

function fieldForReference(
  operations: readonly ConfigurationOperation[],
  reference: AcquisitionCandidateFieldReference,
) {
  return activeOperations(operations, "set_field").find(
    (field) =>
      field.object_key === reference.object_key && field.key === reference.key,
  );
}

/**
 * Build the only correction context the model may receive. The caller must
 * pass the exact validator/recovery pair; other failures cannot construct a
 * scoped correction manifest.
 */
export function buildAcquisitionRequiredIdentityRepairManifest(
  payloadInput: unknown,
  validatorCode: string,
  recoveryFailureCode: string,
): AcquisitionRequiredIdentityRepairManifest {
  if (
    validatorCode !== ACQUISITION_SCOPED_REPAIR_VALIDATOR_CODE ||
    recoveryFailureCode !== ACQUISITION_SCOPED_REPAIR_FAILURE_CODE
  ) {
    throw new AcquisitionScopedRepairManifestError("manifest_unavailable");
  }

  const payload = acquisitionBuildPayloadSchema.parse(payloadInput);
  const objects = activeOperations(payload.operations, "set_object");
  const relationships = activeOperations(
    payload.operations,
    "set_relationship",
  );
  const affectedReferences = findAcquisitionCandidateMechanicalRepairFields(
    payload,
    ACQUISITION_SCOPED_REPAIR_VALIDATOR_CODE,
  );
  const affectedFields = affectedReferences
    .map((reference) => {
      const field = fieldForReference(payload.operations, reference);
      return field
        ? {
            object_key: field.object_key,
            field_key: field.key,
            label: field.label,
            field_type: field.field_type,
            required: field.required,
          }
        : null;
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);
  if (affectedFields.length === 0) {
    throw new AcquisitionScopedRepairManifestError("manifest_unavailable");
  }

  const areas = objects.map((object) => ({
    object_key: object.key,
    singular_label: object.singular_label,
    plural_label: object.plural_label,
  }));
  const areaKeys = new Set(affectedFields.map(({ object_key }) => object_key));
  const affectedBusinessAreas = areas.filter(({ object_key }) =>
    areaKeys.has(object_key),
  );

  return acquisitionRequiredIdentityRepairManifestSchema.parse({
    schema_version: 1,
    correction_reason: ACQUISITION_SCOPED_REPAIR_REASON,
    validator_code: ACQUISITION_SCOPED_REPAIR_VALIDATOR_CODE,
    recovery_failure_code: ACQUISITION_SCOPED_REPAIR_FAILURE_CODE,
    allowed_correction_scope: ACQUISITION_SCOPED_REPAIR_SCOPE,
    owner_scope: {
      category: payload.proposal.category,
      business_areas: areas,
      connections: relationships.map((relationship) => ({
        relationship_key: relationship.key,
        source_object_key: relationship.source_object_key,
        target_object_key: relationship.target_object_key,
        source_label: relationship.source_label,
        target_label: relationship.target_label,
        cardinality: relationship.cardinality,
      })),
      unsupported_requirements: payload.proposal.not_included,
    },
    affected_business_areas: affectedBusinessAreas,
    affected_fields: affectedFields,
  });
}
