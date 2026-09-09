import { z } from "zod";

import {
  pageBlockSchema,
  siteCollectionBlockSchema,
  siteGalleryBlockSchema,
  sitePageLayoutSchema,
  siteRecordDetailBlockSchema,
  type SitePageLayout,
} from "../experience/schemas";
import { jsonObjectSchema } from "../graph/schemas";

const siteNameSchema = z.string().trim().min(1).max(120);
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

export const sitePageSchema = z
  .object({
    /**
     * This identifies the page inside the Site draft only. PostgreSQL derives
     * the canonical Page key and receives its trusted configuration UUID from
     * the ordinary configuration allocator; callers never choose that ID.
     */
    id: z.uuid(),
    title: siteNameSchema,
    slug: siteSlugSchema,
    navigation_label: z.string().trim().min(1).max(80),
    is_home: z.boolean(),
    is_in_navigation: z.boolean(),
    is_included: z.boolean(),
    layout: sitePageLayoutSchema,
  })
  .strict();

export const siteDraftV1Schema = z
  .object({
    schema_version: z.literal(1),
    branding: siteBrandingSchema,
    pages: z.array(sitePageSchema).min(1).max(20),
  })
  .strict()
  .superRefine((draft, context) => {
    const pageIds = draft.pages.map((page) => page.id);
    const slugs = draft.pages.map((page) => page.slug);
    const homes = draft.pages.filter((page) => page.is_home);
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
    if (homes.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "A Site needs exactly one Home Page.",
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
    for (const page of draft.pages) {
      if (page.is_home && !page.is_included) {
        context.addIssue({
          code: "custom",
          message: "The Home Page must be included in the next release.",
          path: ["pages"],
        });
      }
      if (page.is_in_navigation && !page.is_included) {
        context.addIssue({
          code: "custom",
          message: "Only included Pages can appear in Site navigation.",
          path: ["pages"],
        });
      }
    }
  });

export type SiteDraftV1 = z.infer<typeof siteDraftV1Schema>;

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

const siteProjectedGalleryBlockSchema = siteGalleryBlockSchema.safeExtend({
  id: z.uuid(),
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

const siteProjectedSectionChildBlockSchema = z.union([
  pageBlockSchema,
  siteProjectedGalleryBlockSchema,
  siteProjectedCollectionBlockSchema,
  siteProjectedRecordDetailBlockSchema,
]);

const siteProjectedSectionBlockSchema = z
  .object({
    type: z.literal("section"),
    width: z.enum(["content", "wide"]).default("content"),
    columns: z
      .array(
        z
          .object({
            blocks: z.array(siteProjectedSectionChildBlockSchema).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    id: z.uuid(),
  })
  .strict();

const siteProjectedPageBlockSchema = z.union([
  pageBlockSchema,
  siteProjectedGalleryBlockSchema,
  siteProjectedCollectionBlockSchema,
  siteProjectedRecordDetailBlockSchema,
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

const siteReleaseProjectionPageSchema = sitePageSchema
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
      !siteDraftV1Schema.safeParse(
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
    return block.images.map((image) => image.asset_id);
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
