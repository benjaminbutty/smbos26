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
  if (typeof node.attrs?.text === "string") {
    return node.attrs.text;
  }
  return (node.content ?? [])
    .filter((child) => child.type === "text")
    .map((child) => child.text ?? "")
    .join("");
}

function canonicalBlock(node: JSONContent): PageBlock | null {
  const id = blockId(node.attrs);
  const withId = <T extends Record<string, unknown>>(value: T): T =>
    id ? ({ ...value, id } as T) : value;

  if (node.type === "heading") {
    const level = node.attrs?.level;
    const result = pageBlockSchema.safeParse(
      withId({
        type: "heading",
        text: textFromNode(node),
        level: level === 1 || level === 3 ? level : 2,
      }),
    );
    return result.success ? result.data : null;
  }
  if (node.type === "paragraph") {
    const result = pageBlockSchema.safeParse(
      withId({ type: "text", text: textFromNode(node) }),
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
      if (!parsed.success) {
        return null;
      }
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
    if (node.type === "paragraph" && textFromNode(node).trim() === "") {
      return [];
    }
    const block = canonicalBlock(node);
    if (!block) {
      throw new Error("Unsupported Page editor block.");
    }
    return [block];
  });
  return pageLayoutSchema.parse({ blocks });
}
