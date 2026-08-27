import { readFileSync } from "node:fs";

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
const headingBlockId = "00000000-0000-4000-8000-000000000004";
const viewBlockId = "00000000-0000-4000-8000-000000000005";
const siteButtonBlockId = "00000000-0000-4000-8000-000000000006";

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
