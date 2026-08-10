import { z } from "zod";

import { graphKeySchema } from "../../graph/schemas";
import { pageLayoutSchema } from "../../experience/schemas";

const directPageTitleSchema = z.string().trim().min(1).max(120);

export const directPageActionKindSchema = z.enum([
  "create_page",
  "rename_page",
  "save_page_layout",
]);

const createPageIntentSchema = z
  .object({
    action: z.literal("create_page"),
    title: directPageTitleSchema,
  })
  .strict();

const renamePageIntentSchema = z
  .object({
    action: z.literal("rename_page"),
    pageKey: graphKeySchema,
    title: directPageTitleSchema,
  })
  .strict();

const savePageLayoutIntentSchema = z
  .object({
    action: z.literal("save_page_layout"),
    pageKey: graphKeySchema,
    layout: pageLayoutSchema,
  })
  .strict();

export const directPageIntentSchema = z.discriminatedUnion("action", [
  createPageIntentSchema,
  renamePageIntentSchema,
  savePageLayoutIntentSchema,
]);

export const directPageCurrentnessSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export type DirectPageIntent = z.infer<typeof directPageIntentSchema>;
export type DirectPageActionKind = z.infer<typeof directPageActionKindSchema>;
export type DirectPageCurrentness = z.infer<typeof directPageCurrentnessSchema>;
