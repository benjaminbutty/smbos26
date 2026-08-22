import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/bakery",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock(
  "../src/runtime/editor-kernel/production/production-table-actions",
  () => ({
    archiveProductionSavedViewAction: vi.fn(),
    configureProductionSavedViewAction: vi.fn(),
    duplicateProductionSavedViewAction: vi.fn(),
    previewProductionSavedViewAction: vi.fn(),
    refreshProductionTableCurrentnessAction: vi.fn(),
    searchProductionTableConnectionTargetsAction: vi.fn(),
  }),
);

import { WorkspaceHome } from "../src/components/workspace-home";
import { WorkspaceMobileNav } from "../src/components/workspace-mobile-nav";
import { AcquisitionProposalCard } from "../src/components/acquisition-proposal";
import { AcquisitionSetupSummary } from "../src/components/acquisition-setup-summary";
import { BuilderResultPanel } from "../src/components/builder-ui";
import { RecordPanel } from "../src/runtime/editor-kernel/record-panel";
import { TableViewTabs } from "../src/runtime/views/table-view-navigation";
import { TableViewControls } from "../src/runtime/views/table-view-controls";

describe("Lenni unified workspace presentation", () => {
  it("keeps mobile navigation role-aware while preserving shared destinations", () => {
    const ownerHtml = renderToStaticMarkup(
      createElement(WorkspaceMobileNav, {
        businessName: "Bakery",
        businessSlug: "bakery",
        canManageConfiguration: true,
        pages: [],
        tables: [],
      }),
    );
    const staffHtml = renderToStaticMarkup(
      createElement(WorkspaceMobileNav, {
        businessName: "Bakery",
        businessSlug: "bakery",
        canManageConfiguration: false,
        pages: [],
        tables: [],
      }),
    );

    expect(ownerHtml).toContain('aria-label="Mobile workspace navigation"');
    expect(ownerHtml).toContain("Tables");
    expect(ownerHtml).toContain("Pages");
    expect(ownerHtml).toContain("More");
    expect(ownerHtml).not.toContain("Work");
    expect(staffHtml).not.toContain("Changes");
    expect(staffHtml).not.toContain("Setup");
    expect(staffHtml).toContain("Tables");
    expect(staffHtml).toContain("Pages");
    expect(staffHtml).toContain("More");

    const source = readFileSync(
      new URL("../src/components/workspace-mobile-nav.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("Tell Lenni");
    expect(source).not.toContain('type SheetKind = "work"');
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

  it("keeps the desktop shell one-destination and capability-driven", () => {
    const source = readFileSync(
      new URL("../src/app/app/[businessSlug]/layout.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<TablesSidebar");
    expect(source).toContain("<PagesSidebar");
    expect(source).toContain('aria-label="Sites"');
    expect(source).not.toContain(">Work</");
    expect(source).not.toContain("Other views");
    expect(source).not.toContain("href={`/app/${businessSlug}/setup`}");
  });

  it("keeps C7 settings, auth and public preorder presentation bounded", () => {
    const locationsSource = readFileSync(
      new URL(
        "../src/app/app/[businessSlug]/locations/page.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const setupSource = readFileSync(
      new URL("../src/app/app/[businessSlug]/setup/page.tsx", import.meta.url),
      "utf8",
    );
    const signInSource = readFileSync(
      new URL("../src/app/sign-in/page.tsx", import.meta.url),
      "utf8",
    );
    const signUpSource = readFileSync(
      new URL("../src/app/sign-up/page.tsx", import.meta.url),
      "utf8",
    );
    const businessSource = readFileSync(
      new URL("../src/app/start/business/page.tsx", import.meta.url),
      "utf8",
    );
    const claimFormSource = readFileSync(
      new URL("../src/components/workspace-claim-form.tsx", import.meta.url),
      "utf8",
    );
    const publicSource = readFileSync(
      new URL(
        "../src/app/p/[businessSlug]/[pageSlug]/page.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const preorderSource = readFileSync(
      new URL(
        "../src/runtime/preorder/preorder-experience.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const cssSource = readFileSync(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );

    expect(locationsSource).toContain('from("business_memberships")');
    expect(locationsSource).toContain('id="business"');
    expect(locationsSource).toContain('id="locations"');
    expect(locationsSource).toContain('id="team"');
    expect(locationsSource).toContain('name="timezone"');
    expect(locationsSource).toContain('"manage_locations"');
    expect(locationsSource).toContain('"manage_memberships"');
    expect(setupSource).toContain("Settings / Setup");
    expect(setupSource).toContain('aria-label="Settings sections"');
    expect(setupSource).toContain("prepare a change for review");

    expect(signInSource).toContain("c7-auth-page");
    expect(signInSource).toContain("c7-auth-panel");
    expect(signInSource).toContain("Sign in and continue");
    expect(signInSource).toContain("loadAcquisitionSession");
    expect(signUpSource).toContain("c7-auth-page");
    expect(signUpSource).toContain("c7-auth-panel");
    expect(signUpSource).toContain("Save workspace and continue");
    expect(signUpSource).toContain("accepted_candidate_checksum");
    expect(businessSource).toContain("Your Business was not created.");
    expect(businessSource).toContain("WorkspaceClaimForm");
    expect(claimFormSource).toContain("useFormStatus");
    expect(claimFormSource).toContain("Creating your workspace");
    expect(claimFormSource).not.toContain("setTimeout");
    expect(claimFormSource).not.toContain("percentage");
    expect(publicSource).toContain("c7-public-experience-header");
    expect(publicSource).toContain("Powered by Lenni");
    expect(publicSource).toContain("c7-public-preorder");
    expect(preorderSource).toContain("aria-busy={submitting}");
    expect(preorderSource).toContain('id="preorder-error"');
    expect(preorderSource).toContain('role="alert"');
    expect(preorderSource).not.toContain("reach the bakery");

    expect(cssSource).toContain(".c7-settings-section-nav");
    expect(cssSource).toContain(".c7-settings-role-grid");
    expect(cssSource).toContain(".c7-auth-panel");
    expect(cssSource).toContain(".c7-public-experience-header");
    expect(cssSource).toContain(".c7-public-preorder .preorder-summary");
    expect(cssSource).toContain("@media (max-width: 48rem)");
    expect(cssSource).toContain("@media (max-width: 38rem)");
  });

  it("keeps the Page editor bounded, direct, and renderer-backed", () => {
    const editorSource = readFileSync(
      new URL("../src/runtime/page-editor/page-editor.tsx", import.meta.url),
      "utf8",
    );
    const cssSource = readFileSync(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );

    expect(editorSource).toContain('aria-keyshortcuts="/"');
    expect(editorSource).toContain("Press / to add");
    expect(editorSource).toContain('void addBlock({ type: "divider" })');
    expect(editorSource).toContain('aria-controls="page-editor-add-menu"');
    expect(editorSource).toContain('aria-live="polite"');
    expect(editorSource).toContain("draggable={Boolean(id)}");
    expect(editorSource).toContain("moveBlockToIndex");
    expect(editorSource).toContain("Open Table");
    expect(editorSource).toContain("Read-only");
    expect(editorSource).toContain("ProductionTableWorkspace");

    expect(cssSource).toContain("/* C5 Page canvas presentation.");
    expect(cssSource).toContain(".page-editor-inline-edit:focus-visible");
    expect(cssSource).toContain(".page-editor-view-block .editor-grid-shell");
    expect(cssSource).toContain(
      ".editor-kernel-embedded .editor-mobile-record-list",
    );
    expect(cssSource).toContain(".editor-kernel-embedded .editor-record-panel");
    expect(cssSource).toContain("overflow-x: auto");
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
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
    expect(html).toContain("Live workspace");
    expect(html).toContain("This is your real workspace");
    expect(html).not.toContain("needs your attention");
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

  it("renders the owner-readable Workspace Map without inventing capabilities", () => {
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

    expect(html).toContain("Your workspace map");
    expect(html).toContain("The parts you&#x27;ll work with");
    expect(html).toContain("How the work connects");
    expect(html).toContain("This setup includes");
    expect(html).toContain("Why this shape");
    expect(html).toContain("Not included");
    expect(html).toContain("Reliable starting point");
    expect(html).toContain("Preview workspace");
    expect(html).toContain("Something&#x27;s missing");
    expect(html).toContain('aria-label="Journey orientation"');
    expect(html).not.toContain("cardinality");
    expect(html).not.toContain("source/target");
    expect(html).not.toContain("Print");
    expect(html).not.toContain("Archive");
  });

  it("keeps the accepted candidate visible without implying creation", () => {
    const html = renderToStaticMarkup(
      createElement(AcquisitionSetupSummary, {
        model: {
          checksum: "candidate-checksum",
          pages: [{ key: "booking", title: "Book online" }],
          tables: {
            appointments: {
              objectKey: "appointment",
              objectLabel: "Appointments",
            },
            customers: {
              objectKey: "customer",
              objectLabel: "Customers",
            },
            pets: {
              objectKey: "pet",
              objectLabel: "Pets",
            },
          },
          title: "A calmer booking workspace",
        },
        proposal: {
          category: "appointments",
          concepts: [
            {
              description: "People who book",
              name: "Customers",
              tracked_information: ["Name"],
            },
            {
              description: "Work in the diary",
              name: "Appointments",
              tracked_information: ["Date"],
            },
          ],
          connections: [{ text: "Each Customer has Appointments" }],
          first_step: "Review the diary.",
          landing_page_key: "today",
          not_included: [],
          pages: [],
          schema_version: 1,
          source: "tailored",
          title: "A calmer booking workspace",
          understanding: "You need customers and appointments kept together.",
          views: [{ description: "Today", name: "Today" }],
          why: "It keeps the day clear.",
        },
      } as never),
    );

    expect(html).toContain("Setup ready to save");
    expect(html).toContain("A calmer booking workspace");
    expect(html).toContain("Customers");
    expect(html).toContain("Appointments");
    expect(html).toContain("Pets");
    expect(html).toContain("temporary");
    expect(html).not.toContain("created successfully");
  });

  it("keeps preview routes in one shell and fills mobile Record context", () => {
    const shellSource = readFileSync(
      new URL("../src/components/app-shell.tsx", import.meta.url),
      "utf8",
    );
    const cssSource = readFileSync(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );

    expect(shellSource).toContain('pathname.startsWith("/start/preview/")');
    expect(shellSource).toContain("app-frame candidate-frame");
    expect(cssSource).toContain(".candidate-preview-page .editor-record-panel");
    expect(cssSource).toContain("height: 100dvh");
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

    expect(startSource).toContain(
      "Build the system your business actually needs",
    );
    expect(startSource).toContain("What kind of work is closest?");
    expect(startSource).toContain('submitLabel="Start with Lenni"');
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

  it("shows the Table-local Saved View control only with structural access", () => {
    const props = {
      availableColumns: [{ kind: "field", field_key: "name" }],
      businessSlug: "bakery",
      config: {
        schema_version: 2,
        role: "primary",
        columns: [{ kind: "field", field_key: "name" }],
        fields: ["name"],
        title_field: "name",
        include_archived: false,
        filters: [],
        filter_match: "all",
        sorts: [],
        group: null,
      },
      fields: [{ key: "name", label: "Name", field_type: "short_text" }],
      primaryViewKey: "appointments",
      relationships: [],
      viewKey: "appointments",
      viewName: "Appointments",
    };
    const owner = renderToStaticMarkup(
      createElement(TableViewControls, {
        ...props,
        currentness: {
          expectedBaseVersionId: "10000000-0000-4000-8000-000000000001",
          expectedHeadRevision: 2,
        },
      } as never),
    );
    const staff = renderToStaticMarkup(
      createElement(TableViewControls, props as never),
    );
    expect(owner).toContain('aria-label="Create saved view"');
    expect(staff).not.toContain("Create saved view");
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
    const recordPanelSource = readFileSync(
      new URL("../src/runtime/editor-kernel/record-panel.tsx", import.meta.url),
      "utf8",
    );
    const viewControlsSource = readFileSync(
      new URL("../src/runtime/views/table-view-controls.tsx", import.meta.url),
      "utf8",
    );
    const unsavedWarningSource = readFileSync(
      new URL("../src/runtime/unsaved-navigation-warning.ts", import.meta.url),
      "utf8",
    );
    const productionActionsSource = readFileSync(
      new URL(
        "../src/runtime/editor-kernel/production/production-table-actions.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const connectionEditorSource = readFileSync(
      new URL(
        "../src/runtime/editor-kernel/cell-editors/index.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const detailRendererSource = readFileSync(
      new URL("../src/runtime/views/view-renderer.tsx", import.meta.url),
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
    expect(editorSource).toContain('aria-label="Search this Table"');
    expect(editorSource).toContain('data-testid="editor-grid-no-matches"');
    expect(editorSource).toContain('data-testid="editor-mobile-record-list"');
    expect(editorSource).toContain('status: "stale"');
    expect(editorSource).toContain("Needs reload");
    expect(editorSource).toContain("capabilities.rowCreationMessage");
    expect(recordPanelSource).toContain('aria-modal="true"');
    expect(recordPanelSource).toContain('role="dialog"');
    expect(recordPanelSource).toContain("focusableSelector");
    expect(viewControlsSource).toContain("Filtered by");
    expect(viewControlsSource).toContain("Sorted by");
    expect(viewControlsSource).toContain("Grouped by");
    expect(viewControlsSource).not.toContain("Filter {config.filters.length}");
    expect(viewControlsSource).toContain("useUnsavedNavigationWarning");
    expect(viewControlsSource).toContain("config.filters.slice(1)");
    expect(viewControlsSource).toContain("filter_match: config.filter_match");
    expect(viewControlsSource).toContain("config.sorts.slice(1)");
    expect(editorSource).toContain("useUnsavedNavigationWarning");
    expect(unsavedWarningSource).toContain('"beforeunload"');
    expect(unsavedWarningSource).toContain("window.confirm(message)");
    expect(productionActionsSource).toContain("submitExperienceForm");
    expect(productionActionsSource).toContain("availability.formKey");
    expect(connectionEditorSource).toContain("creationNotice");
    expect(connectionEditorSource).toContain("added to");
    expect(detailRendererSource).toContain('aria-label="Record location"');
    expect(detailRendererSource).toContain("Where this lives");
    expect(detailRendererSource).toContain('aria-label="Record context"');
    expect(productionSource).toContain("creationFallbackHref");
    expect(productionSource).toContain('className="editor-lab-kicker">Table');
    expect(cssSource).toContain(
      ".workspace-table-page .editor-header-content:empty",
    );
    expect(cssSource).toContain(
      ".workspace-table-page .editor-header-menu-button",
    );
    expect(cssSource).toContain(
      ".workspace-table-page .editor-mobile-record-list",
    );
    expect(cssSource).toContain(
      ".workspace-table-page .editor-lab-meta > span:nth-child(2)",
    );
    expect(cssSource).not.toContain(
      ".workspace-table-page .editor-lab-meta > span:nth-child(3)",
    );
    expect(cssSource).toContain(".runtime-detail-location");
    expect(cssSource).toContain(".editor-connection-popover.is-portal");
    expect(cssSource).toContain("position: sticky");
    expect(cssSource).toContain("position: fixed");
  });

  it("keeps Builder trust states distinct and preserves manual continuity", () => {
    const unavailableHtml = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: "bakery",
        state: {
          state: "unavailable",
          reason: "ai_disabled",
          message:
            "Builder is enabled for this Business, but AI is currently unavailable in this environment.",
        },
      }),
    );
    const proposalHtml = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: "bakery",
        state: {
          state: "proposed",
          proposal_id: "00000000-0000-4000-8000-000000000001",
          summary: "Add an Enquiries information type.",
          operation_count: 1,
        },
      }),
    );
    const clarificationHtml = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: "bakery",
        state: {
          state: "needs_clarification",
          understanding: "You want to organise customer enquiries.",
          known_requirements: ["Customer name"],
          assumptions: [],
          questions: [
            {
              question: "What should an enquiry include?",
              reason: "This determines the fields in the proposed setup.",
              response_style: "free_text",
              options: [],
            },
          ],
          unsupported_requirements: [],
        },
      }),
    );

    expect(unavailableHtml).toContain("Builder AI is unavailable");
    expect(unavailableHtml).toContain("Build manually");
    expect(unavailableHtml).toContain('href="/app/bakery"');
    expect(unavailableHtml).toContain("live workspace is unchanged");
    expect(proposalHtml).toContain("Configuration proposal · Proposed");
    expect(proposalHtml).toContain("Nothing is live yet");
    expect(proposalHtml).toContain("Review proposed change");
    expect(clarificationHtml).toContain("What Lenni understood");
    expect(clarificationHtml).toContain("Questions to answer");
  });

  it("keeps Changes and Preview trust language owner-centred", () => {
    const historySource = readFileSync(
      new URL(
        "../src/components/configuration-history-ui.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const previewSource = readFileSync(
      new URL(
        "../src/components/configuration-preview-shell.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const cssSource = readFileSync(
      new URL("../src/app/globals.css", import.meta.url),
      "utf8",
    );

    expect(historySource).toContain("Checked — ready to apply");
    expect(historySource).toContain("Applied · Live");
    expect(historySource).toContain("ownerConsequence");
    expect(historySource).toContain("Things changed — Preview is unavailable");
    expect(historySource).toContain("Technical revision");
    expect(historySource).toContain(
      "Rollback is a new forward configuration change",
    );
    expect(previewSource).toContain("Preview — not live");
    expect(previewSource).toContain("Read-only");
    expect(previewSource).toContain("No edits or submissions will be saved");
    expect(cssSource).toContain(".history-impact");
    expect(cssSource).toContain(".builder-result-unavailable");
    expect(cssSource).toContain(".diff-technical-details");
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

  it("uses owner-readable, read-only language in preview Record context", () => {
    const html = renderToStaticMarkup(
      createElement(RecordPanel, {
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
            editable: false,
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
        onClose: () => undefined,
        onCommitCell: () => undefined,
        recordTypeLabel: "Appointment",
        row: {
          id: "30000000-0000-4000-8000-000000000001",
          values: {
            name: "Milo · Full groom",
            customer: ["40000000-0000-4000-8000-000000000001"],
          },
          connectionValues: {
            customer: [
              {
                id: "40000000-0000-4000-8000-000000000001",
                label: "Sarah Evans",
              },
            ],
          },
        },
        statusLabel: "Read-only preview",
        tableName: "Appointments",
      } as never),
    );

    expect(html).toContain("Read-only preview");
    expect(html).toContain("Also shows on");
    expect(html).toContain("Connected example information");
    expect(html).toContain("Related information");
    expect(html).toContain("Sarah Evans");
    expect(html).not.toContain("Several records");
    expect(html).not.toContain("Remove Sarah Evans");
  });
});
