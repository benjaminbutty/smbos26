import { describe, expect, it } from "vitest";

import {
  deterministicPageBlockId,
  withEditorBlockIds,
} from "../src/runtime/page-editor/block-identities";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("Page editor block identity", () => {
  it("allocates deterministic valid UUIDs for legacy top-level and contained blocks", () => {
    const layout = {
      blocks: [
        { type: "heading" as const, text: "Opening", level: 2 as const },
        {
          type: "collapsible" as const,
          summary: "Details",
          open: true,
          blocks: [{ type: "text" as const, text: "Check the door" }],
        },
      ],
    };

    const first = withEditorBlockIds(layout);
    const second = withEditorBlockIds(layout);
    const section = first.blocks[1];
    if (section?.type !== "collapsible") throw new Error("Expected section");
    const ids = [first.blocks[0]?.id, section.id, section.blocks[0]?.id];

    expect(ids.every((id) => typeof id === "string" && uuid.test(id))).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(first).toEqual(second);
  });

  it("does not reuse an identity when the path or block type changes", () => {
    expect(deterministicPageBlockId("0", "text")).not.toBe(
      deterministicPageBlockId("1", "text"),
    );
    expect(deterministicPageBlockId("0", "text")).not.toBe(
      deterministicPageBlockId("0", "heading"),
    );
  });
});
