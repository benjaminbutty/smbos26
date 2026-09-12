import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { configurationSnapshotV1Schema } from "../src/core/configuration/definition-source";
import {
  pageLayoutSchema,
  sitePageLayoutSchema,
} from "../src/core/experience/schemas";
import { bookingConfigSchema } from "../src/core/booking/schemas";
import { setPageOperationSchema } from "../src/core/configuration/schemas";
import {
  siteDraftPublicationReadyV1Schema,
  siteDraftV1Schema,
  siteFormChoiceOptionsForPublication,
  sitePublicProjectionSchema,
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
  it("keeps Booking source identity Site-private while preserving the ordinary Page grammar", () => {
    const config = bookingConfigSchema.parse({
      booking_object_key: "booking",
      customer_object_key: "customer",
      subject_object_key: null,
      service_object_key: null,
      relationships: {
        customer_booking: "customer_booking",
        customer_subject: null,
        subject_booking: null,
        service_booking: null,
      },
      field_mappings: {
        customer: { name: "name", email: "email", phone: null },
        booking: {
          start_at: "start_at",
          status: "status",
          default_status: "new",
          date: null,
          time: null,
        },
        subject: null,
        service: null,
      },
      public_fields: [],
      schedule: {
        timezone_source: "business",
        location_id: null,
        days_of_week: [1],
        first_time: "09:00",
        last_time: "10:00",
        slot_interval_minutes: 30,
        capacity_per_slot: 1,
        minimum_notice_minutes: 0,
        booking_horizon_days: 1,
      },
    });
    const layout = {
      blocks: [
        {
          type: "booking" as const,
          id: ids.collection,
          booking_key: "appointments",
          config,
          stable_source_page_id: ids.homePage,
        },
      ],
    };
    expect(sitePageLayoutSchema.safeParse(layout).success).toBe(true);
    expect(pageLayoutSchema.safeParse(layout).success).toBe(false);
  });

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

  it("keeps incomplete Form authoring edits durable until publication readiness", () => {
    const draft = {
      ...validDraft(),
      forms: [
        {
          id: "00000000-0000-4000-8000-000000000040",
          key: "draft_form",
          name: "",
          object_mode: "new" as const,
          object_key: "",
          view_mode: "new" as const,
          questions: [
            {
              id: "00000000-0000-4000-8000-000000000041",
              key: "",
              label: "",
              field_type: "select" as const,
              required: false,
              options: [" First choice ", "", "  "],
              visible_when: {
                field: "",
                operator: "equals" as const,
                value: "",
              },
            },
          ],
        },
      ],
    };
    (draft.pages[0]!.layout.blocks as unknown[]).push({
      type: "public_form",
      id: "00000000-0000-4000-8000-000000000042",
      form_key: "draft_form",
    });
    const parsedDraft = siteDraftV1Schema.safeParse(draft);
    expect(parsedDraft.success).toBe(true);
    if (parsedDraft.success) {
      expect(parsedDraft.data.forms?.[0]?.questions[0]?.options).toEqual([
        " First choice ",
        "",
        "  ",
      ]);
      expect(
        siteFormChoiceOptionsForPublication(
          parsedDraft.data.forms?.[0]?.questions[0]?.options,
        ),
      ).toEqual(["First choice"]);
    }
    expect(siteDraftPublicationReadyV1Schema.safeParse(draft).success).toBe(
      false,
    );

    const unplaced = structuredClone(draft) as typeof draft;
    unplaced.forms![0]!.key = "unplaced_form";
    const unplacedBlocks = unplaced.pages[0]!.layout.blocks as unknown[];
    const formBlockIndex = unplacedBlocks.findIndex(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "public_form",
    );
    if (formBlockIndex >= 0) unplacedBlocks.splice(formBlockIndex, 1);
    expect(siteDraftPublicationReadyV1Schema.safeParse(unplaced).success).toBe(
      true,
    );
  });

  it("uses trimmed choice domains for publication conditions while retaining draft lines", () => {
    const draft = structuredClone(validDraft()) as ReturnType<
      typeof validDraft
    > & {
      forms?: unknown[];
    };
    draft.forms = [
      {
        id: "00000000-0000-4000-8000-000000000050",
        key: "choice_form",
        name: "Choice form",
        object_mode: "new",
        object_key: "choice_table",
        singular_label: "Choice",
        plural_label: "Choices",
        view_mode: "new",
        view_key: "choice_view",
        view_name: "Choices",
        questions: [
          {
            id: "00000000-0000-4000-8000-000000000051",
            key: "kind",
            label: "Kind",
            field_type: "select",
            required: false,
            options: [" Yes ", ""],
          },
          {
            id: "00000000-0000-4000-8000-000000000052",
            key: "details",
            label: "Details",
            field_type: "short_text",
            required: true,
            visible_when: {
              field: "kind",
              operator: "equals",
              value: "Yes",
            },
          },
        ],
      },
    ];
    (draft.pages[0]!.layout.blocks as unknown[]).push({
      type: "public_form",
      id: "00000000-0000-4000-8000-000000000053",
      form_key: "choice_form",
    });

    const parsed = siteDraftV1Schema.parse(draft);
    expect(parsed.forms?.[0]?.questions[0]?.options).toEqual([" Yes ", ""]);
    expect(siteDraftPublicationReadyV1Schema.safeParse(parsed).success).toBe(
      true,
    );

    const duplicate = structuredClone(parsed);
    duplicate.forms![0]!.questions[0]!.options = ["Yes", " Yes "];
    expect(siteDraftPublicationReadyV1Schema.safeParse(duplicate).success).toBe(
      false,
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

  it("parses the finite Customer binding emitted into a canonical Form snapshot", () => {
    const customerBinding = {
      enabled: true,
      customer_object_key: "customer",
      relationship_key: "customer_has_enquiry",
      email_field_key: "email",
      mappings: [
        { customer_field_key: "name", question_key: "name" },
        {
          customer_field_key: "email",
          question_key: "email",
          default_value: "unknown@example.test",
        },
        {
          customer_field_key: "phone",
          question_key: "",
          default_value: "020 7000 0000",
        },
      ],
    };
    const objectDefinitionId = crypto.randomUUID();
    const disabledBinding = {
      enabled: false,
      customer_object_key: "",
      relationship_key: "",
      email_field_key: "",
      mappings: [
        {
          customer_field_key: "",
          question_key: "",
          default_value: "Retained while disconnected",
        },
      ],
    };
    const parsed = configurationSnapshotV1Schema.parse({
      schema_version: 1,
      object_definitions: [],
      field_definitions: [],
      relationship_definitions: [],
      views: [],
      forms: [
        {
          id: crypto.randomUUID(),
          key: "customer_enquiry",
          name: "Customer enquiry",
          object_definition_id: objectDefinitionId,
          object_key: "enquiry",
          mode: "create",
          config_json: {
            fields: [
              { field: "name", label: "Name", required: true },
              { field: "email", label: "Email", required: true },
            ],
            submit_label: "Send enquiry",
            customer_binding: customerBinding,
          },
          audience: "public",
          is_active: true,
        },
        {
          id: crypto.randomUUID(),
          key: "disconnected_enquiry",
          name: "Disconnected enquiry",
          object_definition_id: objectDefinitionId,
          object_key: "enquiry",
          mode: "create",
          config_json: {
            fields: [{ field: "subject", label: "Subject" }],
            customer_binding: disabledBinding,
          },
          audience: "public",
          is_active: true,
        },
      ],
      pages: [],
      preorder_experiences: [],
      preorder_experience_locations: [],
    });

    expect(parsed.forms[0]?.config_json.customer_binding).toEqual(
      customerBinding,
    );
    expect(parsed.forms[1]?.config_json.customer_binding).toEqual(
      disabledBinding,
    );
  });

  it("rejects private identities and storage metadata in anonymous projections", () => {
    const publicId = `r_${"a".repeat(64)}`;
    const publicKey = `b_${"b".repeat(64)}`;
    const valid = {
      schema_version: 2,
      branding: { name: "Moss and Stone", accent: "forest" },
      pages: [
        {
          public_key: publicKey,
          title: "Home",
          slug: "home",
          navigation_label: "Home",
          is_home: true,
          is_in_navigation: true,
          layout: {
            blocks: [
              {
                type: "collection",
                public_key: publicKey,
                records: [{ public_id: publicId, values: { id: "safe" } }],
              },
              {
                type: "record_detail",
                public_key: publicKey,
                display_field_keys: ["name"],
              },
              {
                type: "section",
                public_key: publicKey,
                width: "wide",
                spacing: "spacious",
                alignment: "center",
                background: "tint",
                columns: [{ blocks: [] }],
              },
            ],
          },
        },
      ],
    };
    expect(sitePublicProjectionSchema.safeParse(valid).success).toBe(true);
    expect(
      sitePublicProjectionSchema.safeParse({
        ...valid,
        pages: [
          {
            ...valid.pages[0],
            layout: {
              blocks: [
                { type: "image", public_key: publicKey, asset_id: ids.detail },
              ],
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      sitePublicProjectionSchema.safeParse({
        ...valid,
        pages: [
          {
            ...valid.pages[0],
            layout: {
              blocks: [
                {
                  type: "image",
                  public_key: publicKey,
                  storage_key: "private/path",
                },
              ],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
