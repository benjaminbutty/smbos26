import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

export interface PageBlockTarget {
  blockId: string;
}

export interface PageBlockLocation extends PageBlockTarget {
  index: number;
  node: ProseMirrorNode;
  parent: ProseMirrorNode;
  position: number;
}

function blockIndex(parent: ProseMirrorNode, node: ProseMirrorNode): number {
  let index = -1;
  let cursor = 0;
  parent.forEach((candidate) => {
    if (candidate === node) index = cursor;
    cursor += 1;
  });
  return index;
}

export function pageBlockTargetAtPosition(
  document: ProseMirrorNode,
  position: number,
): PageBlockTarget | null {
  const blockId = document.nodeAt(position)?.attrs?.blockId;
  return typeof blockId === "string" ? { blockId } : null;
}

export function pageBlockLocationForTarget(
  document: ProseMirrorNode,
  target: PageBlockTarget,
): PageBlockLocation | null {
  let location: PageBlockLocation | null = null;
  document.descendants((node, position, parent) => {
    if (node.attrs?.blockId !== target.blockId || !parent) return true;
    const index = blockIndex(parent, node);
    if (index >= 0) {
      location = {
        blockId: target.blockId,
        index,
        node,
        parent,
        position,
      };
    }
    return false;
  });
  return location;
}

/**
 * Reorders one canonical Page block among its direct siblings. Targeting by
 * immutable block ID keeps a contextual menu attached to its original block
 * even when a caret move or unrelated edit shifts document positions.
 */
export function movePageBlock(
  transaction: Transaction,
  target: PageBlockTarget,
  direction: "up" | "down",
): boolean {
  const selected = pageBlockLocationForTarget(transaction.doc, target);
  if (!selected) return false;
  if (
    (direction === "up" && selected.index <= 0) ||
    (direction === "down" && selected.index >= selected.parent.childCount - 1)
  ) {
    return false;
  }

  const adjacent = selected.parent.child(
    direction === "up" ? selected.index - 1 : selected.index + 1,
  );
  transaction.delete(
    selected.position,
    selected.position + selected.node.nodeSize,
  );
  const insertionPosition =
    direction === "up"
      ? selected.position - adjacent.nodeSize
      : transaction.mapping.map(selected.position + selected.node.nodeSize, 1) +
        adjacent.nodeSize;
  transaction.insert(insertionPosition, selected.node);
  transaction.setMeta("addToHistory", true);
  return true;
}
