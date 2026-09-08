import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import SoftwareGuidePage, {
  metadata as softwareGuideMetadata,
} from "../src/app/guides/what-software-does-my-small-business-need/page";

describe("Lenni small-business software guide", () => {
  it("renders the decision guide, product proof and early-access path", () => {
    const markup = renderToStaticMarkup(createElement(SoftwareGuidePage));

    expect(markup).toContain(
      "What software does your small business <span>actually need?</span>",
    );
    expect(markup).toContain(
      "Start with the business, not the software category.",
    );
    expect(markup).toContain("Describe the work in four parts.");
    expect(markup).toContain("Maintenance company");
    expect(markup).toContain("Salon");
    expect(markup).toContain("Recurring delivery");
    expect(markup).toContain("A simple CRM may be enough.");
    expect(markup).toContain("Consider a flexible operating workspace.");
    expect(markup).toContain("Second-site quote");
    expect(markup).toContain("Do I need a CRM for my small business?");
    expect(markup).toContain('href="/#early-access"');
    expect(markup).toContain("Show me what Lenni would build");
    expect(markup).toContain('type="application/ld+json"');
  });

  it("publishes canonical article and social metadata", () => {
    expect(softwareGuideMetadata).toMatchObject({
      title: "What Software Does Your Small Business Actually Need?",
      description:
        "A practical guide to choosing between a CRM, specialist software, flexible tools and a connected workspace built around how your business works.",
      alternates: {
        canonical: "/guides/what-software-does-my-small-business-need",
      },
      openGraph: {
        type: "article",
        url: "/guides/what-software-does-my-small-business-need",
        images: ["/og-lenni.png"],
      },
      twitter: {
        card: "summary_large_image",
        images: ["/og-lenni.png"],
      },
    });
  });
});
