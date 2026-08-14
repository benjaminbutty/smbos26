import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/bakery",
}));

import { WorkspaceHome } from "../src/components/workspace-home";
import { WorkspaceMobileNav } from "../src/components/workspace-mobile-nav";
import { RecordPanel } from "../src/runtime/editor-kernel/record-panel";
import { TableViewTabs } from "../src/runtime/views/table-view-navigation";

describe("Lenni unified workspace presentation", () => {
  it("keeps mobile navigation role-aware while preserving shared destinations", () => {
    const ownerHtml = renderToStaticMarkup(
      createElement(WorkspaceMobileNav, {
        businessName: "Bakery",
        businessSlug: "bakery",
        canManageConfiguration: true,
        otherViews: [],
        pages: [],
        tables: [],
      }),
    );
    const staffHtml = renderToStaticMarkup(
      createElement(WorkspaceMobileNav, {
        businessName: "Bakery",
        businessSlug: "bakery",
        canManageConfiguration: false,
        otherViews: [],
        pages: [],
        tables: [],
      }),
    );

    expect(ownerHtml).toContain('aria-label="Mobile workspace navigation"');
    expect(ownerHtml).toContain("Tell Lenni");
    expect(ownerHtml).toContain("Work");
    expect(ownerHtml).toContain("More");
    expect(staffHtml).not.toContain("Tell Lenni");
    expect(staffHtml).not.toContain("Changes");
    expect(staffHtml).not.toContain("Setup");
    expect(staffHtml).toContain("Work");
    expect(staffHtml).toContain("More");
  });

  it("keeps the mobile sheet focus, escape, and overflow contract", () => {
    const source = readFileSync(
      new URL("../src/components/workspace-mobile-nav.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("window.requestAnimationFrame");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain(
      "event.shiftKey && document.activeElement === first",
    );
    expect(source).toContain(
      "!event.shiftKey && document.activeElement === last",
    );
    expect(source).toContain("trigger.focus()");
    expect(source).toContain('document.body.style.overflow = "hidden"');
    expect(source).toContain("document.body.style.overflow = previousOverflow");
  });

  it("keeps the canonical Lenni token families in the current CSS source", () => {
    const source = readFileSync(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );

    const readRootToken = (token: string) => {
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = source.match(
        new RegExp(`\\n\\s*${escapedToken}:\\s*([^;]+);`),
      );
      expect(
        match,
        `Expected ${token} in the canonical root token source`,
      ).toBeTruthy();
      return match?.[1]?.trim();
    };

    const canonicalTokens = {
      "--coral-50": "#fff1ef",
      "--coral-100": "#ffe4df",
      "--coral-200": "#ffc9c2",
      "--coral-300": "#ffa69c",
      "--coral-400": "#ff8273",
      "--coral-500": "#ff5a4d",
      "--coral-600": "#e9483c",
      "--coral-700": "#d83a2f",
      "--coral-800": "#b92c24",
      "--coral-900": "#8f211b",
      "--border-strong": "#d5ccc3",
      "--surface-dark": "#111315",
      "--space-1": "4px",
      "--space-2": "8px",
      "--space-3": "12px",
      "--space-4": "16px",
      "--space-5": "20px",
      "--space-6": "24px",
      "--space-8": "32px",
      "--space-10": "40px",
      "--space-12": "48px",
      "--space-16": "64px",
      "--radius-sm": "6px",
      "--radius-md": "10px",
      "--radius-lg": "14px",
      "--radius-xl": "20px",
      "--radius-full": "9999px",
      "--trust-suggestion-text": "#5d646b",
      "--trust-suggestion-surface": "#f3f4f5",
      "--trust-proposed-text": "#6546b4",
      "--trust-proposed-surface": "#f2edff",
      "--trust-checked-text": "#0f6f70",
      "--trust-checked-surface": "#e8f7f6",
      "--trust-preview-text": "#245ea8",
      "--trust-preview-surface": "#ecf4ff",
      "--trust-live-applied-text": "#147a55",
      "--trust-live-applied-surface": "#eaf7f1",
      "--trust-published-text": "#3d4650",
      "--trust-published-surface": "#f1f3f5",
      "--trust-warning-needs-review-text": "#8a5200",
      "--trust-warning-needs-review-surface": "#fff5df",
      "--trust-destructive-error-text": "#b42318",
      "--trust-destructive-error-surface": "#fdecea",
      "--trust-read-only-text": "#5d646b",
      "--trust-read-only-surface": "#f5f2ee",
    } as const;

    for (const [token, value] of Object.entries(canonicalTokens)) {
      expect(readRootToken(token), `${token} must use its approved value`).toBe(
        value,
      );
    }

    const compatibilityAliases = {
      "--radius-control": "var(--radius-md)",
      "--radius-panel": "var(--radius-lg)",
      "--radius-pill": "var(--radius-full)",
      "--semantic-success": "var(--trust-live-applied-text)",
      "--semantic-warning": "var(--trust-warning-needs-review-text)",
      "--semantic-danger": "var(--trust-destructive-error-text)",
      "--semantic-info": "var(--trust-preview-text)",
      "--surface": "color-mix(in srgb, var(--surface-base) 78%, transparent)",
      "--accent": "var(--trust-live-applied-text)",
      "--accent-soft": "var(--trust-live-applied-surface)",
    } as const;

    for (const [token, value] of Object.entries(compatibilityAliases)) {
      expect(
        readRootToken(token),
        `${token} must reference a canonical token`,
      ).toBe(value);
    }

    expect(readRootToken("--border-width-thin")).toBe("1px");
    expect(readRootToken("--border-width-strong")).toBe("2px");
    expect(readRootToken("--elevation-none")).toBe("none");
    expect(readRootToken("--elevation-subtle")).toBe(
      "0 0.25rem 0.75rem rgb(23 26 29 / 0.06)",
    );
    expect(readRootToken("--elevation-panel")).toBe(
      "0 0.65rem 1.5rem rgb(23 26 29 / 0.12)",
    );
    expect(readRootToken("--elevation-overlay")).toBe(
      "0 1rem 3rem rgb(23 26 29 / 0.16)",
    );
  });

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

  it("keeps connected records navigable from the record panel", () => {
    const html = renderToStaticMarkup(
      createElement(RecordPanel, {
        businessSlug: "bakery",
        columns: [
          {
            key: "name",
            label: "Name",
            kind: "text",
            primary: true,
            editable: false,
            width: 180,
          },
          {
            key: "customer",
            label: "Customer",
            kind: "connection",
            width: 180,
            connection: {
              relationshipKey: "customer",
              direction: "source",
              multiple: false,
              targetObjectKey: "customer",
              targetViewKey: "customers",
            },
          },
        ],
        fullRecordPath: "/app/bakery/workspace/appointments",
        onClose: () => undefined,
        onCommitCell: () => undefined,
        recordTypeLabel: "Appointment",
        row: {
          id: "30000000-0000-4000-8000-000000000001",
          values: {
            name: "Milo",
            customer: ["40000000-0000-4000-8000-000000000001"],
          },
          connectionValues: {
            customer: [
              {
                id: "40000000-0000-4000-8000-000000000001",
                label: "Beth Smith",
              },
            ],
          },
        },
        tableName: "Appointments",
      } as never),
    );

    expect(html).toContain("Connected records");
    expect(html).toContain("Beth Smith");
    expect(html).toContain('aria-label="Edit Customer"');
    expect(html).toContain("/app/bakery/workspace/customers/");
    expect(html).toContain("Open full record");
  });

  it("keeps connected-record navigation inside the drawer when supported", () => {
    const html = renderToStaticMarkup(
      createElement(RecordPanel, {
        businessSlug: "bakery",
        columns: [
          {
            key: "name",
            label: "Name",
            kind: "text",
            primary: true,
            editable: false,
            width: 180,
          },
          {
            key: "customer",
            label: "Customer",
            kind: "connection",
            width: 180,
            connection: {
              relationshipKey: "customer",
              direction: "source",
              multiple: false,
              targetObjectKey: "customer",
              targetViewKey: "customers",
            },
          },
        ],
        fullRecordPath: "/app/bakery/workspace/appointments",
        onBack: () => undefined,
        onClose: () => undefined,
        onCommitCell: () => undefined,
        onFollowConnectedRecord: () => undefined,
        recordTypeLabel: "Appointment",
        row: {
          id: "30000000-0000-4000-8000-000000000001",
          values: {
            name: "Milo",
            customer: ["40000000-0000-4000-8000-000000000001"],
          },
          connectionValues: {
            customer: [
              {
                id: "40000000-0000-4000-8000-000000000001",
                label: "Beth Smith",
              },
            ],
          },
        },
        tableName: "Appointments",
      } as never),
    );

    expect(html).toContain("← Back");
    expect(html).toContain(">Beth Smith</button>");
    expect(html).not.toContain("/app/bakery/workspace/customers/");
  });
});
