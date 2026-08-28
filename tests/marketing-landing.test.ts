import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import HomePage from "../src/app/page";
import { marketingMetadata } from "../src/app/marketing-metadata";

describe("public marketing landing page", () => {
  it("renders the Lenni-branded workspace hero and first entry path", () => {
    const markup = renderToStaticMarkup(createElement(HomePage));

    expect(markup).toContain("Your business,");
    expect(markup).toContain("in one calm workspace.");
    expect(markup).toContain("Bring the work that keeps your business moving");
    expect(markup).toContain('href="#early-access"');
    expect(markup).toContain("Show me what Lenni would build");
    expect(markup).toContain('href="/outgrown-spreadsheets"');
    expect(markup).toContain("Outgrown spreadsheets? Read more");
    expect(markup).not.toContain('href="/start"');
    expect(markup).not.toContain('href="/sign-up"');
    expect(markup).toContain("Tell Lenni");
    expect(markup).toContain("What is Lenni?");
    expect(markup).toContain("Is Lenni just an AI chatbot?");
    expect(markup).toContain("Lenni workspace");
    expect(markup).not.toContain("What is SMBOS?");
    expect(markup).not.toContain("SMBOS");
    expect(markup).not.toContain("SMBOS v0.1");
    expect(markup).not.toContain("Milestone 1");
    expect(markup).not.toContain("secure foundation");
  });

  it("uses the owner-facing metadata direction", () => {
    expect(marketingMetadata).toMatchObject({
      description:
        "Lenni is a flexible business workspace for small businesses, shaped around how you actually work.",
      openGraph: {
        title: "Your business, in one calm workspace. · Lenni",
        images: ["/og-lenni.png"],
      },
      twitter: {
        card: "summary_large_image",
        images: ["/og-lenni.png"],
      },
      title: {
        default: "Your business, in one calm workspace.",
        template: "%s · Lenni",
      },
    });
  });
});
