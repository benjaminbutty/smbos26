import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { configurationSnapshotV1Schema } from "../src/core/configuration/definition-source";
import { pageLayoutSchema } from "../src/core/experience/schemas";
import { setPageOperationSchema } from "../src/core/configuration/schemas";
import {
  siteDraftPublicationReadyV1Schema,
  siteDraftV1Schema,
  siteReleaseProjectionSchema,
  siteReleaseReviewSchema,
} from "../src/core/sites/schemas";

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
  it("persists finite incomplete author input regardless of Page inclusion, then rejects it at preparation", () => {
    const incompletePage = {
      id: "00000000-0000-4000-8000-000000000020",
      title: "",
      slug: "",
      navigation_label: "",
      is_home: false,
      is_in_navigation: false,
      is_included: true,
      layout: {
        blocks: [
          {
            type: "heading",
            id: "00000000-0000-4000-8000-000000000021",
            text: "",
            level: 2,
            draft_state: "incomplete",
          },
          {
            type: "button",
            id: "00000000-0000-4000-8000-000000000022",
            label: "",
            href: "",
            draft_state: "incomplete",
          },
          {
            type: "image",
            id: "00000000-0000-4000-8000-000000000023",
            alt: "",
            draft_state: "incomplete",
          },
          {
            type: "gallery",
            id: "00000000-0000-4000-8000-000000000024",
            images: [
              { alt: "", draft_state: "incomplete" },
              { alt: "", draft_state: "incomplete" },
            ],
            draft_state: "incomplete",
          },
          {
            type: "collection",
            id: "00000000-0000-4000-8000-000000000025",
            selection: { schema_version: 1, record_ids: [] },
            public_field_keys: [],
            draft_state: "incomplete",
          },
          {
            type: "collapsible",
            id: "00000000-0000-4000-8000-000000000028",
            summary: "",
            draft_state: "incomplete",
            blocks: [
              {
                type: "image",
                id: "00000000-0000-4000-8000-000000000029",
                alt: "",
                draft_state: "incomplete",
              },
            ],
          },
        ],
      },
    };
    const draft = {
      ...validDraft(),
      branding: { name: "", accent: "forest" },
      pages: [...validDraft().pages, incompletePage],
    };
    expect(siteDraftV1Schema.safeParse(draft).success).toBe(true);
    expect(siteDraftPublicationReadyV1Schema.safeParse(draft).success).toBe(
      false,
    );
    expect(siteDraftV1Schema.safeParse({ ...draft, pages: [] }).success).toBe(
      true,
    );
  });

  it("keeps excluded unfinished content durable and omits it from the publication-ready grammar", () => {
    const draft = validDraft();
    const excluded = {
      id: "00000000-0000-4000-8000-000000000027",
      title: "",
      slug: "",
      navigation_label: "",
      is_home: false,
      is_in_navigation: false,
      is_included: false,
      layout: {
        blocks: [
          {
            type: "heading",
            id: "00000000-0000-4000-8000-000000000026",
            text: "",
            draft_state: "incomplete",
          },
        ],
      },
    };
    const persisted = { ...draft, pages: [...draft.pages, excluded] };
    expect(siteDraftV1Schema.safeParse(persisted).success).toBe(true);
    expect(siteDraftPublicationReadyV1Schema.safeParse(persisted).success).toBe(
      true,
    );
    expect(
      siteDraftPublicationReadyV1Schema.safeParse({
        ...persisted,
        pages: [...draft.pages, { ...excluded, is_included: true }],
      }).success,
    ).toBe(false);
  });

  it("permits exactly two levels of Site collapsibles and preserves complete-content rules", () => {
    const allowed = structuredClone(validDraft()) as {
      pages: Array<{ layout: { blocks: unknown[] } }>;
    };
    allowed.pages[0]!.layout.blocks.push({
      type: "collapsible",
      id: "00000000-0000-4000-8000-000000000030",
      summary: "Top level",
      blocks: [
        {
          type: "collapsible",
          id: "00000000-0000-4000-8000-000000000031",
          summary: "Second level",
          blocks: [
            {
              type: "heading",
              id: "00000000-0000-4000-8000-000000000032",
              text: "Deepest allowed",
              level: 2,
            },
          ],
        },
      ],
    });
    expect(siteDraftV1Schema.safeParse(allowed).success).toBe(true);

    const tooDeep = structuredClone(allowed);
    const topLevel = tooDeep.pages[0]!.layout.blocks.at(-1);
    if (
      !topLevel ||
      typeof topLevel !== "object" ||
      topLevel === null ||
      !("blocks" in topLevel) ||
      !Array.isArray(topLevel.blocks)
    ) {
      throw new Error("Fixture is invalid.");
    }
    const secondLevel = topLevel.blocks[0];
    if (
      !secondLevel ||
      typeof secondLevel !== "object" ||
      !("blocks" in secondLevel) ||
      !Array.isArray(secondLevel.blocks)
    ) {
      throw new Error("Fixture is invalid.");
    }
    secondLevel.blocks[0] = {
      type: "collapsible",
      id: "00000000-0000-4000-8000-000000000033",
      summary: "Rejected third level",
      blocks: [
        {
          type: "heading",
          id: "00000000-0000-4000-8000-000000000034",
          text: "Too deep",
          level: 2,
        },
      ],
    };
    expect(siteDraftV1Schema.safeParse(tooDeep).success).toBe(false);

    const whitespace = structuredClone(validDraft()) as {
      pages: Array<{ layout: { blocks: unknown[] } }>;
    };
    whitespace.pages[0]!.layout.blocks.push({
      type: "collapsible",
      id: "00000000-0000-4000-8000-000000000035",
      summary: "   ",
      blocks: [],
    });
    expect(siteDraftV1Schema.safeParse(whitespace).success).toBe(false);

    const incompleteGalleryInCompleteParent = structuredClone(validDraft()) as {
      pages: Array<{ layout: { blocks: unknown[] } }>;
    };
    incompleteGalleryInCompleteParent.pages[0]!.layout.blocks.push({
      type: "gallery",
      id: "00000000-0000-4000-8000-000000000036",
      images: [{ alt: "", draft_state: "incomplete" }],
    });
    expect(
      siteDraftV1Schema.safeParse(incompleteGalleryInCompleteParent).success,
    ).toBe(false);
  });

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

  it("rejects a block identity reused on another Site Page", () => {
    const draft = validDraft();
    const section = draft.pages[1]!.layout.blocks[0]!;
    if (!("id" in section)) throw new Error("Fixture is invalid.");
    section.id = ids.collection;
    expect(siteDraftV1Schema.safeParse(draft).success).toBe(false);
  });

  it("parses only bounded, included release projections and review metadata", () => {
    const draft = validDraft();
    const collection = draft.pages[0]!.layout.blocks[0]!;
    if (!("selection" in collection)) throw new Error("Fixture is invalid.");
    const nestedCollection = {
      ...collection,
      records: [
        {
          id: "00000000-0000-4000-8000-000000000007",
          values: { name: "Frozen", price: 10 },
        },
      ],
    };
    const featuredBlocks = [
      {
        type: "image" as const,
        id: "00000000-0000-4000-8000-000000000038",
        asset_id: "00000000-0000-4000-8000-000000000039",
        alt: "Featured product",
        draft_state: "complete" as const,
      },
      {
        type: "gallery" as const,
        id: "00000000-0000-4000-8000-000000000040",
        draft_state: "complete" as const,
        images: [
          {
            asset_id: "00000000-0000-4000-8000-000000000041",
            alt: "Product collection",
            draft_state: "complete" as const,
          },
        ],
      },
      nestedCollection,
    ];
    const featured = {
      type: "collapsible" as const,
      id: "00000000-0000-4000-8000-000000000037",
      summary: "Frozen featured products",
      draft_state: "complete" as const,
      blocks: featuredBlocks,
    };
    const projection = {
      schema_version: 1,
      branding: draft.branding,
      pages: [
        {
          ...draft.pages[0],
          layout: {
            blocks: [featured],
          },
        },
        draft.pages[1],
      ],
    };
    collection.selection.record_ids = ["00000000-0000-4000-8000-000000000007"];
    expect(siteReleaseProjectionSchema.safeParse(projection).success).toBe(
      true,
    );
    expect(
      siteReleaseProjectionSchema.safeParse({
        ...projection,
        pages: [
          {
            ...projection.pages[0],
            layout: {
              blocks: [
                {
                  ...featured,
                  blocks: [
                    { ...featured.blocks[0], untrusted_key: true },
                    ...featured.blocks.slice(1),
                  ],
                },
              ],
            },
          },
          projection.pages[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      siteReleaseProjectionSchema.safeParse({
        ...projection,
        pages: [
          {
            ...projection.pages[0],
            is_included: false,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      siteReleaseProjectionSchema.safeParse({
        ...projection,
        pages: [
          {
            ...projection.pages[0],
            layout: {
              blocks: [
                {
                  ...featured,
                  blocks: [
                    ...featured.blocks.slice(0, 2),
                    {
                      ...nestedCollection,
                      records: [
                        {
                          id: "00000000-0000-4000-8000-000000000007",
                          values: {
                            name: "Frozen",
                            price: 10,
                            internal_note: "Private",
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          projection.pages[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      siteReleaseProjectionSchema.safeParse({
        ...projection,
        pages: [
          {
            ...projection.pages[0],
            layout: {
              blocks: [
                {
                  ...featured,
                  blocks: [
                    ...featured.blocks.slice(0, 2),
                    {
                      ...nestedCollection,
                      records: [
                        {
                          id: "00000000-0000-4000-8000-000000000009",
                          values: { name: "Frozen", price: 10 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          projection.pages[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      siteReleaseReviewSchema.safeParse({
        schema_version: 1,
        included_page_ids: [ids.homePage],
        excluded_page_ids: [ids.detailPage],
      }).success,
    ).toBe(true);
    expect(
      siteReleaseReviewSchema.safeParse({
        schema_version: 1,
        included_page_ids: [ids.homePage],
        excluded_page_ids: [ids.homePage],
      }).success,
    ).toBe(false);
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

    const externalImage = {
      blocks: [
        {
          type: "image",
          id: "00000000-0000-4000-8000-000000000008",
          src: "https://example.test/legacy-image.png",
          alt: "Legacy image",
        },
      ],
    };
    expect(pageLayoutSchema.safeParse(externalImage).success).toBe(true);
    expect(
      siteDraftV1Schema.safeParse({
        ...validDraft(),
        pages: [
          {
            ...validDraft().pages[0],
            layout: externalImage,
          },
          validDraft().pages[1],
        ],
      }).success,
    ).toBe(false);

    const nestedExternalImage = {
      blocks: [
        {
          type: "collapsible",
          id: "00000000-0000-4000-8000-000000000030",
          summary: "Legacy image section",
          blocks: [
            {
              type: "image",
              id: "00000000-0000-4000-8000-000000000031",
              src: "https://example.test/legacy-image.png",
              alt: "Legacy image",
            },
          ],
        },
      ],
    };
    expect(pageLayoutSchema.safeParse(nestedExternalImage).success).toBe(true);
    expect(
      siteDraftV1Schema.safeParse({
        ...validDraft(),
        pages: [
          {
            ...validDraft().pages[0],
            layout: nestedExternalImage,
          },
          validDraft().pages[1],
        ],
      }).success,
    ).toBe(false);
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
