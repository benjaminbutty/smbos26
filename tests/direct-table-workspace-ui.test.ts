import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ExperienceViewBundle } from "../src/core/experience/service";
import type { TableViewConfig } from "../src/core/experience/schemas";
import type { Tables } from "../src/db/supabase/database.types";
import { TablesSidebar } from "../src/runtime/navigation/tables-sidebar";
import { DirectTableWorkspace } from "../src/runtime/views/direct-table-workspace";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/example/workspace/contacts",
}));

const businessId = "10000000-0000-4000-8000-000000000001";
const objectId = "20000000-0000-4000-8000-000000000001";
const recordId = "30000000-0000-4000-8000-000000000001";
const now = "2026-08-09T12:00:00.000Z";

function field(
  key: string,
  label: string,
  fieldType: Tables<"field_definitions">["field_type"],
  position: number,
  settingsJson: Record<string, unknown> = {},
): Tables<"field_definitions"> {
  return {
    id: crypto.randomUUID(),
    business_id: businessId,
    object_definition_id: objectId,
    key,
    label,
    field_type: fieldType,
    required: false,
    default_value: null,
    settings_json: settingsJson,
    position,
    is_active: true,
    created_at: now,
    updated_at: now,
  } as Tables<"field_definitions">;
}

const name = field("name", "Name", "short_text", 0);
const status = field("status", "Status", "status", 1, {
  options: ["New", "Booked"],
});
const due = field("due", "Due date", "date", 2);
const confirmed = field("confirmed", "Confirmed", "boolean", 3);
const config: TableViewConfig = {
  fields: ["status", "name", "due", "confirmed"],
  title_field: "name",
  include_archived: false,
};
const record = {
  id: recordId,
  business_id: businessId,
  created_by: null,
  object_definition_id: objectId,
  data_json: {
    name: "Sam Taylor",
    status: "Booked",
    due: "2026-08-10",
    confirmed: true,
  },
  record_status: "active",
  created_at: now,
  updated_at: now,
} as Tables<"records">;
const bundle = {
  definition: {
    id: crypto.randomUUID(),
    business_id: businessId,
    key: "contacts",
    name: "Contacts",
    view_type: "table",
    object_definition_id: objectId,
    config_json: config,
    audience: "internal",
    is_active: true,
    created_at: now,
    updated_at: now,
    object_key: "contact",
  },
  object: {
    id: objectId,
    business_id: businessId,
    key: "contact",
    singular_label: "Contact",
    plural_label: "Contacts",
    description: "",
    kind: "custom",
    semantic_type: null,
    icon: null,
    is_active: true,
    created_at: now,
    updated_at: now,
  },
  fields: [name, status, due, confirmed],
  records: [record],
  config,
} as unknown as ExperienceViewBundle;

const structuralAction = async (): Promise<never> => {
  throw new Error("not invoked during static rendering");
};
const cellAction = async () => ({ status: "idle" as const });
const rowAction = async () => ({ status: "idle" as const });

describe("direct Table Workspace UI evidence", () => {
  it("renders primary identity, direct controls, panel fallback, and no CRUD Edit buttons", () => {
    const html = renderToStaticMarkup(
      createElement(DirectTableWorkspace, {
        addColumnAction: structuralAction,
        bundle,
        businessSlug: "example",
        canManageConfiguration: true,
        createRowAction: rowAction,
        currentness: {
          expectedBaseVersionId: crypto.randomUUID(),
          expectedHeadRevision: 1,
        },
        recordId,
        rowCreation: { kind: "direct" },
        renameColumnAction: structuralAction,
        renameTableAction: structuralAction,
        reorderColumnsAction: structuralAction,
        resizeColumnAction: structuralAction,
        selectedRecord: record,
        undoAction: structuralAction,
        updateCellAction: cellAction,
        updateOptionsAction: structuralAction,
      }),
    );

    expect(html).toContain("Contacts");
    expect(html).toContain("Status: Active");
    expect(html).toContain("Open full record");
    expect(html).toContain("Add row");
    expect(html).toContain('aria-label="Edit Status"');
    expect(html).toContain('aria-label="Edit Due date"');
    expect(html).toContain('aria-label="Edit Confirmed"');
    expect(html).toContain("Click to open; double-click to edit");
    expect(html).toContain("record-panel");
    expect(html).not.toMatch(/>Edit<|>Create row<|>Save row</);

    const primaryLinkIndex = html.indexOf("primary-record-link");
    const statusIndex = html.indexOf("Status");
    const nameIndex = html.indexOf("Sam Taylor");
    expect(primaryLinkIndex).toBeGreaterThan(-1);
    expect(nameIndex).toBeGreaterThan(statusIndex);
  });

  it("marks the selected Table in the primary sidebar surface", () => {
    const html = renderToStaticMarkup(
      createElement(TablesSidebar, {
        action: async () => ({ status: "idle" as const }),
        businessSlug: "example",
        currentness: {
          expectedBaseVersionId: crypto.randomUUID(),
          expectedHeadRevision: 1,
        },
        tables: [
          { key: "contacts", name: "Contacts", path: "contacts" },
          { key: "orders", name: "Orders", path: "orders" },
        ],
      }),
    );

    expect(html).toContain('aria-current="page"');
    expect(html.indexOf("Contacts")).toBeLessThan(html.indexOf("Orders"));
    expect(html).toContain('aria-label="Create Table"');
  });
});
