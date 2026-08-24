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
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import { publishPublicPage } from "../../src/core/configuration/publication/page-service";
import type { ConfigurationOperation } from "../../src/core/configuration/schemas";
import { resolvePublicPage } from "../../src/core/experience/service";
import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
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
let anonymous: Client;
let sql: Sql;
let owner: Identity;
let workspaceAdmin: Identity;
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

async function applyConfigurationOperations(
  operations: ConfigurationOperation[],
  title: string,
) {
  const state = await currentness(owner);
  const configuration = new ConfigurationChangeService(owner.client, {
    businessId: business.id,
    actorId: owner.user.id,
  });
  const proposal = await configuration.proposeChangeSet({
    expectedBaseVersionId: state.currentness.expectedBaseVersionId,
    expectedHeadRevision: state.currentness.expectedHeadRevision,
    title,
    description: null,
    operations,
  });
  const validated = await configuration.validateChangeSet(proposal.id);
  expect(validated.status).toBe("validated");
  const applied = await configuration.applyChangeSet(proposal.id);
  expect(applied.status).toBe("applied");
  return currentness(owner);
}

async function createPublicDraft(
  pageKey: string,
  pageSlug: string,
  layout: Extract<ConfigurationOperation, { op: "set_page" }>["layout_json"] = {
    blocks: [{ type: "heading", text: "Book online", level: 1 }],
  },
) {
  return applyConfigurationOperations(
    [
      {
        op: "set_page",
        key: pageKey,
        title: "Book online",
        slug: pageSlug,
        audience: "public",
        layout_json: layout,
        status: "draft",
        is_active: true,
      },
    ],
    `Create ${pageKey}`,
  );
}

async function configurationCounts() {
  const [counts] = await sql<
    { versions: number; changes: number; revision: number }[]
  >`
    select
      (select count(*)::integer from public.configuration_versions
       where business_id = ${business.id}) as versions,
      (select count(*)::integer from public.configuration_change_sets
       where business_id = ${business.id}) as changes,
      (select head_revision::integer from public.business_configuration_heads
       where business_id = ${business.id}) as revision
  `;
  if (!counts) throw new Error("Could not read configuration counts.");
  return {
    versions: Number(counts.versions),
    changes: Number(counts.changes),
    revision: Number(counts.revision),
  };
}

async function expectShapeRejected(
  actionKind: "rename_page" | "save_page_layout",
  baseSnapshot: Json,
  candidateSnapshot: Json,
  operations: Json,
) {
  await expect(
    sql`
      select private.assert_direct_page_action_shape_v1(
        ${actionKind},
        ${sql.json(baseSnapshot)}::jsonb,
        ${sql.json(candidateSnapshot)}::jsonb,
        ${sql.json(operations)}::jsonb
      )
    `,
  ).rejects.toThrow(/direct_page_action_shape_invalid/);
}

describe("workspace foundation direct Page actions", () => {
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
    anonymous = createClient<Database>(
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
    owner = await createIdentity("owner");
    workspaceAdmin = await createIdentity("admin");
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
    const membership = await admin.from("business_memberships").insert([
      {
        business_id: business.id,
        user_id: workspaceAdmin.user.id,
        role: "admin",
      },
      {
        business_id: business.id,
        user_id: staff.user.id,
        role: "staff",
      },
    ]);
    if (membership.error) throw membership.error;
  }, 180_000);

  afterAll(async () => {
    if (business) await admin.from("businesses").delete().eq("id", business.id);
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
    if (sql) await sql.end();
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

  it("saves a completed long-distance Page reorder in exactly one Version", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const pageKey = `reorder_${suffix}`;
    const created = await applyConfigurationOperations(
      [
        {
          op: "set_page",
          key: pageKey,
          title: "This week",
          slug: `this-week-${suffix}`,
          audience: "internal",
          layout_json: {
            blocks: [
              {
                id: crypto.randomUUID(),
                type: "heading",
                text: "One",
                level: 2,
              },
              { id: crypto.randomUUID(), type: "text", text: "Two" },
              { id: crypto.randomUUID(), type: "divider" },
              { id: crypto.randomUUID(), type: "text", text: "Four" },
            ],
          },
          status: "draft",
          is_active: true,
        },
      ],
      `Create ${pageKey}`,
    );
    const page = created.snapshot.pages.find((entry) => entry.key === pageKey);
    if (!page) throw new Error("Expected the reorder Page.");
    const [first, ...remaining] = page.layout_json.blocks;
    if (!first) throw new Error("Expected Page blocks.");
    const before = await configurationCounts();

    const reordered = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: created.currentness,
        intent: {
          action: "save_page_layout",
          pageKey,
          layout: { blocks: [...remaining, first] },
        },
      },
    );
    const after = await configurationCounts();
    const reorderedPage = reordered.snapshot.pages.find(
      (entry) => entry.key === pageKey,
    );

    expect(reorderedPage?.layout_json.blocks.map((block) => block.id)).toEqual([
      ...remaining.map((block) => block.id),
      first.id,
    ]);
    expect(after).toEqual({
      versions: before.versions + 1,
      changes: before.changes + 1,
      revision: before.revision + 1,
    });
  });

  it("saves one complete bounded rich-text Page candidate in one Version", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const pageKey = `rich_page_${suffix}`;
    const created = await applyConfigurationOperations(
      [
        {
          op: "set_page",
          key: pageKey,
          title: "Rich Page",
          slug: `rich-page-${suffix}`,
          audience: "internal",
          layout_json: { blocks: [] },
          status: "draft",
          is_active: true,
        },
      ],
      `Create ${pageKey}`,
    );
    const before = await configurationCounts();

    const saved = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: created.currentness,
        intent: {
          action: "save_page_layout",
          pageKey,
          layout: {
            blocks: [
              {
                type: "rich_text",
                node: {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Confirm " },
                    {
                      type: "text",
                      text: "today",
                      marks: [{ type: "bold" }],
                    },
                  ],
                },
              },
              {
                type: "rich_text",
                node: {
                  type: "bullet_list",
                  items: [
                    { content: [{ type: "text", text: "Call Priya" }] },
                    { content: [{ type: "text", text: "Check stock" }] },
                  ],
                },
              },
            ],
          },
        },
      },
    );
    const after = await configurationCounts();
    const page = saved.snapshot.pages.find((entry) => entry.key === pageKey);

    expect(page?.layout_json.blocks.map((block) => block.type)).toEqual([
      "rich_text",
      "rich_text",
    ]);
    expect(page?.layout_json.blocks.every((block) => Boolean(block.id))).toBe(
      true,
    );
    expect(after).toEqual({
      versions: before.versions + 1,
      changes: before.changes + 1,
      revision: before.revision + 1,
    });
  });

  it("allows an Admin to author one bounded Page action", async () => {
    const before = await currentness(workspaceAdmin);
    const countsBefore = await configurationCounts();
    const created = await applyDirectPageAction(
      workspaceAdmin.client,
      { businessId: business.id, actorId: workspaceAdmin.user.id },
      {
        currentness: before.currentness,
        intent: {
          action: "create_page",
          title: `Admin page ${crypto.randomUUID().slice(0, 8)}`,
        },
      },
    );

    expect(created.changeSet.status).toBe("applied");
    expect(await configurationCounts()).toEqual({
      versions: countsBefore.versions + 1,
      changes: countsBefore.changes + 1,
      revision: countsBefore.revision + 1,
    });
  });

  it("renames and edits a draft public Site without changing its identity or lifecycle", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const pageKey = `draft_site_${suffix}`;
    const pageSlug = `draft-site-${suffix}`;
    const created = await createPublicDraft(pageKey, pageSlug);
    const original = created.snapshot.pages.find(
      (page) => page.key === pageKey,
    );
    if (!original) throw new Error("Expected the draft public Site.");
    const before = await configurationCounts();

    const renamed = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: created.currentness,
        intent: {
          action: "rename_page",
          pageKey,
          title: "Mobile grooming appointments",
        },
      },
    );
    const saved = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: renamed.currentness,
        intent: {
          action: "save_page_layout",
          pageKey,
          layout: {
            blocks: [
              {
                type: "heading",
                text: "Mobile grooming appointments",
                level: 1,
              },
              { type: "text", text: "Choose a time that suits your dog." },
            ],
          },
        },
      },
    );
    const edited = saved.snapshot.pages.find((page) => page.key === pageKey);
    const after = await configurationCounts();

    expect(edited).toMatchObject({
      id: original.id,
      key: pageKey,
      slug: pageSlug,
      audience: "public",
      status: "draft",
      is_active: true,
      title: "Mobile grooming appointments",
    });
    expect(edited?.layout_json.blocks).toHaveLength(2);
    expect(after).toEqual({
      versions: before.versions + 2,
      changes: before.changes + 2,
      revision: before.revision + 2,
    });

    const originalVersion = await new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    }).getVersion(created.currentness.expectedBaseVersionId);
    expect(
      (
        originalVersion.snapshot_json as { pages: typeof saved.snapshot.pages }
      ).pages.find((page) => page.key === pageKey),
    ).toMatchObject({
      id: original.id,
      title: "Book online",
      status: "draft",
    });
  });

  it("keeps the published Site live until one complete candidate is applied", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const pageKey = `live_site_${suffix}`;
    const pageSlug = `live-site-${suffix}`;
    const buttonId = crypto.randomUUID();
    await createPublicDraft(pageKey, pageSlug, {
      blocks: [
        { type: "heading", text: "Book online", level: 1 },
        {
          id: buttonId,
          type: "button",
          label: "Book now",
          href: "/book",
          style: "primary",
        },
      ],
    });
    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const publication = await publishPublicPage(configuration, { pageKey });
    expect(publication.status).toBe("applied");
    const published = await currentness(owner);
    const publishedPage = published.snapshot.pages.find(
      (page) => page.key === pageKey,
    );
    if (!publishedPage) throw new Error("Expected the published public Site.");

    const liveBefore = await resolvePublicPage(
      anonymous,
      business.slug,
      publishedPage.slug,
    );
    const countsBefore = await configurationCounts();

    await expect(
      applyDirectPageAction(
        owner.client,
        { businessId: business.id, actorId: owner.user.id },
        {
          currentness: published.currentness,
          intent: {
            action: "rename_page",
            pageKey,
            title: "This must not go live directly",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "direct_page_published_site_requires_publication",
    });
    expect(await configurationCounts()).toEqual(countsBefore);
    expect(liveBefore?.page).toMatchObject({
      key: pageKey,
      title: "Book online",
    });

    const malformed = await owner.client.rpc(
      "apply_direct_page_configuration_change",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        expected_base_version_id: published.currentness.expectedBaseVersionId,
        expected_head_revision: published.currentness.expectedHeadRevision,
        requested_action_kind: "publish_page_changes",
        requested_operations: [
          {
            op: "set_page",
            key: pageKey,
            title: "Bypass",
            slug: pageSlug,
            audience: "public",
            layout_json: {
              blocks: [{ type: "text", text: "Removed capability" }],
            },
            status: "published",
            is_active: true,
          },
        ],
      },
    );
    expect(malformed.error?.message).toContain(
      "direct_page_action_shape_invalid",
    );
    expect(await configurationCounts()).toEqual(countsBefore);

    const applied = await applyDirectPageAction(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        currentness: published.currentness,
        intent: {
          action: "publish_page_changes",
          pageKey,
          title: "Grooming visits at your door",
          layout: {
            blocks: [
              {
                id: buttonId,
                type: "button",
                label: "Book now",
                href: "/book",
                style: "primary",
              },
              {
                type: "heading",
                text: "Freshly groomed at home",
                level: 1,
              },
              { type: "text", text: "Book our mobile service online." },
            ],
          },
        },
      },
    );
    const edited = applied.snapshot.pages.find((page) => page.key === pageKey);
    const live = await resolvePublicPage(
      anonymous,
      business.slug,
      publishedPage.slug,
    );
    expect(await configurationCounts()).toEqual({
      versions: countsBefore.versions + 1,
      changes: countsBefore.changes + 1,
      revision: countsBefore.revision + 1,
    });

    expect(edited).toMatchObject({
      id: publishedPage.id,
      key: pageKey,
      slug: pageSlug,
      audience: "public",
      status: "published",
      is_active: true,
      title: "Grooming visits at your door",
    });
    expect(live?.page).toMatchObject({
      key: pageKey,
      slug: pageSlug,
      title: "Grooming visits at your door",
    });
    expect(live?.page.layout.blocks).toEqual([
      expect.objectContaining({
        id: buttonId,
        type: "button",
        label: "Book now",
      }),
      expect.objectContaining({
        type: "heading",
        text: "Freshly groomed at home",
      }),
      expect.objectContaining({
        type: "text",
        text: "Book our mobile service online.",
      }),
    ]);
  });

  it("rejects lifecycle, identity, other Page, and unrelated snapshot mutations", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const pageKey = `shape_site_${suffix}`;
    const pageSlug = `shape-site-${suffix}`;
    const state = await createPublicDraft(pageKey, pageSlug);
    const base = structuredClone(state.snapshot);
    const basePage = base.pages.find((page) => page.key === pageKey);
    if (!basePage) throw new Error("Expected the action-shape Site.");
    const changedLayout = {
      blocks: [
        { type: "heading" as const, text: "Changed", level: 1 as const },
      ],
    };
    const validOperation = {
      op: "set_page",
      key: basePage.key,
      title: basePage.title,
      slug: basePage.slug,
      audience: basePage.audience,
      layout_json: changedLayout,
      status: basePage.status,
      is_active: basePage.is_active,
    };
    const validCandidate = structuredClone(base);
    Object.assign(
      validCandidate.pages.find((page) => page.key === pageKey)!,
      validOperation,
      { id: basePage.id },
    );
    delete (
      validCandidate.pages.find((page) => page.key === pageKey)! as {
        op?: string;
      }
    ).op;

    for (const mutation of [
      { property: "audience", value: "internal" },
      { property: "status", value: "published" },
      { property: "slug", value: `${pageSlug}-changed` },
      { property: "key", value: `${pageKey}_changed` },
      { property: "id", value: crypto.randomUUID() },
    ] as const) {
      const candidate = structuredClone(validCandidate);
      const operation = structuredClone(validOperation) as Record<
        string,
        unknown
      >;
      const page = candidate.pages.find(
        (entry) => entry.key === pageKey,
      )! as unknown as Record<string, unknown>;
      page[mutation.property] = mutation.value;
      if (mutation.property !== "id") {
        operation[mutation.property] = mutation.value;
      }
      await expectShapeRejected(
        "save_page_layout",
        base as unknown as Json,
        candidate as unknown as Json,
        [operation] as Json,
      );
    }

    const otherPageCandidate = structuredClone(validCandidate);
    const otherPage = otherPageCandidate.pages.find(
      (page) => page.key !== pageKey,
    );
    if (!otherPage) throw new Error("Expected an unrelated Page fixture.");
    otherPage.title = `${otherPage.title} changed`;
    await expectShapeRejected(
      "save_page_layout",
      base as unknown as Json,
      otherPageCandidate as unknown as Json,
      [validOperation] as Json,
    );

    const unrelatedCandidate = structuredClone(validCandidate);
    (unrelatedCandidate.object_definitions as unknown[]).push({
      marker: "unrelated change",
    });
    await expectShapeRejected(
      "save_page_layout",
      base as unknown as Json,
      unrelatedCandidate as unknown as Json,
      [validOperation] as Json,
    );

    const before = await configurationCounts();
    const malformed = await owner.client.rpc(
      "apply_direct_page_configuration_change",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        expected_base_version_id: state.currentness.expectedBaseVersionId,
        expected_head_revision: state.currentness.expectedHeadRevision,
        requested_action_kind: "save_page_layout",
        requested_operations: [{ ...validOperation, status: "published" }],
      },
    );
    expect(malformed.error?.message).toContain(
      "direct_page_action_shape_invalid",
    );
    expect(await configurationCounts()).toEqual(before);
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
