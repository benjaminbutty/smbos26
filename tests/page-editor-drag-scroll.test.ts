import { describe, expect, it } from "vitest";

import { pageEditorDragScrollDelta } from "../src/runtime/page-editor/drag-scroll";

describe("Page editor drag edge scrolling", () => {
  it("scrolls toward the nearest viewport edge and stays idle in the document middle", () => {
    expect(
      pageEditorDragScrollDelta({ clientY: 12, viewportHeight: 800 }),
    ).toBe(-18);
    expect(
      pageEditorDragScrollDelta({ clientY: 788, viewportHeight: 800 }),
    ).toBe(18);
    expect(
      pageEditorDragScrollDelta({ clientY: 400, viewportHeight: 800 }),
    ).toBe(0);
  });

  it("does not request scroll from an unusable viewport", () => {
    expect(pageEditorDragScrollDelta({ clientY: 4, viewportHeight: 0 })).toBe(
      0,
    );
  });
});
