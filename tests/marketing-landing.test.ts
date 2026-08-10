import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import HomePage from "../src/app/page";
import { marketingMetadata } from "../src/app/marketing-metadata";

describe("public marketing landing page", () => {
  it("renders the brief-led hero, sections and early-access path", () => {
    const markup = renderToStaticMarkup(createElement(HomePage));

    expect(markup).toContain("Run your business.");
    expect(markup).toContain("Your way.");
    expect(markup).toContain("Everything you need to run your business");
    expect(markup).toContain('href="#early-access"');
    expect(markup).toContain('href="#how-it-works"');
    expect(markup).toContain("AI helps you build");
    expect(markup).toContain("What is SMBOS?");
    expect(markup).not.toContain("SMBOS v0.1");
    expect(markup).not.toContain("Milestone 1");
    expect(markup).not.toContain("secure foundation");
  });

  it("uses the owner-facing metadata direction", () => {
    expect(marketingMetadata).toMatchObject({
      description:
        "SMBOS is a flexible operating platform for small businesses, shaped around how you actually work.",
      openGraph: {
        title: "Run your business. Your way. · SMBOS",
        images: ["/og.png"],
      },
      twitter: {
        card: "summary_large_image",
        images: ["/og.png"],
      },
    });
  });
});
