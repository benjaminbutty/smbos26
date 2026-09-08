import { describe, expect, it, vi } from "vitest";

import {
  createTransientPointerDismissal,
  registerCapturePointerDismissal,
} from "../src/runtime/page-editor/transient-pointer-dismissal";

describe("Page transient pointer dismissal", () => {
  it("keeps an internal target open while closing unrelated open surfaces", () => {
    const closeBlock = vi.fn();
    const closeSlash = vi.fn();
    const closeLink = vi.fn();
    const blockAction = new EventTarget();
    const slashSearch = new EventTarget();
    const linkInput = new EventTarget();
    const dismiss = createTransientPointerDismissal(
      (target): target is EventTarget => target instanceof EventTarget,
      [
        {
          contains: (target) => target === blockAction,
          dismiss: closeBlock,
          open: true,
        },
        {
          contains: (target) => target === slashSearch,
          dismiss: closeSlash,
          open: true,
        },
        {
          contains: (target) => target === linkInput,
          dismiss: closeLink,
          open: true,
        },
      ],
    );

    dismiss({ target: slashSearch });

    expect(closeBlock).toHaveBeenCalledOnce();
    expect(closeSlash).not.toHaveBeenCalled();
    expect(closeLink).toHaveBeenCalledOnce();
  });

  it("closes every open surface for an outside pointer without consuming it", () => {
    const closeBlock = vi.fn();
    const closeSlash = vi.fn();
    const closeLink = vi.fn();
    const preventDefault = vi.fn();
    const dismiss = createTransientPointerDismissal(
      (target): target is EventTarget => target instanceof EventTarget,
      [
        { contains: () => false, dismiss: closeBlock, open: true },
        { contains: () => false, dismiss: closeSlash, open: true },
        { contains: () => false, dismiss: closeLink, open: true },
      ],
    );

    const pointer = { preventDefault, target: new EventTarget() };
    dismiss(pointer);

    expect(closeBlock).toHaveBeenCalledOnce();
    expect(closeSlash).toHaveBeenCalledOnce();
    expect(closeLink).toHaveBeenCalledOnce();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("registers at capture phase and cleans up the same listener", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const closeMenu = vi.fn();
    const listener = createTransientPointerDismissal(
      (target): target is EventTarget => target instanceof EventTarget,
      [{ contains: () => false, dismiss: closeMenu, open: true }],
    );
    const documentTarget = {
      addEventListener,
      removeEventListener,
    } as unknown as Document;

    const unregister = registerCapturePointerDismissal(
      documentTarget,
      listener,
    );

    expect(addEventListener).toHaveBeenCalledWith(
      "pointerdown",
      listener,
      true,
    );
    unregister();
    expect(removeEventListener).toHaveBeenCalledWith(
      "pointerdown",
      listener,
      true,
    );
  });
});
