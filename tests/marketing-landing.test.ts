import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import HomePage from "../src/app/page";
import { marketingMetadata } from "../src/app/marketing-metadata";

describe("public marketing landing page", () => {
  it("renders the approved Lenni story and first entry path", () => {
    const markup = renderToStaticMarkup(createElement(HomePage));

    expect(markup).toContain("For the business");
    expect(markup).toContain("could build.");
    expect(markup).toContain("Eventually,");
    expect(markup).toContain("you are the system.");
    expect(markup).toContain('href="#possibilities"');
    expect(markup).toContain("See what");
    expect(markup).toContain("independent-florist.png");
    expect(markup).toContain("Preview · example data");
    expect(markup).toContain("Lenni is not generally available yet.");
    expect(markup).not.toContain('href="/start"');
    expect(markup).not.toContain('href="/sign-up"');
    expect(markup).toContain("A flower studio");
    expect(markup).toContain("A maintenance business");
    expect(markup).toContain("A creative studio");
    expect(markup).toContain("What can I do with Lenni?");
    expect(markup).toContain("Does it connect to the tools I already use?");
    expect(markup).toContain('name="email"');
    expect(markup).toContain('id="main"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).not.toContain('name="businessType"');
    expect(markup).not.toContain("What is SMBOS?");
    expect(markup).not.toContain("SMBOS");
    expect(markup).not.toContain("SMBOS v0.1");
    expect(markup).not.toContain("Milestone 1");
    expect(markup).not.toContain("secure foundation");
  });

  it("uses the owner-facing metadata direction", () => {
    expect(marketingMetadata).toMatchObject({
      description:
        "A flexible workspace shaped around how you work. Your customers, your plans, your next big thing.",
      openGraph: {
        title: "For the business only you could build. · Lenni",
        images: ["/og-lenni.png"],
      },
      twitter: {
        card: "summary_large_image",
        images: ["/og-lenni.png"],
      },
      title: {
        default: "For the business only you could build.",
        template: "%s · Lenni",
      },
    });
  });

  it("loads the required deferred JAMP scripts from the document head", () => {
    const layoutSource = readFileSync("src/app/layout.tsx", "utf8");

    expect(layoutSource).toContain(
      "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap",
    );
    expect(layoutSource).toMatch(
      /<script\s+defer\s+crossOrigin="anonymous"\s+data-website-id="cmtej8bsc0004q500nl740or8"\s+src="https:\/\/jamp\.io\/main\.js"\s+\/>/,
    );
    expect(layoutSource).toMatch(
      /<script\s+defer\s+crossOrigin="anonymous"\s+data-website-id="cmtej8bsc0004q500nl740or8"\s+src="https:\/\/jamp\.io\/index\.js"\s+\/>/,
    );
  });
});
