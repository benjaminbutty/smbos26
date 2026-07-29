import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfigurationPreviewShell } from "../src/components/configuration-preview-shell";
import type { Tables } from "../src/db/supabase/database.types";
import { rejectConfigurationPreviewMutation } from "../src/proxy";

const now = "2026-07-29T12:00:00.000Z";
const businessId = "10000000-0000-4000-8000-000000000001";
const changeSetId = "10000000-0000-4000-8000-000000000002";

function candidatePage(overrides: Partial<Tables<"pages">>): Tables<"pages"> {
  return {
    id: crypto.randomUUID(),
    business_id: businessId,
    key: "orders_workspace",
    title: "Orders",
    slug: "proposed-orders-slug",
    audience: "internal",
    layout_json: { blocks: [] },
    status: "draft",
    is_active: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("authenticated rendered configuration preview route", () => {
  it("renders the persistent banner and stable-key candidate navigation", () => {
    const pages = [
      candidatePage({ key: "orders_workspace", title: "Orders" }),
      candidatePage({
        key: "public_preorder",
        title: "Preorder",
        slug: "a-new-candidate-slug",
        audience: "public",
        status: "published",
      }),
    ];
    const html = renderToStaticMarkup(
      createElement(ConfigurationPreviewShell, {
        businessSlug: "bedford-bakery",
        candidateChecksum:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        changeSetId,
        currentPageKey: "public_preorder",
        kind: "rollback",
        navigationPages: pages,
        status: "validated",
        title: "Restore weekend collection",
        children: createElement("p", null, "Candidate content"),
      }),
    );

    expect(html).toContain("Preview — not live");
    expect(html).toContain("Restore weekend collection");
    expect(html).toContain("Rollback · Validated");
    expect(html).toContain("abcdef012345");
    expect(html).toContain("No edits or submissions will be saved.");
    expect(html).toContain('href="/app/bedford-bakery"');
    expect(html).toContain(
      `/app/bedford-bakery/changes/${changeSetId}/preview/orders_workspace`,
    );
    expect(html).toContain(
      `/app/bedford-bakery/changes/${changeSetId}/preview/public_preorder`,
    );
    expect(html).not.toContain("a-new-candidate-slug");
    expect(html.match(/<a\b/g)?.length).toBe(
      html.match(/<a\b[^>]*\bhref=/g)?.length,
    );
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects %s before the read-only preview route",
    async (method) => {
      const request = new NextRequest(
        `http://localhost/app/bedford-bakery/changes/${changeSetId}/preview/public_preorder`,
        { method },
      );
      const response = rejectConfigurationPreviewMutation(request);

      expect(response?.status).toBe(405);
      expect(response?.headers.get("allow")).toBe("GET, HEAD");
      await expect(response?.json()).resolves.toEqual({
        error: "Configuration preview is read-only.",
      });
    },
  );

  it("allows only read methods to continue to authenticated route handling", () => {
    for (const method of ["GET", "HEAD"]) {
      expect(
        rejectConfigurationPreviewMutation(
          new NextRequest(
            `http://localhost/app/bedford-bakery/changes/${changeSetId}/preview/public_preorder`,
            { method },
          ),
        ),
      ).toBeNull();
    }
    expect(
      rejectConfigurationPreviewMutation(
        new NextRequest("http://localhost/app/bedford-bakery", {
          method: "POST",
        }),
      ),
    ).toBeNull();
  });

  it("keeps route code session-only, identifier-only, dynamic and action-free", () => {
    const routeDirectory = join(
      process.cwd(),
      "src/app/app/[businessSlug]/changes/[changeSetId]/preview/[pageKey]",
    );
    const source = readFileSync(join(routeDirectory, "page.tsx"), "utf8");

    expect(readdirSync(routeDirectory).toSorted()).toEqual(["page.tsx"]);
    expect(source).toContain('dynamic = "force-dynamic"');
    expect(source).toContain('fetchCache = "force-no-store"');
    expect(source).toContain("createServerClient");
    expect(source).toContain("resolveTenant");
    expect(source).toContain("actorId: tenant.user.id");
    expect(source).not.toContain("createAdminClient");
    expect(source).not.toContain("service_role");
    expect(source).not.toContain("candidate_snapshot_json");
    expect(source).not.toContain("searchParams");
    expect(source).not.toContain("FormData");
  });
});
