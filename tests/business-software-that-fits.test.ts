import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/business-software-that-fits",
}));

import BusinessSoftwareThatFitsPage, {
  metadata as businessSoftwareThatFitsMetadata,
} from "../src/app/business-software-that-fits/page";
import {
  createFitDemoState,
  getVisibleFitRows,
} from "../src/components/business-software-fit-demo";
import { AppShell } from "../src/components/app-shell";
import { rejectMarketingOnlyRoute } from "../src/proxy";

describe("Lenni business-software-that-fits marketing page", () => {
  it("renders the approved story, local product proof and one early-access form", () => {
    const markup = renderToStaticMarkup(
      createElement(BusinessSoftwareThatFitsPage),
    );

    expect(markup).toContain("Finally, software");
    expect(markup).toContain("your business.");
    expect(markup).toContain("Northline Studio");
    expect(markup).toContain("Waiting for reply");
    expect(markup).toContain("A better fit.");
    expect(markup).toContain("Shape your workspace.");
    expect(markup).toContain("Is Lenni just a CRM?");
    expect(markup).toContain(
      "Interactive local demo. Sample records, not a live account.",
    );
    expect(markup).toContain("No email or messages are being monitored.");
    expect(markup).toContain('id="main"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('href="#early-access"');
    expect(markup.match(/class="early-access-form/g)).toHaveLength(1);
    expect(markup).not.toContain('href="/start"');
    expect(markup).not.toContain('href="/sign-up"');
    expect(markup).not.toContain("SMBOS");
  });

  it("keeps the example state local and makes the waiting view explicit", () => {
    const workspace = createFitDemoState("studio");
    const rows = getVisibleFitRows(workspace, "enquiries", "waiting");

    expect(rows).toEqual([
      expect.objectContaining({
        id: "spring-collection",
        status: "Waiting for reply",
      }),
    ]);
    expect(workspace.enquiries).toHaveLength(4);
    expect(getVisibleFitRows(workspace, "clients", "all")).toHaveLength(4);
    expect(getVisibleFitRows(workspace, "projects", "all")).toHaveLength(3);

    expect(createFitDemoState("trades")).toMatchObject({
      clientDescriptor: "Homeowner",
      leadLabel: "Enquiries",
      workLabel: "Jobs",
    });
    expect(createFitDemoState("consultancy")).toMatchObject({
      clientDescriptor: "Growing business",
      leadLabel: "Opportunities",
      workLabel: "Engagements",
    });
  });

  it("uses page-specific metadata and the shared marketing shell", () => {
    expect(businessSoftwareThatFitsMetadata).toMatchObject({
      title: {
        absolute: "Customisable CRM & Business Software That Fits | Lenni",
      },
      description:
        "A flexible, connected workspace for small businesses that want customer information, work and useful stages to fit the way they operate.",
      alternates: { canonical: "/business-software-that-fits" },
      openGraph: {
        type: "website",
        url: "/business-software-that-fits",
        images: ["/og-lenni.png"],
      },
      twitter: { card: "summary_large_image", images: ["/og-lenni.png"] },
    });

    const shell = renderToStaticMarkup(
      createElement(AppShell, null, createElement("main", null, "Page")),
    );

    expect(shell).toContain("marketing-frame");
    expect(shell).toContain("Find your fit");
    expect(shell).toContain("Room to grow");
    expect(shell).toContain("Get early access");
    expect(shell).toContain('href="#early-access"');
    expect(shell).toContain('href="/business-software-that-fits"');
    expect(shell).not.toContain('href="/sign-in"');
  });

  it("allows only the exact public route in marketing-only mode", async () => {
    for (const pathname of [
      "/business-software-that-fits",
      "/business-software-that-fits/",
    ]) {
      expect(
        rejectMarketingOnlyRoute(
          new NextRequest(`https://uselenni.com${pathname}`),
          true,
        ),
      ).toBeNull();
    }

    const rejected = rejectMarketingOnlyRoute(
      new NextRequest(
        "https://uselenni.com/business-software-that-fits/private",
      ),
      true,
    );
    expect(rejected?.status).toBe(404);
    await expect(rejected?.text()).resolves.toBe("Not found.");
  });
});
