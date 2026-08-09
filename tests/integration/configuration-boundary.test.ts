import { execFileSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;

interface Identity {
  client: Client;
  user: User;
}

const demoPassword = "Local-demo-2026!";
const versionedTables = [
  "object_definitions",
  "field_definitions",
  "relationship_definitions",
  "views",
  "forms",
  "pages",
  "preorder_experiences",
  "preorder_experience_locations",
] as const;
const applicationRoles = ["anon", "authenticated", "service_role"] as const;
const privateEngineFunctions = [
  "configuration_materialize_candidate_v1",
  "configuration_rollback_candidate_v1",
  "configuration_semantic_diff_v1",
  "build_configuration_rollback_display_context_v1",
  "replay_configuration_change_set_v1",
  "assert_configuration_preview_v1",
  "assemble_preorder_catalogue_v1",
  "project_configuration_candidate_v1",
  "validate_configuration_candidate_in_sandbox_v1",
  "assert_configuration_projection_matches_v1",
  "assert_configuration_application_state_v1",
  "protect_configuration_change_set",
  "protect_business_configuration_head",
] as const;
const lifecycleFunctions = [
  "abandon_configuration_change_set",
  "apply_configuration_change",
  "apply_direct_configuration_change",
  "get_configuration_change_set",
  "get_configuration_version",
  "list_configuration_change_sets",
  "list_configuration_versions",
  "load_configuration_preview",
  "prepare_configuration_rollback",
  "propose_configuration_change",
  "resolve_configuration_preview_preorder",
  "undo_direct_configuration_change",
  "validate_configuration_change",
] as const;

let settings: LocalSupabaseSettings;
let sql: Sql;
let admin: Client;
let anonymous: Client;
let serviceRole: Client;
let owner: Identity;
let staff: Identity;
let administrator: Identity;
let business: Business;
let preorder: Tables<"preorder_experiences">;
const createdUserIds: string[] = [];

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

async function signIn(email: string, password: string): Promise<Identity> {
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
    throw signedIn.error ?? new Error(`Could not sign in ${email}.`);
  }
  return { client, user: signedIn.data.user };
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `m5-boundary-${label}-${crypto.randomUUID()}@example.test`;
  const password = "Milestone-5-phase-3b-test-password!";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
  createdUserIds.push(created.data.user.id);
  return signIn(email, password);
}

async function expectDmlDenied(
  client: Client,
  table: (typeof versionedTables)[number],
): Promise<void> {
  const relation = client.from(table);
  const inserted = await relation.insert({} as never);
  expect(inserted.error?.code).toBe("42501");
  const updated = await relation
    .update({ is_active: false } as never)
    .eq("business_id", business.id);
  expect(updated.error?.code).toBe("42501");
  const deleted = await relation.delete().eq("business_id", business.id);
  expect(deleted.error?.code).toBe("42501");
}

async function proposeCapacityNine(): Promise<
  Tables<"configuration_change_sets">
> {
  const head = requireData(
    await owner.client
      .from("business_configuration_heads")
      .select("*")
      .eq("business_id", business.id)
      .single(),
    "Could not load the active configuration head.",
  );
  const locationRows = requireData(
    await owner.client
      .from("preorder_experience_locations")
      .select("location_id")
      .eq("business_id", business.id)
      .eq("preorder_experience_id", preorder.id)
      .eq("is_active", true)
      .order("location_id"),
    "Could not load allowed Locations.",
  );
  const config = structuredClone(preorder.config_json) as {
    schedule: { slot_capacity: number };
  } & Record<string, Json | undefined>;
  config.schedule.slot_capacity = 9;
  return requireData(
    await administrator.client.rpc("propose_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: administrator.user.id,
      expected_base_version_id: head.active_version_id,
      expected_head_revision: head.head_revision,
      requested_title: "Reduce preorder slot capacity",
      requested_description: "Phase 3B post-closure application proof.",
      requested_operations: [
        {
          op: "set_preorder_experience",
          key: preorder.key,
          product_object_key: "product",
          customer_object_key: "customer",
          order_object_key: "order",
          order_item_object_key: "order_item",
          customer_places_order_relationship_key: "customer_places_order",
          order_contains_item_relationship_key: "order_contains_order_item",
          product_appears_in_item_relationship_key:
            "product_appears_in_order_item",
          config_json: config,
          allowed_location_ids: locationRows.map(
            ({ location_id }) => location_id,
          ),
          is_active: true,
        },
      ],
    }),
    "Could not propose the post-closure change.",
  );
}

describe("Milestone 5 Phase 3B configuration mutation boundary", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    sql = postgres(settings.databaseUrl, { max: 1 });
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
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
    [owner, staff] = await Promise.all([
      signIn("demo@smbos.local", demoPassword),
      signIn("staff@smbos.local", demoPassword),
    ]);
    administrator = await createIdentity("admin");
    business = requireData(
      await admin
        .from("businesses")
        .select("*")
        .eq("slug", "bedford-bakery-demo")
        .single(),
      "Could not load Bedford Bakery.",
    );
    const membership = await admin.from("business_memberships").insert({
      business_id: business.id,
      user_id: administrator.user.id,
      role: "admin",
    });
    if (membership.error) {
      throw membership.error;
    }
    preorder = requireData(
      await owner.client
        .from("preorder_experiences")
        .select("*")
        .eq("business_id", business.id)
        .eq("key", "bakery_preorder")
        .single(),
      "Could not load Bedford preorder configuration.",
    );
  }, 90_000);

  afterAll(async () => {
    if (sql && business) {
      await sql`
        delete from public.businesses
        where id = ${business.id}::uuid
      `;
    }
    if (admin) {
      for (const userId of createdUserIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
    if (sql) {
      await sql.end();
    }
  });

  it("has no table mutation grants or mutation RLS policies", async () => {
    const privileges = await sql<
      {
        can_delete: boolean;
        can_insert: boolean;
        can_update: boolean;
        role_name: string;
        table_name: string;
      }[]
    >`
      select
        role_name,
        table_name,
        has_table_privilege(
          role_name,
          format('public.%I', table_name),
          'INSERT'
        ) as can_insert,
        has_table_privilege(
          role_name,
          format('public.%I', table_name),
          'UPDATE'
        ) as can_update,
        has_table_privilege(
          role_name,
          format('public.%I', table_name),
          'DELETE'
        ) as can_delete
      from unnest(${applicationRoles}::text[]) as role_name
      cross join unnest(${versionedTables}::text[]) as table_name
    `;
    expect(privileges).toHaveLength(
      applicationRoles.length * versionedTables.length,
    );
    expect(
      privileges.every(
        ({ can_delete, can_insert, can_update }) =>
          !can_delete && !can_insert && !can_update,
      ),
    ).toBe(true);

    const policies = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = any(${versionedTables}::text[])
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    `;
    expect(policies[0]?.count).toBe(0);
  });

  it("denies real PostgREST DML for Owner, Admin, Staff, service role and anonymous callers", async () => {
    for (const client of [
      owner.client,
      administrator.client,
      staff.client,
      serviceRole,
      anonymous,
    ]) {
      for (const table of versionedTables) {
        await expectDmlDenied(client, table);
      }
    }
  });

  it("keeps authenticated runtime reads and anonymous narrow resolvers working", async () => {
    for (const client of [owner.client, administrator.client, staff.client]) {
      for (const table of versionedTables) {
        const selected = await client
          .from(table)
          .select("business_id", { head: true })
          .eq("business_id", business.id);
        expect(selected.error).toBeNull();
      }
    }
    const resolved = await anonymous.rpc("resolve_public_preorder", {
      requested_business_slug: business.slug,
      requested_page_slug: "preorder",
      requested_preorder_key: preorder.key,
    });
    expect(resolved.error).toBeNull();
    expect(resolved.data).not.toBeNull();
  });

  it("removes every normal-role path to legacy and private configuration helpers", async () => {
    const legacyPrivileges = await sql<
      { allowed: boolean; function_name: string; role_name: string }[]
    >`
      select
        role_name,
        function_value.proname as function_name,
        has_function_privilege(
          role_name,
          function_value.oid,
          'EXECUTE'
        ) as allowed
      from unnest(${applicationRoles}::text[]) as role_name
      join pg_catalog.pg_proc as function_value on true
      join pg_catalog.pg_namespace as namespace_value
        on namespace_value.oid = function_value.pronamespace
      where namespace_value.nspname = 'public'
        and function_value.proname in (
          'create_preorder_experience',
          'set_preorder_experience_locations'
        )
    `;
    expect(legacyPrivileges.every(({ allowed }) => !allowed)).toBe(true);

    const privatePrivileges = await sql<
      { allowed: boolean; function_name: string; role_name: string }[]
    >`
      select
        role_name,
        function_value.proname as function_name,
        has_function_privilege(
          role_name,
          function_value.oid,
          'EXECUTE'
        ) as allowed
      from unnest(${applicationRoles}::text[]) as role_name
      join pg_catalog.pg_proc as function_value on true
      join pg_catalog.pg_namespace as namespace_value
        on namespace_value.oid = function_value.pronamespace
      where namespace_value.nspname = 'private'
        and function_value.proname = any(${privateEngineFunctions}::text[])
    `;
    expect(privatePrivileges.every(({ allowed }) => !allowed)).toBe(true);

    for (const client of [
      owner.client,
      administrator.client,
      staff.client,
      serviceRole,
      anonymous,
    ]) {
      const legacyCreate = await client.rpc("create_preorder_experience", {
        expected_business_id: business.id,
        requested_key: "denied",
        requested_product_object_definition_id: crypto.randomUUID(),
        requested_customer_object_definition_id: crypto.randomUUID(),
        requested_order_object_definition_id: crypto.randomUUID(),
        requested_order_item_object_definition_id: crypto.randomUUID(),
        requested_customer_places_order_relationship_definition_id:
          crypto.randomUUID(),
        requested_order_contains_item_relationship_definition_id:
          crypto.randomUUID(),
        requested_product_appears_in_item_relationship_definition_id:
          crypto.randomUUID(),
        requested_config: {},
        requested_location_ids: [],
        requested_is_active: false,
      });
      expect(legacyCreate.error?.code).toBe("42501");
      const legacyLocations = await client.rpc(
        "set_preorder_experience_locations",
        {
          expected_business_id: business.id,
          target_preorder_experience_id: preorder.id,
          requested_location_ids: [],
        },
      );
      expect(legacyLocations.error?.code).toBe("42501");
    }
  });

  it("exposes exactly the authenticated public configuration lifecycle allow-list", async () => {
    const executable = await sql<{ function_name: string }[]>`
      select distinct function_value.proname as function_name
      from pg_catalog.pg_proc as function_value
      join pg_catalog.pg_namespace as namespace_value
        on namespace_value.oid = function_value.pronamespace
      where namespace_value.nspname = 'public'
        and (
          function_value.proname like '%configuration%'
          or function_value.proname in (
            'create_preorder_experience',
            'set_preorder_experience_locations'
          )
        )
        and has_function_privilege(
          'authenticated',
          function_value.oid,
          'EXECUTE'
        )
      order by function_name
    `;
    expect(executable.map(({ function_name }) => function_name)).toEqual(
      [...lifecycleFunctions].sort(),
    );
  });

  it("proves Bedford is empty V1 followed by owner-applied configured V2", async () => {
    const versions = requireData(
      await owner.client
        .from("configuration_versions")
        .select("*")
        .eq("business_id", business.id)
        .order("version_number"),
      "Owner could not list Bedford versions.",
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      version_number: 1,
      kind: "baseline",
      parent_version_id: null,
      source_change_set_id: null,
      created_by: null,
    });
    expect(versions[1]).toMatchObject({
      version_number: 2,
      kind: "change",
      parent_version_id: versions[0]?.id,
      created_by: owner.user.id,
    });
    const empty = versions[0]?.snapshot_json as Record<string, Json>;
    expect(
      versionedTables.every(
        (table) => Array.isArray(empty[table]) && empty[table].length === 0,
      ),
    ).toBe(true);
    const changeSets = requireData(
      await owner.client.rpc("list_configuration_change_sets", {
        expected_business_id: business.id,
      }),
      "Owner could not list Bedford change sets.",
    );
    const initial = changeSets.find(
      ({ title }) => title === "Install Bedford Bakery configuration",
    );
    expect(initial).toMatchObject({
      status: "applied",
      requested_by: owner.user.id,
      applied_version_id: versions[1]?.id,
    });
    expect(versions[1]?.source_change_set_id).toBe(initial?.id);

    const staffVersions = await staff.client
      .from("configuration_versions")
      .select("id")
      .eq("business_id", business.id);
    expect(staffVersions.error).toBeNull();
    expect(staffVersions.data).toEqual([]);
    const staffChangeSets = await staff.client
      .from("configuration_change_sets")
      .select("id")
      .eq("business_id", business.id);
    expect(staffChangeSets.error).toBeNull();
    expect(staffChangeSets.data).toEqual([]);
  });

  it("keeps lifecycle mutations role-bound and closes the direct-write/apply race", async () => {
    const proposal = await proposeCapacityNine();
    const staffPropose = await staff.client.rpc(
      "propose_configuration_change",
      {
        expected_business_id: business.id,
        expected_actor_id: staff.user.id,
        expected_base_version_id: proposal.base_version_id,
        expected_head_revision: proposal.base_head_revision,
        requested_title: "Staff attempt",
        requested_description: "",
        requested_operations: proposal.operations_json,
      },
    );
    expect(staffPropose.error?.code).toBe("42501");
    for (const functionName of [
      "validate_configuration_change",
      "apply_configuration_change",
      "abandon_configuration_change_set",
    ] as const) {
      const denied = await staff.client.rpc(functionName, {
        expected_business_id: business.id,
        expected_actor_id: staff.user.id,
        requested_change_set_id: proposal.id,
      });
      expect(denied.error?.code).toBe("42501");
    }

    const validated = requireData(
      await administrator.client.rpc("validate_configuration_change", {
        expected_business_id: business.id,
        expected_actor_id: administrator.user.id,
        requested_change_set_id: proposal.id,
      }),
      "Admin could not validate the post-closure change.",
    );
    expect(validated.status).toBe("validated");

    const directWrite = owner.client
      .from("preorder_experiences")
      .update({ config_json: preorder.config_json })
      .eq("business_id", business.id)
      .eq("id", preorder.id);
    const application = administrator.client.rpc("apply_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: administrator.user.id,
      requested_change_set_id: proposal.id,
    });
    const [writeResult, applyResult] = await Promise.all([
      directWrite,
      application,
    ]);
    expect(writeResult.error?.code).toBe("42501");
    expect(applyResult.error).toBeNull();
    expect(applyResult.data?.status).toBe("applied");

    const [state] = await sql<
      {
        head_revision: number;
        projection_matches: boolean;
        version_number: number;
      }[]
    >`
      select
        head.head_revision::integer as head_revision,
        version.version_number,
        private.configuration_snapshot_v1(head.business_id)
          = version.snapshot_json as projection_matches
      from public.business_configuration_heads as head
      join public.configuration_versions as version
        on version.business_id = head.business_id
        and version.id = head.active_version_id
      where head.business_id = ${business.id}::uuid
    `;
    expect(state).toEqual({
      head_revision: 3,
      projection_matches: true,
      version_number: 3,
    });
  });

  it("keeps Bedford graph concepts generic and avoids bakery domain tables", async () => {
    const objects = requireData(
      await owner.client
        .from("object_definitions")
        .select("key, kind, semantic_type")
        .eq("business_id", business.id)
        .in("key", ["customer", "product", "order", "order_item"])
        .order("key"),
      "Could not inspect Bedford Objects.",
    );
    expect(
      objects.every(
        ({ kind, semantic_type }) =>
          kind === "custom" && semantic_type === null,
      ),
    ).toBe(true);
    const domainTables = await sql<{ name: string; relation: string | null }[]>`
      select name, to_regclass(format('public.%I', name))::text as relation
      from unnest(
        array[
          'customers',
          'products',
          'orders',
          'order_items',
          'bedford_bakery_orders'
        ]
      ) as name
    `;
    expect(domainTables.every(({ relation }) => relation === null)).toBe(true);
  });
});
