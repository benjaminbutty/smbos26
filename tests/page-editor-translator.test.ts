import { describe, expect, it } from "vitest";

import {
  pageLayoutToTiptap,
  tiptapToPageLayout,
} from "../src/runtime/page-editor/page-translator";

describe("Page editor canonical translator", () => {
  it("round-trips supported plain blocks and preserves legacy blocks", () => {
    const layout = {
      blocks: [
        {
          type: "heading" as const,
          text: "Operations",
          level: 1 as const,
          id: "00000000-0000-4000-8000-000000000001",
        },
        {
          type: "text" as const,
          text: "Keep this copy plain.",
          id: "00000000-0000-4000-8000-000000000002",
        },
        {
          type: "divider" as const,
          id: "00000000-0000-4000-8000-000000000003",
        },
        {
          type: "callout" as const,
          text: "Ready",
          tone: "success" as const,
          id: "00000000-0000-4000-8000-000000000004",
        },
        {
          type: "view" as const,
          view_key: "contacts",
          read_only: true,
          id: "00000000-0000-4000-8000-000000000005",
        },
        {
          type: "image" as const,
          src: "https://example.com/image.png",
          alt: "A retained image",
          caption: "Historical content",
          id: "00000000-0000-4000-8000-000000000006",
        },
        {
          type: "button" as const,
          label: "Learn more",
          href: "/learn-more",
          style: "secondary" as const,
          id: "00000000-0000-4000-8000-000000000007",
        },
        {
          type: "form" as const,
          form_key: "contact_form",
          id: "00000000-0000-4000-8000-000000000008",
        },
        {
          type: "preorder" as const,
          preorder_key: "preorder",
          id: "00000000-0000-4000-8000-000000000009",
        },
      ],
    };

    const document = pageLayoutToTiptap(layout);
    expect(document.content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "pageDivider",
      "pageCallout",
      "pageView",
      "pageLegacy",
      "pageLegacy",
      "pageLegacy",
      "pageLegacy",
    ]);
    expect(document.content?.[5]?.attrs).toMatchObject({
      blockType: "image",
    });
    expect(tiptapToPageLayout(document)).toEqual(layout);
  });

  it("uses an empty Tiptap document for an empty Page", () => {
    expect(pageLayoutToTiptap({ blocks: [] })).toEqual({
      type: "doc",
      content: [],
    });
    expect(tiptapToPageLayout({ type: "doc", content: [] })).toEqual({
      blocks: [],
    });
    expect(
      tiptapToPageLayout({
        type: "doc",
        content: [{ type: "paragraph", content: [] }],
      }),
    ).toEqual({ blocks: [] });
  });

  it("keeps empty block shells saveable while an owner starts writing", () => {
    expect(
      tiptapToPageLayout({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [] }],
              },
            ],
          },
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [] }],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      blocks: [
        {
          type: "rich_text",
          node: { type: "heading", level: 2, content: [] },
        },
        {
          type: "rich_text",
          node: { type: "bullet_list", items: [{ content: [] }] },
        },
        {
          type: "rich_text",
          node: { type: "numbered_list", items: [{ content: [] }] },
        },
      ],
    });
  });

  it("rejects raw unsupported editor nodes", () => {
    expect(() =>
      tiptapToPageLayout({
        type: "doc",
        content: [{ type: "bulletList", content: [] }],
      }),
    ).toThrow("Unsupported Page editor block");
  });

  it("round-trips bounded formatting and flat lists without editor JSON", () => {
    const document = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Confirm " },
            { type: "text", text: "today", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: " in the diary",
              marks: [
                { type: "italic" },
                { type: "link", attrs: { href: "/app/diary" } },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Call Priya" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Check stock" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const layout = tiptapToPageLayout(document);
    expect(layout.blocks).toEqual([
      {
        type: "rich_text",
        node: {
          type: "paragraph",
          content: [
            { type: "text", text: "Confirm " },
            { type: "text", text: "today", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: " in the diary",
              marks: [{ type: "italic" }, { type: "link", href: "/app/diary" }],
            },
          ],
        },
      },
      {
        type: "rich_text",
        node: {
          type: "bullet_list",
          items: [
            { content: [{ type: "text", text: "Call Priya" }] },
            { content: [{ type: "text", text: "Check stock" }] },
          ],
        },
      },
    ]);
    expect(tiptapToPageLayout(pageLayoutToTiptap(layout))).toEqual(layout);
  });

  it("rejects unknown marks, unsafe links, and nested lists", () => {
    expect(() =>
      tiptapToPageLayout({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "No", marks: [{ type: "underline" }] },
            ],
          },
        ],
      }),
    ).toThrow("Unsupported Page editor mark");

    expect(() =>
      tiptapToPageLayout({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "No",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      tiptapToPageLayout({
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "bulletList", content: [] }],
              },
            ],
          },
        ],
      }),
    ).toThrow("Nested or unsupported Page lists");
  });
});
