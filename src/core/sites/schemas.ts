import { z } from "zod";

import {
  siteCollectionBlockSchema,
  siteDraftImageBlockSchema,
  siteGalleryBlockSchema,
  sitePageLayoutSchema,
  siteRecordDetailBlockSchema,
  siteSharedAtomicBlockSchema,
  type SitePageLayout,
} from "../experience/schemas";
import { jsonObjectSchema } from "../graph/schemas";

const siteNameSchema = z.string().trim().min(1).max(120);
const siteDraftTextSchema = z.string().trim().max(120);
const siteSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const siteAccentSchema = z.enum(["coral", "clay", "forest", "ocean", "plum"]);

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

export const siteDraftV1Schema = z
  .object({
    schema_version: z.literal(1),
    branding: siteDraftBrandingSchema,
    pages: z.array(sitePageSchema).max(20),
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
    width: z.enum(["content", "wide"]).default("content"),
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
