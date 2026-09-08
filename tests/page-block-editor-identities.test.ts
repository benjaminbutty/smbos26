import type { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { ensureEditorBlockIds } from "../src/runtime/page-editor/block-identities";
import {
  pageLayoutToTiptap,
  tiptapToPageLayout,
} from "../src/runtime/page-editor/page-translator";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      attrs: { blockId: { default: null } },
      content: "text*",
      group: "block",
    },
    text: { group: "inline" },
  },
});

function fakeEditor(initialState: EditorState) {
  let state = initialState;
  return {
    editor: {
      get state() {
        return state;
      },
      view: {
        dispatch(transaction: Transaction) {
          state = state.apply(transaction);
        },
      },
    } as unknown as Editor,
    state: () => state,
  };
}

describe("Page editor block identities", () => {
  it("gives the new native split paragraph a unique ID before autosave", () => {
    const originalId = "12345737-3600-4b83-9f82-b90013fdc3d9";
    const document = schema.node("doc", undefined, [
      schema.node(
        "paragraph",
        { blockId: originalId },
        schema.text("Opening notes"),
      ),
    ]);
    let split = EditorState.create({ schema, doc: document });
    split = split.apply(
      split.tr.split((document.firstChild?.content.size ?? 0) + 1),
    );
    const { editor, state } = fakeEditor(split);

    // Native split clones paragraph attrs, including this persistent identity.
    expect(state().doc.child(0).attrs.blockId).toBe(originalId);
    expect(state().doc.child(1).attrs.blockId).toBe(originalId);

    ensureEditorBlockIds(editor);

    expect(state().doc.child(0).attrs.blockId).toBe(originalId);
    expect(state().doc.child(1).attrs.blockId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(state().doc.child(1).attrs.blockId).not.toBe(originalId);

    const savedLayout = tiptapToPageLayout(state().doc.toJSON());
    expect(savedLayout.blocks).toMatchObject([
      { id: originalId, text: "Opening notes", type: "text" },
      {
        id: state().doc.child(1).attrs.blockId,
        node: { content: [], type: "paragraph" },
        type: "rich_text",
      },
    ]);
    expect(pageLayoutToTiptap(savedLayout).content?.[1]?.attrs?.blockId).toBe(
      state().doc.child(1).attrs.blockId,
    );
  });
});
