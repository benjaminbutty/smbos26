import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyDirectPageAction,
  loadDirectPageConfiguration,
} from "../../src/core/configuration/direct-pages/service";
import type { Database, Tables } from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };

const password = "Workspace-foundation-pages!";
const createdUserIds: string[] = [];
let settings: LocalSupabaseSettings;
let admin: Client;
let owner: Identity;
let staff: Identity;
let business: Tables<"businesses">;

async function createIdentity(label: string): Promise<Identity> {
  const email = `page-workspace-${label}-${crypto.randomUUID()}@example.test`;
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
  return loadDirectPageConfiguration(identity.client, {
    businessId: business.id,
    actorId: identity.user.id,
  });
}

describe("workspace foundation direct Page actions", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
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
      business_name: `Page Workspace ${crypto.randomUUID()}`,
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
  });

  it("creates, renames, and saves a Page through one M5-backed action", async () => {
    const initial = await currentness(owner);
    const created = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: initial.currentness,
        intent: { action: "create_page", title: "Catering Enquiries" },
      },
    );

    expect(created.changeSet.status).toBe("applied");
    expect(created.composed.pageKey).toBe("catering_enquiries");
    expect(created.composed.pageSlug).toBe("catering-enquiries");
    const createdPage = created.snapshot.pages.find(
      (page) => page.key === created.composed.pageKey,
    );
    expect(createdPage).toMatchObject({
      title: "Catering Enquiries",
      slug: "catering-enquiries",
      audience: "internal",
      status: "draft",
      is_active: true,
      layout_json: { blocks: [] },
    });

    const added = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: created.currentness,
        intent: {
          action: "add_page_block",
          pageKey: created.composed.pageKey,
          block: { type: "text", text: "Use the saved Views below." },
        },
      },
    );
    const addedPage = added.snapshot.pages.find(
      (page) => page.key === created.composed.pageKey,
    );
    expect(addedPage?.layout_json.blocks).toEqual([
      expect.objectContaining({
        type: "text",
        text: "Use the saved Views below.",
      }),
    ]);
    expect(addedPage?.layout_json.blocks[0]).toHaveProperty("id");

    const renamed = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: added.currentness,
        intent: {
          action: "rename_page",
          pageKey: created.composed.pageKey,
          title: "Catering Requests",
        },
      },
    );
    const renamedPage = renamed.snapshot.pages.find(
      (page) => page.key === created.composed.pageKey,
    );
    expect(renamedPage).toMatchObject({
      key: created.composed.pageKey,
      slug: created.composed.pageSlug,
      title: "Catering Requests",
    });

    const saved = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: renamed.currentness,
        intent: {
          action: "save_page_layout",
          pageKey: created.composed.pageKey,
          layout: {
            blocks: [
              { type: "heading", text: "Catering Requests", level: 1 },
              { type: "callout", text: "Ready", tone: "success" },
            ],
          },
        },
      },
    );
    const savedPage = saved.snapshot.pages.find(
      (page) => page.key === created.composed.pageKey,
    );
    expect(savedPage?.slug).toBe("catering-enquiries");
    expect(savedPage?.layout_json.blocks).toHaveLength(2);
    expect(savedPage?.layout_json.blocks[0]).toHaveProperty("id");
    expect(saved.changeSet.base_head_revision).toBe(
      renamed.changeSet.base_head_revision + 1,
    );
  });

  it("rejects stale, unauthorized, and invalid actions without advancing the head", async () => {
    const before = await currentness(owner);
    const staleAttempt = applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: {
          ...before.currentness,
          expectedHeadRevision: before.currentness.expectedHeadRevision - 1,
        },
        intent: { action: "create_page", title: "Stale Page" },
      },
    );
    await expect(staleAttempt).rejects.toMatchObject({
      code: "direct_configuration_stale",
    });

    await expect(
      applyDirectPageAction(
        staff.client,
        { businessId: business.id, actorId: staff.user.id },
        {
          currentness: before.currentness,
          intent: { action: "create_page", title: "Staff Page" },
        },
      ),
    ).rejects.toThrow();

    const page = before.snapshot.pages[0];
    if (!page) throw new Error("Expected the first Page to exist.");
    await expect(
      applyDirectPageAction(
        owner.client,
        { businessId: business.id, actorId: owner.user.id },
        {
          currentness: before.currentness,
          intent: {
            action: "save_page_layout",
            pageKey: page.key,
            layout: {
              blocks: [{ type: "view", view_key: "missing_view" }],
            },
          },
        },
      ),
    ).rejects.toThrow();

    const after = await currentness(owner);
    expect(after.currentness).toEqual(before.currentness);
  });
});
