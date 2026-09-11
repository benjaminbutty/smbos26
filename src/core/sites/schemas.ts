import { z } from "zod";

import {
  siteCollectionBlockSchema,
  siteDraftImageBlockSchema,
  siteGalleryBlockSchema,
  pageRichTextNodeSchema,
  sitePageLayoutSchema,
  siteRecordDetailBlockSchema,
  siteSectionAlignmentSchema,
  siteSectionBackgroundSchema,
  siteSectionSpacingSchema,
  siteSectionWidthSchema,
  siteSharedAtomicBlockSchema,
  type SitePageLayout,
} from "../experience/schemas";
import {
  graphKeySchema,
  jsonObjectSchema,
  jsonValueSchema,
} from "../graph/schemas";

const siteNameSchema = z.string().trim().min(1).max(120);
const siteDraftTextSchema = z.string().trim().max(120);
const siteSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const siteAccentSchema = z.enum(["coral", "clay", "forest", "ocean", "plum"]);

const siteDraftFormTextSchema = z.string().trim().max(120);
const siteDraftFormKeySchema = z
  .string()
  .trim()
  .max(80)
  .refine(
    (value) => value.length === 0 || /^[a-z][a-z0-9_]*$/.test(value),
    "Use lowercase letters, numbers, and underscores.",
  );

export const siteBrandingSchema = z
  .object({
    name: siteNameSchema,
    accent: siteAccentSchema,
    logo_asset_id: z.uuid().optional(),
  })
  .strict();

const siteDraftBrandingSchema = z
  .object({
    name: siteDraftTextSchema,
    accent: siteAccentSchema,
    logo_asset_id: z.uuid().optional(),
  })
  .strict();

const sitePageShape = z
  .object({
    /**
     * This identifies the page inside the Site draft only. PostgreSQL derives
     * the canonical Page key and receives its trusted configuration UUID from
     * the ordinary configuration allocator; callers never choose that ID.
     */
    id: z.uuid(),
    title: siteDraftTextSchema,
    slug: z.string().trim().max(80),
    navigation_label: z.string().trim().max(80),
    is_home: z.boolean(),
    is_in_navigation: z.boolean(),
    is_included: z.boolean(),
    layout: sitePageLayoutSchema,
  })
  .strict();

export const sitePageSchema = sitePageShape.superRefine((page, context) => {
  if (page.slug.length > 0 && !siteSlugSchema.safeParse(page.slug).success) {
    context.addIssue({
      code: "custom",
      message: "A Site Page address must use lowercase words and hyphens.",
      path: ["slug"],
    });
  }
});

/**
 * A Site Form is a pending authoring intent. It is deliberately separate from
 * the canonical Form row: autosave can retain a useful, recoverable draft
 * while Prepare is the only operation that materialises it into the ordinary
 * Object, Field, View and Form primitives.
 */
export const siteFormConditionSchema = z
  .object({
    field: graphKeySchema,
    operator: z.enum(["equals", "not_equals", "includes"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();

const siteFormDraftConditionSchema = z
  .object({
    field: siteDraftFormKeySchema,
    operator: z.enum(["equals", "not_equals", "includes"]),
    value: z.union([z.string().trim().max(120), z.number(), z.boolean()]),
  })
  .strict();

const siteFormQuestionTypeSchema = z.enum([
  "short_text",
  "long_text",
  "number",
  "currency",
  "date",
  "datetime",
  "email",
  "phone",
  "url",
  "select",
  "multi_select",
  "boolean",
  "file",
  "status",
]);

const siteFormQuestionSchema = z
  .object({
    id: z.uuid(),
    key: siteDraftFormKeySchema,
    // A missing mode is accepted while an older draft is being normalized.
    // New authoring writes it explicitly so an existing Table can add a new
    // Property without replacing the Table's established Fields.
    field_mode: z.enum(["existing", "new"]).optional(),
    label: siteDraftFormTextSchema,
    help_text: z.string().trim().max(500).optional(),
    field_type: siteFormQuestionTypeSchema,
    required: z.boolean().default(false),
    options: z.array(z.string().trim().max(120)).max(50).optional(),
    default_value: jsonValueSchema.optional(),
    visible_when: siteFormDraftConditionSchema.optional(),
    upload_kind: z.enum(["image", "pdf"]).optional(),
    upload_count: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .superRefine((question, context) => {
    // Draft persistence is intentionally permissive. Prepare applies the
    // question and destination completeness rules once the owner is done.
    if (question.upload_count !== undefined && question.upload_count < 1) {
      context.addIssue({
        code: "custom",
        message: "Upload count must be positive.",
        path: ["upload_count"],
      });
    }
  });

export const siteFormDraftSchema = z
  .object({
    id: z.uuid(),
    key: siteDraftFormKeySchema,
    name: siteDraftFormTextSchema,
    object_mode: z.enum(["existing", "new"]),
    object_key: siteDraftFormKeySchema,
    singular_label: siteDraftFormTextSchema.optional(),
    plural_label: siteDraftFormTextSchema.optional(),
    view_mode: z.enum(["existing", "new"]),
    view_key: siteDraftFormKeySchema.optional(),
    view_name: siteDraftFormTextSchema.optional(),
    submit_label: siteDraftFormTextSchema.optional(),
    questions: z.array(siteFormQuestionSchema).max(50),
  })
  .strict()
  .superRefine((form, context) => {
    const questionKeys = form.questions.map((question) => question.key);
    const nonEmptyQuestionKeys = questionKeys.filter((key) => key.length > 0);
    if (new Set(nonEmptyQuestionKeys).size !== nonEmptyQuestionKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Form questions must use unique Property keys.",
        path: ["questions"],
      });
    }
  });

export type SiteFormDraft = z.infer<typeof siteFormDraftSchema>;

export const siteDraftV1Schema = z
  .object({
    schema_version: z.literal(1),
    branding: siteDraftBrandingSchema,
    pages: z.array(sitePageSchema).max(20),
    forms: z.array(siteFormDraftSchema).max(20).optional(),
  })
  .strict()
  .superRefine((draft, context) => {
    const pageIds = draft.pages.map((page) => page.id);
    const slugs = draft.pages
      .map((page) => page.slug)
      .filter((slug) => slug.length > 0);
    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({
        code: "custom",
        message: "Site Pages must use unique draft identities.",
        path: ["pages"],
      });
    }
    if (new Set(slugs).size !== slugs.length) {
      context.addIssue({
        code: "custom",
        message: "Site Page addresses must be unique.",
        path: ["pages"],
      });
    }
    if (draft.pages.filter((page) => page.is_home).length > 1) {
      context.addIssue({
        code: "custom",
        message: "A Site can have only one Home Page.",
        path: ["pages"],
      });
    }
    const blockIds = new Set<string>();
    const collectionFields = new Map<string, ReadonlySet<string>>();
    const collectionDetailPages = new Map<string, string | undefined>();
    const detailBlocks: Array<{
      collectionId: string;
      fields: readonly string[];
      pageId: string;
    }> = [];
    const selectedRecordIds = new Set<string>();
    const visit = (
      blocks: readonly SitePageLayout["blocks"][number][],
      pageId: string,
    ) => {
      for (const block of blocks) {
        if (!("id" in block) || !block.id) {
          context.addIssue({
            code: "custom",
            message: "Site blocks require stable identities.",
            path: ["pages"],
          });
        } else if (blockIds.has(block.id)) {
          context.addIssue({
            code: "custom",
            message: "Site blocks must use identities unique across the Site.",
            path: ["pages"],
          });
        } else {
          blockIds.add(block.id);
        }
        if (block.type === "collection") {
          if (!block.id) continue;
          collectionFields.set(block.id, new Set(block.public_field_keys));
          collectionDetailPages.set(block.id, block.detail_page_id);
          block.selection.record_ids.forEach((id) => selectedRecordIds.add(id));
        }
        if (block.type === "record_detail") {
          detailBlocks.push({
            collectionId: block.collection_block_id,
            fields: block.public_field_keys,
            pageId,
          });
        }
        if (block.type === "collapsible") {
          visit(
            block.blocks as readonly SitePageLayout["blocks"][number][],
            pageId,
          );
        }
        if (block.type === "section") {
          block.columns.forEach((column) =>
            visit(
              column.blocks as readonly SitePageLayout["blocks"][number][],
              pageId,
            ),
          );
        }
      }
    };
    draft.pages.forEach((page) => visit(page.layout.blocks, page.id));
    if (selectedRecordIds.size > 500) {
      context.addIssue({
        code: "custom",
        message: "A Site can include at most 500 distinct Records.",
        path: ["pages"],
      });
    }
    for (const detail of detailBlocks) {
      const fields = collectionFields.get(detail.collectionId);
      const detailPageId = collectionDetailPages.get(detail.collectionId);
      if (!fields || detailPageId !== detail.pageId) {
        context.addIssue({
          code: "custom",
          message:
            "A shared detail layout must belong to its collection's selected detail Page.",
          path: ["pages"],
        });
        continue;
      }
      if (detail.fields.some((field) => !fields.has(field))) {
        context.addIssue({
          code: "custom",
          message:
            "A detail layout can only display its collection's public Properties.",
          path: ["pages"],
        });
      }
    }
    if (
      new TextEncoder().encode(JSON.stringify(draft)).byteLength >
      256 * 1024
    ) {
      context.addIssue({
        code: "custom",
        message: "A Site draft cannot exceed 256 KiB.",
      });
    }
  });

export type SiteDraftV1 = z.infer<typeof siteDraftV1Schema>;

/**
 * Draft persistence accepts a complete bounded composition even when the
 * owner is deliberately excluding unfinished Pages. Preparation applies this
 * additional release-only contract; autosave never pretends that exclusion is
 * a completed public route.
 */
export const siteDraftPublicationReadyV1Schema = siteDraftV1Schema.superRefine(
  (draft, context) => {
    const pages = new Map(draft.pages.map((page) => [page.id, page]));
    const reachableFormKeys = new Set<string>();
    const collectReachableFormKeys = (value: unknown): void => {
      if (!Array.isArray(value)) return;
      for (const child of value) {
        if (!child || typeof child !== "object") continue;
        const block = child as Record<string, unknown>;
        if (
          block.type === "public_form" &&
          typeof block.form_key === "string"
        ) {
          reachableFormKeys.add(block.form_key);
        }
        collectReachableFormKeys(block.blocks);
        if (Array.isArray(block.columns)) {
          for (const column of block.columns) {
            if (!column || typeof column !== "object") continue;
            collectReachableFormKeys(
              (column as Record<string, unknown>).blocks,
            );
          }
        }
      }
    };
    draft.pages
      .filter((page) => page.is_included)
      .forEach((page) => collectReachableFormKeys(page.layout.blocks));
    const formKeys = new Set<string>();
    for (const [formIndex, form] of (draft.forms ?? []).entries()) {
      if (!reachableFormKeys.has(form.key)) continue;
      if (!form.key || formKeys.has(form.key)) {
        context.addIssue({
          code: "custom",
          message:
            "Each Form needs a unique managed identity before publishing.",
          path: ["forms", formIndex, "key"],
        });
      }
      formKeys.add(form.key);
      if (!form.name.trim()) {
        context.addIssue({
          code: "custom",
          message: "Each Form needs a name before publishing.",
          path: ["forms", formIndex, "name"],
        });
      }
      if (
        form.object_mode === "new" &&
        (!form.singular_label?.trim() || !form.plural_label?.trim())
      ) {
        context.addIssue({
          code: "custom",
          message: "A new Form Table needs singular and plural names.",
          path: ["forms", formIndex],
        });
      }
      if (form.object_mode === "existing" && !form.object_key) {
        context.addIssue({
          code: "custom",
          message: "A Form needs an existing Table before publishing.",
          path: ["forms", formIndex, "object_key"],
        });
      }
      if (form.view_mode === "new" && !form.view_name?.trim()) {
        context.addIssue({
          code: "custom",
          message: "A new Form View needs a name before publishing.",
          path: ["forms", formIndex, "view_name"],
        });
      }
      if (form.questions.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Each Form needs at least one question before publishing.",
          path: ["forms", formIndex, "questions"],
        });
      }
      const questionKeys = new Set<string>();
      form.questions.forEach((question, questionIndex) => {
        if (!question.key || questionKeys.has(question.key)) {
          context.addIssue({
            code: "custom",
            message: "Each Form question needs a unique managed property.",
            path: ["forms", formIndex, "questions", questionIndex, "key"],
          });
        }
        questionKeys.add(question.key);
        if (!question.label.trim()) {
          context.addIssue({
            code: "custom",
            message: "Each Form question needs a label before publishing.",
            path: ["forms", formIndex, "questions", questionIndex, "label"],
          });
        }
        if (
          (question.field_type === "select" ||
            question.field_type === "multi_select" ||
            question.field_type === "status") &&
          (!(question.options ?? []).length ||
            (question.options ?? []).some((option) => !option.trim()))
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Choice questions need at least one option before publishing.",
            path: ["forms", formIndex, "questions", questionIndex, "options"],
          });
        }
        if (question.field_type === "file" && !question.upload_kind) {
          context.addIssue({
            code: "custom",
            message: "File questions need an upload kind before publishing.",
            path: [
              "forms",
              formIndex,
              "questions",
              questionIndex,
              "upload_kind",
            ],
          });
        }
      });
      const questionPositions = new Map(
        form.questions.map((question, questionIndex) => [
          question.key,
          questionIndex,
        ]),
      );
      form.questions.forEach((question, questionIndex) => {
        const condition = question.visible_when;
        if (!condition) return;
        const sourceIndex = questionPositions.get(condition.field);
        const source = form.questions.find(
          (candidate) => candidate.key === condition.field,
        );
        const sourceIsEarlier =
          sourceIndex !== undefined && sourceIndex < questionIndex;
        const supportedSource =
          source?.field_type === "select" ||
          source?.field_type === "multi_select" ||
          source?.field_type === "boolean" ||
          source?.field_type === "status";
        const operatorSupported =
          source?.field_type === "multi_select"
            ? condition.operator === "includes"
            : condition.operator === "equals" ||
              condition.operator === "not_equals";
        const valueSupported =
          source?.field_type === "boolean"
            ? typeof condition.value === "boolean"
            : typeof condition.value === "string" &&
              Boolean(
                source?.options?.some(
                  (option) =>
                    option.trim() !== "" && option.trim() === condition.value,
                ),
              );
        if (
          !sourceIsEarlier ||
          !supportedSource ||
          !operatorSupported ||
          !valueSupported ||
          question.required
        ) {
          context.addIssue({
            code: "custom",
            message: question.required
              ? "A conditional question cannot be required."
              : "Conditions must use a typed earlier choice or Yes/No question.",
            path: [
              "forms",
              formIndex,
              "questions",
              questionIndex,
              "visible_when",
            ],
          });
        }
      });
    }
    const collections = new Map<
      string,
      { pageId: string; detailPageId: string | undefined }
    >();
    const detailBlocks: Array<{ collectionId: string; pageId: string }> = [];
    const visit = (
      blocks: readonly SitePageLayout["blocks"][number][],
      pageId: string,
    ) => {
      for (const block of blocks) {
        if (block.type === "collection" && block.id) {
          collections.set(block.id, {
            pageId,
            detailPageId: block.detail_page_id,
          });
        }
        if (block.type === "record_detail") {
          detailBlocks.push({
            collectionId: block.collection_block_id,
            pageId,
          });
        }
        if (block.type === "collapsible") {
          visit(
            block.blocks as readonly SitePageLayout["blocks"][number][],
            pageId,
          );
        }
        if (block.type === "section") {
          block.columns.forEach((column) =>
            visit(
              column.blocks as readonly SitePageLayout["blocks"][number][],
              pageId,
            ),
          );
        }
      }
    };
    draft.pages.forEach((page) => visit(page.layout.blocks, page.id));

    if (draft.branding.name.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A Site needs a name before publishing.",
        path: ["branding", "name"],
      });
    }
    if (
      draft.pages.filter((page) => page.is_home && page.is_included).length !==
      1
    ) {
      context.addIssue({
        code: "custom",
        message: "A release needs exactly one included Home Page.",
        path: ["pages"],
      });
    }

    const visitReadiness = (
      blocks: readonly SitePageLayout["blocks"][number][],
      page: SiteDraftV1["pages"][number],
    ) => {
      for (const block of blocks) {
        if (
          page.is_included &&
          "draft_state" in block &&
          block.draft_state === "incomplete"
        ) {
          context.addIssue({
            code: "custom",
            message: "Included Pages cannot contain unfinished content.",
            path: ["pages"],
          });
        }
        if (block.type === "collapsible") {
          visitReadiness(
            block.blocks as readonly SitePageLayout["blocks"][number][],
            page,
          );
        }
        if (block.type === "section") {
          block.columns.forEach((column) =>
            visitReadiness(
              column.blocks as readonly SitePageLayout["blocks"][number][],
              page,
            ),
          );
        }
      }
    };

    for (const page of draft.pages) {
      if (!page.is_included) continue;
      if (page.title.length === 0) {
        context.addIssue({
          code: "custom",
          message: "An included Page needs a title before publishing.",
          path: ["pages"],
        });
      }
      if (!siteSlugSchema.safeParse(page.slug).success) {
        context.addIssue({
          code: "custom",
          message: "An included Page needs an address before publishing.",
          path: ["pages"],
        });
      }
      if (page.is_in_navigation && page.navigation_label.length === 0) {
        context.addIssue({
          code: "custom",
          message: "A navigation Page needs a label before publishing.",
          path: ["pages"],
        });
      }
      visitReadiness(page.layout.blocks, page);
      if (page.is_home && !page.is_included) {
        context.addIssue({
          code: "custom",
          message: "The Home Page must be included before publishing.",
          path: ["pages"],
        });
      }
    }

    for (const page of draft.pages) {
      if (page.is_home && !page.is_included) {
        context.addIssue({
          code: "custom",
          message: "The Home Page must be included before publishing.",
          path: ["pages"],
        });
      }
      if (page.is_in_navigation && !page.is_included) {
        context.addIssue({
          code: "custom",
          message: "Only included Pages can appear in published navigation.",
          path: ["pages"],
        });
      }
    }

    for (const [collectionId, collection] of collections) {
      const sourcePage = pages.get(collection.pageId);
      if (!sourcePage?.is_included || !collection.detailPageId) continue;
      const detailPage = pages.get(collection.detailPageId);
      if (!detailPage?.is_included) {
        context.addIssue({
          code: "custom",
          message:
            "An included collection cannot link to an excluded or missing detail Page.",
          path: ["pages"],
        });
        continue;
      }
      if (
        !detailBlocks.some(
          (detail) =>
            detail.collectionId === collectionId &&
            detail.pageId === collection.detailPageId,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "An included collection detail link needs its shared detail layout.",
          path: ["pages"],
        });
      }
    }

    for (const detail of detailBlocks) {
      const detailPage = pages.get(detail.pageId);
      const collection = collections.get(detail.collectionId);
      if (
        detailPage?.is_included &&
        (!collection ||
          !pages.get(collection.pageId)?.is_included ||
          collection.detailPageId !== detail.pageId)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "An included detail Page needs an included collection that owns it.",
          path: ["pages"],
        });
      }
    }
  },
);

/**
 * A release is a server-built, immutable projection. Collection entries carry
 * only the frozen public values selected during preparation; no caller can
 * provide this shape to the draft-save RPC.
 */
const siteProjectedRecordSchema = z
  .object({ id: z.uuid(), values: jsonObjectSchema })
  .strict();

const siteProjectedCollectionBlockSchema = siteCollectionBlockSchema
  .safeExtend({
    id: z.uuid(),
    records: z.array(siteProjectedRecordSchema).max(500),
  })
  .superRefine((block, context) => {
    if (
      new Set(block.selection.record_ids).size !==
      block.selection.record_ids.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A collection cannot select the same Record more than once.",
        path: ["selection", "record_ids"],
      });
    }
    if (
      new Set(block.public_field_keys).size !== block.public_field_keys.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A collection's public Properties must be unique.",
        path: ["public_field_keys"],
      });
    }
    if (block.records.length !== block.selection.record_ids.length) {
      context.addIssue({
        code: "custom",
        message: "A release collection must freeze every selected Record.",
        path: ["records"],
      });
    }
    if (
      block.records.some(
        (record, index) => record.id !== block.selection.record_ids[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A release collection must retain each selected Record in draft order.",
        path: ["records"],
      });
    }
    for (const record of block.records) {
      const valueKeys = Object.keys(record.values);
      if (
        valueKeys.length !== block.public_field_keys.length ||
        valueKeys.some((key) => !block.public_field_keys.includes(key))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A release collection can include values only for its public Properties.",
          path: ["records"],
        });
      }
    }
  });

const siteProjectedRecordDetailBlockSchema =
  siteRecordDetailBlockSchema.safeExtend({
    id: z.uuid(),
  });

const siteProjectedGalleryBlockSchema = siteGalleryBlockSchema
  .safeExtend({
    id: z.uuid(),
    draft_state: z.literal("complete").default("complete"),
  })
  .superRefine((block, context) => {
    if (
      block.images.some(
        (image) =>
          image.draft_state !== "complete" ||
          !image.asset_id ||
          image.alt.length === 0,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "A release gallery must contain complete managed images.",
      });
    }
  });

const siteProjectedImageBlockSchema = siteDraftImageBlockSchema.safeExtend({
  id: z.uuid(),
  asset_id: z.uuid(),
  draft_state: z.literal("complete").default("complete"),
});

function stripSiteProjectionRecordValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSiteProjectionRecordValues);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => key !== "records")
      .map(([key, nested]) => [key, stripSiteProjectionRecordValues(nested)]),
  );
}

type SiteProjectedCollapsibleBlock = {
  type: "collapsible";
  summary: string;
  blocks: SiteProjectedNestedBlock[];
  open: boolean;
  id: string;
  draft_state: "complete";
};

type SiteProjectedNestedBlock =
  | z.output<typeof siteSharedAtomicBlockSchema>
  | z.output<typeof siteProjectedImageBlockSchema>
  | z.output<typeof siteProjectedGalleryBlockSchema>
  | z.output<typeof siteProjectedCollectionBlockSchema>
  | z.output<typeof siteProjectedRecordDetailBlockSchema>
  | SiteProjectedCollapsibleBlock;

const siteProjectedLeafBlockSchema = z.union([
  siteSharedAtomicBlockSchema,
  siteProjectedImageBlockSchema,
  siteProjectedGalleryBlockSchema,
  siteProjectedCollectionBlockSchema,
  siteProjectedRecordDetailBlockSchema,
]);

function siteProjectedNestedBlockSchemaAtDepth(
  nesting: number,
): z.ZodType<SiteProjectedNestedBlock> {
  return z.lazy(() =>
    nesting > 1
      ? siteProjectedLeafBlockSchema
      : z.union([
          siteProjectedLeafBlockSchema,
          siteProjectedCollapsibleBlockSchemaAtDepth(nesting),
        ]),
  );
}

function siteProjectedCollapsibleBlockSchemaAtDepth(
  nesting: number,
): z.ZodType<SiteProjectedCollapsibleBlock> {
  return z
    .object({
      type: z.literal("collapsible"),
      summary: z.string().trim().min(1).max(200),
      blocks: z
        .array(siteProjectedNestedBlockSchemaAtDepth(nesting + 1))
        .max(50),
      open: z.boolean().default(true),
      id: z.uuid(),
      draft_state: z.literal("complete").default("complete"),
    })
    .strict();
}

const siteProjectedNestedBlockSchema = siteProjectedNestedBlockSchemaAtDepth(0);

const siteProjectedSectionBlockSchema = z
  .object({
    type: z.literal("section"),
    width: siteSectionWidthSchema.default("content"),
    spacing: siteSectionSpacingSchema.default("comfortable"),
    alignment: siteSectionAlignmentSchema.default("start"),
    background: siteSectionBackgroundSchema.default("plain"),
    columns: z
      .array(
        z
          .object({
            blocks: z.array(siteProjectedNestedBlockSchemaAtDepth(1)).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    id: z.uuid(),
  })
  .strict();

const siteProjectedPageBlockSchema = z.union([
  siteProjectedNestedBlockSchema,
  siteProjectedSectionBlockSchema,
]);

const siteProjectedPageLayoutSchema = z
  .object({ blocks: z.array(siteProjectedPageBlockSchema).max(100) })
  .strict()
  .superRefine((layout, context) => {
    // Projection-only `records` is the one intentional extension of the
    // canonical Site grammar. Strip it and reuse the draft traversal so an
    // unexpected internal View/Form atom cannot enter a public release.
    if (
      !sitePageLayoutSchema.safeParse(stripSiteProjectionRecordValues(layout))
        .success
    ) {
      context.addIssue({
        code: "custom",
        message: "A release projection must remain a valid Site Page layout.",
      });
    }
  });

const siteReleaseProjectionPageSchema = sitePageShape
  .omit({ layout: true })
  .extend({
    is_included: z.literal(true),
    layout: siteProjectedPageLayoutSchema,
  })
  .strict();

export const siteReleaseProjectionSchema = z
  .object({
    schema_version: z.literal(1),
    branding: siteBrandingSchema,
    pages: z.array(siteReleaseProjectionPageSchema).min(1).max(20),
  })
  .strict()
  .superRefine((projection, context) => {
    const ids = projection.pages.map((page) => page.id);
    const slugs = projection.pages.map((page) => page.slug);
    if (
      new Set(ids).size !== ids.length ||
      new Set(slugs).size !== slugs.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Release Pages must retain unique identities and addresses.",
        path: ["pages"],
      });
    }
    if (projection.pages.filter((page) => page.is_home).length !== 1) {
      context.addIssue({
        code: "custom",
        message: "A release must include exactly one Home Page.",
        path: ["pages"],
      });
    }
    if (
      !siteDraftPublicationReadyV1Schema.safeParse(
        stripSiteProjectionRecordValues({
          schema_version: 1,
          branding: projection.branding,
          pages: projection.pages,
        }),
      ).success
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A release projection must retain valid Site-wide Page and detail bindings.",
      });
    }
  });

export const siteReleaseReviewSchema = z
  .object({
    schema_version: z.literal(1),
    included_page_ids: z.array(z.uuid()).min(1).max(20),
    excluded_page_ids: z.array(z.uuid()).max(20),
  })
  .strict()
  .superRefine((review, context) => {
    const all = [...review.included_page_ids, ...review.excluded_page_ids];
    if (new Set(all).size !== all.length) {
      context.addIssue({
        code: "custom",
        message: "Release review Page identities must not overlap.",
      });
    }
  });

/**
 * Anonymous Site delivery has its own schema. It intentionally accepts only
 * opaque keys and the bounded presentation tree; private draft identities,
 * Record UUIDs and storage keys never cross this parser boundary.
 */
const sitePublicTokenSchema = z.string().regex(/^[rm]_([a-f0-9]{64})$/);

const sitePublicRecordSchema = z
  .object({
    public_id: z.string().regex(/^r_[a-f0-9]{64}$/),
    values: jsonObjectSchema,
  })
  .strict();

const sitePublicImageSchema = z
  .object({
    media_token: z.string().regex(/^m_[a-f0-9]{64}$/),
  })
  .passthrough();

const privatePublicProjectionKeys = new Set([
  "id",
  "asset_id",
  "object_key",
  "selection",
  "public_field_keys",
  "detail_page_id",
  "collection_block_id",
  "form_key",
  "booking_key",
  "preorder_key",
  "view_key",
  "src",
  "storage_key",
  "business_id",
  "record_id",
  "draft_state",
  "legacy_source_page_id",
  "legacy_source_checksum",
]);

function findPrivateProjectionKey(
  value: unknown,
  path: readonly string[] = [],
): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = findPrivateProjectionKey(item, [...path, String(index)]);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    if (privatePublicProjectionKeys.has(key)) {
      return [...path, key].join(".");
    }
    // Record values are user-defined public field keys. They may legitimately
    // be named `id`, so their contents are bounded by jsonObjectSchema rather
    // than treated as projection metadata.
    if (key === "values") continue;
    const result = findPrivateProjectionKey(nested, [...path, key]);
    if (result) return result;
  }
  return null;
}

const sitePublicBlockSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "heading",
        "text",
        "rich_text",
        "image",
        "gallery",
        "button",
        "callout",
        "divider",
        "collapsible",
        "section",
        "collection",
        "record_detail",
      ]),
      public_key: z
        .string()
        .regex(/^b_[a-f0-9]{64}$/)
        .optional(),
      media_token: sitePublicTokenSchema.optional(),
      records: z.array(sitePublicRecordSchema).max(500).optional(),
      images: z.array(sitePublicImageSchema).max(12).optional(),
      display_field_keys: z.array(graphKeySchema).max(50).optional(),
      width: siteSectionWidthSchema.optional(),
      spacing: siteSectionSpacingSchema.optional(),
      alignment: siteSectionAlignmentSchema.optional(),
      background: siteSectionBackgroundSchema.optional(),
      blocks: z.array(sitePublicBlockSchema).max(50).optional(),
      columns: z
        .array(
          z
            .object({ blocks: z.array(sitePublicBlockSchema).max(100) })
            .strict(),
        )
        .max(3)
        .optional(),
    })
    .passthrough()
    .superRefine((block, context) => {
      if (
        block.type === "rich_text" &&
        !pageRichTextNodeSchema.safeParse(block.node).success
      ) {
        context.addIssue({
          code: "custom",
          message: "Public rich text must use the canonical Page format.",
          path: ["node"],
        });
      }
      const privateKey = findPrivateProjectionKey(block);
      if (privateKey) {
        context.addIssue({
          code: "custom",
          message: `Public Site projection contains private key ${privateKey}.`,
          path: [privateKey],
        });
      }
    }),
);

export const sitePublicProjectionBrandingSchema = z
  .object({
    name: z.string(),
    accent: siteAccentSchema,
    logo_media_token: z
      .string()
      .regex(/^m_[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

export const sitePublicProjectionPageSchema = z
  .object({
    public_key: z.string().regex(/^b_[a-f0-9]{64}$/),
    title: z.string().max(120),
    slug: z.string().max(80),
    navigation_label: z.string().max(80),
    is_home: z.boolean(),
    is_in_navigation: z.boolean(),
    layout: z
      .object({ blocks: z.array(sitePublicBlockSchema).max(100) })
      .strict(),
  })
  .strict();

export const sitePublicProjectionSchema = z
  .object({
    schema_version: z.literal(2),
    branding: sitePublicProjectionBrandingSchema,
    pages: z.array(sitePublicProjectionPageSchema).min(1).max(20),
  })
  .strict()
  .superRefine((projection, context) => {
    const slugs = projection.pages.map((page) => page.slug);
    const keys = projection.pages.map((page) => page.public_key);
    if (
      new Set(slugs).size !== slugs.length ||
      new Set(keys).size !== keys.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Public Site Pages must retain unique addresses and keys.",
        path: ["pages"],
      });
    }
    if (projection.pages.filter((page) => page.is_home).length !== 1) {
      context.addIssue({
        code: "custom",
        message: "A public Site needs exactly one Home Page.",
        path: ["pages"],
      });
    }
  });

export type SitePublicProjection = z.infer<typeof sitePublicProjectionSchema>;

/**
 * Site Form delivery is versioned independently from the immutable v2
 * projection. The action contains only public question semantics and opaque
 * release/action keys; canonical UUIDs and upload provider details stay on the
 * server.
 */
export const sitePublicFormQuestionSchema = z
  .object({
    key: graphKeySchema,
    label: siteNameSchema,
    help_text: z.string().trim().min(1).max(500).optional(),
    field_type: z.enum([
      "short_text",
      "long_text",
      "number",
      "currency",
      "date",
      "datetime",
      "email",
      "phone",
      "url",
      "select",
      "multi_select",
      "boolean",
      "file",
      "status",
    ]),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    visible_when: siteFormConditionSchema.optional(),
    upload_kind: z.enum(["image", "pdf"]).optional(),
    upload_count: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .superRefine((question, context) => {
    if (
      (question.field_type === "select" ||
        question.field_type === "multi_select" ||
        question.field_type === "status") &&
      !question.options?.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Choice questions need options.",
        path: ["options"],
      });
    }
    if (question.field_type === "file" && !question.upload_kind) {
      context.addIssue({
        code: "custom",
        message: "File questions need an upload kind.",
        path: ["upload_kind"],
      });
    }
    if (question.upload_count !== undefined && !question.upload_kind) {
      context.addIssue({
        code: "custom",
        message: "An upload count needs an upload kind.",
        path: ["upload_kind"],
      });
    }
  });

export const sitePublicFormActionSchema = z
  .object({
    release_token: z.string().regex(/^s_[a-f0-9]{64}$/),
    action_key: z.string().regex(/^a_[a-f0-9]{64}$/),
    form_name: siteNameSchema,
    submit_label: siteNameSchema.optional(),
    questions: z.array(sitePublicFormQuestionSchema).min(1).max(50),
  })
  .strict()
  .superRefine((action, context) => {
    const keys = action.questions.map((question) => question.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Public Form question keys must be unique.",
        path: ["questions"],
      });
    }
    const positions = new Map(keys.map((key, index) => [key, index]));
    action.questions.forEach((question, index) => {
      if (
        question.visible_when &&
        (!positions.has(question.visible_when.field) ||
          (positions.get(question.visible_when.field) ?? -1) >= index)
      ) {
        context.addIssue({
          code: "custom",
          message: "A condition must reference an earlier question.",
          path: ["questions", index, "visible_when", "field"],
        });
      } else if (question.visible_when) {
        const source = action.questions.find(
          (candidate) => candidate.key === question.visible_when?.field,
        );
        const condition = question.visible_when;
        const supportedSource =
          source?.field_type === "select" ||
          source?.field_type === "multi_select" ||
          source?.field_type === "boolean" ||
          source?.field_type === "status";
        const operatorSupported =
          source?.field_type === "multi_select"
            ? condition.operator === "includes"
            : condition.operator === "equals" ||
              condition.operator === "not_equals";
        const valueSupported =
          source?.field_type === "boolean"
            ? typeof condition.value === "boolean"
            : typeof condition.value === "string" &&
              Boolean(
                source?.options?.some(
                  (option) => option.trim() === condition.value,
                ),
              );
        if (!supportedSource || !operatorSupported || !valueSupported) {
          context.addIssue({
            code: "custom",
            message:
              "Conditions must use a typed earlier choice or Yes/No question.",
            path: ["questions", index, "visible_when"],
          });
        }
      }
    });
  });

export type SitePublicFormAction = z.infer<typeof sitePublicFormActionSchema>;

const sitePublicFormBlockSchema = z
  .object({
    type: z.literal("form"),
    public_key: z.string().regex(/^b_[a-f0-9]{64}$/),
    action: sitePublicFormActionSchema,
  })
  .strict();

const sitePublicBlockSchemaV3: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "heading",
        "text",
        "rich_text",
        "image",
        "gallery",
        "button",
        "callout",
        "divider",
        "collapsible",
        "section",
        "collection",
        "record_detail",
        "form",
      ]),
      public_key: z
        .string()
        .regex(/^b_[a-f0-9]{64}$/)
        .optional(),
      media_token: sitePublicTokenSchema.optional(),
      records: z.array(sitePublicRecordSchema).max(500).optional(),
      images: z.array(sitePublicImageSchema).max(12).optional(),
      display_field_keys: z.array(graphKeySchema).max(50).optional(),
      width: siteSectionWidthSchema.optional(),
      spacing: siteSectionSpacingSchema.optional(),
      alignment: siteSectionAlignmentSchema.optional(),
      background: siteSectionBackgroundSchema.optional(),
      blocks: z.array(sitePublicBlockSchemaV3).max(50).optional(),
      columns: z
        .array(
          z
            .object({ blocks: z.array(sitePublicBlockSchemaV3).max(100) })
            .strict(),
        )
        .max(3)
        .optional(),
      action: sitePublicFormActionSchema.optional(),
    })
    .passthrough()
    .superRefine((block, context) => {
      if (block.type === "form") {
        const parsed = sitePublicFormBlockSchema.safeParse(block);
        if (!parsed.success) {
          context.addIssue({
            code: "custom",
            message: "Public Form blocks must include a valid action.",
            path: ["action"],
          });
        }
      }
      if (
        block.type === "rich_text" &&
        !pageRichTextNodeSchema.safeParse(block.node).success
      ) {
        context.addIssue({
          code: "custom",
          message: "Public rich text must use the canonical Page format.",
          path: ["node"],
        });
      }
      const privateKey = findPrivateProjectionKey(block);
      if (privateKey) {
        context.addIssue({
          code: "custom",
          message: `Public Site projection contains private key ${privateKey}.`,
          path: [privateKey],
        });
      }
    }),
);

const sitePublicProjectionPageSchemaV3 = z
  .object({
    public_key: z.string().regex(/^b_[a-f0-9]{64}$/),
    title: z.string().max(120),
    slug: z.string().max(80),
    navigation_label: z.string().max(80),
    is_home: z.boolean(),
    is_in_navigation: z.boolean(),
    layout: z
      .object({ blocks: z.array(sitePublicBlockSchemaV3).max(100) })
      .strict(),
  })
  .strict();

export const sitePublicProjectionV3Schema = z
  .object({
    schema_version: z.literal(3),
    branding: sitePublicProjectionBrandingSchema,
    pages: z.array(sitePublicProjectionPageSchemaV3).min(1).max(20),
  })
  .strict()
  .superRefine((projection, context) => {
    const slugs = projection.pages.map((page) => page.slug);
    const keys = projection.pages.map((page) => page.public_key);
    if (
      new Set(slugs).size !== slugs.length ||
      new Set(keys).size !== keys.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Public Site Pages must retain unique addresses and keys.",
        path: ["pages"],
      });
    }
    if (projection.pages.filter((page) => page.is_home).length !== 1) {
      context.addIssue({
        code: "custom",
        message: "A public Site needs exactly one Home Page.",
        path: ["pages"],
      });
    }
  });

export type SitePublicProjectionV3 = z.infer<
  typeof sitePublicProjectionV3Schema
>;

export const siteDraftCreateSchema = z
  .object({ draft: siteDraftV1Schema })
  .strict();

export const siteDraftSaveSchema = z
  .object({
    siteId: z.uuid(),
    expectedDraftRevision: z.number().int().positive(),
    draft: siteDraftV1Schema,
  })
  .strict();

export const siteReleasePreparationSchema = z
  .object({
    siteId: z.uuid(),
    expectedDraftRevision: z.number().int().positive(),
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

export const siteDraftRebaseSchema = z
  .object({
    siteId: z.uuid(),
    expectedDraftRevision: z.number().int().positive(),
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

/** An owner acknowledgement is required before retaining a changed binding. */
export const siteDraftConflictResolutionSchema = siteDraftRebaseSchema
  .extend({
    /** The exact current configuration the owner reviewed before acknowledging. */
    expectedTargetVersionId: z.uuid(),
    expectedTargetHeadRevision: z.number().int().positive(),
    resolution: z.literal("keep_site_draft"),
  })
  .strict();

export const siteReleasePublishSchema = z
  .object({
    siteId: z.uuid(),
    candidateId: z.uuid(),
    expectedDraftRevision: z.number().int().positive(),
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
  })
  .strict();

function siteBlockMediaAssetIds(
  block: SitePageLayout["blocks"][number],
): string[] {
  if (block.type === "image") return block.asset_id ? [block.asset_id] : [];
  if (block.type === "gallery")
    return block.images.flatMap((image) =>
      image.asset_id ? [image.asset_id] : [],
    );
  if (block.type === "collapsible") {
    return block.blocks.flatMap((child) =>
      siteBlockMediaAssetIds(child as SitePageLayout["blocks"][number]),
    );
  }
  if (block.type === "section") {
    return block.columns.flatMap((column) =>
      column.blocks.flatMap((child) =>
        siteBlockMediaAssetIds(child as SitePageLayout["blocks"][number]),
      ),
    );
  }
  return [];
}

/** All managed assets referenced by saved draft content, before publication. */
export function siteDraftMediaAssetIds(
  draftInput: unknown,
): ReadonlySet<string> {
  const draft = siteDraftV1Schema.parse(draftInput);
  const ids = new Set<string>();
  if (draft.branding.logo_asset_id) ids.add(draft.branding.logo_asset_id);
  for (const page of draft.pages) {
    for (const block of page.layout.blocks) {
      for (const assetId of siteBlockMediaAssetIds(block)) ids.add(assetId);
    }
  }
  return ids;
}
