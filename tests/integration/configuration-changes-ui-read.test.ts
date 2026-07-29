import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ConfigurationChangeDetail,
  ConfigurationChangesOverview,
  ConfigurationVersionDetail,
} from "../../src/components/configuration-history-ui";
import type { SemanticDiff } from "../../src/core/configuration/schemas";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
  summarizeConfigurationSnapshot,
} from "../../src/core/configuration/service";
import type { Database, Tables } from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type Identity = { client: Client; user: User };

const password = "Milestone-5-phase-5a-read-test!";
const createdUserIds: string[] = [];

let settings: LocalSupabaseSettings;
let sql: Sql;
let serviceRole: Client;
let anonymous: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let business: Business;
let otherBusiness: Business;
let ownerService: ConfigurationChangeService;
let adminService: ConfigurationChangeService;
let proposal: Tables<"configuration_change_sets">;
let baseline: Tables<"configuration_versions">;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

async function signIn(email: string): Promise<Identity> {
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
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.user) {
    throw result.error ?? new Error(`Could not sign in ${email}.`);
  }
  return { client, user: result.data.user };
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `m5-phase5a-${label}-${crypto.randomUUID()}@example.test`;
  const created = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
  createdUserIds.push(created.data.user.id);
  return signIn(email);
}

async function createBusiness(
  identity: Identity,
  name: string,
): Promise<Business> {
  return requireData(
    await identity.client.rpc("create_business", {
      business_name: name,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    }),
    `Could not create ${name}`,
  );
}

async function captureTenantState(
  businessId: string,
): Promise<Record<string, unknown>> {
  const tables = await sql<{ table_name: string }[]>`
    select distinct columns.table_name
    from information_schema.columns
    where columns.table_schema = 'public'
      and columns.column_name = 'business_id'
    order by columns.table_name
  `;
  const state: Record<string, unknown> = {};
  for (const { table_name: tableName } of tables) {
    state[tableName] = await sql`
      select to_jsonb(tenant_row) as row
      from ${sql(tableName)} as tenant_row
      where tenant_row.business_id = ${businessId}::uuid
      order by to_jsonb(tenant_row)::text
    `;
  }
  state.business = await sql`
    select to_jsonb(business_row) as row
    from public.businesses as business_row
    where business_row.id = ${businessId}::uuid
  `;
  return state;
}

function expectEngineError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code });
}

describe("Milestone 5 Phase 5A authenticated read interface", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    sql = postgres(settings.databaseUrl, { max: 1 });
    serviceRole = createClient<Database>(
      settings.apiUrl,
      settings.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
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
    [owner, administrator, staff] = await Promise.all([
      createIdentity("owner"),
      createIdentity("admin"),
      createIdentity("staff"),
    ]);
    business = await createBusiness(owner, "Changes UI Read Business");
    otherBusiness = await createBusiness(owner, "Changes UI Other Business");
    const memberships = await serviceRole.from("business_memberships").insert([
      {
        business_id: business.id,
        user_id: administrator.user.id,
        role: "admin",
      },
      {
        business_id: business.id,
        user_id: staff.user.id,
        role: "staff",
      },
    ]);
    if (memberships.error) {
      throw memberships.error;
    }

    ownerService = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    adminService = new ConfigurationChangeService(administrator.client, {
      businessId: business.id,
      actorId: administrator.user.id,
    });
    baseline = (await ownerService.listVersions())[0]!;
    proposal = await ownerService.proposeChangeSet({
      title: "Add catering enquiries",
      description: "A read-only Phase 5A proposal fixture.",
      operations: [
        {
          op: "set_object",
          key: "catering_enquiry",
          singular_label: "Catering Enquiry",
          plural_label: "Catering Enquiries",
          description: "A customer catering request.",
          icon: null,
          is_active: true,
        },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    if (serviceRole && business && otherBusiness) {
      await serviceRole
        .from("businesses")
        .delete()
        .in("id", [business.id, otherBusiness.id]);
    }
    if (serviceRole) {
      await Promise.all(
        createdUserIds.map((userId) =>
          serviceRole.auth.admin.deleteUser(userId),
        ),
      );
    }
    await owner?.client.auth.signOut();
    await administrator?.client.auth.signOut();
    await staff?.client.auth.signOut();
    await sql?.end();
  });

  it("allows Owner/Admin reads while denying Staff and anonymous sessions", async () => {
    expect(await ownerService.getChangeSet(proposal.id)).toEqual(proposal);
    expect((await adminService.listChangeSets()).map(({ id }) => id)).toContain(
      proposal.id,
    );
    expect((await adminService.listVersions())[0]?.id).toBe(baseline.id);

    const staffService = new ConfigurationChangeService(staff.client, {
      businessId: business.id,
      actorId: staff.user.id,
    });
    const anonymousService = new ConfigurationChangeService(anonymous, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    await expectEngineError(
      staffService.listChangeSets(),
      "configuration_owner_or_admin_required",
    );
    await expectEngineError(
      staffService.getVersion(baseline.id),
      "configuration_owner_or_admin_required",
    );
    await expect(anonymousService.listVersions()).rejects.toBeInstanceOf(
      ConfigurationChangeServiceError,
    );
  });

  it("does not leak cross-Business change-set or version identifiers and controls malformed IDs", async () => {
    const otherService = new ConfigurationChangeService(owner.client, {
      businessId: otherBusiness.id,
      actorId: owner.user.id,
    });
    await expectEngineError(
      otherService.getChangeSet(proposal.id),
      "configuration_change_set_not_found",
    );
    await expectEngineError(
      otherService.getVersion(baseline.id),
      "configuration_version_not_found",
    );
    await expect(
      ownerService.getChangeSet("not-a-uuid"),
    ).rejects.toHaveProperty("name", "ZodError");
    await expect(
      ownerService.getVersion("also-not-a-uuid"),
    ).rejects.toHaveProperty("name", "ZodError");
  });

  it("bounds both overview read functions to the latest 50 rows in stable order", async () => {
    const [changeFunction, versionFunction] = await Promise.all([
      sql<{ definition: string }[]>`
        select pg_get_functiondef(
          'public.list_configuration_change_sets(uuid)'::regprocedure
        ) as definition
      `,
      sql<{ definition: string }[]>`
        select pg_get_functiondef(
          'public.list_configuration_versions(uuid)'::regprocedure
        ) as definition
      `,
    ]);
    expect(changeFunction[0]?.definition).toMatch(
      /order by change_set\.created_at desc, change_set\.id desc\s+limit 50/i,
    );
    expect(versionFunction[0]?.definition).toMatch(
      /order by version\.version_number desc, version\.id desc\s+limit 50/i,
    );
  });

  it("loads overview, proposal, preview, and version presentation with exact no-write state", async () => {
    const before = await captureTenantState(business.id);
    const [changeSets, versions, head, loadedProposal, loadedVersion, preview] =
      await Promise.all([
        ownerService.listChangeSets(),
        ownerService.listVersions(),
        ownerService.getActiveHead(),
        ownerService.getChangeSet(proposal.id),
        ownerService.getVersion(baseline.id),
        ownerService.loadPreview(proposal.id),
      ]);

    const overviewHtml = renderToStaticMarkup(
      createElement(ConfigurationChangesOverview, {
        activeVersionId: head.active_version_id,
        businessSlug: business.slug,
        changeSets,
        versions,
      }),
    );
    const proposalHtml = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: null,
        baseVersion: loadedVersion,
        businessSlug: business.slug,
        changeSet: loadedProposal,
        preview:
          preview.pages.length === 0
            ? { state: "empty" }
            : { state: "available", pages: preview.pages },
        rollbackTarget: null,
      }),
    );
    const versionHtml = renderToStaticMarkup(
      createElement(ConfigurationVersionDetail, {
        active: head.active_version_id === loadedVersion.id,
        businessSlug: business.slug,
        diff: null as SemanticDiff | null,
        parent: null,
        restoredFrom: null,
        snapshotCounts: summarizeConfigurationSnapshot(
          loadedVersion.snapshot_json,
        ),
        sourceChangeSet: null,
        sourceUnavailable: false,
        version: loadedVersion,
      }),
    );
    const after = await captureTenantState(business.id);

    expect(overviewHtml).toContain("Add catering enquiries");
    expect(proposalHtml).toContain(
      "This candidate has no active Pages available to preview.",
    );
    expect(versionHtml).toContain(
      "Empty configuration created with the Business.",
    );
    expect(after).toEqual(before);
  });
});
