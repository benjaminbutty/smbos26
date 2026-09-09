import { describe, expect, it } from "vitest";

import { configurationSnapshotV1Schema } from "../src/core/configuration/definition-source";
import { pageLayoutSchema } from "../src/core/experience/schemas";
import { setPageOperationSchema } from "../src/core/configuration/schemas";
import { siteDraftV1Schema } from "../src/core/sites/schemas";

const ids = {
  collection: "00000000-0000-4000-8000-000000000001",
  secondCollection: "00000000-0000-4000-8000-000000000006",
  detail: "00000000-0000-4000-8000-000000000002",
  detailPage: "00000000-0000-4000-8000-000000000003",
  homePage: "00000000-0000-4000-8000-000000000004",
  section: "00000000-0000-4000-8000-000000000005",
};

function validDraft() {
  return {
    schema_version: 1,
    branding: { name: "Moss and Stone", accent: "forest" },
    pages: [
      {
        id: ids.homePage,
        title: "Home",
        slug: "home",
        navigation_label: "Home",
        is_home: true,
        is_in_navigation: true,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "collection",
              id: ids.collection,
              object_key: "product",
              selection: { schema_version: 1, record_ids: [] as string[] },
              public_field_keys: ["name", "price"],
              presentation: "cards",
              detail_page_id: ids.detailPage,
            },
          ],
        },
      },
      {
        id: ids.detailPage,
        title: "Product",
        slug: "product",
        navigation_label: "Product",
        is_home: false,
        is_in_navigation: false,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "section",
              id: ids.section,
              columns: [
                {
                  blocks: [
                    {
                      type: "record_detail",
                      id: ids.detail,
                      collection_block_id: ids.collection,
                      public_field_keys: ["name"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

describe("Lenni Sites C1 composition schema", () => {
  it("accepts an empty explicit collection and its cross-Page detail layout", () => {
    const draft = siteDraftV1Schema.parse(validDraft());
    expect(draft.pages[0]!.layout.blocks[0]).toMatchObject({
      selection: { record_ids: [] },
      type: "collection",
    });
  });

  it("keeps the 500-record budget Site-wide, not once per collection", () => {
    const draft = validDraft();
    const firstRecordIds = Array.from(
      { length: 300 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    );
    const secondRecordIds = Array.from(
      { length: 201 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
    );
    const collection = draft.pages[0]!.layout.blocks[0]!;
    if (!("selection" in collection)) throw new Error("Fixture is invalid.");
    collection.selection.record_ids = firstRecordIds;
    const firstPage = draft.pages[0]!;
    const draftWithTwoCollections = {
      ...draft,
      pages: [
        {
          ...firstPage,
          layout: {
            blocks: [
              ...firstPage.layout.blocks,
              {
                type: "collection",
                id: ids.secondCollection,
                object_key: "product",
                selection: { schema_version: 1, record_ids: secondRecordIds },
                public_field_keys: ["name"],
                presentation: "cards",
              },
            ],
          },
        },
        draft.pages[1]!,
      ],
    };
    expect(siteDraftV1Schema.safeParse(draftWithTwoCollections).success).toBe(
      false,
    );
  });

  it("rejects a detail layout assigned to the wrong Page", () => {
    const draft = validDraft();
    const collection = draft.pages[0]!.layout.blocks[0]!;
    if (!("detail_page_id" in collection)) {
      throw new Error("Fixture is invalid.");
    }
    collection.detail_page_id = ids.homePage;
    expect(siteDraftV1Schema.safeParse(draft).success).toBe(false);
  });

  it("rejects a detail layout without its collection's declared detail Page", () => {
    const draft = validDraft();
    const collection = draft.pages[0]!.layout.blocks[0]!;
    if (!("detail_page_id" in collection)) {
      throw new Error("Fixture is invalid.");
    }
    const withoutDetailPage = Object.fromEntries(
      Object.entries(collection).filter(([key]) => key !== "detail_page_id"),
    );
    const withoutDetail = {
      ...draft,
      pages: [
        {
          ...draft.pages[0]!,
          layout: { blocks: [withoutDetailPage] },
        },
        draft.pages[1]!,
      ],
    };
    expect(siteDraftV1Schema.safeParse(withoutDetail).success).toBe(false);
  });

  it("rejects a detail field outside its collection's public fields", () => {
    const draft = validDraft();
    const section = draft.pages[1]!.layout.blocks[0]!;
    if (!("columns" in section)) throw new Error("Fixture is invalid.");
    section.columns[0]!.blocks[0]!.public_field_keys = ["sku"];
    expect(siteDraftV1Schema.safeParse(draft).success).toBe(false);
  });

  it("does not weaken the ordinary internal Page grammar", () => {
    const internalView = {
      blocks: [{ type: "view", view_key: "tasks" }],
    };
    expect(pageLayoutSchema.safeParse(internalView).success).toBe(true);

    const original = validDraft();
    const siteDraft = {
      ...original,
      pages: [
        {
          ...original.pages[0]!,
          layout: { blocks: [internalView.blocks[0]!] },
        },
        original.pages[1]!,
      ],
    };
    expect(siteDraftV1Schema.safeParse(siteDraft).success).toBe(false);
  });

  it("parses a public draft Site backing Page beside an ordinary internal Page", () => {
    const draft = validDraft();
    const snapshot = {
      schema_version: 1,
      object_definitions: [],
      field_definitions: [],
      relationship_definitions: [],
      views: [],
      forms: [],
      pages: [
        {
          id: ids.homePage,
          key: "internal_tasks",
          title: "Tasks",
          slug: "tasks",
          audience: "internal",
          layout_json: { blocks: [{ type: "view", view_key: "tasks" }] },
          status: "draft",
          is_active: true,
        },
        {
          id: ids.detailPage,
          key: "site_backing",
          title: "Private Site backing Page",
          slug: "site-backing",
          audience: "public",
          layout_json: draft.pages[1]!.layout,
          status: "draft",
          is_active: true,
        },
      ],
      preorder_experiences: [],
      preorder_experience_locations: [],
    };
    expect(configurationSnapshotV1Schema.safeParse(snapshot).success).toBe(
      true,
    );
    expect(
      setPageOperationSchema.safeParse({
        op: "set_page",
        key: "internal_tasks",
        title: "Tasks",
        slug: "tasks",
        audience: "internal",
        layout_json: snapshot.pages[0]!.layout_json,
        status: "draft",
        is_active: true,
      }).success,
    ).toBe(true);
  });
});
