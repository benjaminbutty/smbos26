import type { JSONContent } from "@tiptap/core";

import {
  pageBlockSchema,
  pageLayoutSchema,
  type PageBlock,
  type PageLayout,
} from "../../core/experience/schemas";

export const pageEditorNodeNames = {
  divider: "pageDivider",
  callout: "pageCallout",
  view: "pageView",
  legacy: "pageLegacy",
} as const;

export interface PageEditorDocument extends JSONContent {
  type: "doc";
  content?: JSONContent[];
}

type RichTextBlock = Extract<PageBlock, { type: "rich_text" }>;
type RichTextContent = Extract<
  RichTextBlock["node"],
  { content: unknown }
>["content"];

function blockIdAttrs(block: PageBlock): { blockId: string | null } {
  return { blockId: "id" in block ? (block.id ?? null) : null };
}

function textContent(text: string): JSONContent[] {
  return text ? [{ type: "text", text }] : [];
}

function legacyNode(block: PageBlock): JSONContent {
  return {
    type: pageEditorNodeNames.legacy,
    attrs: {
      ...blockIdAttrs(block),
      blockType: block.type,
      blockJson: JSON.stringify(block),
    },
  };
}

function tiptapMarks(
  marks: RichTextContent[number]["marks"],
): JSONContent["marks"] {
  return marks?.map((mark) =>
    mark.type === "link"
      ? { type: "link", attrs: { href: mark.href } }
      : { type: mark.type },
  );
}

function tiptapInline(content: RichTextContent): JSONContent[] {
  return content.map((span) => {
    const marks = tiptapMarks(span.marks);
    return {
      type: "text",
      text: span.text,
      ...(marks?.length ? { marks } : {}),
    };
  });
}

function richTextToTiptap(block: RichTextBlock): JSONContent {
  const attrs = blockIdAttrs(block);
  switch (block.node.type) {
    case "paragraph":
      return {
        type: "paragraph",
        attrs,
        content: tiptapInline(block.node.content),
      };
    case "heading":
      return {
        type: "heading",
        attrs: { ...attrs, level: block.node.level },
        content: tiptapInline(block.node.content),
      };
    case "bullet_list":
    case "numbered_list":
      return {
        type: block.node.type === "bullet_list" ? "bulletList" : "orderedList",
        attrs,
        content: block.node.items.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: tiptapInline(item.content) }],
        })),
      };
  }
}

export function pageLayoutToTiptap(layoutInput: unknown): PageEditorDocument {
  const layout = pageLayoutSchema.parse(layoutInput);
  const content = layout.blocks.map<JSONContent>((block) => {
    switch (block.type) {
      case "heading":
        return {
          type: "heading",
          attrs: { ...blockIdAttrs(block), level: block.level },
          content: textContent(block.text),
        };
      case "text":
        return {
          type: "paragraph",
          attrs: blockIdAttrs(block),
          content: textContent(block.text),
        };
      case "rich_text":
        return richTextToTiptap(block);
      case "divider":
        return {
          type: pageEditorNodeNames.divider,
          attrs: blockIdAttrs(block),
        };
      case "callout":
        return {
          type: pageEditorNodeNames.callout,
          attrs: {
            ...blockIdAttrs(block),
            text: block.text,
            tone: block.tone,
          },
        };
      case "view":
        return {
          type: pageEditorNodeNames.view,
          attrs: {
            ...blockIdAttrs(block),
            viewKey: block.view_key,
            readOnly: block.read_only ?? null,
          },
        };
      case "image":
      case "button":
      case "form":
      case "public_form":
      case "booking":
      case "preorder":
        return legacyNode(block);
    }
  });
  return { type: "doc", content };
}

function blockId(
  attrs: Record<string, unknown> | undefined,
): string | undefined {
  return typeof attrs?.blockId === "string" ? attrs.blockId : undefined;
}

function textFromNode(node: JSONContent): string {
  if (typeof node.attrs?.text === "string") return node.attrs.text;
  return (node.content ?? [])
    .filter((child) => child.type === "text")
    .map((child) => child.text ?? "")
    .join("");
}

function canonicalMarks(node: JSONContent): RichTextContent[number]["marks"] {
  if (!node.marks?.length) return undefined;
  const marks = node.marks.map((mark) => {
    if (mark.type === "bold" || mark.type === "italic") {
      return { type: mark.type } as const;
    }
    if (mark.type === "link" && typeof mark.attrs?.href === "string") {
      return { type: "link" as const, href: mark.attrs.href };
    }
    throw new Error("Unsupported Page editor mark.");
  });
  return marks.sort((first, second) => first.type.localeCompare(second.type));
}

function canonicalInline(node: JSONContent): RichTextContent {
  return (node.content ?? []).map((child) => {
    if (child.type !== "text" || !child.text) {
      throw new Error("Unsupported Page editor inline content.");
    }
    const marks = canonicalMarks(child);
    return {
      type: "text" as const,
      text: child.text,
      ...(marks?.length ? { marks } : {}),
    };
  });
}

function listItems(node: JSONContent): RichTextContent[] {
  return (node.content ?? []).map((item) => {
    if (
      item.type !== "listItem" ||
      item.content?.length !== 1 ||
      item.content[0]?.type !== "paragraph"
    ) {
      throw new Error("Nested or unsupported Page lists are not allowed.");
    }
    return canonicalInline(item.content[0]);
  });
}

function canonicalBlock(node: JSONContent): PageBlock | null {
  const id = blockId(node.attrs);
  const withId = <T extends Record<string, unknown>>(value: T): T =>
    id ? ({ ...value, id } as T) : value;

  if (node.type === "heading") {
    const level = node.attrs?.level;
    const content = canonicalInline(node);
    const hasMarks = content.some((span) => Boolean(span.marks?.length));
    const text = content.map((span) => span.text).join("");
    const result = pageBlockSchema.safeParse(
      !hasMarks && text
        ? withId({
            type: "heading",
            text,
            level: level === 1 || level === 3 ? level : 2,
          })
        : withId({
            type: "rich_text",
            node: {
              type: "heading",
              level: level === 1 || level === 3 ? level : 2,
              content,
            },
          }),
    );
    return result.success ? result.data : null;
  }
  if (node.type === "paragraph") {
    const content = canonicalInline(node);
    const hasMarks = content.some((span) => Boolean(span.marks?.length));
    const text = content.map((span) => span.text).join("");
    const result = pageBlockSchema.safeParse(
      !hasMarks && text
        ? withId({ type: "text", text })
        : withId({
            type: "rich_text",
            node: { type: "paragraph", content },
          }),
    );
    return result.success ? result.data : null;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const result = pageBlockSchema.safeParse(
      withId({
        type: "rich_text",
        node: {
          type: node.type === "bulletList" ? "bullet_list" : "numbered_list",
          items: listItems(node).map((content) => ({ content })),
        },
      }),
    );
    return result.success ? result.data : null;
  }
  if (node.type === pageEditorNodeNames.divider) {
    const result = pageBlockSchema.safeParse(withId({ type: "divider" }));
    return result.success ? result.data : null;
  }
  if (node.type === pageEditorNodeNames.callout) {
    const result = pageBlockSchema.safeParse(
      withId({
        type: "callout",
        text: textFromNode(node),
        tone:
          node.attrs?.tone === "neutral" ||
          node.attrs?.tone === "success" ||
          node.attrs?.tone === "warning"
            ? node.attrs.tone
            : "info",
      }),
    );
    return result.success ? result.data : null;
  }
  if (node.type === pageEditorNodeNames.view) {
    const readOnly = node.attrs?.readOnly === true;
    const result = pageBlockSchema.safeParse(
      withId({
        type: "view",
        view_key: node.attrs?.viewKey,
        ...(readOnly ? { read_only: true } : {}),
      }),
    );
    return result.success ? result.data : null;
  }
  if (node.type === pageEditorNodeNames.legacy) {
    try {
      const parsed = pageBlockSchema.safeParse(
        JSON.parse(String(node.attrs?.blockJson ?? "")),
      );
      if (!parsed.success) return null;
      return id && !("id" in parsed.data)
        ? pageBlockSchema.parse({ ...parsed.data, id })
        : parsed.data;
    } catch {
      return null;
    }
  }
  return null;
}

export function tiptapToPageLayout(documentInput: unknown): PageLayout {
  const document = documentInput as PageEditorDocument;
  if (
    !document ||
    document.type !== "doc" ||
    (document.content !== undefined && !Array.isArray(document.content))
  ) {
    throw new Error("Unsupported Page editor document.");
  }

  const blocks = (document.content ?? []).flatMap((node) => {
    if (
      node.type === "paragraph" &&
      (node.content?.length ?? 0) === 0 &&
      blockId(node.attrs) === undefined
    ) {
      return [];
    }
    const block = canonicalBlock(node);
    if (!block) throw new Error("Unsupported Page editor block.");
    return [block];
  });
  return pageLayoutSchema.parse({ blocks });
}
