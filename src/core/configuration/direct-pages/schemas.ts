import { z } from "zod";

import { graphKeySchema } from "../../graph/schemas";
import { pageLayoutSchema } from "../../experience/schemas";

const directPageTitleSchema = z.string().trim().min(1).max(120);
// Historical Page layouts may predate stable block IDs. The bounded editor
// uses a position-scoped alias for those blocks until the first mutation
// persists real UUIDs through the existing configuration change boundary.
const directPageBlockIdSchema = z.union([
  z.uuid(),
  z.string().regex(/^legacy:\d+$/),
]);

const directPageHeadingBlockSchema = z
  .object({
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(200),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  })
  .strict();

const directPageTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(5_000),
  })
  .strict();

const directPageDividerBlockSchema = z
  .object({
    type: z.literal("divider"),
  })
  .strict();

const directPageViewBlockSchema = z
  .object({
    type: z.literal("view"),
    viewKey: graphKeySchema,
    readOnly: z.boolean().optional(),
  })
  .strict();

export const directPageBlockInputSchema = z.discriminatedUnion("type", [
  directPageHeadingBlockSchema,
  directPageTextBlockSchema,
  directPageDividerBlockSchema,
  directPageViewBlockSchema,
]);

const addPageBlockIntentSchema = z
  .object({
    action: z.literal("add_page_block"),
    pageKey: graphKeySchema,
    block: directPageBlockInputSchema,
    afterBlockId: directPageBlockIdSchema.nullable().optional(),
  })
  .strict();

const updatePageBlockIntentSchema = z
  .object({
    action: z.literal("update_page_block"),
    pageKey: graphKeySchema,
    blockId: directPageBlockIdSchema,
    block: z.union([directPageHeadingBlockSchema, directPageTextBlockSchema]),
  })
  .strict();

const removePageBlockIntentSchema = z
  .object({
    action: z.literal("remove_page_block"),
    pageKey: graphKeySchema,
    blockId: directPageBlockIdSchema,
  })
  .strict();

const movePageBlockIntentSchema = z
  .object({
    action: z.literal("move_page_block"),
    pageKey: graphKeySchema,
    blockId: directPageBlockIdSchema,
    direction: z.enum(["up", "down"]),
  })
  .strict();

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
  addPageBlockIntentSchema,
  updatePageBlockIntentSchema,
  removePageBlockIntentSchema,
  movePageBlockIntentSchema,
]);

export const directPageCurrentnessSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export type DirectPageIntent = z.infer<typeof directPageIntentSchema>;
export type DirectPageBlockInput = z.infer<typeof directPageBlockInputSchema>;
export type DirectPageActionKind = z.infer<typeof directPageActionKindSchema>;
export type DirectPageCurrentness = z.infer<typeof directPageCurrentnessSchema>;
