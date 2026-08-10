import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSnapshotConfigurationDefinitionSource,
  type ConfigurationSnapshotV1,
} from "../src/core/configuration/definition-source";
import { composeDirectTableAction } from "../src/core/configuration/direct-tables/composer";
import { createExperienceService } from "../src/core/experience/service";
import {
  deterministicTableViewRoles,
  normalizeTableViewConfig,
  validateTableViewQuery,
} from "../src/core/experience/schemas";
import type { Json } from "../src/db/supabase/database.types";
import { internalWorkspaceProofFixtures } from "./support/internal-workspace-proof-fixtures";

const milkObjectId = "20000000-0000-4000-8000-000000000001";
const dogObjectId = "20000000-0000-4000-8000-000000000002";
const enquiryObjectId = "20000000-0000-4000-8000-000000000003";

function object(
  id: string,
  key: string,
  singularLabel: string,
  pluralLabel: string,
) {
  return {
    id,
    key,
    singular_label: singularLabel,
    plural_label: pluralLabel,
    description: "",
    kind: "custom" as const,
    semantic_type: null,
    icon: null,
    is_active: true,
  };
}

function field(
  id: string,
  objectDefinitionId: string,
  objectKey: string,
  key: string,
  label: string,
  fieldType: "short_text" | "status" | "date",
  position: number,
) {
  return {
    id,
    object_definition_id: objectDefinitionId,
    object_key: objectKey,
    key,
    label,
    field_type: fieldType,
    required: key === "name",
    default_value: null,
    settings_json: fieldType === "status" ? { options: ["Open", "Done"] } : {},
    position,
    is_active: true,
  };
}

function view(
  id: string,
  key: string,
  name: string,
  objectDefinitionId: string,
  objectKey: string,
  configJson: Record<string, Json>,
) {
  return {
    id,
    key,
    name,
    view_type: "table" as const,
    object_definition_id: objectDefinitionId,
    object_key: objectKey,
    config_json: configJson,
    audience: "internal" as const,
    is_active: true,
  };
}

const snapshot: ConfigurationSnapshotV1 = {
  schema_version: 1,
  object_definitions: [
    object(milkObjectId, "milk_round", "Milk round", "Milk rounds"),
    object(dogObjectId, "dog", "Dog", "Dogs"),
    object(enquiryObjectId, "enquiry", "Enquiry", "Enquiries"),
  ],
  field_definitions: [
    field(
      "30000000-0000-4000-8000-000000000001",
      milkObjectId,
      "milk_round",
      "name",
      "Name",
      "short_text",
      0,
    ),
    field(
      "30000000-0000-4000-8000-000000000002",
      milkObjectId,
      "milk_round",
      "status",
      "Status",
      "status",
      1,
    ),
    field(
      "30000000-0000-4000-8000-000000000003",
      milkObjectId,
      "milk_round",
      "delivery_date",
      "Delivery date",
      "date",
      2,
    ),
    field(
      "30000000-0000-4000-8000-000000000004",
      dogObjectId,
      "dog",
      "name",
      "Name",
      "short_text",
      0,
    ),
    field(
      "30000000-0000-4000-8000-000000000005",
      enquiryObjectId,
      "enquiry",
      "name",
      "Name",
      "short_text",
      0,
    ),
  ],
  relationship_definitions: [],
  views: [
    view(
      "40000000-0000-4000-8000-000000000001",
      "milk_rounds",
      "Milk rounds",
      milkObjectId,
      "milk_round",
      {
        fields: ["name", "status", "delivery_date"],
        title_field: "name",
        include_archived: false,
      },
    ),
    view(
      "40000000-0000-4000-8000-000000000002",
      "dogs",
      "Dogs",
      dogObjectId,
      "dog",
      {
        fields: ["name"],
        title_field: "name",
        include_archived: false,
      },
    ),
    view(
      "40000000-0000-4000-8000-000000000003",
      "enquiries",
      "Enquiries",
      enquiryObjectId,
      "enquiry",
      {
        fields: ["name"],
        title_field: "name",
        include_archived: false,
      },
    ),
  ],
  forms: [],
  pages: [],
  preorder_experiences: [],
  preorder_experience_locations: [],
};

describe("Internal Workspace Engine", () => {
  it("keeps the proof concepts on the same generic primitive path", () => {
    expect(
      internalWorkspaceProofFixtures.map((fixture) => fixture.concept),
    ).toEqual(["Milk round", "Dog groomer", "Catering Enquiry"]);
    expect(
      internalWorkspaceProofFixtures.every(
        (fixture) =>
          fixture.objectKey.length > 0 &&
          fixture.connectedObjectKey.length > 0 &&
          fixture.primaryField.length > 0,
      ),
    ).toBe(true);
  });

  it("normalizes historical Tables into canonical mixed columns without record relation IDs", () => {
    expect(
      normalizeTableViewConfig({
        fields: ["name", "status"],
        title_field: "name",
        include_archived: false,
      }),
    ).toMatchObject({
      schema_version: 2,
      role: "primary",
      columns: [
        { kind: "field", field_key: "name" },
        { kind: "field", field_key: "status" },
      ],
      filters: [],
      sorts: [],
      group: null,
    });

    const canonical = normalizeTableViewConfig({
      schema_version: 2,
      role: "primary",
      columns: [
        { kind: "field", field_key: "name" },
        {
          kind: "connection",
          relationship_key: "milk_round_customer",
          direction: "source",
          label: "customers",
        },
      ],
      title_field: "name",
      filters: [],
      filter_match: "all",
      sorts: [],
      group: null,
      include_archived: false,
    });
    expect(canonical.fields).toEqual(["name"]);
    expect(JSON.stringify(canonical)).not.toContain("record_id");
    expect(JSON.stringify(canonical)).not.toContain("source_record_id");
  });

  it("enforces one primary Table View while normalizing legacy roles deterministically", () => {
    const legacyConfig = {
      fields: ["name"],
      title_field: "name",
      include_archived: false,
    };
    const canonicalConfig = (role: "primary" | "saved") => ({
      schema_version: 2 as const,
      role,
      columns: [{ kind: "field" as const, field_key: "name" }],
      title_field: "name",
      include_archived: false,
      filters: [],
      filter_match: "all" as const,
      sorts: [],
      group: null,
    });

    expect(() =>
      deterministicTableViewRoles([
        { key: "saved_only", config_json: canonicalConfig("saved") },
      ]),
    ).toThrow("one active primary");

    expect(
      deterministicTableViewRoles([
        { key: "legacy_b", config_json: legacyConfig },
        { key: "legacy_a", config_json: legacyConfig },
      ]),
    ).toEqual(
      new Map([
        ["legacy_a", "primary"],
        ["legacy_b", "saved"],
      ]),
    );

    expect(
      deterministicTableViewRoles([
        { key: "primary", config_json: canonicalConfig("primary") },
        { key: "saved", config_json: canonicalConfig("saved") },
      ]),
    ).toEqual(
      new Map([
        ["primary", "primary"],
        ["saved", "saved"],
      ]),
    );

    expect(() =>
      deterministicTableViewRoles([
        { key: "primary_a", config_json: canonicalConfig("primary") },
        { key: "primary_b", config_json: canonicalConfig("primary") },
      ]),
    ).toThrow("only one active primary");
  });

  it("passes normalized legacy roles to page and Table View consumers", async () => {
    const source = createSnapshotConfigurationDefinitionSource(
      snapshot as unknown as Json,
      { businessId: milkObjectId },
    );
    const service = createExperienceService(
      {} as never,
      { businessId: milkObjectId },
      source,
    );
    const views = await service.listTableViews();
    expect(views).toHaveLength(3);
    expect(
      views.every(
        (view) =>
          typeof view.config_json === "object" &&
          view.config_json !== null &&
          !Array.isArray(view.config_json) &&
          view.config_json.schema_version === 2 &&
          view.config_json.role === "primary",
      ),
    ).toBe(true);
  });

  it("creates a reusable Connection property and updates both endpoint Views atomically", () => {
    const result = composeDirectTableAction(snapshot, {
      action: "create_connection_property",
      viewKey: "milk_rounds",
      targetViewKey: "dogs",
      label: "Dogs",
      mode: "several_records",
      addReverse: true,
    });

    expect(result.actionKind).toBe("create_connection_property");
    expect(result.operations.map((operation) => operation.op)).toEqual([
      "set_relationship",
      "set_view",
      "set_view",
    ]);
    const views = result.operations.filter(
      (operation) => operation.op === "set_view",
    );
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      key: "milk_rounds",
      config_json: expect.objectContaining({
        schema_version: 2,
        role: "primary",
        columns: expect.arrayContaining([
          expect.objectContaining({ kind: "connection", direction: "source" }),
        ]),
      }),
    });
    expect(views[1]).toMatchObject({
      key: "dogs",
      config_json: expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({ kind: "connection", direction: "target" }),
        ]),
      }),
    });
  });

  it("keeps saved View query changes typed and bounds Connection sort/group", () => {
    const savedSnapshot: ConfigurationSnapshotV1 = {
      ...snapshot,
      views: [
        ...snapshot.views,
        view(
          "40000000-0000-4000-8000-000000000004",
          "open_milk_rounds",
          "Open milk rounds",
          milkObjectId,
          "milk_round",
          {
            schema_version: 2,
            role: "saved",
            columns: [
              { kind: "field", field_key: "name" },
              { kind: "field", field_key: "status" },
              { kind: "field", field_key: "delivery_date" },
            ],
            fields: ["name", "status", "delivery_date"],
            title_field: "name",
            include_archived: false,
            filters: [],
            filter_match: "all",
            sorts: [],
            group: null,
          },
        ),
      ],
    };
    const updated = composeDirectTableAction(savedSnapshot, {
      action: "update_view_query",
      viewKey: "open_milk_rounds",
      query: {
        filters: [{ property: "field:status", operator: "is", value: "Open" }],
        filter_match: "all",
        sorts: [{ property: "field:delivery_date", direction: "ascending" }],
        group: "field:status",
      },
    });
    expect(updated.operations[0]).toMatchObject({
      op: "set_view",
      config_json: expect.objectContaining({
        role: "saved",
        filters: [{ property: "field:status", operator: "is", value: "Open" }],
        group: "field:status",
      }),
    });

    expect(() =>
      validateTableViewQuery(
        {
          filters: [],
          filter_match: "all",
          sorts: [
            { property: "connection:dogs:source", direction: "ascending" },
          ],
          group: "connection:dogs:source",
        },
        {
          fields: [{ key: "name", field_type: "short_text" }],
          relationships: [{ key: "dogs", cardinality: "many_to_many" }],
          columns: [],
        },
      ),
    ).toThrow();

    expect(
      validateTableViewQuery(
        {
          filters: [],
          filter_match: "all",
          sorts: [
            { property: "connection:dogs:source", direction: "ascending" },
          ],
          group: "connection:dogs:source",
        },
        {
          fields: [{ key: "name", field_type: "short_text" }],
          relationships: [{ key: "dogs", cardinality: "one_to_many" }],
          columns: [
            {
              kind: "connection",
              relationship_key: "dogs",
              direction: "source",
            },
          ],
        },
      ),
    ).toMatchObject({
      sorts: [{ property: "connection:dogs:source", direction: "ascending" }],
      group: "connection:dogs:source",
    });
  });

  it("keeps field collisions and self-relationship directions unambiguous", () => {
    expect(() =>
      validateTableViewQuery(
        {
          filters: [{ property: "status", operator: "is", value: "Open" }],
          filter_match: "all",
          sorts: [],
          group: null,
        },
        {
          fields: [{ key: "status", field_type: "status" }],
          relationships: [{ key: "status", cardinality: "one_to_one" }],
          columns: [],
        },
      ),
    ).toThrow();

    expect(
      validateTableViewQuery(
        {
          filters: [
            { property: "field:status", operator: "is", value: "Open" },
            {
              property: "connection:status:target",
              operator: "is_empty",
            },
          ],
          filter_match: "all",
          sorts: [
            {
              property: "connection:status:source",
              direction: "ascending",
            },
          ],
          group: "connection:status:target",
        },
        {
          fields: [{ key: "status", field_type: "status" }],
          relationships: [{ key: "status", cardinality: "one_to_one" }],
          columns: [
            {
              kind: "connection",
              relationship_key: "status",
              direction: "source",
            },
            {
              kind: "connection",
              relationship_key: "status",
              direction: "target",
            },
          ],
        },
      ),
    ).toMatchObject({
      filters: [
        { property: "field:status" },
        { property: "connection:status:target" },
      ],
      sorts: [{ property: "connection:status:source" }],
      group: "connection:status:target",
    });
  });
});
