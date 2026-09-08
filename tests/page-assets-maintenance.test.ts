import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cleanupUnreferencedPageAssets,
  referencedPageAssetIds,
} from "../src/runtime/media/page-assets-maintenance";

const businessId = "00000000-0000-4000-8000-000000000001";
const pageId = "00000000-0000-4000-8000-000000000002";

function snapshot(layout: unknown) {
  return {
    schema_version: 1 as const,
    object_definitions: [],
    field_definitions: [],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [
      {
        id: pageId,
        key: "opening",
        title: "Opening",
        slug: "opening",
        audience: "internal" as const,
        layout_json: layout,
        status: "draft" as const,
        is_active: true,
      },
    ],
    preorder_experiences: [],
    preorder_experience_locations: [],
  };
}

describe("historical Page asset references", () => {
  it("retains managed images inside contained sections across every Version", () => {
    const retained = referencedPageAssetIds([
      snapshot({
        blocks: [
          {
            type: "collapsible",
            summary: "Open",
            blocks: [
              {
                type: "image",
                asset_id: businessId,
                alt: "A useful image",
              },
            ],
          },
        ],
      }),
    ]);

    expect(retained).toEqual(new Set([businessId]));
  });

  it("fails closed when a historical snapshot cannot be parsed", () => {
    expect(() =>
      referencedPageAssetIds([snapshot({ blocks: [{ type: "unsafe" }] })]),
    ).toThrow();
  });

  it("retains assets referenced only by older Versions and removes unreferenced objects", async () => {
    const retainedId = businessId;
    const orphanId = "00000000-0000-4000-8000-000000000003";
    const historical = snapshot({
      blocks: [
        {
          type: "image",
          asset_id: retainedId,
          alt: "Still needed",
        },
      ],
    });
    const calls: string[] = [];
    const remove = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn((table: string) => {
        calls.push(table);
        if (table === "configuration_versions") {
          const query = {
            eq: vi.fn(() => query),
            range: vi.fn().mockResolvedValue({
              data: [{ snapshot_json: historical }],
              error: null,
            }),
            select: vi.fn(() => query),
          };
          return query;
        }
        if (table === "media_assets") {
          const query = {
            delete: vi.fn(() => query),
            eq: vi.fn(() => query),
            in: vi.fn().mockResolvedValue({ error: null }),
            lt: vi.fn(() => query),
            range: vi.fn().mockResolvedValue({
              data: [
                {
                  created_at: "2026-09-01T00:00:00.000Z",
                  id: retainedId,
                  storage_key: `${businessId}/${retainedId}.png`,
                },
                {
                  created_at: "2026-09-01T00:00:00.000Z",
                  id: orphanId,
                  storage_key: `${businessId}/${orphanId}.png`,
                },
              ],
              error: null,
            }),
            select: vi.fn(() => query),
          };
          return query;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      storage: { from: vi.fn(() => ({ remove })) },
    };

    const result = await cleanupUnreferencedPageAssets(client as never, {
      businessId,
      olderThan: new Date("2026-09-02T00:00:00.000Z"),
    });

    expect(result).toEqual({
      deletedAssetIds: [orphanId],
      inspectedAssets: 2,
      retainedAssetIds: [retainedId],
    });
    expect(calls).toEqual([
      "configuration_versions",
      "media_assets",
      "media_assets",
    ]);
    expect(remove).toHaveBeenCalledWith([`${businessId}/${orphanId}.png`]);
  });
});
