import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import OutgrownSpreadsheetsPage, {
  metadata as outgrownSpreadsheetsMetadata,
} from "../src/app/outgrown-spreadsheets/page";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import { AppShell } from "../src/components/app-shell";
import { rejectMarketingOnlyRoute } from "../src/proxy";

vi.mock("next/navigation", () => ({
  usePathname: () => "/outgrown-spreadsheets",
}));

describe("Lenni marketing launch", () => {
  it("renders the approved outgrown-spreadsheets narrative and early CTA", () => {
    const markup = renderToStaticMarkup(
      createElement(OutgrownSpreadsheetsPage),
    );

    expect(markup).toContain(
      "Your business has outgrown spreadsheets. What comes next?",
    );
    expect(markup).toContain("Eventually, you are the system.");
    expect(markup).toContain("Start with the business.");
    expect(markup).toContain("Customer");
    expect(markup).toContain("Job");
    expect(markup).toContain("Quote");
    expect(markup).toContain("jobs to follow up");
    expect(markup).toContain("The workspace remains editable.");
    expect(markup).toContain("The business runs from normal software.");
    expect(markup).toContain("Show me what Lenni would build");
    expect(markup).toContain('href="/#early-access"');
    expect(markup).toContain("Lenni is not generally available yet.");
  });

  it("uses the shared Lenni marketing shell without product navigation", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", null, "Article")),
    );

    expect(markup).toContain("marketing-frame");
    expect(markup).toContain("Outgrown spreadsheets");
    expect(markup).toContain("Join early access");
    expect(markup).not.toContain('href="/sign-in"');
    expect(markup).not.toContain('href="/start"');
    expect(markup).not.toContain("SMBOS");
  });

  it("uses canonical production metadata for the article", () => {
    expect(outgrownSpreadsheetsMetadata).toMatchObject({
      title: "Your business has outgrown spreadsheets. What comes next?",
      description:
        "A practical way to move from spreadsheets, messages and memory to a connected, editable business workspace.",
      alternates: {
        canonical: "/outgrown-spreadsheets",
      },
      openGraph: {
        type: "article",
        url: "/outgrown-spreadsheets",
      },
    });
  });

  it("publishes exactly the two marketing URLs in crawler resources", () => {
    expect(sitemap()).toEqual([
      { url: "https://uselenni.com/" },
      { url: "https://uselenni.com/outgrown-spreadsheets" },
    ]);
    expect(robots()).toMatchObject({
      host: "https://uselenni.com",
      sitemap: "https://uselenni.com/sitemap.xml",
      rules: {
        allow: ["/", "/outgrown-spreadsheets"],
      },
    });
  });

  it("fails closed for application routes in marketing-only mode", async () => {
    const rejected = rejectMarketingOnlyRoute(
      new NextRequest("https://uselenni.com/app/example"),
      true,
    );

    expect(rejected?.status).toBe(404);
    expect(rejected?.headers.get("x-robots-tag")).toBe("noindex");
    await expect(rejected?.text()).resolves.toBe("Not found.");

    for (const pathname of [
      "/",
      "/outgrown-spreadsheets",
      "/outgrown-spreadsheets/",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      expect(
        rejectMarketingOnlyRoute(
          new NextRequest(`https://uselenni.com${pathname}`),
          true,
        ),
      ).toBeNull();
    }
  });
});
