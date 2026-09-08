import { describe, expect, it } from "vitest";

import {
  positionSlashMenu,
  slashMenuScrollTopForActiveOption,
} from "../src/runtime/page-editor/slash-menu-layout";

describe("Page slash menu layout", () => {
  it("keeps a below-caret menu inside the viewport edge", () => {
    const position = positionSlashMenu(
      { bottom: 359, left: 400, top: 335 },
      { height: 700, width: 1024 },
    );

    expect(position).toMatchObject({ left: 400, top: 367 });
    expect(position.top + position.maxHeight).toBe(692);
  });

  it("opens above the caret when the lower viewport is too short", () => {
    const position = positionSlashMenu(
      { bottom: 658, left: 400, top: 634 },
      { height: 700, width: 1024 },
    );

    expect(position).toMatchObject({ left: 400, maxHeight: 384, top: 242 });
    expect(position.top).toBeGreaterThanOrEqual(8);
  });

  it("scrolls only the options pane to reveal an active choice below it", () => {
    expect(
      slashMenuScrollTopForActiveOption({
        clientHeight: 344,
        optionBottom: 839,
        optionTop: 787,
        scrollTop: 0,
      }),
    ).toBe(495);
  });

  it("scrolls upward for an active choice above the current pane", () => {
    expect(
      slashMenuScrollTopForActiveOption({
        clientHeight: 344,
        optionBottom: 335,
        optionTop: 282,
        scrollTop: 344,
      }),
    ).toBe(282);
  });

  it("does not change a manually scrolled pane when its active choice is visible", () => {
    expect(
      slashMenuScrollTopForActiveOption({
        clientHeight: 344,
        optionBottom: 620,
        optionTop: 568,
        scrollTop: 344,
      }),
    ).toBe(344);
  });
});
