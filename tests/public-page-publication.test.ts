import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../src/core/configuration/definition-source";
import {
  composePublicPagePublicationOperation,
  publishPublicPage,
  PublicPagePublicationError,
} from "../src/core/configuration/publication/page-service";
import type { ConfigurationChangeService } from "../src/core/configuration/service";
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

  it("reloads currentness and publishes through the existing lifecycle", async () => {
    const proposed = { id: "00000000-0000-4000-8000-000000000103" };
    const configuration = {
      getActiveHead: vi.fn().mockResolvedValue({
        active_version_id: "00000000-0000-4000-8000-000000000102",
        head_revision: 7,
      }),
      getVersion: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000102",
        snapshot_json: snapshot(),
      }),
      proposeChangeSet: vi.fn().mockResolvedValue(proposed),
      validateChangeSet: vi.fn().mockResolvedValue({ status: "validated" }),
      applyChangeSet: vi.fn().mockResolvedValue({ status: "applied" }),
    } as unknown as ConfigurationChangeService;

    await publishPublicPage(configuration, { pageKey: "booking_site" });

    expect(configuration.proposeChangeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedBaseVersionId: "00000000-0000-4000-8000-000000000102",
        expectedHeadRevision: 7,
        operations: [
          expect.objectContaining({
            op: "set_page",
            key: "booking_site",
            status: "published",
          }),
        ],
      }),
    );
    expect(configuration.validateChangeSet).toHaveBeenCalledWith(proposed.id);
    expect(configuration.applyChangeSet).toHaveBeenCalledWith(proposed.id);
  });

  it("fails closed when validation does not return a validated proposal", async () => {
    const configuration = {
      getActiveHead: vi.fn().mockResolvedValue({
        active_version_id: "00000000-0000-4000-8000-000000000102",
        head_revision: 7,
      }),
      getVersion: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000102",
        snapshot_json: snapshot(),
      }),
      proposeChangeSet: vi
        .fn()
        .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000103" }),
      validateChangeSet: vi.fn().mockResolvedValue({ status: "rejected" }),
      applyChangeSet: vi.fn(),
    } as unknown as ConfigurationChangeService;

    await expect(
      publishPublicPage(configuration, { pageKey: "booking_site" }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "public_page_validation_failed" }),
    );
    expect(configuration.applyChangeSet).not.toHaveBeenCalled();
  });
});
