import { describe, expect, it } from "vitest";

import { resolveSlashInsertionRange } from "../src/runtime/page-editor/slash-insertion";

describe("Page slash insertion range", () => {
  it("replaces a current slash command", () => {
    expect(
      resolveSlashInsertionRange({
        documentSize: 32,
        query: "heading",
        requestedFrom: 12,
        requestedTo: 20,
        textBetween: () => "/heading",
      }),
    ).toEqual({ from: 12, to: 20 });
  });

  it("dismisses a command whose transient block is no longer present", () => {
    expect(
      resolveSlashInsertionRange({
        documentSize: 26,
        query: "heading",
        requestedFrom: 20,
        requestedTo: 28,
        textBetween: () => {
          throw new Error("A stale range must not read the document.");
        },
      }),
    ).toBeNull();
  });

  it("does not replace an unrelated live selection when the saved range drifted", () => {
    expect(
      resolveSlashInsertionRange({
        documentSize: 40,
        query: "heading",
        requestedFrom: 12,
        requestedTo: 20,
        textBetween: () => "opening ",
      }),
    ).toBeNull();
  });
});
