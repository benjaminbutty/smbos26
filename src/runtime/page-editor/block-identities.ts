import {
  pageBlockSchema,
  type PageBlock,
  type PageLayout,
} from "../../core/experience/schemas";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { pageEditorNodeNames } from "./page-translator";

function isPageBlockNode(node: ProseMirrorNode): boolean {
  return (
    node.type.name === "paragraph" ||
    node.type.name === "heading" ||
    node.type.name === "bulletList" ||
    node.type.name === "orderedList" ||
    node.type.name === pageEditorNodeNames.divider ||
    node.type.name === pageEditorNodeNames.callout ||
    node.type.name === pageEditorNodeNames.view ||
    node.type.name === pageEditorNodeNames.image ||
    node.type.name === pageEditorNodeNames.collapsible ||
    node.type.name === pageEditorNodeNames.legacy
  );
}

/**
 * ProseMirror copies attributes when it splits a block. Page block IDs are
 * identities, so the original keeps its ID and the newly split sibling must
 * receive a new one before the draft is translated for autosave. Empty, brand
 * new paragraphs remain unassigned, but an empty paragraph that inherited a
 * duplicate ID is repaired immediately.
 */
export function ensureEditorBlockIds(editor: Editor): void {
  const transaction = editor.state.tr;
  const seenBlockIds = new Set<string>();
  let changed = false;

  const nextBlockId = (): string => {
    let blockId = globalThis.crypto.randomUUID();
    while (seenBlockIds.has(blockId)) blockId = globalThis.crypto.randomUUID();
    seenBlockIds.add(blockId);
    return blockId;
  };

  editor.state.doc.descendants((node, position, parent) => {
    const isTopLevelPageBlock =
      parent &&
      (parent.type.name === "doc" ||
        parent.type.name === pageEditorNodeNames.collapsible) &&
      isPageBlockNode(node);
    if (!isTopLevelPageBlock) return true;

    const blockId = node.attrs?.blockId;
    const hasBlockId = typeof blockId === "string";
    const duplicateBlockId = hasBlockId && seenBlockIds.has(blockId);
    const isEmptyParagraph =
      node.type.name === "paragraph" && node.content.size === 0;

    if (hasBlockId && !duplicateBlockId) {
      seenBlockIds.add(blockId);
      return true;
    }

    // Leave a brand new empty paragraph out of the document grammar. A split
    // paragraph, however, arrives with a copied ID and must be disambiguated
    // even before the owner types the slash command into it.
    if (isEmptyParagraph && !duplicateBlockId) return true;

    transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      blockId: nextBlockId(),
    });
    changed = true;
    return true;
  });
  if (!changed) return;
  transaction.setMeta("addToHistory", false);
  transaction.setMeta("preventUpdate", true);
  editor.view.dispatch(transaction);
}

/**
 * Older Page layouts may not have persisted block IDs. The editor needs a
 * stable, valid UUID before the first edit so an acknowledgement can update
 * identity without replacing the user's document.
 */
export function deterministicPageBlockId(path: string, type: string): string {
  let hash = 2166136261;
  for (const character of `${path}:${type}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (value: number): string =>
    (value >>> 0).toString(16).padStart(8, "0");
  const first = hex(hash);
  const second = hex(Math.imul(hash ^ 0x9e3779b9, 2246822519));
  const third = `4${hex(Math.imul(hash ^ 0x85ebca6b, 3266489917)).slice(1, 4)}`;
  const fourth = `8${hex(Math.imul(hash ^ 0xc2b2ae35, 668265263)).slice(1, 4)}`;
  const fifth = `${hex(Math.imul(hash ^ 0x27d4eb2f, 1597334677))}${hex(
    Math.imul(hash ^ 0x165667b1, 3812015801),
  )}`.slice(0, 12);
  return `${first}-${second.slice(0, 4)}-${third}-${fourth}-${fifth}`;
}

export function withEditorBlockIds(input: PageLayout): PageLayout {
  const assign = (inputBlock: PageBlock, path: string): PageBlock => {
    const block = pageBlockSchema.parse(inputBlock);
    const id =
      "id" in block && block.id
        ? block.id
        : deterministicPageBlockId(path, block.type);
    if (block.type !== "collapsible") return { ...block, id };
    return {
      ...block,
      id,
      blocks: block.blocks.map((child, index) =>
        assign(child, `${path}.${index}`),
      ),
    } as PageBlock;
  };
  return {
    blocks: input.blocks.map((block, index) => assign(block, `${index}`)),
  };
}
