import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composeDirectPageAction,
  DirectPageComposerError,
} from "../src/core/configuration/direct-pages/composer";
import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";
import {
  pageLayoutSchema,
  type PageLayout,
} from "../src/core/experience/schemas";

const pageId = "00000000-0000-4000-8000-000000000001";
const objectId = "00000000-0000-4000-8000-000000000002";
const viewId = "00000000-0000-4000-8000-000000000003";

const snapshot: ConfigurationSnapshotV1 = {
  schema_version: 1,
  object_definitions: [
    {
      id: objectId,
      key: "contacts",
      singular_label: "Contact",
      plural_label: "Contacts",
      description: "",
      kind: "custom",
      semantic_type: null,
      icon: null,
      is_active: true,
    },
  ],
  field_definitions: [],
  relationship_definitions: [],
  views: [
    {
      id: viewId,
      key: "contacts",
      name: "Contacts",
      view_type: "table",
      object_definition_id: objectId,
      object_key: "contacts",
      config_json: {
        fields: ["name"],
        title_field: "name",
        include_archived: false,
      },
      audience: "internal",
      is_active: true,
    },
  ],
  forms: [],
  pages: [
    {
      id: pageId,
      key: "workspace",
      title: "Workspace",
      slug: "workspace",
      audience: "internal",
      layout_json: {
        blocks: [
          { type: "heading", text: "Welcome", level: 2 },
          { type: "view", view_key: "contacts" },
        ],
      },
      status: "draft",
      is_active: true,
    },
  ],
  preorder_experiences: [],
  preorder_experience_locations: [],
};

describe("Page grammar and direct Workspace composer", () => {
  it("accepts empty Pages, bounded Callouts, and read-only Views", () => {
    const layout = pageLayoutSchema.parse({
      blocks: [
        { type: "callout", text: "Ready", tone: "success" },
        { type: "view", view_key: "contacts", read_only: true },
      ],
    });

    expect(pageLayoutSchema.parse({ blocks: [] })).toEqual({ blocks: [] });
    expect(layout.blocks[0]).toMatchObject({
      type: "callout",
      text: "Ready",
      tone: "success",
    });
    expect(layout.blocks[1]).toMatchObject({
      type: "view",
      view_key: "contacts",
      read_only: true,
    });
  });

  it("rejects duplicate stable block IDs", () => {
    expect(() =>
      pageLayoutSchema.parse({
        blocks: [
          {
            type: "text",
            text: "One",
            id: "00000000-0000-4000-8000-000000000010",
          },
          {
            type: "divider",
            id: "00000000-0000-4000-8000-000000000010",
          },
        ],
      }),
    ).toThrow(/unique IDs/);
  });

  it("creates a bounded empty internal Page with deterministic identities", () => {
    const result = composeDirectPageAction(snapshot, {
      action: "create_page",
      title: "Catering Enquiries",
    });

    expect(result.actionKind).toBe("create_page");
    expect(result.pageKey).toBe("catering_enquiries");
    expect(result.pageSlug).toBe("catering-enquiries");
    expect(result.operations).toEqual([
      expect.objectContaining({
        op: "set_page",
        key: "catering_enquiries",
        slug: "catering-enquiries",
        audience: "internal",
        status: "draft",
        is_active: true,
        layout_json: { blocks: [] },
      }),
    ]);
  });

  it("preserves historical block IDs on rename and assigns IDs on layout save", () => {
    const renamed = composeDirectPageAction(snapshot, {
      action: "rename_page",
      pageKey: "workspace",
      title: "Operations",
    });
    const renamedLayout = (renamed.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(renamedLayout).toEqual(snapshot.pages[0]!.layout_json);

    const saved = composeDirectPageAction(snapshot, {
      action: "save_page_layout",
      pageKey: "workspace",
      layout: { blocks: [{ type: "text", text: "Updated" }] },
    });
    const savedLayout = (saved.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(savedLayout.blocks[0]).toMatchObject({
      type: "text",
      text: "Updated",
    });
    expect(savedLayout.blocks[0]).toHaveProperty("id");
  });

  it("fails closed for duplicate names and unknown Pages", () => {
    expect(() =>
      composeDirectPageAction(snapshot, {
        action: "create_page",
        title: "Workspace",
      }),
    ).toThrowError(DirectPageComposerError);
    expect(() =>
      composeDirectPageAction(snapshot, {
        action: "rename_page",
        pageKey: "missing",
        title: "Operations",
      }),
    ).toThrowError(DirectPageComposerError);
  });
});
