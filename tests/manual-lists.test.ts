import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConfigurationIdentityAllocationError,
  createGraphKeyAllocator,
  createPageSlugAllocator,
  normaliseGraphKeyBase,
  normalisePageSlugBase,
} from "../src/core/configuration/identity-allocation";
import { normalizeManualListOptionLines } from "../src/app/app/[businessSlug]/setup/lists/new/manual-list-form";
import {
  composeManualList,
  ManualListError,
} from "../src/core/configuration/manual-lists/composer";
import { prepareManualListProposal } from "../src/core/configuration/manual-lists/service";
import {
  manualListInformationRowSchema,
  manualListIntentSchema,
  manualListPreparationRequestSchema,
} from "../src/core/configuration/manual-lists/schemas";
import { configurationOperationsSchema } from "../src/core/configuration/schemas";
import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";

function id(number: number): string {
  return `00000000-0000-4000-8000-${number.toString().padStart(12, "0")}`;
}

function snapshot(
  overrides: Partial<ConfigurationSnapshotV1> = {},
): ConfigurationSnapshotV1 {
  return {
    schema_version: 1,
    object_definitions: [
      {
        id: id(1),
        key: "customer",
        singular_label: "Customer",
        plural_label: "Customers",
        description: "Customers",
        kind: "custom",
        semantic_type: null,
        icon: null,
        is_active: true,
      },
      {
        id: id(2),
        key: "test_item",
        singular_label: "Archived item",
        plural_label: "Archived items",
        description: "Archived identity reservation",
        kind: "custom",
        semantic_type: null,
        icon: null,
        is_active: false,
      },
    ],
    field_definitions: [],
    relationship_definitions: [],
    views: [
      {
        id: id(3),
        key: "test_items",
        name: "Archived items",
        view_type: "table",
        object_definition_id: id(2),
        object_key: "test_item",
        config_json: { fields: ["old_name"], include_archived: false },
        audience: "internal",
        is_active: false,
      },
    ],
    forms: [
      {
        id: id(4),
        key: "test_item_create",
        name: "Archived create",
        object_definition_id: id(2),
        object_key: "test_item",
        mode: "create",
        config_json: { fields: [{ field: "old_name", hidden: false }] },
        audience: "internal",
        is_active: false,
      },
      {
        id: id(5),
        key: "test_item_edit",
        name: "Archived edit",
        object_definition_id: id(2),
        object_key: "test_item",
        mode: "edit",
        config_json: { fields: [{ field: "old_name", hidden: false }] },
        audience: "internal",
        is_active: false,
      },
    ],
    pages: [
      {
        id: id(6),
        key: "test_items_workspace",
        title: "Archived items",
        slug: "test-items",
        audience: "internal",
        layout_json: {
          blocks: [{ type: "heading", text: "Archived", level: 1 }],
        },
        status: "draft",
        is_active: false,
      },
    ],
    preorder_experiences: [],
    preorder_experience_locations: [],
    ...overrides,
  };
}

function baseIntent() {
  return {
    singularItemLabel: "Test Item",
    pluralListLabel: "Test Items",
    mainNameLabel: "Name",
    information: [
      { label: "Quantity", type: "number" as const, required: true },
      {
        label: "Status",
        type: "status" as const,
        required: true,
        options: ["Active", "Inactive"],
      },
    ],
  };
}

describe("manual internal list intent and deterministic composer", () => {
  it("rejects unknown properties and unsupported owner-facing types", () => {
    expect(
      manualListIntentSchema.safeParse({
        ...baseIntent(),
        candidate: [],
      }).success,
    ).toBe(false);
    expect(
      manualListInformationRowSchema.safeParse({
        label: "Money",
        type: "currency",
        required: false,
      }).success,
    ).toBe(false);
    expect(
      manualListPreparationRequestSchema.safeParse({
        expectedBaseVersionId: id(20),
        expectedHeadRevision: 3,
        ...baseIntent(),
        businessId: id(21),
      }).success,
    ).toBe(false);
  });

  it("keeps the mandatory main name, maps all supported types and preserves order", () => {
    const input = {
      singularItemLabel: "Entry",
      pluralListLabel: "Entries",
      mainNameLabel: "Title",
      information: [
        { label: "Text", type: "text" as const, required: false },
        { label: "Notes", type: "longer_text" as const, required: true },
        { label: "Count", type: "number" as const, required: false },
        { label: "Enabled", type: "yes_no" as const, required: true },
        { label: "When", type: "date" as const, required: false },
        { label: "Email", type: "email" as const, required: false },
        { label: "Phone", type: "phone" as const, required: false },
        {
          label: "Choice",
          type: "choice" as const,
          required: false,
          options: ["One", "Two"],
        },
        {
          label: "State",
          type: "status" as const,
          required: false,
          options: ["Open", "Closed"],
        },
      ],
    };
    expect(() => composeManualList(snapshot(), input)).toThrow(ManualListError);

    const composed = composeManualList(snapshot(), {
      ...input,
      information: input.information.slice(0, 7),
    });
    const fields = composed.operations.filter(
      (operation) => operation.op === "set_field",
    );
    expect(fields.map((field) => [field.label, field.field_type])).toEqual([
      ["Title", "short_text"],
      ["Text", "short_text"],
      ["Notes", "long_text"],
      ["Count", "number"],
      ["Enabled", "boolean"],
      ["When", "date"],
      ["Email", "email"],
      ["Phone", "phone"],
    ]);
    expect(fields.map((field) => field.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(fields.every((field) => field.default_value === null)).toBe(true);
    expect(fields.every((field) => field.is_active)).toBe(true);
    expect(
      composed.operations.filter((operation) => operation.op === "set_field")
        .length,
    ).toBe(8);

    const choiceAndStatus = composeManualList(snapshot(), {
      ...input,
      singularItemLabel: "Choice entry",
      pluralListLabel: "Choice entries",
      information: input.information.slice(7),
    });
    expect(
      choiceAndStatus.operations
        .filter((operation) => operation.op === "set_field")
        .slice(1)
        .map((field) => [field.label, field.field_type, field.settings_json]),
    ).toEqual([
      ["Choice", "select", { options: ["One", "Two"] }],
      ["State", "status", { options: ["Open", "Closed"] }],
    ]);
  });

  it("emits exactly N + 5 operations with complete create/edit/table/wrapper configuration", () => {
    const composed = composeManualList(snapshot(), baseIntent());
    const operations = configurationOperationsSchema.parse(composed.operations);
    expect(operations).toHaveLength(8);
    expect(operations.map((operation) => operation.op)).toEqual([
      "set_object",
      "set_field",
      "set_field",
      "set_field",
      "set_form",
      "set_form",
      "set_view",
      "set_page",
    ]);

    const object = operations.find(
      (operation) => operation.op === "set_object",
    );
    const fields = operations.filter(
      (operation) => operation.op === "set_field",
    );
    const forms = operations.filter((operation) => operation.op === "set_form");
    const view = operations.find((operation) => operation.op === "set_view");
    const page = operations.find((operation) => operation.op === "set_page");
    if (
      !object ||
      object.op !== "set_object" ||
      !view ||
      view.op !== "set_view" ||
      !page ||
      page.op !== "set_page"
    ) {
      throw new Error("Expected complete manual list operations.");
    }

    expect(object).toMatchObject({
      singular_label: "Test Item",
      plural_label: "Test Items",
      description: "A simple list of Test Items.",
      icon: null,
      is_active: true,
    });
    expect(fields.map((field) => field.label)).toEqual([
      "Name",
      "Quantity",
      "Status",
    ]);
    expect(forms).toHaveLength(2);
    expect(forms.map((form) => form.mode).sort()).toEqual(["create", "edit"]);
    expect(
      forms.every(
        (form) =>
          form.op === "set_form" &&
          form.object_key === object.key &&
          form.audience === "internal" &&
          form.is_active &&
          form.config_json.fields.every((field) => field.hidden === false),
      ),
    ).toBe(true);
    expect(view).toMatchObject({
      name: "Test Items",
      view_type: "table",
      object_key: object.key,
      audience: "internal",
      is_active: true,
    });
    expect(view.config_json).toMatchObject({
      fields: fields.map((field) => field.key),
      title_field: fields[0]!.key,
      create_form_key: forms.find(
        (form) => form.op === "set_form" && form.mode === "create",
      )?.key,
      edit_form_key: forms.find(
        (form) => form.op === "set_form" && form.mode === "edit",
      )?.key,
      include_archived: false,
    });
    expect(page).toMatchObject({
      title: "Test Items",
      audience: "internal",
      status: "draft",
      is_active: true,
      layout_json: {
        blocks: [
          { type: "heading", text: "Test Items", level: 1 },
          { type: "view", view_key: view.key },
        ],
      },
    });
    expect(
      operations.some((operation) => operation.op === "set_relationship"),
    ).toBe(false);
    expect(
      operations.some(
        (operation) => operation.op === "set_preorder_experience",
      ),
    ).toBe(false);
  });

  it("rejects duplicate labels, duplicate options and invalid option bounds", () => {
    expect(() =>
      composeManualList(snapshot(), {
        ...baseIntent(),
        mainNameLabel: " name ",
        information: [
          { label: "Name", type: "text" as const, required: false },
        ],
      }),
    ).toThrow(ManualListError);
    expect(() =>
      composeManualList(snapshot(), {
        ...baseIntent(),
        information: [
          {
            label: "Quantity",
            type: "number" as const,
            required: true,
          },
          {
            label: "Status",
            type: "choice" as const,
            required: false,
            options: ["Active", " active "],
          },
        ],
      }),
    ).toThrow(ManualListError);
    expect(
      manualListIntentSchema.safeParse({
        ...baseIntent(),
        information: [
          {
            label: "Status",
            type: "status",
            required: true,
            options: ["Only one"],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      manualListIntentSchema.safeParse({
        ...baseIntent(),
        information: [
          {
            label: "Status",
            type: "status",
            required: true,
            options: ["Active", "Inactive", ""],
          },
        ],
      }).success,
    ).toBe(false);
    expect(normalizeManualListOptionLines(["Active", "Inactive", ""])).toEqual([
      "Active",
      "Inactive",
    ]);
    expect(
      manualListIntentSchema.safeParse({
        ...baseIntent(),
        information: [
          {
            label: "Status",
            type: "status",
            required: true,
            options: Array.from(
              { length: 101 },
              (_, index) => `Option ${index}`,
            ),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects active and archived business-label conflicts but allows mass nouns", () => {
    expect(() =>
      composeManualList(snapshot(), {
        ...baseIntent(),
        singularItemLabel: "Customer",
        pluralListLabel: "Customer",
      }),
    ).toThrow(ManualListError);
    expect(() =>
      composeManualList(
        snapshot({
          object_definitions: [
            ...snapshot().object_definitions,
            {
              ...snapshot().object_definitions[1]!,
              id: id(30),
              key: "archived_equipment",
              singular_label: "Equipment",
              plural_label: "Equipment",
            },
          ],
        }),
        {
          ...baseIntent(),
          singularItemLabel: "Equipment",
          pluralListLabel: "Equipment",
        },
      ),
    ).toThrow(ManualListError);
    expect(
      composeManualList(snapshot(), {
        ...baseIntent(),
        singularItemLabel: "Equipment",
        pluralListLabel: "Equipment",
      }).operations[0],
    ).toMatchObject({
      op: "set_object",
      singular_label: "Equipment",
      plural_label: "Equipment",
    });
  });

  it("reserves archived identities and suffixes deterministically", () => {
    const composed = composeManualList(snapshot(), baseIntent());
    const object = composed.operations.find(
      (operation) => operation.op === "set_object",
    );
    const forms = composed.operations.filter(
      (operation) => operation.op === "set_form",
    );
    const view = composed.operations.find(
      (operation) => operation.op === "set_view",
    );
    const page = composed.operations.find(
      (operation) => operation.op === "set_page",
    );
    expect(object && object.op === "set_object" ? object.key : null).toBe(
      "test_item_2",
    );
    expect(
      forms.map((form) => (form.op === "set_form" ? form.key : "")),
    ).toEqual(["test_item_2_create", "test_item_2_edit"]);
    expect(view && view.op === "set_view" ? view.key : null).toBe(
      "test_items_2",
    );
    expect(page && page.op === "set_page" ? page.key : null).toBe(
      "test_items_2_workspace",
    );
    expect(page && page.op === "set_page" ? page.slug : null).toBe(
      "test-items-2",
    );
  });

  it("keeps generated proposal metadata within the existing label bound", () => {
    const longLabel = "L".repeat(120);
    const composed = composeManualList(snapshot(), {
      ...baseIntent(),
      singularItemLabel: "Long item",
      pluralListLabel: longLabel,
    });
    expect(composed.title.length).toBeLessThanOrEqual(120);
    expect(composed.operations).toHaveLength(8);
  });

  it("keeps the manual path outside AI and lifecycle composition", () => {
    const composerSource = readFileSync(
      join(process.cwd(), "src/core/configuration/manual-lists/composer.ts"),
      "utf8",
    );
    const serviceSource = readFileSync(
      join(process.cwd(), "src/core/configuration/manual-lists/service.ts"),
      "utf8",
    );
    expect(composerSource).not.toContain("src/ai/");
    expect(serviceSource).not.toContain("validateChangeSet");
    expect(serviceSource).not.toContain("applyChangeSet");
    expect(serviceSource).not.toContain("createAdminClient");
  });

  it("reloads the authoritative snapshot and calls the ordinary proposal boundary once", async () => {
    const baseVersionId = id(50);
    const proposeChangeSet = vi.fn(async (input: { operations: unknown[] }) => {
      void input;
      return { id: id(51) } as never;
    });
    const configuration = {
      getActiveHead: vi.fn(async () => ({
        active_version_id: baseVersionId,
        business_id: id(52),
        head_revision: 4,
      })),
      getVersion: vi.fn(async () => ({
        id: baseVersionId,
        snapshot_json: snapshot(),
      })),
      proposeChangeSet,
    } as never;

    const result = await prepareManualListProposal(configuration, {
      expectedBaseVersionId: baseVersionId,
      expectedHeadRevision: 4,
      ...baseIntent(),
    });

    expect(result).toEqual({ id: id(51) });
    expect(proposeChangeSet).toHaveBeenCalledTimes(1);
    expect(proposeChangeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedBaseVersionId: baseVersionId,
        expectedHeadRevision: 4,
        operations: expect.any(Array),
      }),
    );
    expect(proposeChangeSet.mock.calls[0]?.[0]?.operations).toHaveLength(8);
  });

  it("fails stale expected currentness without composing or proposing", async () => {
    const proposeChangeSet = vi.fn();
    const configuration = {
      getActiveHead: vi.fn(async () => ({
        active_version_id: id(60),
        business_id: id(61),
        head_revision: 5,
      })),
      getVersion: vi.fn(async () => ({
        id: id(60),
        snapshot_json: snapshot(),
      })),
      proposeChangeSet,
    } as never;

    await expect(
      prepareManualListProposal(configuration, {
        expectedBaseVersionId: id(62),
        expectedHeadRevision: 4,
        ...baseIntent(),
      }),
    ).rejects.toMatchObject({ code: "manual_list_stale" });
    expect(proposeChangeSet).not.toHaveBeenCalled();
  });
});

describe("neutral configuration identity allocation", () => {
  it("preserves normalization, 80-character bounds, active/archived suffixes and finite exhaustion", () => {
    expect(normaliseGraphKeyBase("Éclair & Tea / Box", "object")).toBe(
      "eclair_and_tea_box",
    );
    expect(normalisePageSlugBase("Éclair & Tea / Box")).toBe(
      "eclair-and-tea-box",
    );
    expect(normaliseGraphKeyBase("x".repeat(200), "object")).toHaveLength(80);
    expect(normalisePageSlugBase("x".repeat(200))).toHaveLength(80);
    expect(
      createGraphKeyAllocator(["item", "item_2"]).allocate("Item", "object"),
    ).toBe("item_3");
    expect(
      createPageSlugAllocator(["items", "items-2"]).allocate("Items"),
    ).toBe("items-3");

    const exhausted = [
      "value",
      ...Array.from({ length: 999 }, (_, index) => `value_${index + 2}`),
    ];
    expect(() =>
      createGraphKeyAllocator(exhausted).allocate("Value", "field"),
    ).toThrowError(ConfigurationIdentityAllocationError);
    try {
      createGraphKeyAllocator(exhausted).allocate("Value", "field");
    } catch (error) {
      expect(error).toMatchObject({
        code: "configuration_identity_key_unavailable",
      });
    }
  });
});
