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

  it("rejects raw unsupported editor nodes", () => {
    expect(() =>
      tiptapToPageLayout({
        type: "doc",
        content: [{ type: "bulletList", content: [] }],
      }),
    ).toThrow("Unsupported Page editor block");
  });
});
