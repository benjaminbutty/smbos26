import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composeDirectPageAction,
  DirectPageComposerError,
} from "../src/core/configuration/direct-pages/composer";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../src/core/configuration/definition-source";
import {
  pageLayoutSchema,
  type PageLayout,
} from "../src/core/experience/schemas";

const pageId = "00000000-0000-4000-8000-000000000001";
const objectId = "00000000-0000-4000-8000-000000000002";
const viewId = "00000000-0000-4000-8000-000000000003";
const headingBlockId = "00000000-0000-4000-8000-000000000004";
const viewBlockId = "00000000-0000-4000-8000-000000000005";
const siteButtonBlockId = "00000000-0000-4000-8000-000000000006";
const sectionBlockId = "00000000-0000-4000-8000-000000000009";
const nestedHeadingBlockId = "00000000-0000-4000-8000-00000000000a";

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

const checklistSnapshot: ConfigurationSnapshotV1 = {
  ...snapshot,
  field_definitions: [
    {
      id: "00000000-0000-4000-8000-000000000007",
      object_definition_id: objectId,
      object_key: "contacts",
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 0,
      is_active: true,
    },
    {
      id: "00000000-0000-4000-8000-000000000008",
      object_definition_id: objectId,
      object_key: "contacts",
      key: "completed",
      label: "Completed",
      field_type: "boolean",
      required: false,
      default_value: false,
      settings_json: {},
      position: 1,
      is_active: true,
    },
  ],
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

  it("projects contained Page blocks through the historical snapshot grammar", () => {
    const historical = configurationSnapshotV1Schema.parse({
      ...snapshot,
      pages: [
        {
          ...snapshot.pages[0]!,
          layout_json: {
            blocks: [
              {
                type: "collapsible",
                summary: "Opening",
                blocks: [
                  {
                    type: "view",
                    view_key: "contacts",
                    read_only: true,
                  },
                ],
                open: false,
              },
            ],
          },
        },
      ],
    });

    expect(historical.pages[0]?.layout_json.blocks[0]).toMatchObject({
      type: "collapsible",
      blocks: [{ type: "view", view_key: "contacts", read_only: true }],
    });
  });

  it("accepts only the bounded canonical rich-text grammar", () => {
    const layout = pageLayoutSchema.parse({
      blocks: [
        {
          type: "rich_text",
          node: {
            type: "heading",
            level: 2,
            content: [
              { type: "text", text: "This week", marks: [{ type: "bold" }] },
            ],
          },
        },
        {
          type: "rich_text",
          node: {
            type: "numbered_list",
            items: [
              {
                content: [
                  {
                    type: "text",
                    text: "Open the diary",
                    marks: [{ type: "link", href: "/app/diary" }],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(layout.blocks).toHaveLength(2);

    expect(() =>
      pageLayoutSchema.parse({
        blocks: [
          {
            type: "rich_text",
            node: {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Unsafe",
                  marks: [{ type: "link", href: "javascript:alert(1)" }],
                },
              ],
            },
          },
        ],
      }),
    ).toThrow();
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

  it("composes checklist creation as one bounded page-aware change", () => {
    const result = composeDirectPageAction(checklistSnapshot, {
      action: "create_checklist",
      pageKey: "workspace",
      name: "Opening tasks",
    });

    expect(result.actionKind).toBe("create_checklist");
    expect(result.operations.map((operation) => operation.op)).toEqual([
      "set_object",
      "set_field",
      "set_field",
      "set_view",
      "set_page",
    ]);
    const page = result.operations.at(-1);
    expect(page).toMatchObject({ op: "set_page", key: "workspace" });
    if (page?.op === "set_page") {
      expect(page.layout_json.blocks.at(-1)).toMatchObject({
        type: "view",
        checklist: { label_field: "name", completed_field: "completed" },
      });
    }
  });

  it("requires existing checklist mappings to be visible in the saved View", () => {
    expect(() =>
      composeDirectPageAction(
        {
          ...checklistSnapshot,
          pages: [
            {
              ...checklistSnapshot.pages[0]!,
              layout_json: { blocks: [] },
            },
          ],
          views: checklistSnapshot.views.map((view) => ({
            ...view,
            config_json: {
              ...view.config_json,
              fields: ["name"],
            },
          })),
        },
        {
          action: "add_page_block",
          pageKey: "workspace",
          block: {
            type: "view",
            viewKey: "contacts",
            checklist: { labelField: "name", completedField: "completed" },
          },
        },
      ),
    ).toThrow(DirectPageComposerError);
  });

  it("rejects writable checklist mappings hidden by the saved edit screen", () => {
    const hiddenByEditForm = {
      ...checklistSnapshot,
      views: checklistSnapshot.views.map((view) => ({
        ...view,
        config_json: {
          ...view.config_json,
          fields: ["name", "completed"],
          edit_form_key: "contacts_edit",
        },
      })),
      forms: [
        {
          id: "00000000-0000-4000-8000-00000000000b",
          key: "contacts_edit",
          name: "Edit contact",
          object_definition_id: objectId,
          object_key: "contacts",
          mode: "edit" as const,
          config_json: {
            fields: [
              { field: "name", hidden: true, default_value: "Untitled" },
              { field: "completed", hidden: false },
            ],
          },
          audience: "internal" as const,
          is_active: true,
        },
      ],
    };

    expect(() =>
      composeDirectPageAction(hiddenByEditForm, {
        action: "add_page_block",
        pageKey: "workspace",
        block: {
          type: "view",
          viewKey: "contacts",
          checklist: { labelField: "name", completedField: "completed" },
        },
      }),
    ).toThrow(DirectPageComposerError);

    expect(() =>
      composeDirectPageAction(hiddenByEditForm, {
        action: "add_page_block",
        pageKey: "workspace",
        block: {
          type: "view",
          viewKey: "contacts",
          readOnly: true,
          checklist: { labelField: "name", completedField: "completed" },
        },
      }),
    ).not.toThrow();
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

  it("composes a completed long-distance reorder as one complete Page operation", () => {
    const reordered = composeDirectPageAction(snapshot, {
      action: "save_page_layout",
      pageKey: "workspace",
      layout: {
        blocks: [
          snapshot.pages[0]!.layout_json.blocks[1]!,
          snapshot.pages[0]!.layout_json.blocks[0]!,
        ],
      },
    });

    expect(reordered.operations).toHaveLength(1);
    expect(reordered.operations[0]).toMatchObject({
      op: "set_page",
      key: "workspace",
    });
    const layout = (reordered.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(layout.blocks.map((block) => block.type)).toEqual([
      "view",
      "heading",
    ]);
  });

  it("adds an exact saved View reference without copying View or Record data", () => {
    const result = composeDirectPageAction(snapshot, {
      action: "add_page_block",
      pageKey: "workspace",
      block: { type: "view", viewKey: "contacts" },
    });
    const layout = (result.operations[0] as { layout_json: PageLayout })
      .layout_json;

    expect(layout.blocks).toHaveLength(3);
    expect(layout.blocks[0]).toMatchObject({
      type: "heading",
      text: "Welcome",
    });
    expect(layout.blocks[1]).toMatchObject({
      type: "view",
      view_key: "contacts",
    });
    expect(layout.blocks[1]).not.toHaveProperty("records");
    expect(layout.blocks[1]).not.toHaveProperty("config_json");
    expect(layout.blocks[1]).toHaveProperty("id");
  });

  it("adds a Divider through the direct Page action boundary", () => {
    const result = composeDirectPageAction(snapshot, {
      action: "add_page_block",
      pageKey: "workspace",
      block: { type: "divider" },
    });
    const layout = (result.operations[0] as { layout_json: PageLayout })
      .layout_json;

    expect(layout.blocks.at(-1)).toMatchObject({ type: "divider" });
    expect(layout.blocks.at(-1)).toHaveProperty("id");
  });

  it("inserts a bounded block after a trusted existing block", () => {
    const stableSnapshot: ConfigurationSnapshotV1 = {
      ...snapshot,
      pages: [
        {
          ...snapshot.pages[0]!,
          layout_json: {
            blocks: [
              {
                id: headingBlockId,
                type: "heading",
                text: "Welcome",
                level: 2,
              },
              { id: viewBlockId, type: "view", view_key: "contacts" },
            ],
          },
        },
      ],
    };
    const result = composeDirectPageAction(stableSnapshot, {
      action: "add_page_block",
      pageKey: "workspace",
      afterBlockId: headingBlockId,
      block: { type: "divider" },
    });
    const layout = (result.operations[0] as { layout_json: PageLayout })
      .layout_json;

    expect(layout.blocks.map((block) => block.type)).toEqual([
      "heading",
      "divider",
      "view",
    ]);
    expect(layout.blocks[0]).toMatchObject({ id: headingBlockId });
    expect(layout.blocks[1]).toHaveProperty("id");
    expect(layout.blocks[2]).toMatchObject({ id: viewBlockId });
  });

  it("supports bounded block update, reorder, and removal by stable ID", () => {
    const editableSnapshot: ConfigurationSnapshotV1 = {
      ...snapshot,
      pages: [
        {
          ...snapshot.pages[0]!,
          layout_json: {
            blocks: [
              {
                id: headingBlockId,
                type: "heading",
                text: "Welcome",
                level: 2,
              },
              { id: viewBlockId, type: "view", view_key: "contacts" },
            ],
          },
        },
      ],
    };

    const updated = composeDirectPageAction(editableSnapshot, {
      action: "update_page_block",
      pageKey: "workspace",
      blockId: headingBlockId,
      block: { type: "heading", text: "Daily work", level: 1 },
    });
    const updatedLayout = (updated.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(updatedLayout.blocks[0]).toMatchObject({
      id: headingBlockId,
      type: "heading",
      text: "Daily work",
      level: 1,
    });

    const moved = composeDirectPageAction(editableSnapshot, {
      action: "move_page_block",
      pageKey: "workspace",
      blockId: viewBlockId,
      direction: "up",
    });
    const movedLayout = (moved.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(movedLayout.blocks.map((block) => block.id)).toEqual([
      viewBlockId,
      headingBlockId,
    ]);

    const removed = composeDirectPageAction(editableSnapshot, {
      action: "remove_page_block",
      pageKey: "workspace",
      blockId: viewBlockId,
    });
    const removedLayout = (removed.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(removedLayout.blocks).toEqual([
      expect.objectContaining({ id: headingBlockId }),
    ]);
  });

  it("supports bounded mutations for historical blocks without IDs", () => {
    const updated = composeDirectPageAction(snapshot, {
      action: "update_page_block",
      pageKey: "workspace",
      blockId: "legacy:0",
      block: { type: "heading", text: "Daily work", level: 1 },
    });
    const updatedLayout = (updated.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(updatedLayout.blocks[0]).toMatchObject({
      type: "heading",
      text: "Daily work",
      level: 1,
    });
    expect(updatedLayout.blocks[0]).toHaveProperty("id");

    const moved = composeDirectPageAction(snapshot, {
      action: "move_page_block",
      pageKey: "workspace",
      blockId: "legacy:1",
      direction: "up",
    });
    const movedLayout = (moved.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(movedLayout.blocks.map((block) => block.type)).toEqual([
      "view",
      "heading",
    ]);

    const removed = composeDirectPageAction(snapshot, {
      action: "remove_page_block",
      pageKey: "workspace",
      blockId: "legacy:1",
    });
    const removedLayout = (removed.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(removedLayout.blocks).toHaveLength(1);
    expect(removedLayout.blocks[0]?.type).toBe("heading");
  });

  it("keeps insertion and block controls inside a collapsible section", () => {
    const nestedSnapshot: ConfigurationSnapshotV1 = {
      ...snapshot,
      pages: [
        {
          ...snapshot.pages[0]!,
          layout_json: {
            blocks: [
              {
                id: sectionBlockId,
                type: "collapsible",
                summary: "Opening",
                open: true,
                blocks: [
                  {
                    id: nestedHeadingBlockId,
                    type: "heading",
                    text: "Before",
                    level: 2,
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const inserted = composeDirectPageAction(nestedSnapshot, {
      action: "add_page_block",
      pageKey: "workspace",
      afterBlockId: nestedHeadingBlockId,
      block: { type: "text", text: "Inside" },
    });
    const insertedSection = (
      inserted.operations[0] as { layout_json: PageLayout }
    ).layout_json.blocks[0];
    expect(insertedSection).toMatchObject({
      type: "collapsible",
      blocks: [
        { id: nestedHeadingBlockId, text: "Before" },
        { type: "text", text: "Inside" },
      ],
    });

    const updated = composeDirectPageAction(nestedSnapshot, {
      action: "update_page_block",
      pageKey: "workspace",
      blockId: nestedHeadingBlockId,
      block: { type: "heading", text: "Updated", level: 1 },
    });
    expect(
      (
        (updated.operations[0] as { layout_json: PageLayout }).layout_json
          .blocks[0] as Extract<
          PageLayout["blocks"][number],
          { type: "collapsible" }
        >
      ).blocks[0],
    ).toMatchObject({ id: nestedHeadingBlockId, text: "Updated", level: 1 });

    const moved = composeDirectPageAction(
      {
        ...nestedSnapshot,
        pages: [
          {
            ...nestedSnapshot.pages[0]!,
            layout_json: {
              blocks: [
                {
                  id: sectionBlockId,
                  type: "collapsible",
                  summary: "Opening",
                  open: true,
                  blocks: [
                    {
                      id: nestedHeadingBlockId,
                      type: "heading",
                      text: "Before",
                      level: 2,
                    },
                    { type: "text", text: "After" },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        action: "move_page_block",
        pageKey: "workspace",
        blockId: nestedHeadingBlockId,
        direction: "down",
      },
    );
    const movedSection = (moved.operations[0] as { layout_json: PageLayout })
      .layout_json.blocks[0];
    expect(movedSection).toMatchObject({
      type: "collapsible",
      blocks: [{ text: "After" }, { id: nestedHeadingBlockId }],
    });
  });

  it("fails closed when a Page block references an unavailable View", () => {
    expect(() =>
      composeDirectPageAction(snapshot, {
        action: "add_page_block",
        pageKey: "workspace",
        block: { type: "view", viewKey: "missing_view" },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "direct_page_view_unavailable" }),
    );
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

  it("preserves draft public Site identity and lifecycle on private saves", () => {
    const publicSnapshot: ConfigurationSnapshotV1 = {
      ...snapshot,
      pages: [
        {
          ...snapshot.pages[0]!,
          key: "public_site",
          title: "Public site",
          slug: "public-site",
          audience: "public",
          status: "draft",
        },
      ],
    };

    const renamed = composeDirectPageAction(publicSnapshot, {
      action: "rename_page",
      pageKey: "public_site",
      title: "Book with us",
    });
    const saved = composeDirectPageAction(publicSnapshot, {
      action: "save_page_layout",
      pageKey: "public_site",
      layout: { blocks: [{ type: "text", text: "Updated Site" }] },
    });

    for (const result of [renamed, saved]) {
      expect(result.operations).toEqual([
        expect.objectContaining({
          op: "set_page",
          key: "public_site",
          slug: "public-site",
          audience: "public",
          status: "draft",
          is_active: true,
        }),
      ]);
    }
    expect(renamed.operations[0]).toMatchObject({ title: "Book with us" });
    expect(saved.operations[0]).toMatchObject({ title: "Public site" });

    expect(() =>
      composeDirectPageAction(publicSnapshot, {
        action: "save_page_layout",
        pageKey: "public_site",
        layout: {
          blocks: [
            {
              type: "rich_text",
              node: {
                type: "paragraph",
                content: [{ type: "text", text: "Internal only" }],
              },
            },
          ],
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "direct_page_site_rich_text_unsupported",
      }),
    );
  });

  it("rejects ordinary direct saves for an already-published Site", () => {
    const publicSnapshot: ConfigurationSnapshotV1 = {
      ...snapshot,
      pages: [
        {
          ...snapshot.pages[0]!,
          key: "public_site",
          title: "Public site",
          slug: "public-site",
          audience: "public",
          status: "published",
        },
      ],
    };
    for (const intent of [
      {
        action: "rename_page" as const,
        pageKey: "public_site",
        title: "Changed",
      },
      {
        action: "save_page_layout" as const,
        pageKey: "public_site",
        layout: { blocks: [{ type: "text" as const, text: "Changed" }] },
      },
    ]) {
      expect(() =>
        composeDirectPageAction(publicSnapshot, intent),
      ).toThrowError(
        expect.objectContaining({
          code: "direct_page_published_site_requires_publication",
        }),
      );
    }
  });

  it("publishes one complete bounded candidate while preserving Site identity and locked atoms", () => {
    const publicSnapshot: ConfigurationSnapshotV1 = {
      ...snapshot,
      pages: [
        {
          ...snapshot.pages[0]!,
          key: "public_site",
          title: "Public site",
          slug: "public-site",
          audience: "public",
          status: "published",
          layout_json: {
            blocks: [
              {
                id: headingBlockId,
                type: "heading",
                text: "Welcome",
                level: 1,
              },
              {
                id: siteButtonBlockId,
                type: "button",
                label: "Book now",
                href: "/book",
                style: "primary",
              },
            ],
          },
        },
      ],
    };

    const published = composeDirectPageAction(publicSnapshot, {
      action: "publish_page_changes",
      pageKey: "public_site",
      title: "Book with us",
      layout: {
        blocks: [
          {
            id: siteButtonBlockId,
            type: "button",
            label: "Book now",
            href: "/book",
            style: "primary",
          },
          {
            id: headingBlockId,
            type: "heading",
            text: "Appointments",
            level: 2,
          },
          { type: "divider" },
        ],
      },
    });

    expect(published.actionKind).toBe("publish_page_changes");
    expect(published.operations).toEqual([
      expect.objectContaining({
        op: "set_page",
        key: "public_site",
        title: "Book with us",
        slug: "public-site",
        audience: "public",
        status: "published",
        is_active: true,
      }),
    ]);
    const layout = (published.operations[0] as { layout_json: PageLayout })
      .layout_json;
    expect(layout.blocks.map((block) => block.type)).toEqual([
      "button",
      "heading",
      "divider",
    ]);
    expect(layout.blocks[0]).toMatchObject({ id: siteButtonBlockId });
    expect(layout.blocks[2]).toHaveProperty("id");
  });

  it("fails closed when published Site intent changes locked atoms or lifecycle", () => {
    const publicPage: ConfigurationSnapshotV1["pages"][number] = {
      ...snapshot.pages[0]!,
      key: "public_site",
      title: "Public site",
      slug: "public-site",
      audience: "public",
      status: "published",
      layout_json: {
        blocks: [
          {
            id: siteButtonBlockId,
            type: "button",
            label: "Book now",
            href: "/book",
            style: "primary",
          },
        ],
      },
    };
    for (const blocks of [
      [],
      [
        {
          id: siteButtonBlockId,
          type: "button" as const,
          label: "Changed",
          href: "/book",
          style: "primary" as const,
        },
      ],
    ]) {
      expect(() =>
        composeDirectPageAction(
          { ...snapshot, pages: [publicPage] },
          {
            action: "publish_page_changes",
            pageKey: "public_site",
            title: "Changed Site",
            layout: { blocks },
          },
        ),
      ).toThrowError(
        expect.objectContaining({ code: "direct_page_site_block_locked" }),
      );
    }

    for (const page of [
      { ...publicPage, status: "draft" as const },
      { ...publicPage, audience: "internal" as const },
    ]) {
      expect(() =>
        composeDirectPageAction(
          { ...snapshot, pages: [page] },
          {
            action: "publish_page_changes",
            pageKey: "public_site",
            title: "Changed Site",
            layout: page.layout_json,
          },
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "direct_page_published_site_ineligible",
        }),
      );
    }
  });

  it("keeps draft publication separate and published edits in a local candidate", () => {
    const siteRoute = readFileSync(
      new URL(
        "../src/app/app/[businessSlug]/sites/[pageSlug]/page.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const editor = readFileSync(
      new URL("../src/runtime/page-editor/page-editor.tsx", import.meta.url),
      "utf8",
    );

    expect(siteRoute).toContain(
      "Supported edits stay in this browser until you deliberately",
    );
    expect(siteRoute).toContain("key={page.definition.key}");
    expect(siteRoute).toContain("publishPageChangesAction={");
    expect(editor).toContain("Customers still see the current published Site");
    expect(editor).toContain("Publish changes");
    expect(editor).toContain("Discard changes");
    expect(editor).toContain("useUnsavedNavigationWarning");
    expect(editor).toContain("site-candidate-preview-frame");
    expect(editor).toContain("00000000-0000-4000-8000-");
    expect(editor).toContain("Publish Site remains a separate owner action.");
    expect(editor).not.toContain(
      "Changes to this published Site go live when you save.",
    );
  });
});
