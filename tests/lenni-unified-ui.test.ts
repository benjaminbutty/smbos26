import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceHome } from "../src/components/workspace-home";
import { TableViewTabs } from "../src/runtime/views/table-view-navigation";

describe("Lenni unified workspace presentation", () => {
  it("gives an empty Business equally clear AI and manual starting routes", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceHome, {
        businessName: "Willow & Co",
        businessSlug: "willow-co",
        canManageConfiguration: true,
        destinations: [],
        greetingName: "Ben",
      }),
    );

    expect(html).toContain("Build the system your business needs.");
    expect(html).toContain("Tell Lenni what you need");
    expect(html).toContain("Create manually");
    expect(html).toContain("New Table");
    expect(html).toContain("New Page");
    expect(html).toContain("/app/willow-co/builder");
    expect(html).toContain(
      "/app/willow-co?new=table#tables-navigation-heading",
    );
    expect(html).toContain("/app/willow-co?new=page#pages-navigation-heading");
    expect(html).not.toContain("revenue");
    expect(html).not.toContain("location setup");
  });

  it("keeps populated Home vocabulary generic", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceHome, {
        businessName: "Mobile Grooming",
        businessSlug: "mobile-grooming",
        canManageConfiguration: true,
        destinations: [
          {
            description: "View and manage information",
            href: "/app/mobile-grooming/workspace/equipment",
            label: "Equipment",
          },
        ],
        greetingName: "Owner",
      }),
    );

    expect(html).toContain("Mobile Grooming");
    expect(html).toContain("Equipment");
    expect(html).not.toContain("Customers");
  });

  it("keeps saved Views inside a Table tab strip", () => {
    const html = renderToStaticMarkup(
      createElement(TableViewTabs, {
        businessSlug: "bakery",
        currentViewKey: "customers",
        views: [
          {
            id: "primary",
            key: "customers",
            name: "All",
            config_json: { role: "primary" },
          },
          {
            id: "active",
            key: "customers_active",
            name: "Active",
            config_json: { role: "saved" },
          },
        ],
      } as never),
    );

    expect(html).toContain('aria-label="Table views"');
    expect(html).toContain("All");
    expect(html).toContain("Active");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Saved");
  });
});
