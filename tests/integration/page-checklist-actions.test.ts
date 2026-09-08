import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyDirectPageAction,
  loadDirectPageConfiguration,
} from "../../src/core/configuration/direct-pages/service";
import { createGraphService } from "../../src/core/graph/service";
import type { Database, Tables } from "../../src/db/supabase/database.types";
import {
  createPageChecklistRowAction,
  updatePageChecklistCellAction,
} from "../../src/runtime/page-editor/checklist-actions";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

const mockedServer = vi.hoisted(() => ({
  current: null as unknown,
  create: vi.fn(async () => mockedServer.current),
}));

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/supabase/server", () => ({
  createServerClient: mockedServer.create,
}));

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };

const password = "Page-checklist-actions-2026!";
const createdUserIds: string[] = [];
let settings: LocalSupabaseSettings;
let admin: Client;
let sql: Sql;
let owner: Identity;
let staff: Identity;
let business: Tables<"businesses">;

async function createIdentity(label: string): Promise<Identity> {
  const email = `page-checklist-${label}-${crypto.randomUUID()}@example.test`;
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

async function configurationVersionCount(): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from public.configuration_versions
    where business_id = ${business.id}
  `;
  return Number(rows[0]?.count ?? 0);
}

describe("Page-aware checklist Record boundary", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    sql = postgres(settings.databaseUrl, { max: 1 });
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    owner = await createIdentity("owner");
    staff = await createIdentity("staff");

    const created = await owner.client.rpc("create_business", {
      business_name: `Checklist boundary ${crypto.randomUUID()}`,
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
  }, 180_000);

  afterAll(async () => {
    if (business) await admin.from("businesses").delete().eq("id", business.id);
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
    if (sql) await sql.end();
  });

  it("lets Staff tick the Page checklist and changes the shared Record without a Page Version", async () => {
    const current = await loadDirectPageConfiguration(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const page = await applyDirectPageAction(
      owner.client,
      { actorId: owner.user.id, businessId: business.id },
      {
        currentness: current.currentness,
        intent: { action: "create_page", title: "Opening guide" },
      },
    );
    const checklist = await applyDirectPageAction(
      owner.client,
      { actorId: owner.user.id, businessId: business.id },
      {
        currentness: page.currentness,
        intent: {
          action: "create_checklist",
          name: "Opening tasks",
          pageKey: page.composed.pageKey,
        },
      },
    );
    const configuredPage = checklist.snapshot.pages.find(
      (candidate) => candidate.key === page.composed.pageKey,
    );
    const checklistBlock = configuredPage?.layout_json.blocks.find(
      (block) => block.type === "view" && block.checklist,
    );
    if (!checklistBlock || checklistBlock.type !== "view") {
      throw new Error("Expected a checklist View block.");
    }
    const view = checklist.snapshot.views.find(
      (candidate) => candidate.key === checklistBlock.view_key,
    );
    if (!view) throw new Error("Expected the checklist View definition.");
    const record = await createGraphService(owner.client, {
      businessId: business.id,
    }).createRecord({
      data: { completed: false, name: "Unlock the front door" },
      objectDefinitionId: view.object_definition_id,
    });
    const versionsBefore = await configurationVersionCount();

    mockedServer.current = staff.client;
    const updated = await updatePageChecklistCellAction(
      business.slug,
      page.composed.pageKey,
      checklistBlock.view_key,
      checklistBlock.id!,
      {
        fieldKey: "completed",
        recordId: record.id,
        value: true,
      },
    );

    expect(updated.status).toBe("success");
    expect(await configurationVersionCount()).toBe(versionsBefore);
    const stored = await staff.client
      .from("records")
      .select("data_json")
      .eq("id", record.id)
      .single();
    expect(stored.error).toBeNull();
    expect(stored.data?.data_json).toMatchObject({ completed: true });

    const versionsBeforeCreate = await configurationVersionCount();
    mockedServer.current = owner.client;
    const created = await createPageChecklistRowAction(
      business.slug,
      page.composed.pageKey,
      checklistBlock.view_key,
      checklistBlock.id!,
      { labelValue: "Lock the back door" },
    );
    expect(created.status).toBe("success");
    expect(await configurationVersionCount()).toBe(versionsBeforeCreate);
    if (created.status === "success") {
      expect(created.value.values).toMatchObject({
        completed: false,
        name: "Lock the back door",
      });
    }
  });

  it("rejects read-only and non-member checklist writes at the Page boundary", async () => {
    const loaded = await loadDirectPageConfiguration(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const page = loaded.snapshot.pages.find((candidate) => candidate.key);
    if (!page) throw new Error("Expected a configured Page.");
    const block = page.layout_json.blocks.find(
      (candidate) => candidate.type === "view" && candidate.checklist,
    );
    if (!block || block.type !== "view" || !block.checklist) {
      throw new Error("Expected a checklist block.");
    }
    const readOnlyLayout = {
      blocks: page.layout_json.blocks.map((candidate) =>
        candidate.type === "view" && candidate.id === block.id
          ? { ...candidate, read_only: true }
          : candidate,
      ),
    };
    const readOnly = await applyDirectPageAction(
      owner.client,
      { actorId: owner.user.id, businessId: business.id },
      {
        currentness: loaded.currentness,
        intent: {
          action: "save_page_layout",
          layout: readOnlyLayout,
          pageKey: page.key,
        },
      },
    );
    const viewKey = block.view_key;
    const object = readOnly.snapshot.views.find(
      (candidate) => candidate.key === viewKey,
    );
    if (!object) throw new Error("Expected the checklist View.");
    const record = await createGraphService(owner.client, {
      businessId: business.id,
    }).createRecord({
      data: { completed: false, name: "Read-only item" },
      objectDefinitionId: object.object_definition_id,
    });

    mockedServer.current = staff.client;
    const denied = await updatePageChecklistCellAction(
      business.slug,
      page.key,
      viewKey,
      block.id!,
      { fieldKey: "completed", recordId: record.id, value: true },
    );
    expect(denied.status).toBe("error");
    if (denied.status === "error") {
      expect(denied.message).toMatch(/read-only|no longer available/i);
    }

    const wrongTenant = await updatePageChecklistCellAction(
      `${business.slug}-other-tenant`,
      page.key,
      viewKey,
      block.id!,
      { fieldKey: "completed", recordId: record.id, value: true },
    );
    expect(wrongTenant.status).toBe("error");
  });
});
