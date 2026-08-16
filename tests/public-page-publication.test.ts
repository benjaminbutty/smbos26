import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../src/core/configuration/definition-source";
import {
  composePublicPagePublicationOperation,
  PublicPagePublicationError,
} from "../src/core/configuration/publication/page-service";
import { publicPagePublicationFormSchema } from "../src/core/configuration/publication/schemas";

const pageId = "00000000-0000-4000-8000-000000000101";

function sitePage(
  overrides: Partial<ConfigurationSnapshotV1["pages"][number]> = {},
) {
  return {
    id: pageId,
    key: "booking_site",
    title: "Book online",
    slug: "book-online",
    audience: "public" as const,
    layout_json: {
      blocks: [
        { type: "heading" as const, text: "Book online", level: 1 as const },
      ],
    },
    status: "draft" as const,
    is_active: true,
    ...overrides,
  };
}

function snapshot(page = sitePage()): ConfigurationSnapshotV1 {
  return configurationSnapshotV1Schema.parse({
    schema_version: 1,
    object_definitions: [],
    field_definitions: [],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [page],
    preorder_experiences: [],
    preorder_experience_locations: [],
  });
}

describe("Journey 1 public Site publication", () => {
  it("changes only the selected public Page status", () => {
    const page = snapshot().pages[0]!;
    expect(composePublicPagePublicationOperation(snapshot(), page.key)).toEqual(
      {
        op: "set_page",
        key: page.key,
        title: page.title,
        slug: page.slug,
        audience: page.audience,
        layout_json: page.layout_json,
        status: "published",
        is_active: page.is_active,
      },
    );
  });

  it("fails closed for internal, inactive, and already published Pages", () => {
    for (const page of [
      sitePage({ audience: "internal" }),
      sitePage({ is_active: false }),
      sitePage({ status: "published" }),
    ]) {
      expect(() =>
        composePublicPagePublicationOperation(snapshot(page), page.key),
      ).toThrow(PublicPagePublicationError);
    }
    expect(() =>
      composePublicPagePublicationOperation(snapshot(), "missing_site"),
    ).toThrowError(expect.objectContaining({ code: "public_page_missing" }));
  });

  it("accepts only the bounded page publication form", () => {
    expect(
      publicPagePublicationFormSchema.safeParse({
        pageKey: "booking_site",
        expectedBaseVersionId: "00000000-0000-4000-8000-000000000102",
        expectedHeadRevision: 2,
      }).success,
    ).toBe(true);
    expect(
      publicPagePublicationFormSchema.safeParse({
        pageKey: "booking_site",
        expectedBaseVersionId: "not-a-uuid",
        expectedHeadRevision: 2,
      }).success,
    ).toBe(false);
  });
});
