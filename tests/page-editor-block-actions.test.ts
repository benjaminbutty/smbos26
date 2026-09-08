import { Schema } from "@tiptap/pm/model";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import {
  movePageBlock,
  pageBlockLocationForTarget,
  pageBlockTargetAtPosition,
} from "../src/runtime/page-editor/block-actions";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      attrs: { blockId: { default: null } },
      content: "text*",
      group: "block",
    },
    section: {
      attrs: { blockId: { default: null } },
      content: "block+",
      group: "block",
    },
    table: {
      atom: true,
      attrs: { blockId: { default: null } },
      group: "block",
    },
    text: { group: "inline" },
  },
});

function paragraph(blockId: string, text: string) {
  return schema.node("paragraph", { blockId }, schema.text(text));
}

function blockIds(document: EditorState["doc"]): string[] {
  const ids: string[] = [];
  document.forEach((node) => ids.push(node.attrs.blockId));
  return ids;
}

describe("Page editor block actions", () => {
  it("keeps a contextual target attached to its immutable ID after another block changes", () => {
    const document = schema.node("doc", undefined, [
      paragraph("alpha", "Alpha"),
      paragraph("bravo", "Bravo"),
    ]);
    const target = pageBlockTargetAtPosition(
      document,
      document.child(0).nodeSize,
    );
    expect(target).toEqual({ blockId: "bravo" });

    const state = EditorState.create({ schema, doc: document });
    const changed = state.apply(state.tr.insertText(" revised", 2));
    expect(pageBlockLocationForTarget(changed.doc, target!)).toMatchObject({
      blockId: "bravo",
      node: expect.objectContaining({ textContent: "Bravo" }),
    });
  });

  it("moves the intended direct sibling and preserves its canonical ID", () => {
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", undefined, [
        paragraph("alpha", "Alpha"),
        paragraph("bravo", "Bravo"),
        paragraph("charlie", "Charlie"),
      ]),
    });
    const transaction = state.tr;

    expect(movePageBlock(transaction, { blockId: "bravo" }, "up")).toBe(true);
    const moved = state.apply(transaction);
    expect(blockIds(moved.doc)).toEqual(["bravo", "alpha", "charlie"]);
    expect(moved.doc.child(0).textContent).toBe("Bravo");
    expect(transaction.getMeta("addToHistory")).toBe(true);
  });

  it("moves across an atom and remains one undoable Page edit", () => {
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", undefined, [
        paragraph("alpha", "Alpha"),
        schema.node("table", { blockId: "table" }),
        paragraph("bravo", "Bravo"),
      ]),
      plugins: [history()],
    });
    const transaction = state.tr;

    expect(movePageBlock(transaction, { blockId: "alpha" }, "down")).toBe(true);
    const moved = state.apply(transaction);
    expect(blockIds(moved.doc)).toEqual(["table", "alpha", "bravo"]);

    let restored = moved;
    expect(
      undo(moved, (undoTransaction: Transaction) => {
        restored = restored.apply(undoTransaction);
      }),
    ).toBe(true);
    expect(blockIds(restored.doc)).toEqual(["alpha", "table", "bravo"]);
  });

  it("leaves the first and last sibling in place at their movement boundary", () => {
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", undefined, [
        paragraph("alpha", "Alpha"),
        paragraph("bravo", "Bravo"),
      ]),
    });

    expect(movePageBlock(state.tr, { blockId: "alpha" }, "up")).toBe(false);
    expect(movePageBlock(state.tr, { blockId: "bravo" }, "down")).toBe(false);
  });

  it("keeps a nested block inside its collapsible parent when moved", () => {
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", undefined, [
        paragraph("before", "Before"),
        schema.node("section", { blockId: "section" }, [
          paragraph("first", "First"),
          paragraph("second", "Second"),
        ]),
        paragraph("after", "After"),
      ]),
    });
    const transaction = state.tr;

    expect(movePageBlock(transaction, { blockId: "second" }, "up")).toBe(true);
    const moved = state.apply(transaction);
    const section = moved.doc.child(1);
    expect(section.attrs.blockId).toBe("section");
    expect(section.child(0).attrs.blockId).toBe("second");
    expect(section.child(1).attrs.blockId).toBe("first");
    expect(blockIds(moved.doc)).toEqual(["before", "section", "after"]);
  });
});
