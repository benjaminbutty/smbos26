import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyDirectTableAction,
  loadDirectTableConfiguration,
} from "../../src/core/configuration/direct-tables/service";
import type { DirectTableCurrentness } from "../../src/core/configuration/direct-tables/schemas";
import { createGraphService } from "../../src/core/graph/service";
import {
  createExperienceService,
  type ExperienceNavigation,
} from "../../src/core/experience/service";
import {
  normalizeTableViewConfig,
  tableViewConnectionPropertyKey,
  tableViewFieldPropertyKey,
} from "../../src/core/experience/schemas";
import {
  queryTableViewRecords,
  searchTableConnectionTargets,
  setTableRecordConnectionValues,
} from "../../src/core/experience/table-query";
import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import {
  internalWorkspaceProofFixtures,
  type InternalWorkspaceProofFixture,
  type InternalWorkspaceProofQueryFixture,
} from "../support/internal-workspace-proof-fixtures";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };
type Business = Tables<"businesses">;
type RecordRow = Tables<"records">;

interface ScenarioState {
  business: Business;
  currentness: DirectTableCurrentness;
  tableViews: Map<string, string>;
  fieldKeys: Map<string, string>;
  connectionProperties: Map<
    string,
    { key: string; direction: "source" | "target" }
  >;
  relationshipKeys: Map<string, string>;
  records: Map<string, RecordRow>;
  savedViews: Map<string, string>;
}

const password = "Internal-workspace-proof-2026!";
const createdUserIds: string[] = [];
const createdBusinesses: Business[] = [];
let settings: LocalSupabaseSettings;
let admin: Client;
let owner: Identity;
let ownerEmail = "";

async function createOwner(): Promise<Identity> {
  const email = `workspace-proof-${crypto.randomUUID()}@example.test`;
  ownerEmail = email;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("Could not create proof owner.");
  }
  createdUserIds.push(created.data.user.id);
  const client = createClient<Database>(
    settings.apiUrl,
    settings.publishableKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.user) {
    throw signedIn.error ?? new Error("Could not sign in proof owner.");
  }
  return { client, user: signedIn.data.user };
}

async function createBusiness(name: string): Promise<Business> {
  const created = await owner.client.rpc("create_business", {
    business_name: name,
    requested_business_type: "internal_workspace_proof",
    requested_timezone: "Europe/London",
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error(`Could not create ${name}.`);
  }
  createdBusinesses.push(created.data);
  return created.data;
}

async function applyAction(
  state: ScenarioState,
  intent: Parameters<typeof applyDirectTableAction>[2]["intent"],
) {
  const result = await applyDirectTableAction(
    owner.client,
    { businessId: state.business.id, actorId: owner.user.id },
    { currentness: state.currentness, intent },
  );
  expect(result.changeSet.status).toBe("applied");
  state.currentness = result.currentness;
  return result;
}

function tableMapKey(tableKey: string, label: string): string {
  return `${tableKey}:${label}`;
}

function relationMapKey(
  sourceTableKey: string,
  targetTableKey: string,
  label: string,
): string {
  return `${sourceTableKey}:${targetTableKey}:${label}`;
}

function fieldKeyFor(
  state: ScenarioState,
  tableKey: string,
  label: string,
): string {
  const key = state.fieldKeys.get(tableMapKey(tableKey, label));
  if (!key) {
    throw new Error(`Missing proof field ${tableKey}/${label}.`);
  }
  return key;
}

async function configureScenario(
  fixture: InternalWorkspaceProofFixture,
): Promise<ScenarioState> {
  const business = await createBusiness(fixture.businessName);
  const initial = await loadDirectTableConfiguration(owner.client, {
    businessId: business.id,
    actorId: owner.user.id,
  });
  const state: ScenarioState = {
    business,
    currentness: initial.currentness,
    tableViews: new Map(),
    fieldKeys: new Map(),
    connectionProperties: new Map(),
    relationshipKeys: new Map(),
    records: new Map(),
    savedViews: new Map(),
  };

  for (const table of fixture.tables) {
    const created = await applyAction(state, {
      action: "create_table",
      title: table.title,
    });
    const viewKey = created.composed?.viewKey;
    if (!viewKey) throw new Error(`Missing proof Table ${table.title}.`);
    state.tableViews.set(table.key, viewKey);
    const nameField = created.composed?.operations.find(
      (operation) => operation.op === "set_field",
    );
    if (!nameField || nameField.op !== "set_field") {
      throw new Error(`Missing primary field for ${table.title}.`);
    }
    state.fieldKeys.set(tableMapKey(table.key, "Name"), nameField.key);
  }

  for (const table of fixture.tables) {
    for (const field of table.fields ?? []) {
      const viewKey = state.tableViews.get(table.key)!;
      const added = await applyAction(state, {
        action: "add_column",
        viewKey,
        label: field.label,
        columnType: field.columnType,
        ...(field.options ? { options: [...field.options] } : {}),
        ...(field.currency ? { currency: field.currency } : {}),
      });
      const fieldOperation = added.composed?.operations.find(
        (operation) => operation.op === "set_field",
      );
      if (!fieldOperation || fieldOperation.op !== "set_field") {
        throw new Error(
          `Missing field operation for ${table.key}/${field.label}.`,
        );
      }
      state.fieldKeys.set(
        tableMapKey(table.key, field.label),
        fieldOperation.key,
      );
    }
  }

  for (const connection of fixture.connections) {
    const created = await applyAction(state, {
      action: "create_connection_property",
      viewKey: state.tableViews.get(connection.sourceTableKey)!,
      targetViewKey: state.tableViews.get(connection.targetTableKey)!,
      label: connection.label,
      currentMultiplicity: connection.currentMultiplicity,
      targetMultiplicity: connection.targetMultiplicity,
      addReverse: true,
    });
    const relationship = created.composed?.operations.find(
      (operation) => operation.op === "set_relationship",
    );
    if (!relationship || relationship.op !== "set_relationship") {
      throw new Error(`Missing relationship for ${connection.label}.`);
    }
    state.relationshipKeys.set(
      relationMapKey(
        connection.sourceTableKey,
        connection.targetTableKey,
        connection.label,
      ),
      relationship.key,
    );
    state.connectionProperties.set(
      tableMapKey(connection.sourceTableKey, connection.label),
      { key: relationship.key, direction: "source" },
    );
  }

  const structuralTableKey = fixture.connections[0]?.sourceTableKey;
  if (structuralTableKey) {
    const structuralViewKey = state.tableViews.get(structuralTableKey)!;
    const inserted = await applyAction(state, {
      action: "insert_column",
      viewKey: structuralViewKey,
      anchorFieldKey: fieldKeyFor(state, structuralTableKey, "Name"),
      position: "right",
      label: "Workspace note",
      columnType: "short_text",
    });
    const insertedField = inserted.composed?.operations.find(
      (operation) => operation.op === "set_field",
    );
    if (!insertedField || insertedField.op !== "set_field") {
      throw new Error("Missing structural proof field.");
    }
    state.fieldKeys.set(
      tableMapKey(structuralTableKey, "Workspace note"),
      insertedField.key,
    );
    const added = await applyAction(state, {
      action: "add_column",
      viewKey: structuralViewKey,
      label: "Workspace flag",
      columnType: "boolean",
    });
    const addedField = added.composed?.operations.find(
      (operation) => operation.op === "set_field",
    );
    if (!addedField || addedField.op !== "set_field") {
      throw new Error("Missing appended structural proof field.");
    }
    state.fieldKeys.set(
      tableMapKey(structuralTableKey, "Workspace flag"),
      addedField.key,
    );
    const refreshed = await loadDirectTableConfiguration(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const structuralView = refreshed.snapshot.views.find(
      (candidate) => candidate.key === structuralViewKey,
    );
    if (!structuralView) throw new Error("Missing structural proof View.");
    const structuralConfig = normalizeTableViewConfig(
      structuralView.config_json,
    );
    await applyAction(state, {
      action: "reorder_columns",
      viewKey: structuralViewKey,
      fieldKeys: [...structuralConfig.fields].reverse(),
    });
    await applyAction(state, {
      action: "resize_column",
      viewKey: structuralViewKey,
      fieldKey: insertedField.key,
      width: 300,
    });
  }

  for (const query of fixture.queries) {
    const sourceViewKey = state.tableViews.get(query.tableKey)!;
    const created = await applyAction(state, {
      action: "create_saved_view",
      sourceViewKey,
      name: query.name,
    });
    const savedViewKey = created.composed?.viewKey;
    if (!savedViewKey) throw new Error(`Missing saved View ${query.name}.`);
    state.savedViews.set(tableMapKey(query.tableKey, query.name), savedViewKey);

    const tableQuery = queryInput(state, query);
    if (
      tableQuery.filters.length > 0 ||
      tableQuery.sorts.length > 0 ||
      tableQuery.group
    ) {
      await applyAction(state, {
        action: "update_view_query",
        viewKey: savedViewKey,
        query: tableQuery,
      });
    }
  }

  return state;
}

function queryInput(
  state: ScenarioState,
  query: InternalWorkspaceProofQueryFixture,
) {
  return {
    filters: query.filter
      ? [
          {
            property: propertyKeyFor(
              state,
              query.tableKey,
              query.filter.fieldLabel,
            ),
            operator: query.filter.operator,
            value: query.filter.value,
          },
        ]
      : [],
    filter_match: "all" as const,
    sorts: query.sort
      ? [
          {
            property: propertyKeyFor(
              state,
              query.tableKey,
              query.sort.fieldLabel,
            ),
            direction: query.sort.direction,
          },
        ]
      : [],
    group: query.groupFieldLabel
      ? propertyKeyFor(state, query.tableKey, query.groupFieldLabel)
      : null,
  };
}

function propertyKeyFor(
  state: ScenarioState,
  tableKey: string,
  label: string,
): string {
  const field = state.fieldKeys.get(tableMapKey(tableKey, label));
  if (field) return tableViewFieldPropertyKey(field);
  const connection = state.connectionProperties.get(
    tableMapKey(tableKey, label),
  );
  if (connection) {
    return tableViewConnectionPropertyKey(connection.key, connection.direction);
  }
  throw new Error(`Missing proof query property ${tableKey}/${label}.`);
}

async function createScenarioRecords(
  fixture: InternalWorkspaceProofFixture,
  state: ScenarioState,
): Promise<void> {
  const graph = createGraphService(owner.client, {
    businessId: state.business.id,
  });
  const configuration = await loadDirectTableConfiguration(owner.client, {
    businessId: state.business.id,
    actorId: owner.user.id,
  });

  for (const recordFixture of fixture.records) {
    const viewKey = state.tableViews.get(recordFixture.tableKey)!;
    const view = configuration.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    );
    if (!view) throw new Error(`Missing configured View ${viewKey}.`);
    const object = configuration.snapshot.object_definitions.find(
      (candidate) => candidate.key === view.object_key,
    );
    if (!object)
      throw new Error(`Missing configured Object ${view.object_key}.`);
    const data: Record<string, Json> = {
      [fieldKeyFor(state, recordFixture.tableKey, "Name")]: recordFixture.label,
    };
    for (const [fieldLabel, value] of Object.entries(
      recordFixture.fields ?? {},
    )) {
      data[fieldKeyFor(state, recordFixture.tableKey, fieldLabel)] = value;
    }
    const created = await graph.createRecord({
      objectDefinitionId: object.id,
      data,
    });
    state.records.set(
      tableMapKey(recordFixture.tableKey, recordFixture.label),
      created,
    );
  }
}

async function connectScenarioRecords(
  fixture: InternalWorkspaceProofFixture,
  state: ScenarioState,
): Promise<void> {
  for (const link of fixture.links) {
    const sourceViewKey = state.tableViews.get(link.sourceTableKey)!;
    const relationKey = state.relationshipKeys.get(
      relationMapKey(
        link.sourceTableKey,
        link.targetTableKey,
        link.connectionLabel,
      ),
    );
    if (!relationKey)
      throw new Error(`Missing relationship ${link.connectionLabel}.`);
    const sourceRecord = state.records.get(
      tableMapKey(link.sourceTableKey, link.sourceRecordLabel),
    );
    const targetRecords = link.targetRecordLabels.map((label) =>
      state.records.get(tableMapKey(link.targetTableKey, label)),
    );
    if (!sourceRecord || targetRecords.some((record) => !record)) {
      throw new Error(`Missing proof records for ${link.connectionLabel}.`);
    }
    await setTableRecordConnectionValues(owner.client, state.business.id, {
      viewKey: sourceViewKey,
      recordId: sourceRecord.id,
      relationshipKey: relationKey,
      direction: "source",
      targetRecordIds: targetRecords.map((record) => record!.id),
    });
    const firstTargetLabel = link.targetRecordLabels[0];
    if (!firstTargetLabel) {
      throw new Error(
        `Missing target proof record for ${link.connectionLabel}.`,
      );
    }
    const searched = await searchTableConnectionTargets(
      owner.client,
      state.business.id,
      {
        viewKey: sourceViewKey,
        relationshipKey: relationKey,
        direction: "source",
        search: firstTargetLabel,
        limit: 50,
      },
    );
    expect(searched.map((target) => target.label)).toContain(firstTargetLabel);

    const queried = await queryTableViewRecords(
      owner.client,
      state.business.id,
      sourceViewKey,
      { limit: 250 },
    );
    const queriedConnectionValues =
      queried.connectionValues[sourceRecord.id]?.[
        `connection:${relationKey}:source`
      ] ?? [];
    expect(queriedConnectionValues.map((target) => target.label)).toEqual(
      [...link.targetRecordLabels].sort(),
    );
  }
}

async function queryScenarioViews(
  fixture: InternalWorkspaceProofFixture,
  state: ScenarioState,
): Promise<void> {
  for (const query of fixture.queries) {
    const viewKey = state.savedViews.get(
      tableMapKey(query.tableKey, query.name),
    );
    if (!viewKey) throw new Error(`Missing saved View ${query.name}.`);
    const result = await queryTableViewRecords(
      owner.client,
      state.business.id,
      viewKey,
      { limit: 1, offset: 0 },
    );
    expect(result.totalCount).toBeGreaterThanOrEqual(1);
    expect(result.records.length).toBeLessThanOrEqual(1);
    if (query.groupFieldLabel) {
      expect(result.groups.length).toBeGreaterThanOrEqual(1);
    }
  }
}

describe("Internal Workspace Engine three-business proof", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    owner = await createOwner();
  }, 180_000);

  afterAll(async () => {
    if (process.env.INTERNAL_WORKSPACE_PROOF_PERSIST === "1") {
      console.log(
        JSON.stringify({
          password,
          ownerEmail,
          businesses: createdBusinesses.map((business) => ({
            id: business.id,
            name: business.name,
            slug: business.slug,
          })),
        }),
      );
      return;
    }
    for (const business of createdBusinesses) {
      await admin.from("businesses").delete().eq("id", business.id);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("runs the same generic Connection and View/query paths for all proof businesses", async () => {
    const states: ScenarioState[] = [];
    for (const fixture of internalWorkspaceProofFixtures) {
      const state = await configureScenario(fixture);
      await createScenarioRecords(fixture, state);
      await connectScenarioRecords(fixture, state);
      await queryScenarioViews(fixture, state);
      states.push(state);

      const experience = createExperienceService(owner.client, {
        businessId: state.business.id,
      });
      const navigation: ExperienceNavigation =
        await experience.listNavigation();
      const primaryTables = navigation.views.filter(
        (view) =>
          view.view_type === "table" &&
          typeof view.config_json === "object" &&
          view.config_json !== null &&
          !Array.isArray(view.config_json) &&
          view.config_json.role === "primary",
      );
      expect(primaryTables).toHaveLength(fixture.tables.length);
      const pageTableViews = await experience.listTableViews();
      const pageTableViewKeys = new Set(pageTableViews.map((view) => view.key));
      for (const savedViewKey of state.savedViews.values()) {
        expect(pageTableViewKeys).toContain(savedViewKey);
      }

      const afterConfiguration = await loadDirectTableConfiguration(
        owner.client,
        { businessId: state.business.id, actorId: owner.user.id },
      );
      const headBeforeOperationalWrites =
        afterConfiguration.currentness.expectedHeadRevision;
      const firstLink = fixture.links[0]!;
      const firstRelation = state.relationshipKeys.get(
        relationMapKey(
          firstLink.sourceTableKey,
          firstLink.targetTableKey,
          firstLink.connectionLabel,
        ),
      )!;
      const firstSource = state.records.get(
        tableMapKey(firstLink.sourceTableKey, firstLink.sourceRecordLabel),
      )!;
      await setTableRecordConnectionValues(owner.client, state.business.id, {
        viewKey: state.tableViews.get(firstLink.sourceTableKey)!,
        recordId: firstSource.id,
        relationshipKey: firstRelation,
        direction: "source",
        targetRecordIds: [],
      });
      const afterOperationalWrite = await loadDirectTableConfiguration(
        owner.client,
        { businessId: state.business.id, actorId: owner.user.id },
      );
      expect(afterOperationalWrite.currentness.expectedHeadRevision).toBe(
        headBeforeOperationalWrites,
      );
    }

    const first = states[0]!;
    const second = states[1]!;
    const firstFixture = internalWorkspaceProofFixtures[0]!;
    const firstLink = firstFixture.links[0]!;
    const firstRelation = first.relationshipKeys.get(
      relationMapKey(
        firstLink.sourceTableKey,
        firstLink.targetTableKey,
        firstLink.connectionLabel,
      ),
    )!;
    const firstSource = first.records.get(
      tableMapKey(firstLink.sourceTableKey, firstLink.sourceRecordLabel),
    )!;
    const foreignTarget = second.records.values().next().value as RecordRow;
    await expect(
      setTableRecordConnectionValues(owner.client, first.business.id, {
        viewKey: first.tableViews.get(firstLink.sourceTableKey)!,
        recordId: firstSource.id,
        relationshipKey: firstRelation,
        direction: "source",
        targetRecordIds: [foreignTarget.id],
      }),
    ).rejects.toThrow();
  }, 180_000);

  it("enforces zero, one, and multiple primary Table View states in PostgreSQL", async () => {
    const business = await createBusiness(
      `Primary View Boundary ${crypto.randomUUID()}`,
    );
    let configuration = await loadDirectTableConfiguration(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const created = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: configuration.currentness,
        intent: { action: "create_table", title: "Primary boundary" },
      },
    );
    expect(created.changeSet.status).toBe("applied");

    configuration = await loadDirectTableConfiguration(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const initialView = configuration.snapshot.views.find(
      (candidate) => candidate.view_type === "table",
    );
    if (!initialView) throw new Error("Missing primary boundary Table View.");

    const setViewOperation = (view: typeof initialView, configJson: Json) => ({
      op: "set_view" as const,
      key: view.key,
      name: view.name,
      view_type: view.view_type,
      object_key: view.object_key,
      config_json: configJson,
      audience: view.audience,
      is_active: view.is_active,
    });
    const savedOnlyConfig = {
      ...normalizeTableViewConfig(initialView.config_json),
      role: "saved" as const,
    };
    const zero = await owner.client.rpc("propose_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      expected_base_version_id: configuration.currentness.expectedBaseVersionId,
      expected_head_revision: configuration.currentness.expectedHeadRevision,
      requested_title: "Reject zero primary Views",
      requested_description: "Database primary View invariant test.",
      requested_operations: [
        setViewOperation(initialView, savedOnlyConfig as Json),
      ],
    });
    expect(zero.error?.code).toBe("23514");
    expect(zero.error?.message).toContain(
      "internal_workspace_primary_view_missing",
    );

    const canonicalPrimaryConfig = normalizeTableViewConfig(
      initialView.config_json,
      "primary",
    );
    const one = await owner.client.rpc("propose_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      expected_base_version_id: configuration.currentness.expectedBaseVersionId,
      expected_head_revision: configuration.currentness.expectedHeadRevision,
      requested_title: "Accept one primary View",
      requested_description: "Database primary View invariant test.",
      requested_operations: [
        setViewOperation(initialView, canonicalPrimaryConfig as Json),
      ],
    });
    if (one.error || !one.data) {
      throw one.error ?? new Error("Could not propose one primary View.");
    }
    const validated = await owner.client.rpc("validate_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_change_set_id: one.data.id,
    });
    if (validated.error || !validated.data) {
      throw (
        validated.error ?? new Error("Could not validate one primary View.")
      );
    }
    const applied = await owner.client.rpc("apply_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_change_set_id: one.data.id,
    });
    if (applied.error || !applied.data) {
      throw applied.error ?? new Error("Could not apply one primary View.");
    }
    expect(applied.data.status).toBe("applied");

    configuration = await loadDirectTableConfiguration(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const canonicalPrimaries = configuration.snapshot.views.filter(
      (candidate) => {
        if (candidate.view_type !== "table") return false;
        const config = normalizeTableViewConfig(candidate.config_json);
        return config.role === "primary";
      },
    );
    expect(canonicalPrimaries).toHaveLength(1);

    const saved = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: configuration.currentness,
        intent: {
          action: "create_saved_view",
          sourceViewKey: initialView.key,
          name: "Duplicate primary boundary",
        },
      },
    );
    expect(saved.changeSet.status).toBe("applied");
    configuration = await loadDirectTableConfiguration(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const savedView = configuration.snapshot.views.find(
      (candidate) => candidate.key === saved.composed?.viewKey,
    );
    if (!savedView) throw new Error("Missing saved boundary View.");
    const duplicatePrimaryConfig = {
      ...normalizeTableViewConfig(savedView.config_json),
      role: "primary" as const,
    };
    const multiple = await owner.client.rpc("propose_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      expected_base_version_id: configuration.currentness.expectedBaseVersionId,
      expected_head_revision: configuration.currentness.expectedHeadRevision,
      requested_title: "Reject multiple primary Views",
      requested_description: "Database primary View invariant test.",
      requested_operations: [
        setViewOperation(savedView, duplicatePrimaryConfig as Json),
      ],
    });
    expect(multiple.error?.code).toBe("23514");
    expect(multiple.error?.message).toContain(
      "internal_workspace_primary_view_duplicate",
    );
  }, 180_000);
});
