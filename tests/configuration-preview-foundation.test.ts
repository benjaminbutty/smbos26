import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  createActiveConfigurationDefinitionSource,
  createSnapshotConfigurationDefinitionSource,
  type ConfigurationSnapshotV1,
} from "../src/core/configuration/definition-source";
import { createExperienceService } from "../src/core/experience/service";
import type { Database, Json, Tables } from "../src/db/supabase/database.types";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
type QueryResult = { data: Row[]; error: null };

class FakeQuery implements PromiseLike<QueryResult> {
  readonly #sourceRows: Row[];
  readonly #filters: Array<(row: Row) => boolean> = [];
  #limit: number | null = null;
  #orderColumn: string | null = null;

  constructor(sourceRows: Row[]) {
    this.#sourceRows = sourceRows;
  }

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.#filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    const allowed = new Set(values);
    this.#filters.push((row) => allowed.has(row[column]));
    return this;
  }

  order(column: string): this {
    this.#orderColumn = column;
    return this;
  }

  limit(value: number): this {
    this.#limit = value;
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.#rows()[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.#rows(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }

  #rows(): Row[] {
    let rows = this.#sourceRows
      .filter((row) => this.#filters.every((filter) => filter(row)))
      .map((row) => structuredClone(row));
    if (this.#orderColumn) {
      const column = this.#orderColumn;
      rows = rows.toSorted((left, right) =>
        String(left[column]).localeCompare(String(right[column])),
      );
    }
    return this.#limit === null ? rows : rows.slice(0, this.#limit);
  }
}

function fakeClient(
  rowsByTable: Readonly<Record<string, readonly Row[]>>,
): SupabaseClient<Database> {
  return {
    from(table: string) {
      return new FakeQuery(
        (rowsByTable[table] ?? []).map((row) => structuredClone(row)),
      );
    },
  } as unknown as SupabaseClient<Database>;
}

const businessId = "10000000-0000-4000-8000-000000000001";
const objectId = "10000000-0000-4000-8000-000000000002";
const fieldId = "10000000-0000-4000-8000-000000000003";
const tableViewId = "10000000-0000-4000-8000-000000000004";
const detailViewId = "10000000-0000-4000-8000-000000000005";
const formId = "10000000-0000-4000-8000-000000000006";
const pageId = "10000000-0000-4000-8000-000000000007";
const recordId = "10000000-0000-4000-8000-000000000008";
const actorId = "10000000-0000-4000-8000-000000000009";
const inactivePageId = "10000000-0000-4000-8000-000000000010";
const createdAt = "1970-01-01T00:00:00.000Z";

const object: Tables<"object_definitions"> = {
  id: objectId,
  business_id: businessId,
  key: "catering_enquiry",
  singular_label: "Catering Enquiry",
  plural_label: "Catering Enquiries",
  description: "A catering request",
  kind: "custom",
  semantic_type: null,
  icon: null,
  is_active: true,
  created_at: createdAt,
  updated_at: createdAt,
};
const field: Tables<"field_definitions"> = {
  id: fieldId,
  business_id: businessId,
  object_definition_id: objectId,
  key: "company_name",
  label: "Company",
  field_type: "short_text",
  required: true,
  default_value: null,
  settings_json: {},
  position: 0,
  is_active: true,
  created_at: createdAt,
  updated_at: createdAt,
};
const tableView: Tables<"views"> = {
  id: tableViewId,
  business_id: businessId,
  key: "catering_enquiries",
  name: "Catering enquiries",
  view_type: "table",
  object_definition_id: objectId,
  config_json: {
    fields: ["company_name"],
    include_archived: false,
  },
  audience: "internal",
  is_active: true,
  created_at: createdAt,
  updated_at: createdAt,
};
const detailView: Tables<"views"> = {
  ...tableView,
  id: detailViewId,
  key: "catering_enquiry_detail",
  name: "Catering enquiry",
  view_type: "detail",
  config_json: {
    fields: ["company_name"],
    title_field: "company_name",
    include_archived: false,
  },
};
const form: Tables<"forms"> = {
  id: formId,
  business_id: businessId,
  key: "catering_enquiry_create",
  name: "New catering enquiry",
  object_definition_id: objectId,
  mode: "create",
  config_json: {
    fields: [{ field: "company_name", hidden: false }],
    submit_label: "Add enquiry",
  },
  audience: "internal",
  is_active: true,
  created_at: createdAt,
  updated_at: createdAt,
};
const page: Tables<"pages"> = {
  id: pageId,
  business_id: businessId,
  key: "catering_workspace",
  title: "Catering enquiries",
  slug: "catering-enquiries",
  audience: "internal",
  layout_json: {
    blocks: [
      { type: "view", view_key: tableView.key },
      { type: "form", form_key: form.key },
    ],
  },
  status: "draft",
  is_active: true,
  created_at: createdAt,
  updated_at: createdAt,
};

function snapshot(
  overrides: Partial<ConfigurationSnapshotV1> = {},
): ConfigurationSnapshotV1 {
  return {
    schema_version: 1,
    object_definitions: [
      {
        id: object.id,
        key: object.key,
        singular_label: object.singular_label,
        plural_label: object.plural_label,
        description: object.description,
        kind: object.kind,
        semantic_type: object.semantic_type,
        icon: object.icon,
        is_active: object.is_active,
      },
    ],
    field_definitions: [
      {
        id: field.id,
        object_definition_id: field.object_definition_id,
        object_key: object.key,
        key: field.key,
        label: field.label,
        field_type: field.field_type,
        required: field.required,
        default_value: field.default_value,
        settings_json: field.settings_json as Record<string, Json>,
        position: field.position,
        is_active: field.is_active,
      },
    ],
    relationship_definitions: [],
    views: [tableView, detailView].map((view) => ({
      id: view.id,
      key: view.key,
      name: view.name,
      view_type: view.view_type,
      object_definition_id: view.object_definition_id,
      object_key: object.key,
      config_json: view.config_json as Record<string, Json>,
      audience: view.audience,
      is_active: view.is_active,
    })),
    forms: [
      {
        id: form.id,
        key: form.key,
        name: form.name,
        object_definition_id: form.object_definition_id,
        object_key: object.key,
        mode: form.mode,
        config_json: form.config_json as {
          fields: Array<{ field: string; hidden: boolean }>;
          submit_label: string;
        },
        audience: form.audience,
        is_active: form.is_active,
      },
    ],
    pages: [
      {
        id: page.id,
        key: page.key,
        title: page.title,
        slug: page.slug,
        audience: page.audience,
        layout_json: page.layout_json as {
          blocks: Array<
            | { type: "view"; view_key: string }
            | { type: "form"; form_key: string }
          >;
        },
        status: page.status,
        is_active: page.is_active,
      },
      {
        id: inactivePageId,
        key: "inactive_page",
        title: "Inactive",
        slug: "inactive",
        audience: "internal",
        layout_json: {
          blocks: [{ type: "heading", text: "Inactive", level: 2 }],
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

function normalizedRows(
  records: Tables<"records">[] = [],
): Record<string, Row[]> {
  return {
    object_definitions: [object].map((row) => ({ ...row })),
    field_definitions: [field].map((row) => ({ ...row })),
    views: [tableView, detailView].map((row) => ({ ...row })),
    forms: [form].map((row) => ({ ...row })),
    pages: [
      page,
      {
        ...page,
        id: inactivePageId,
        key: "inactive_page",
        slug: "inactive",
        is_active: false,
      },
    ].map((row) => ({ ...row })),
    preorder_experiences: [],
    preorder_experience_locations: [],
    records: records.map((row) => ({ ...row })),
  };
}

describe("configuration preview definition sources", () => {
  it("returns equivalent typed definitions from live rows and their immutable snapshot", async () => {
    const live = createActiveConfigurationDefinitionSource(
      fakeClient(normalizedRows()),
      { businessId },
    );
    const candidate = createSnapshotConfigurationDefinitionSource(snapshot(), {
      businessId,
    });

    await expect(live.getPageByKey(page.key)).resolves.toEqual(
      await candidate.getPageByKey(page.key),
    );
    await expect(live.getPageBySlug(page.slug)).resolves.toEqual(
      await candidate.getPageBySlug(page.slug),
    );
    await expect(live.getViewByKey(tableView.key)).resolves.toEqual(
      await candidate.getViewByKey(tableView.key),
    );
    await expect(live.getViewById(detailView.id)).resolves.toEqual(
      await candidate.getViewById(detailView.id),
    );
    await expect(live.getDetailViewForObjectId(object.id)).resolves.toEqual(
      await candidate.getDetailViewForObjectId(object.id),
    );
    await expect(live.getFormByKey(form.key)).resolves.toEqual(
      await candidate.getFormByKey(form.key),
    );
    await expect(live.getObjectByKey(object.key)).resolves.toEqual(
      await candidate.getObjectByKey(object.key),
    );
    await expect(live.getObjectById(object.id)).resolves.toEqual(
      await candidate.getObjectById(object.id),
    );
    await expect(live.listFieldsForObject(object.key)).resolves.toEqual(
      await candidate.listFieldsForObject(object.key),
    );
    await expect(live.listPages()).resolves.toEqual(
      await candidate.listPages(),
    );
    await expect(live.listViews()).resolves.toEqual(
      await candidate.listViews(),
    );
    await expect(candidate.getPageByKey("inactive_page")).resolves.toBeNull();
  });

  it("uses operational Records read-only and warns when candidate fields are incompatible", async () => {
    const record: Tables<"records"> = {
      id: recordId,
      business_id: businessId,
      object_definition_id: objectId,
      data_json: { company_name: "Acme Ltd" },
      record_status: "active",
      created_by: actorId,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const incompatible = snapshot({
      field_definitions: snapshot().field_definitions.map((definition) => ({
        ...definition,
        field_type: "number",
      })),
    });
    const source = createSnapshotConfigurationDefinitionSource(incompatible, {
      businessId,
    });
    const experience = createExperienceService(
      fakeClient(normalizedRows([record])),
      { businessId },
      source,
    );

    const bundle = await experience.loadView(tableView.key);
    expect(bundle.records).toEqual([record]);
    expect(bundle.warnings).toEqual([
      "Some existing information does not match this proposed configuration and is shown without changing it.",
    ]);
  });

  it("returns no operational Records for a new candidate Object", async () => {
    const newObjectId = "10000000-0000-4000-8000-000000000011";
    const newViewId = "10000000-0000-4000-8000-000000000012";
    const newFieldId = "10000000-0000-4000-8000-000000000013";
    const candidateSnapshot = snapshot({
      object_definitions: [
        ...snapshot().object_definitions,
        {
          id: newObjectId,
          key: "new_candidate_object",
          singular_label: "Candidate",
          plural_label: "Candidates",
          description: "",
          kind: "custom",
          semantic_type: null,
          icon: null,
          is_active: true,
        },
      ],
      field_definitions: [
        ...snapshot().field_definitions,
        {
          id: newFieldId,
          object_definition_id: newObjectId,
          object_key: "new_candidate_object",
          key: "name",
          label: "Name",
          field_type: "short_text",
          required: true,
          default_value: null,
          settings_json: {},
          position: 0,
          is_active: true,
        },
      ],
      views: [
        ...snapshot().views,
        {
          id: newViewId,
          key: "new_candidate_objects",
          name: "Candidates",
          view_type: "table",
          object_definition_id: newObjectId,
          object_key: "new_candidate_object",
          config_json: { fields: ["name"], include_archived: false },
          audience: "internal",
          is_active: true,
        },
      ],
    });
    const source = createSnapshotConfigurationDefinitionSource(
      candidateSnapshot,
      { businessId },
    );
    const experience = createExperienceService(
      fakeClient(normalizedRows()),
      { businessId },
      source,
    );

    await expect(
      experience.loadView("new_candidate_objects"),
    ).resolves.toMatchObject({ records: [] });
  });
});
