import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/bakery",
}));

import { WorkspaceHome } from "../src/components/workspace-home";
import { WorkspaceMobileNav } from "../src/components/workspace-mobile-nav";
import { AcquisitionProposalCard } from "../src/components/acquisition-proposal";
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

  it("makes manual setup the clear first route for an empty Business", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceHome, {
        businessName: "Willow & Co",
        businessSlug: "willow-co",
        canManageConfiguration: true,
        destinations: [],
        greetingName: "Ben",
      }),
    );

    expect(html).toContain("Set up your workspace.");
    expect(html).toContain("Tell Lenni what you need");
    expect(html).toContain("Create manually");
    expect(html).toContain("New Table");
    expect(html).toContain("New Page");
    expect(html).toContain("Describe your business");
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
    expect(html).toContain("Start here");
    expect(html).toContain("Open Equipment");
    expect(html).not.toContain("Customers");
  });

  it("prioritises an existing Page as the populated Home next action", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceHome, {
        businessName: "Milk Woman Fran",
        businessSlug: "milkwomanfran",
        canManageConfiguration: true,
        destinations: [
          {
            description: "Open this workspace page",
            href: "/app/milkwomanfran/pages/overview",
            kind: "page",
            label: "Overview",
          },
          {
            description: "View and manage this work",
            href: "/app/milkwomanfran/workspace/milk-products",
            kind: "view",
            label: "Milk products",
          },
        ],
        greetingName: "Owner",
      }),
    );

    expect(html).toContain("Open Overview");
    expect(html).toContain("Your work");
    expect(html).toContain("Milk products");
    expect(html).toContain("/app/milkwomanfran/pages/overview");
  });

  it("renders the proposal hierarchy without inventing capabilities", () => {
    const html = renderToStaticMarkup(
      createElement(AcquisitionProposalCard, {
        proposal: {
          category: "appointments",
          concepts: [
            {
              description: "People who book with you",
              name: "Customers",
              tracked_information: ["Name", "Phone"],
            },
          ],
          connections: [{ text: "Each appointment belongs to one customer" }],
          first_step: "Review the starting workspace.",
          landing_page_key: "today",
          not_included: ["Online booking", "Payments"],
          pages: [
            { description: "The work that needs attention.", name: "Today" },
          ],
          source: "fallback",
          title: "A calm starting workspace",
          understanding: "You need to organise appointments and customers.",
          views: [
            {
              description: "Bookings for today.",
              name: "Appointments — Today",
            },
          ],
          why: "These pieces keep the day easy to see.",
        } as never,
      }),
    );

    expect(html).toContain("Your plan");
    expect(html).toContain("What Lenni will create");
    expect(html).toContain("How it fits together");
    expect(html).toContain("What you&#x27;ll see");
    expect(html).toContain("Why this starting point");
    expect(html).toContain("Not included yet");
    expect(html).toContain("Reliable starting point");
    expect(html).toContain("Create this workspace");
    expect(html).not.toContain("Print");
    expect(html).not.toContain("Archive");
  });

  it("keeps acquisition availability and account continuity explicit", () => {
    const startSource = readFileSync(
      new URL("../src/app/start/page.tsx", import.meta.url),
      "utf8",
    );
    const actionSource = readFileSync(
      new URL("../src/app/start/actions.ts", import.meta.url),
      "utf8",
    );
    const shellSource = readFileSync(
      new URL("../src/components/app-shell.tsx", import.meta.url),
      "utf8",
    );

    expect(startSource).toContain("What are you building?");
    expect(startSource).toContain("What best describes the work?");
    expect(startSource).toContain("state");
    expect(startSource).toContain("Start again");
    expect(actionSource).toContain('"proposal_limit_reached"');
    expect(actionSource).toContain('"needs_more_detail"');
    expect(actionSource).toContain('"anonymous_build_session_expired"');
    expect(actionSource).toContain("state }).toString()");
    expect(shellSource).toContain("lenni-public-frame");
    expect(shellSource).toContain('href="/start"');
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

  it("keeps the production Table action and empty-state contract explicit", () => {
    const editorSource = readFileSync(
      new URL("../src/runtime/editor-kernel/editor-lab.tsx", import.meta.url),
      "utf8",
    );
    const productionSource = readFileSync(
      new URL(
        "../src/runtime/editor-kernel/production/production-table-workspace.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const cssSource = readFileSync(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );

    expect(editorSource).toContain(
      "data-row-creation={capabilities.rowCreation}",
    );
    expect(editorSource).toContain('className="editor-new-record-action"');
    expect(editorSource).toContain('data-testid="editor-grid-empty"');
    expect(editorSource).toContain("capabilities.rowCreationMessage");
    expect(productionSource).toContain("creationFallbackHref");
    expect(productionSource).toContain('className="editor-lab-kicker">Table');
    expect(cssSource).toContain(
      ".workspace-table-page .editor-header-content:empty",
    );
    expect(cssSource).toContain(
      ".workspace-table-page .editor-header-menu-button",
    );
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

    expect(html).toContain("Connections");
    expect(html).toContain("Related work");
    expect(html).toContain("Beth Smith");
    expect(html).toContain('aria-label="Connect to Customer"');
    expect(html).toContain('aria-label="Remove Beth Smith from Customer"');
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
