import { describe, expect, it } from "vitest";

import { positionPageBlockMenu } from "../src/runtime/page-editor/block-menu-layout";

describe("Page editor block action menu placement", () => {
  it("keeps a menu beside an ordinary desktop block", () => {
    expect(
      positionPageBlockMenu(
        { left: 540, top: 320 },
        { height: 900, width: 1440 },
        { height: 168, width: 184 },
      ),
    ).toEqual({ left: 496, top: 320 });
  });

  it("keeps actions inside a short, narrow viewport", () => {
    expect(
      positionPageBlockMenu(
        { left: 390, top: 470 },
        { height: 500, width: 390 },
        { height: 176, width: 240 },
      ),
    ).toEqual({ left: 142, top: 316 });
  });
});
