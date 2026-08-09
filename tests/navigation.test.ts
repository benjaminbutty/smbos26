import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isSimpleViewWrapperPage,
  normalizeNavigationDisplayText,
} from "../src/core/experience/service";
import type { Tables } from "../src/db/supabase/database.types";

const businessId = "10000000-0000-4000-8000-000000000001";
const objectId = "10000000-0000-4000-8000-000000000002";
const now = "2026-08-09T12:00:00.000Z";

function view(overrides: Partial<Tables<"views">> = {}): Tables<"views"> {
  return {
    id: "10000000-0000-4000-8000-000000000003",
    business_id: businessId,
    key: "products",
    name: "Products",
    view_type: "table",
    object_definition_id: objectId,
    config_json: { fields: ["name"], include_archived: false },
    audience: "internal",
    is_active: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function page(overrides: Partial<Tables<"pages">> = {}): Tables<"pages"> {
  return {
    id: "10000000-0000-4000-8000-000000000004",
    business_id: businessId,
    key: "products_workspace",
    title: "Products",
    slug: "products",
    audience: "internal",
    layout_json: {
      blocks: [
        { type: "heading", text: "Products", level: 1 },
        { type: "view", view_key: "products" },
      ],
    },
    status: "draft",
    is_active: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("simple internal View wrapper navigation", () => {
  it("omits an exact two-block wrapper and retains the direct View", () => {
    expect(isSimpleViewWrapperPage(page(), [view()])).toBe("products");
    expect(normalizeNavigationDisplayText("  Products\u00a0  ")).toBe(
      "products",
    );
  });

  it.each([
    ["page inactive", page({ is_active: false }), [view()]],
    ["page public", page({ audience: "public" }), [view()]],
    [
      "extra block",
      page({
        layout_json: {
          blocks: [
            { type: "heading", text: "Products", level: 1 },
            { type: "view", view_key: "products" },
            { type: "divider" },
          ],
        },
      }),
      [view()],
    ],
    [
      "wrong heading level",
      page({
        layout_json: {
          blocks: [
            { type: "heading", text: "Products", level: 2 },
            { type: "view", view_key: "products" },
          ],
        },
      }),
      [view()],
    ],
    [
      "heading mismatch",
      page({
        layout_json: {
          blocks: [
            { type: "heading", text: "Stock", level: 1 },
            { type: "view", view_key: "products" },
          ],
        },
      }),
      [view()],
    ],
    ["view title mismatch", page(), [view({ name: "Product catalogue" })]],
    ["missing view", page(), []],
    ["detail view", page(), [view({ view_type: "detail" })]],
    ["view inactive", page(), [view({ is_active: false })]],
    ["view public", page(), [view({ audience: "public" })]],
  ] as const)("preserves %s", (_name, candidatePage, views) => {
    expect(isSimpleViewWrapperPage(candidatePage, views)).toBeNull();
  });
});
