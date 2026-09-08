import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PageLayout } from "../src/core/experience/schemas";
import {
  boundedConflictLayout,
  PageConflictPanel,
} from "../src/runtime/page-editor/page-conflict-panel";

vi.mock(
  "../src/runtime/editor-kernel/production/production-table-actions",
  () => ({
    listProductionArchivedRecordsAction: vi.fn(),
    setProductionTableRecordArchivedAction: vi.fn(),
  }),
);

describe("Page conflict recovery surface", () => {
  it("shows one readable local/latest comparison and one action pair", () => {
    const html = renderToStaticMarkup(
      createElement(PageConflictPanel, {
        businessSlug: "bakery",
        latest: {
          layout: {
            blocks: [{ text: "Latest body", type: "text" }],
          },
          title: "Latest title",
        },
        local: {
          layout: {
            blocks: [{ text: "Your draft body", type: "text" }],
          },
          title: "Your draft title",
        },
        onKeepMyVersion: vi.fn(),
        onUseLatest: vi.fn(),
      }),
    );

    expect(html.match(/<button\b/g) ?? []).toHaveLength(2);
    expect(html.match(/This Page changed elsewhere/g) ?? []).toHaveLength(1);
    expect(html).toContain("Your version");
    expect(html).toContain("Latest version");
    expect(html).toContain("Your draft title");
    expect(html).toContain("Latest title");
    expect(html).toContain("Your draft body");
    expect(html).toContain("Latest body");
    expect(html).toContain("replaces your local draft");
    expect(html.match(/Keep my version/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("&quot;blocks&quot;");
  });

  it("bounds a large document without changing its first content", () => {
    const layout: PageLayout = {
      blocks: Array.from({ length: 10 }, (_, index) => ({
        text: `Block ${index + 1}`,
        type: "text" as const,
      })),
    };

    const bounded = boundedConflictLayout(layout);

    expect(bounded.blocks).toHaveLength(6);
    expect(bounded.blocks[0]).toEqual(layout.blocks[0]);
    expect(bounded.blocks[5]).toEqual(layout.blocks[5]);
  });
});
