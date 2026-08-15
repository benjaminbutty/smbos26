import { z } from "zod";

import { graphKeySchema } from "../../graph/schemas";

export const publicPreorderPublicationFormSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export type PublicPreorderPublicationForm = z.infer<
  typeof publicPreorderPublicationFormSchema
>;

export const publicPagePublicationFormSchema = z
  .object({
    pageKey: graphKeySchema,
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export type PublicPagePublicationForm = z.infer<
  typeof publicPagePublicationFormSchema
>;
