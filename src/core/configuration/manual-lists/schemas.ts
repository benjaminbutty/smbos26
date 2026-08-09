import { z } from "zod";

const labelSchema = z.string().trim().min(1).max(120);
const optionLabelSchema = z.string().trim().min(1).max(120);

export const manualListOwnerFieldTypeSchema = z.enum([
  "text",
  "longer_text",
  "number",
  "yes_no",
  "date",
  "email",
  "phone",
  "choice",
  "status",
]);

export type ManualListOwnerFieldType = z.infer<
  typeof manualListOwnerFieldTypeSchema
>;

export const manualListInformationRowSchema = z
  .object({
    label: labelSchema,
    type: manualListOwnerFieldTypeSchema,
    required: z.boolean(),
    options: z.array(optionLabelSchema).max(100).optional(),
  })
  .strict()
  .superRefine((row, context) => {
    const needsOptions = row.type === "choice" || row.type === "status";
    if (needsOptions && (!row.options || row.options.length < 2)) {
      context.addIssue({
        code: "custom",
        message: "Choice and Status information needs at least two options.",
        path: ["options"],
      });
    }
    if (!needsOptions && row.options !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Options are supported only for Choice and Status.",
        path: ["options"],
      });
    }
    if (row.options) {
      const normalizedOptions = row.options.map(normalizeManualListLabel);
      if (new Set(normalizedOptions).size !== normalizedOptions.length) {
        context.addIssue({
          code: "custom",
          message: "Options must be different.",
          path: ["options"],
        });
      }
    }
  });

type ManualListInformationRow = z.infer<typeof manualListInformationRowSchema>;

const manualListIntentFields = {
  singularItemLabel: labelSchema,
  pluralListLabel: labelSchema,
  mainNameLabel: labelSchema,
  information: z.array(manualListInformationRowSchema).max(7),
};

function refineManualListLabels(
  intent: {
    mainNameLabel: string;
    information: ManualListInformationRow[];
  },
  context: z.RefinementCtx,
): void {
  const labels = new Map<string, number>();
  const mainName = normalizeManualListLabel(intent.mainNameLabel);
  labels.set(mainName, -1);

  intent.information.forEach((row, index) => {
    const normalized = normalizeManualListLabel(row.label);
    if (labels.has(normalized)) {
      context.addIssue({
        code: "custom",
        message: "Information labels must be different.",
        path: ["information", index, "label"],
      });
    }
    labels.set(normalized, index);
  });
}

export function normalizeManualListLabel(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en");
}

export const manualListIntentSchema = z
  .object(manualListIntentFields)
  .strict()
  .superRefine(refineManualListLabels);

export const manualListPreparationRequestSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
    ...manualListIntentFields,
  })
  .strict()
  .superRefine(refineManualListLabels);

export type ManualListIntent = z.infer<typeof manualListIntentSchema>;
export type ManualListPreparationRequest = z.infer<
  typeof manualListPreparationRequestSchema
>;
