import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyDirectTableAction,
  loadDirectTableConfiguration,
  undoDirectTableAction,
} from "../../src/core/configuration/direct-tables/service";
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import { normalizeTableViewConfig } from "../../src/core/experience/schemas";
import { createDirectTableRow } from "../../src/runtime/views/direct-table-record-service";
import {
  applyDirectTableRecordCellEdit,
  applyDirectTableRecordCellEditValue,
} from "../../src/runtime/views/inline-edit-service";
import type { Database, Tables } from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };

const password = "Milestone-15-direct-table-workspace!";
const createdUserIds: string[] = [];
let settings: LocalSupabaseSettings;
let admin: Client;
let sql: Sql;
let owner: Identity;
let staff: Identity;
let administrator: Identity;
let business: Tables<"businesses">;
let otherBusiness: Tables<"businesses"> | null = null;

async function createIdentity(label: string): Promise<Identity> {
  const email = `m15-direct-${label}-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
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
    throw signedIn.error ?? new Error(`Could not sign in ${label}.`);
  }
  return { client, user: signedIn.data.user };
}

async function currentness(identity: Identity) {
  return loadDirectTableConfiguration(identity.client, {
    businessId: business.id,
    actorId: identity.user.id,
  });
}

describe("Milestone 15 Phase 15A direct Table Workspace", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    sql = postgres(settings.databaseUrl, { max: 1 });
    owner = await createIdentity("owner");
    staff = await createIdentity("staff");
    administrator = await createIdentity("administrator");
    const created = await owner.client.rpc("create_business", {
      business_name: `M15 Direct ${crypto.randomUUID()}`,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    });
    if (created.error || !created.data) {
      throw created.error ?? new Error("Could not create the test Business.");
    }
    business = created.data;
    const membership = await admin.from("business_memberships").insert({
      business_id: business.id,
      user_id: staff.user.id,
      role: "staff",
    });
    if (membership.error) throw membership.error;
    const adminMembership = await admin.from("business_memberships").insert({
      business_id: business.id,
      user_id: administrator.user.id,
      role: "admin",
    });
    if (adminMembership.error) throw adminMembership.error;
  }, 180_000);

  afterAll(async () => {
    if (otherBusiness)
      await admin.from("businesses").delete().eq("id", otherBusiness.id);
    if (business) await admin.from("businesses").delete().eq("id", business.id);
    for (const userId of createdUserIds)
      await admin.auth.admin.deleteUser(userId);
    if (sql) await sql.end();
  });

  it("applies the finite Table action set through one M5-backed atomic lane", async () => {
    const initial = await currentness(owner);
    const created = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: initial.currentness,
        intent: { action: "create_table", title: "Catering Enquiries" },
      },
    );
    const viewKey = created.composed!.viewKey;
    expect(created.changeSet.status).toBe("applied");
    expect(created.composed!.operations).toHaveLength(3);

    const renameIntent = {
      action: "rename_table" as const,
      viewKey,
      title: "Catering Requests",
    };
    const renamedTable = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: created.currentness,
        intent: renameIntent,
      },
    );
    const email = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: renamedTable.currentness,
        intent: {
          action: "add_column",
          viewKey,
          label: "Email",
          columnType: "email",
        },
      },
    );
    const renamedEmail = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: email.currentness,
        intent: {
          action: "rename_column",
          viewKey,
          fieldKey: "email",
          label: "Email address",
        },
      },
    );
    const status = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: renamedEmail.currentness,
        intent: {
          action: "add_column",
          viewKey,
          label: "Stage",
          columnType: "status",
          options: ["New", "Booked"],
        },
      },
    );
    const statusFieldKey = status.composed!.operations.find(
      (operation) => operation.op === "set_field",
    )!.key;
    const updatedOptions = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: status.currentness,
        intent: {
          action: "update_column_options",
          viewKey,
          fieldKey: statusFieldKey,
          options: ["New", "Booked", "Closed"],
        },
      },
    );
    const reordered = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: updatedOptions.currentness,
        intent: {
          action: "reorder_columns",
          viewKey,
          fieldKeys: [statusFieldKey, "email", "name"],
        },
      },
    );
    const resized = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: reordered.currentness,
        intent: {
          action: "resize_column",
          viewKey,
          fieldKey: statusFieldKey,
          width: 320,
        },
      },
    );

    const state = await currentness(owner);
    const view = state.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    )!;
    const object = state.snapshot.object_definitions.find(
      (candidate) => candidate.key === view.object_key,
    )!;
    expect(view.name).toBe("Catering Requests");
    expect(object.singular_label).toBe("Catering Requests");
    expect(object.plural_label).toBe("Catering Requests");
    expect(view.config_json).toMatchObject({
      fields: [statusFieldKey, "email", "name"],
      column_widths: { [statusFieldKey]: 320 },
    });
    expect(resized.currentness.expectedHeadRevision).toBe(
      state.currentness.expectedHeadRevision,
    );

    const rowData = new FormData();
    rowData.set("viewKey", viewKey);
    rowData.set("name", "Sam Taylor");
    rowData.set("email", "sam@example.test");
    rowData.set(statusFieldKey, "Booked");
    const row = await createDirectTableRow(
      owner.client,
      { businessId: business.id },
      { viewKey, formData: rowData },
    );
    expect(row.data_json).toMatchObject({
      name: "Sam Taylor",
      email: "sam@example.test",
      [statusFieldKey]: "Booked",
    });

    const editData = new FormData();
    editData.set("email", "sam.taylor@example.test");
    const edited = await applyDirectTableRecordCellEdit(
      owner.client,
      { businessId: business.id },
      { viewKey, recordId: row.id, fieldKey: "email", formData: editData },
    );
    expect(edited.data_json).toMatchObject({
      email: "sam.taylor@example.test",
    });

    const undone = await undoDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        expectedActiveSourceVersionId: state.currentness.expectedBaseVersionId,
        expectedHeadRevision: state.currentness.expectedHeadRevision,
      },
    );
    expect(undone.changeSet.kind).toBe("rollback");
    const afterUndo = await currentness(owner);
    const undoneView = afterUndo.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    )!;
    expect(undoneView.config_json).not.toHaveProperty("column_widths");
  });

  it("keeps structural Table changes separate from Record work", async () => {
    const created = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: (await currentness(administrator)).currentness,
        intent: {
          action: "create_table",
          title: `Kernel Structure ${crypto.randomUUID()}`,
        },
      },
    );
    const viewKey = created.composed!.viewKey;
    const rowData = new FormData();
    rowData.set("viewKey", viewKey);
    rowData.set("name", "Beth");
    const row = await createDirectTableRow(
      staff.client,
      { businessId: business.id },
      { viewKey, formData: rowData },
    );
    const [recordBefore] = await sql<
      { data_json: unknown; updated_at: string }[]
    >`
      select data_json, updated_at
      from public.records
      where id = ${row.id}
    `;

    const counts = async (): Promise<{
      version_count: number;
      head_revision: number;
      change_count: number;
    }> => {
      const [result] = await sql<
        { version_count: number; head_revision: number; change_count: number }[]
      >`
        select
          (select count(*)::integer from public.configuration_versions
           where business_id = ${business.id}) as version_count,
          (select head_revision from public.business_configuration_heads
           where business_id = ${business.id}) as head_revision,
          (select count(*)::integer from public.configuration_change_sets
           where business_id = ${business.id}) as change_count
      `;
      if (!result) throw new Error("Could not read configuration counts.");
      return {
        version_count: Number(result.version_count),
        head_revision: Number(result.head_revision),
        change_count: Number(result.change_count),
      };
    };

    const beforeAdd = await counts();
    const added = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: created.currentness,
        intent: {
          action: "add_column",
          viewKey,
          label: "Phone",
          columnType: "phone",
        },
      },
    );
    const phoneFieldKey = added.composed!.operations.find(
      (operation) => operation.op === "set_field",
    )!.key;
    const afterAdd = await counts();
    expect(afterAdd.version_count).toBe(beforeAdd.version_count + 1);
    expect(afterAdd.head_revision).toBe(beforeAdd.head_revision + 1);
    expect(afterAdd.change_count).toBe(beforeAdd.change_count + 1);
    const [recordAfterAdd] = await sql<
      { data_json: unknown; updated_at: string }[]
    >`
      select data_json, updated_at
      from public.records
      where id = ${row.id}
    `;
    expect(recordAfterAdd).toEqual(recordBefore);

    const beforeRename = await counts();
    const renamed = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: added.currentness,
        intent: {
          action: "rename_column",
          viewKey,
          fieldKey: "name",
          label: "Customer name",
        },
      },
    );
    const afterRename = await counts();
    expect(afterRename.version_count).toBe(beforeRename.version_count + 1);
    expect(afterRename.head_revision).toBe(beforeRename.head_revision + 1);
    expect(afterRename.change_count).toBe(beforeRename.change_count + 1);
    const renamedState = await currentness(administrator);
    const renamedView = renamedState.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    )!;
    const renamedNameField = renamedState.snapshot.field_definitions.find(
      (candidate) =>
        candidate.key === "name" &&
        candidate.object_definition_id === renamedView.object_definition_id,
    )!;
    expect(renamedNameField.label).toBe("Customer name");
    expect(renamedView.config_json).toMatchObject({
      fields: ["name", phoneFieldKey],
      title_field: "name",
    });
    expect(renamed.currentness.expectedHeadRevision).toBe(
      afterRename.head_revision,
    );
    const [recordAfterRename] = await sql<
      { data_json: unknown; updated_at: string }[]
    >`
      select data_json, updated_at
      from public.records
      where id = ${row.id}
    `;
    expect(recordAfterRename).toEqual(recordBefore);

    const beforeReorder = await counts();
    const reordered = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: renamed.currentness,
        intent: {
          action: "reorder_columns",
          viewKey,
          fieldKeys: [phoneFieldKey, "name"],
        },
      },
    );
    const afterReorder = await counts();
    expect(afterReorder.version_count).toBe(beforeReorder.version_count + 1);
    expect(afterReorder.head_revision).toBe(beforeReorder.head_revision + 1);
    expect(afterReorder.change_count).toBe(beforeReorder.change_count + 1);
    const persisted = await currentness(administrator);
    const persistedView = persisted.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    )!;
    expect(persistedView.config_json).toMatchObject({
      fields: [phoneFieldKey, "name"],
      title_field: "name",
    });
    expect(reordered.currentness.expectedHeadRevision).toBe(
      afterReorder.head_revision,
    );
    const [recordAfterReorder] = await sql<
      { data_json: unknown; updated_at: string }[]
    >`
      select data_json, updated_at
      from public.records
      where id = ${row.id}
    `;
    expect(recordAfterReorder).toEqual(recordBefore);
  });

  it("creates a manual Connection through one atomic advance without touching Records", async () => {
    const first = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: (await currentness(owner)).currentness,
        intent: {
          action: "create_table",
          title: `Manual Current ${crypto.randomUUID()}`,
        },
      },
    );
    const second = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: first.currentness,
        intent: {
          action: "create_table",
          title: `Manual Target ${crypto.randomUUID()}`,
        },
      },
    );
    const currentViewKey = first.composed!.viewKey;
    const targetViewKey = second.composed!.viewKey;
    const recordData = new FormData();
    recordData.set("viewKey", currentViewKey);
    recordData.set("name", "Unlinked record");
    const record = await createDirectTableRow(
      owner.client,
      { businessId: business.id },
      { viewKey: currentViewKey, formData: recordData },
    );
    const [beforeCounts] = await sql<
      {
        version_count: number;
        head_revision: number;
        change_count: number;
        edge_count: number;
      }[]
    >`
      select
        (select count(*)::integer from public.configuration_versions
         where business_id = ${business.id}) as version_count,
        (select head_revision from public.business_configuration_heads
         where business_id = ${business.id}) as head_revision,
        (select count(*)::integer from public.configuration_change_sets
         where business_id = ${business.id}) as change_count,
        (select count(*)::integer from public.record_relationships
         where business_id = ${business.id}) as edge_count
    `;
    const beforeRecord = await sql<{ data_json: unknown }[]>`
      select data_json from public.records where id = ${record.id}
    `;
    if (!beforeCounts || !beforeRecord[0]) {
      throw new Error("Could not read the manual Connection baseline.");
    }

    const created = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: second.currentness,
        intent: {
          action: "create_connection_property",
          viewKey: currentViewKey,
          targetViewKey,
          label: "Target",
          currentMultiplicity: "one",
          targetMultiplicity: "several",
          reverseLabel: "Currents",
          addReverse: true,
        },
      },
    );
    expect(created.changeSet.status).toBe("applied");
    expect(
      created.composed?.operations.filter(
        (operation) => operation.op === "set_relationship",
      ),
    ).toHaveLength(1);
    const [afterCounts] = await sql<
      {
        version_count: number;
        head_revision: number;
        change_count: number;
        edge_count: number;
      }[]
    >`
      select
        (select count(*)::integer from public.configuration_versions
         where business_id = ${business.id}) as version_count,
        (select head_revision from public.business_configuration_heads
         where business_id = ${business.id}) as head_revision,
        (select count(*)::integer from public.configuration_change_sets
         where business_id = ${business.id}) as change_count,
        (select count(*)::integer from public.record_relationships
         where business_id = ${business.id}) as edge_count
    `;
    if (!afterCounts) {
      throw new Error(
        "Could not read the post-Connection configuration counts.",
      );
    }
    expect({
      ...afterCounts,
      head_revision: Number(afterCounts.head_revision),
    }).toMatchObject({
      version_count: beforeCounts.version_count + 1,
      head_revision: Number(beforeCounts.head_revision) + 1,
      change_count: beforeCounts.change_count + 1,
      edge_count: beforeCounts.edge_count,
    });
    const afterConfiguration = await currentness(owner);
    const currentView = afterConfiguration.snapshot.views.find(
      (candidate) => candidate.key === currentViewKey,
    );
    const targetView = afterConfiguration.snapshot.views.find(
      (candidate) => candidate.key === targetViewKey,
    );
    expect(currentView?.config_json).toMatchObject({
      columns: [
        expect.objectContaining({ kind: "field", field_key: "name" }),
        expect.objectContaining({ kind: "connection", direction: "target" }),
      ],
    });
    expect(targetView?.config_json).toMatchObject({
      columns: [
        expect.objectContaining({ kind: "field", field_key: "name" }),
        expect.objectContaining({ kind: "connection", direction: "source" }),
      ],
    });
    expect(
      (
        await sql<{ data_json: unknown }[]>`
        select data_json from public.records where id = ${record.id}
      `
      )[0],
    ).toEqual(beforeRecord[0]);

    await expect(
      applyDirectTableAction(
        owner.client,
        { businessId: business.id, actorId: owner.user.id },
        {
          currentness: second.currentness,
          intent: {
            action: "create_connection_property",
            viewKey: currentViewKey,
            targetViewKey,
            label: "Another target",
            currentMultiplicity: "one",
            targetMultiplicity: "several",
            addReverse: false,
          },
        },
      ),
    ).rejects.toThrow(/reload|changed|stale/i);
    const [afterStaleCounts] = await sql<
      {
        version_count: number;
        head_revision: number;
        change_count: number;
        edge_count: number;
      }[]
    >`
      select
        (select count(*)::integer from public.configuration_versions
         where business_id = ${business.id}) as version_count,
        (select head_revision from public.business_configuration_heads
         where business_id = ${business.id}) as head_revision,
        (select count(*)::integer from public.configuration_change_sets
         where business_id = ${business.id}) as change_count,
        (select count(*)::integer from public.record_relationships
         where business_id = ${business.id}) as edge_count
    `;
    expect(afterStaleCounts).toEqual(afterCounts);

    await expect(
      applyDirectTableAction(
        staff.client,
        { businessId: business.id, actorId: staff.user.id },
        {
          currentness: created.currentness,
          intent: {
            action: "create_connection_property",
            viewKey: currentViewKey,
            targetViewKey,
            label: "Staff target",
            currentMultiplicity: "one",
            targetMultiplicity: "several",
            addReverse: false,
          },
        },
      ),
    ).rejects.toThrow();
  });

  it("refuses Undo when a direct Table or column already carries Records", async () => {
    const created = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: (await currentness(owner)).currentness,
        intent: { action: "create_table", title: "Used Table" },
      },
    );
    const viewKey = created.composed!.viewKey;
    const rowData = new FormData();
    rowData.set("viewKey", viewKey);
    rowData.set("name", "Retained record");
    const row = await createDirectTableRow(
      owner.client,
      { businessId: business.id },
      { viewKey, formData: rowData },
    );
    expect(row.record_status).toBe("active");

    await expect(
      undoDirectTableAction(
        owner.client,
        { businessId: business.id, actorId: owner.user.id },
        {
          expectedActiveSourceVersionId:
            created.currentness.expectedBaseVersionId,
          expectedHeadRevision: created.currentness.expectedHeadRevision,
        },
      ),
    ).rejects.toThrow(/cannot be undone|current Table history/i);
    expect(
      (await currentness(owner)).snapshot.views.some(
        (view) => view.key === viewKey,
      ),
    ).toBe(true);

    const added = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: (await currentness(owner)).currentness,
        intent: {
          action: "add_column",
          viewKey,
          label: "Email",
          columnType: "email",
        },
      },
    );
    const addedFieldKey = added.composed!.operations.find(
      (operation) => operation.op === "set_field",
    )!.key;
    const valuedRowData = new FormData();
    valuedRowData.set("viewKey", viewKey);
    valuedRowData.set("name", "Valued record");
    valuedRowData.set(addedFieldKey, "valued@example.test");
    await createDirectTableRow(
      owner.client,
      { businessId: business.id },
      { viewKey, formData: valuedRowData },
    );

    const afterColumn = await currentness(owner);
    await expect(
      undoDirectTableAction(
        owner.client,
        { businessId: business.id, actorId: owner.user.id },
        {
          expectedActiveSourceVersionId:
            afterColumn.currentness.expectedBaseVersionId,
          expectedHeadRevision: afterColumn.currentness.expectedHeadRevision,
        },
      ),
    ).rejects.toThrow(/cannot be undone|current Table history/i);
  });

  it("accepts Add and Insert long-text properties with Table-owned Forms", async () => {
    const created = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: (await currentness(owner)).currentness,
        intent: {
          action: "create_table",
          title: `Explicit Forms ${crypto.randomUUID()}`,
        },
      },
    );
    const viewKey = created.composed!.viewKey;
    const beforeForms = await currentness(owner);
    const view = beforeForms.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    )!;
    const createFormKey = `${view.object_key}_create_internal`;
    const editFormKey = `${view.object_key}_edit_internal`;
    const publicFormKey = `${view.object_key}_public_unrelated`;
    const canonicalViewConfig = normalizeTableViewConfig(
      beforeForms.snapshot.views.find((candidate) => candidate.key === viewKey)!
        .config_json,
    );
    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const formsProposal = await configuration.proposeChangeSet({
      expectedBaseVersionId: beforeForms.currentness.expectedBaseVersionId,
      expectedHeadRevision: beforeForms.currentness.expectedHeadRevision,
      title: "Configure explicit Table forms",
      description: null,
      operations: [
        {
          op: "set_form",
          key: createFormKey,
          name: "Add explicit form record",
          object_key: view.object_key,
          mode: "create",
          config_json: {
            fields: [{ field: "name", hidden: false }],
            submit_label: "Add record",
          },
          audience: "internal",
          is_active: true,
        },
        {
          op: "set_form",
          key: editFormKey,
          name: "Edit explicit form record",
          object_key: view.object_key,
          mode: "edit",
          config_json: {
            fields: [{ field: "name", hidden: false }],
            submit_label: "Save changes",
          },
          audience: "internal",
          is_active: true,
        },
        {
          op: "set_form",
          key: publicFormKey,
          name: "Public unrelated form",
          object_key: view.object_key,
          mode: "create",
          config_json: {
            fields: [{ field: "name", hidden: false }],
            submit_label: "Send",
          },
          audience: "public",
          is_active: true,
        },
        {
          op: "set_view",
          key: viewKey,
          name: view.name,
          view_type: "table",
          object_key: view.object_key,
          config_json: {
            ...canonicalViewConfig,
            create_form_key: createFormKey,
            edit_form_key: editFormKey,
          },
          audience: "internal",
          is_active: true,
        },
      ],
    });
    const formsValidation = await configuration.validateChangeSet(
      formsProposal.id,
    );
    expect(formsValidation.status).toBe("validated");
    const formsApplied = await configuration.applyChangeSet(formsProposal.id);
    expect(formsApplied.status).toBe("applied");

    const configured = await currentness(owner);
    const publicFormBefore = configured.snapshot.forms.find(
      (candidate) => candidate.key === publicFormKey,
    )!;
    const counts = async (): Promise<{
      versionCount: number;
      changeCount: number;
    }> => {
      const [result] = await sql<
        { version_count: number; change_count: number }[]
      >`
        select
          (select count(*)::integer from public.configuration_versions
           where business_id = ${business.id}) as version_count,
          (select count(*)::integer from public.configuration_change_sets
           where business_id = ${business.id}) as change_count
      `;
      if (!result) throw new Error("Could not read configuration counts.");
      return {
        versionCount: Number(result.version_count),
        changeCount: Number(result.change_count),
      };
    };

    const beforeAdd = await counts();
    const added = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: configured.currentness,
        intent: {
          action: "add_column",
          viewKey,
          label: "Notes",
          columnType: "long_text",
        },
      },
    );
    expect(added.changeSet.status).toBe("applied");
    expect(added.composed!.operations.map((operation) => operation.op)).toEqual(
      ["set_field", "set_form", "set_form", "set_view"],
    );
    const addedFieldKey = added.composed!.operations.find(
      (operation) => operation.op === "set_field",
    )!.key;
    const afterAddCounts = await counts();
    expect(afterAddCounts.versionCount).toBe(beforeAdd.versionCount + 1);
    expect(afterAddCounts.changeCount).toBe(beforeAdd.changeCount + 1);

    const afterAdd = await currentness(owner);
    const addedField = afterAdd.snapshot.field_definitions.find(
      (candidate) => candidate.key === addedFieldKey,
    )!;
    expect(addedField).toMatchObject({
      object_key: view.object_key,
      field_type: "long_text",
      required: false,
      is_active: true,
    });
    const addedView = afterAdd.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    )!;
    expect(addedView.config_json).toMatchObject({
      fields: ["name", addedFieldKey],
    });
    for (const formKey of [createFormKey, editFormKey]) {
      const form = afterAdd.snapshot.forms.find(
        (candidate) => candidate.key === formKey,
      )!;
      expect(form.config_json).toMatchObject({
        fields: [
          { field: "name", hidden: false },
          { field: addedFieldKey, hidden: false },
        ],
      });
    }
    expect(
      afterAdd.snapshot.forms.find(
        (candidate) => candidate.key === publicFormKey,
      ),
    ).toEqual(publicFormBefore);

    const rowData = new FormData();
    rowData.set("viewKey", viewKey);
    rowData.set("name", "Long-text record");
    const row = await createDirectTableRow(
      owner.client,
      { businessId: business.id },
      { viewKey, formData: rowData },
    );
    const edited = await applyDirectTableRecordCellEditValue(
      owner.client,
      { businessId: business.id },
      {
        viewKey,
        recordId: row.id,
        fieldKey: addedFieldKey,
        value: "A subsequent operational value",
      },
    );
    expect(edited.data_json).toMatchObject({
      [addedFieldKey]: "A subsequent operational value",
    });
    expect(await counts()).toEqual(afterAddCounts);

    const beforeInsert = await counts();
    const inserted = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: afterAdd.currentness,
        intent: {
          action: "insert_column",
          viewKey,
          anchorFieldKey: "name",
          position: "right",
          label: "Details",
          columnType: "long_text",
        },
      },
    );
    expect(inserted.changeSet.status).toBe("applied");
    expect(
      inserted.composed!.operations.map((operation) => operation.op),
    ).toEqual(["set_field", "set_form", "set_form", "set_view"]);
    const insertedFieldKey = inserted.composed!.operations.find(
      (operation) => operation.op === "set_field",
    )!.key;
    const afterInsert = await currentness(owner);
    const afterInsertCounts = await counts();
    expect(afterInsertCounts.versionCount).toBe(beforeInsert.versionCount + 1);
    expect(afterInsertCounts.changeCount).toBe(beforeInsert.changeCount + 1);
    expect(
      afterInsert.snapshot.field_definitions.find(
        (candidate) => candidate.key === insertedFieldKey,
      ),
    ).toMatchObject({ field_type: "long_text", required: false });
    expect(
      afterInsert.snapshot.views.find((candidate) => candidate.key === viewKey)
        ?.config_json,
    ).toMatchObject({ fields: ["name", insertedFieldKey, addedFieldKey] });
    for (const formKey of [createFormKey, editFormKey]) {
      const form = afterInsert.snapshot.forms.find(
        (candidate) => candidate.key === formKey,
      )!;
      expect(form.config_json).toMatchObject({
        fields: [
          { field: "name", hidden: false },
          { field: addedFieldKey, hidden: false },
          { field: insertedFieldKey, hidden: false },
        ],
      });
    }
    expect(
      afterInsert.snapshot.forms.find(
        (candidate) => candidate.key === publicFormKey,
      ),
    ).toEqual(publicFormBefore);
  });

  it("adds a Choice property after an existing property in one version and keeps value edits operational", async () => {
    const created = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: (await currentness(owner)).currentness,
        intent: {
          action: "create_table",
          title: "J3 Property Journey " + crypto.randomUUID(),
        },
      },
    );
    const viewKey = created.composed!.viewKey;
    const area = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: created.currentness,
        intent: {
          action: "add_column",
          viewKey,
          label: "Area",
          columnType: "short_text",
        },
      },
    );
    const beforeReferral = await sql<
      { version_count: number; change_count: number }[]
    >`
      select
        (select count(*)::integer from public.configuration_versions where business_id = ${business.id}) as version_count,
        (select count(*)::integer from public.configuration_change_sets where business_id = ${business.id}) as change_count
    `;
    const referral = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: area.currentness,
        intent: {
          action: "insert_column",
          viewKey,
          anchorFieldKey: "area",
          position: "right",
          label: "Referral source",
          columnType: "select",
          options: [
            "Google",
            "Instagram",
            "Recommendation",
            "Returning customer",
            "Other",
          ],
        },
      },
    );
    expect(referral.changeSet.status).toBe("applied");
    expect(
      referral.composed!.operations.filter(
        (operation) => operation.op === "set_field",
      ),
    ).toHaveLength(1);
    const referralFieldKey = referral.composed!.operations.find(
      (operation) => operation.op === "set_field",
    )!.key;
    const afterReferral = await currentness(owner);
    const view = afterReferral.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    )!;
    expect(view.config_json).toMatchObject({
      fields: ["name", "area", referralFieldKey],
    });
    expect(
      afterReferral.snapshot.field_definitions.find(
        (field) => field.key === referralFieldKey,
      ),
    ).toMatchObject({
      field_type: "select",
      required: false,
      settings_json: {
        options: [
          "Google",
          "Instagram",
          "Recommendation",
          "Returning customer",
          "Other",
        ],
      },
    });
    const [afterReferralCounts] = await sql<
      { version_count: number; change_count: number }[]
    >`
      select
        (select count(*)::integer from public.configuration_versions where business_id = ${business.id}) as version_count,
        (select count(*)::integer from public.configuration_change_sets where business_id = ${business.id}) as change_count
    `;
    expect(afterReferralCounts).toEqual({
      version_count: Number(beforeReferral[0]!.version_count) + 1,
      change_count: Number(beforeReferral[0]!.change_count) + 1,
    });

    const rowData = new FormData();
    rowData.set("viewKey", viewKey);
    rowData.set("name", "J3 test customer");
    const row = await createDirectTableRow(
      owner.client,
      { businessId: business.id },
      { viewKey, formData: rowData },
    );
    await applyDirectTableRecordCellEditValue(
      owner.client,
      { businessId: business.id },
      {
        viewKey,
        recordId: row.id,
        fieldKey: referralFieldKey,
        value: "Google",
      },
    );
    const [afterOperationalEdit] = await sql<
      { version_count: number; change_count: number }[]
    >`
      select
        (select count(*)::integer from public.configuration_versions where business_id = ${business.id}) as version_count,
        (select count(*)::integer from public.configuration_change_sets where business_id = ${business.id}) as change_count
    `;
    expect(afterOperationalEdit).toEqual(afterReferralCounts);
  });

  it("keeps Add and Insert supported when a Table has no Forms", async () => {
    const created = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: (await currentness(administrator)).currentness,
        intent: {
          action: "create_table",
          title: `No Forms ${crypto.randomUUID()}`,
        },
      },
    );
    const viewKey = created.composed!.viewKey;
    const added = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: created.currentness,
        intent: {
          action: "add_column",
          viewKey,
          label: "Notes",
          columnType: "long_text",
        },
      },
    );
    expect(added.composed!.operations.map((operation) => operation.op)).toEqual(
      ["set_field", "set_view"],
    );
    const inserted = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: added.currentness,
        intent: {
          action: "insert_column",
          viewKey,
          anchorFieldKey: "name",
          position: "right",
          label: "Details",
          columnType: "long_text",
        },
      },
    );
    expect(inserted.changeSet.status).toBe("applied");
    expect(
      inserted.composed!.operations.map((operation) => operation.op),
    ).toEqual(["set_field", "set_view"]);
    const finalState = await currentness(administrator);
    const finalView = finalState.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    )!;
    expect(
      finalState.snapshot.forms.filter(
        (form) => form.object_key === finalView.object_key,
      ),
    ).toHaveLength(0);
  });

  it("allows Admin structural changes and Staff direct Record work while preserving boundaries", async () => {
    const beforeAiRuns = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.ai_execution_runs
      where business_id = ${business.id}
    `;
    const created = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: (await currentness(administrator)).currentness,
        intent: { action: "create_table", title: "Staff Workspace" },
      },
    );
    const viewKey = created.composed!.viewKey;
    expect(created.changeSet.status).toBe("applied");

    const rowData = new FormData();
    rowData.set("viewKey", viewKey);
    rowData.set("name", "Staff-created record");
    const row = await createDirectTableRow(
      staff.client,
      { businessId: business.id },
      { viewKey, formData: rowData },
    );
    const editData = new FormData();
    editData.set("name", "Staff-edited record");
    const edited = await applyDirectTableRecordCellEdit(
      staff.client,
      { businessId: business.id },
      { viewKey, recordId: row.id, fieldKey: "name", formData: editData },
    );
    expect(edited.data_json).toMatchObject({ name: "Staff-edited record" });

    await expect(
      applyDirectTableAction(
        staff.client,
        { businessId: business.id, actorId: staff.user.id },
        {
          currentness: created.currentness,
          intent: { action: "create_table", title: "Staff Structural" },
        },
      ),
    ).rejects.toThrow();

    const afterAiRuns = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.ai_execution_runs
      where business_id = ${business.id}
    `;
    expect(afterAiRuns).toEqual(beforeAiRuns);
  });

  it("uses the typed production boundary for validation and leaves configuration history untouched", async () => {
    const created = await applyDirectTableAction(
      administrator.client,
      { businessId: business.id, actorId: administrator.user.id },
      {
        currentness: (await currentness(administrator)).currentness,
        intent: { action: "create_table", title: "Typed Workspace" },
      },
    );
    const viewKey = created.composed!.viewKey;

    let current = created.currentness;
    const columns = [
      { label: "Email", columnType: "email" as const },
      { label: "Budget", columnType: "number" as const },
      { label: "Due date", columnType: "date" as const },
      { label: "Website", columnType: "url" as const },
      {
        label: "Status",
        columnType: "status" as const,
        options: ["New", "Booked"],
      },
    ];
    const keys: Record<string, string> = {};
    for (const column of columns) {
      const result = await applyDirectTableAction(
        administrator.client,
        { businessId: business.id, actorId: administrator.user.id },
        {
          currentness: current,
          intent: { action: "add_column", viewKey, ...column },
        },
      );
      current = result.currentness;
      keys[column.label] = result.composed!.operations.find(
        (operation) => operation.op === "set_field",
      )!.key;
    }

    const beforeOperationalWork = await sql<
      { version_count: number; head_revision: number; change_count: number }[]
    >`
      select
        (
          select count(*)::integer from public.configuration_versions
          where business_id = ${business.id}
        ) as version_count,
        (
          select head_revision from public.business_configuration_heads
          where business_id = ${business.id}
        ) as head_revision,
        (
          select count(*)::integer from public.configuration_change_sets
          where business_id = ${business.id}
      ) as change_count
    `;

    const rowData = new FormData();
    rowData.set("viewKey", viewKey);
    rowData.set("name", "Typed record");
    const row = await createDirectTableRow(
      staff.client,
      { businessId: business.id },
      { viewKey, formData: rowData },
    );

    const email = await applyDirectTableRecordCellEditValue(
      staff.client,
      { businessId: business.id },
      {
        viewKey,
        recordId: row.id,
        fieldKey: keys.Email!,
        value: "staff@example.test",
      },
    );
    expect(email.data_json).toMatchObject({
      [keys.Email!]: "staff@example.test",
    });
    const budget = await applyDirectTableRecordCellEditValue(
      staff.client,
      { businessId: business.id },
      {
        viewKey,
        recordId: row.id,
        fieldKey: keys.Budget!,
        value: 42.5,
      },
    );
    expect(budget.data_json).toMatchObject({ [keys.Budget!]: 42.5 });

    await expect(
      applyDirectTableRecordCellEditValue(
        staff.client,
        { businessId: business.id },
        {
          viewKey,
          recordId: row.id,
          fieldKey: keys.Budget!,
          value: "not-a-number",
        },
      ),
    ).rejects.toThrow();
    await expect(
      applyDirectTableRecordCellEditValue(
        staff.client,
        { businessId: business.id },
        {
          viewKey,
          recordId: row.id,
          fieldKey: keys["Due date"]!,
          value: "2026-02-30",
        },
      ),
    ).rejects.toThrow();
    await expect(
      applyDirectTableRecordCellEditValue(
        staff.client,
        { businessId: business.id },
        {
          viewKey,
          recordId: row.id,
          fieldKey: keys.Email!,
          value: "staff@",
        },
      ),
    ).rejects.toThrow();
    await expect(
      applyDirectTableRecordCellEditValue(
        staff.client,
        { businessId: business.id },
        {
          viewKey,
          recordId: row.id,
          fieldKey: keys.Website!,
          value: "ftp://bad",
        },
      ),
    ).rejects.toThrow();
    await expect(
      applyDirectTableRecordCellEditValue(
        staff.client,
        { businessId: business.id },
        {
          viewKey,
          recordId: row.id,
          fieldKey: keys.Status!,
          value: "Unknown",
        },
      ),
    ).rejects.toThrow();
    await expect(
      applyDirectTableRecordCellEditValue(
        staff.client,
        { businessId: business.id },
        { viewKey, recordId: row.id, fieldKey: "name", value: null },
      ),
    ).rejects.toThrow(/required/i);

    const afterOperationalWork = await sql<
      { version_count: number; head_revision: number; change_count: number }[]
    >`
      select
        (
          select count(*)::integer from public.configuration_versions
          where business_id = ${business.id}
        ) as version_count,
        (
          select head_revision from public.business_configuration_heads
          where business_id = ${business.id}
        ) as head_revision,
        (
          select count(*)::integer from public.configuration_change_sets
          where business_id = ${business.id}
        ) as change_count
    `;
    expect(afterOperationalWork).toEqual(beforeOperationalWork);
  });

  it("denies a direct action for a Business where the caller is not a member", async () => {
    const created = await owner.client.rpc("create_business", {
      business_name: `M15 Other ${crypto.randomUUID()}`,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    });
    if (created.error || !created.data) {
      throw created.error ?? new Error("Could not create the other Business.");
    }
    otherBusiness = created.data;
    const otherHead = await admin
      .from("business_configuration_heads")
      .select("active_version_id, head_revision")
      .eq("business_id", otherBusiness.id)
      .single();
    if (otherHead.error || !otherHead.data) throw otherHead.error;

    const denied = await staff.client.rpc("apply_direct_configuration_change", {
      expected_business_id: otherBusiness.id,
      expected_actor_id: staff.user.id,
      expected_base_version_id: otherHead.data.active_version_id,
      expected_head_revision: otherHead.data.head_revision,
      requested_action_kind: "create_table",
      requested_operations: [],
    });
    expect(denied.error).toBeTruthy();
  });

  it("rejects Staff and stale callers before a direct configuration change", async () => {
    const ownerState = await currentness(owner);
    await expect(
      applyDirectTableAction(
        staff.client,
        { businessId: business.id, actorId: staff.user.id },
        {
          currentness: ownerState.currentness,
          intent: { action: "create_table", title: "Staff Table" },
        },
      ),
    ).rejects.toThrow();

    const fresh = await applyDirectTableAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: ownerState.currentness,
        intent: { action: "create_table", title: "Fresh Table" },
      },
    );

    const freshViewKey = fresh.composed!.viewKey;
    const freshState = await currentness(owner);
    const freshView = freshState.snapshot.views.find(
      (candidate) => candidate.key === freshViewKey,
    )!;
    const [beforeShapeFailure] = await sql`
      select
        (
          select count(*)::integer
          from public.configuration_versions
          where business_id = ${business.id}
        ) as version_count,
        (
          select head_revision
          from public.business_configuration_heads
          where business_id = ${business.id}
        ) as head_revision,
        (
          select count(*)::integer
          from public.configuration_change_sets
          where business_id = ${business.id}
            and status = 'proposed'
        ) as proposed_count
    `;
    const malformed = await owner.client.rpc(
      "apply_direct_configuration_change",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        expected_base_version_id: fresh.currentness.expectedBaseVersionId,
        expected_head_revision: fresh.currentness.expectedHeadRevision,
        requested_action_kind: "rename_table",
        requested_operations: [
          {
            op: "set_view",
            key: freshView.key,
            name: "Malformed rename",
            view_type: freshView.view_type,
            object_key: freshView.object_key,
            config_json: freshView.config_json,
            audience: freshView.audience,
            is_active: freshView.is_active,
          },
        ],
      },
    );
    expect(malformed.error).toBeTruthy();
    const [afterShapeFailure] = await sql`
      select
        (
          select count(*)::integer
          from public.configuration_versions
          where business_id = ${business.id}
        ) as version_count,
        (
          select head_revision
          from public.business_configuration_heads
          where business_id = ${business.id}
        ) as head_revision,
        (
          select count(*)::integer
          from public.configuration_change_sets
          where business_id = ${business.id}
            and status = 'proposed'
        ) as proposed_count
    `;
    expect(afterShapeFailure).toEqual(beforeShapeFailure);

    await expect(
      applyDirectTableAction(
        owner.client,
        { businessId: business.id, actorId: owner.user.id },
        {
          currentness: {
            expectedBaseVersionId: ownerState.currentness.expectedBaseVersionId,
            expectedHeadRevision: ownerState.currentness.expectedHeadRevision,
          },
          intent: { action: "create_table", title: "Stale Table" },
        },
      ),
    ).rejects.toThrow(/Reload|changed|stale/i);
  });
});
