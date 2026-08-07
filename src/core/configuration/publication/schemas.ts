import { z } from "zod";

export const publicPreorderPublicationFormSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export type PublicPreorderPublicationForm = z.infer<
  typeof publicPreorderPublicationFormSchema
>;
