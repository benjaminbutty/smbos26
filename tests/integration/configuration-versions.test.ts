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
type ConfigurationVersion = Tables<"configuration_versions">;

interface TestIdentity {
  client: Client;
  user: User;
}

interface SnapshotV1 {
  schema_version: number;
  object_definitions: Array<Record<string, Json | undefined>>;
  field_definitions: Array<Record<string, Json | undefined>>;
  relationship_definitions: Array<Record<string, Json | undefined>>;
  views: Array<Record<string, Json | undefined>>;
  forms: Array<Record<string, Json | undefined>>;
  pages: Array<Record<string, Json | undefined>>;
  preorder_experiences: Array<Record<string, Json | undefined>>;
  preorder_experience_locations: Array<Record<string, Json | undefined>>;
}

const password = "Milestone-5-phase-1-test-password!";
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];

let admin: Client;
let sql: Sql;
let owner: TestIdentity;
let otherOwner: TestIdentity;
let administrator: TestIdentity;
let staff: TestIdentity;
let business: Business;
let otherBusiness: Business;

function asSnapshot(value: Json): SnapshotV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a canonical snapshot object.");
  }
  return value as unknown as SnapshotV1;
}

async function createIdentity(
  label: string,
  settings: LocalSupabaseSettings,
): Promise<TestIdentity> {
  const email = `m5-${Date.now()}-${label}-${crypto.randomUUID()}@example.test`;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
  if (createError || !created.user) {
    throw createError ?? new Error(`Could not create identity ${label}`);
  }

  createdUserIds.push(created.user.id);
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
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    throw signInError;
  }

  return { client, user: created.user };
}

async function createOwnedBusiness(
  identity: TestIdentity,
  name: string,
): Promise<Business> {
  const { data, error } = await identity.client.rpc("create_business", {
    business_name: name,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  if (error || !data) {
    throw error ?? new Error(`Could not create ${name}`);
  }
  createdBusinessIds.push(data.id);
  return data;
}

async function getBaseline(businessId: string): Promise<ConfigurationVersion> {
  const { data, error } = await admin
    .from("configuration_versions")
    .select("*")
    .eq("business_id", businessId)
    .eq("version_number", 1)
    .single();
  if (error || !data) {
    throw error ?? new Error("Could not load baseline configuration version.");
  }
  return data;
}

describe("Milestone 5 Phase 1 configuration baselines", () => {
  beforeAll(async () => {
    const settings = getLocalSupabaseSettings();
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    sql = postgres(settings.databaseUrl, { max: 1 });

    [owner, otherOwner, administrator, staff] = await Promise.all([
      createIdentity("owner", settings),
      createIdentity("other-owner", settings),
      createIdentity("administrator", settings),
      createIdentity("staff", settings),
    ]);
    business = await createOwnedBusiness(
      owner,
      `Versioned Business ${crypto.randomUUID()}`,
    );
    otherBusiness = await createOwnedBusiness(
      otherOwner,
      `Other Versioned Business ${crypto.randomUUID()}`,
    );

    const { error: membershipError } = await admin
      .from("business_memberships")
      .insert([
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
    if (membershipError) {
      throw membershipError;
    }
  });

  afterAll(async () => {
    if (admin && createdBusinessIds.length > 0) {
      await admin.from("businesses").delete().in("id", createdBusinessIds);
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

  it("atomically creates one empty baseline and one revision-1 head for a new Business", async () => {
    const baseline = await getBaseline(business.id);
    const snapshot = asSnapshot(baseline.snapshot_json);
    const { data: heads, error: headError } = await admin
      .from("business_configuration_heads")
      .select("*")
      .eq("business_id", business.id);

    expect(headError).toBeNull();
    expect(heads).toEqual([
      expect.objectContaining({
        active_version_id: baseline.id,
        business_id: business.id,
        head_revision: 1,
      }),
    ]);
    expect(baseline).toMatchObject({
      business_id: business.id,
      created_by: null,
      kind: "baseline",
      parent_version_id: null,
      restored_from_version_id: null,
      snapshot_schema_version: 1,
      source_change_set_id: null,
      version_number: 1,
    });
    expect(baseline.snapshot_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot).toEqual({
      schema_version: 1,
      object_definitions: [],
      field_definitions: [],
      relationship_definitions: [],
      views: [],
      forms: [],
      pages: [],
      preorder_experiences: [],
      preorder_experience_locations: [],
    });
  });

  it("rolls back Business creation when baseline insertion fails", async () => {
    const rejectedBusinessName = `Rejected Baseline ${crypto.randomUUID()}`;
    const [before] = await sql<
      {
        businesses: number;
        heads: number;
        memberships: number;
        versions: number;
      }[]
    >`
      select
        (select count(*)::integer from public.businesses) as businesses,
        (
          select count(*)::integer
          from public.business_configuration_heads
        ) as heads,
        (
          select count(*)::integer
          from public.business_memberships
        ) as memberships,
        (
          select count(*)::integer
          from public.configuration_versions
        ) as versions
    `;

    try {
      await sql`
        create table private.test_configuration_baseline_failures (
          business_name text primary key
        )
      `;
      await sql`
        insert into private.test_configuration_baseline_failures (
          business_name
        )
        values (${rejectedBusinessName})
      `;
      await sql.unsafe(`
        create function private.test_reject_configuration_baseline()
        returns trigger
        language plpgsql
        set search_path = ''
        as $$
        begin
          if exists (
            select 1
            from public.businesses as business
            join private.test_configuration_baseline_failures as failure
              on failure.business_name = business.name
            where business.id = new.business_id
          ) then
            raise exception 'Forced configuration baseline failure'
              using errcode = 'P0001';
          end if;

          return new;
        end;
        $$;

        create trigger configuration_versions_test_reject_baseline
        before insert on public.configuration_versions
        for each row
        execute function private.test_reject_configuration_baseline();
      `);

      const rejected = await owner.client.rpc("create_business", {
        business_name: rejectedBusinessName,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      });
      expect(rejected.data).toBeNull();
      expect(rejected.error).toMatchObject({
        code: "P0001",
        message: "Forced configuration baseline failure",
      });

      const [after] = await sql<
        {
          businesses: number;
          heads: number;
          memberships: number;
          versions: number;
        }[]
      >`
        select
          (select count(*)::integer from public.businesses) as businesses,
          (
            select count(*)::integer
            from public.business_configuration_heads
          ) as heads,
          (
            select count(*)::integer
            from public.business_memberships
          ) as memberships,
          (
            select count(*)::integer
            from public.configuration_versions
          ) as versions
      `;
      expect(after).toEqual(before);

      const [rejectedRows] = await sql<
        {
          businesses: number;
          heads: number;
          memberships: number;
          versions: number;
        }[]
      >`
        select
          (
            select count(*)::integer
            from public.businesses
            where name = ${rejectedBusinessName}
          ) as businesses,
          (
            select count(*)::integer
            from public.business_configuration_heads as head
            join public.businesses as business
              on business.id = head.business_id
            where business.name = ${rejectedBusinessName}
          ) as heads,
          (
            select count(*)::integer
            from public.business_memberships as membership
            join public.businesses as business
              on business.id = membership.business_id
            where business.name = ${rejectedBusinessName}
          ) as memberships,
          (
            select count(*)::integer
            from public.configuration_versions as version
            join public.businesses as business
              on business.id = version.business_id
            where business.name = ${rejectedBusinessName}
          ) as versions
      `;
      expect(rejectedRows).toEqual({
        businesses: 0,
        heads: 0,
        memberships: 0,
        versions: 0,
      });
    } finally {
      await sql`
        drop trigger if exists configuration_versions_test_reject_baseline
        on public.configuration_versions
      `;
      await sql`
        drop function if exists private.test_reject_configuration_baseline()
      `;
      await sql`
        drop table if exists private.test_configuration_baseline_failures
      `;
    }
  });

  it("captures a configured pre-existing Business as its Version 1 backfill", async () => {
    const configuredBusinessId = crypto.randomUUID();
    const alphaObjectId = crypto.randomUUID();
    const zetaObjectId = crypto.randomUUID();
    const alphaFirstFieldId = crypto.randomUUID();
    const alphaSecondFieldId = crypto.randomUUID();
    const zetaFieldId = crypto.randomUUID();
    const relationshipId = crypto.randomUUID();
    const viewId = crypto.randomUUID();
    const formId = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const recordId = crypto.randomUUID();
    createdBusinessIds.push(configuredBusinessId);

    await sql.begin(async (transaction) => {
      await transaction.unsafe("set local session_replication_role = replica");
      await transaction`
        insert into public.businesses (
          id,
          name,
          slug,
          business_type,
          timezone
        )
        values (
          ${configuredBusinessId}::uuid,
          'Configured Backfill Business',
          ${`configured-${configuredBusinessId}`}::text,
          'test',
          'Europe/London'
        )
      `;
      await transaction.unsafe("set local session_replication_role = origin");

      await transaction`
        insert into public.object_definitions (
          id,
          business_id,
          key,
          singular_label,
          plural_label,
          description,
          kind
        )
        values
          (
            ${zetaObjectId}::uuid,
            ${configuredBusinessId}::uuid,
            'zeta',
            'Zeta',
            'Zetas',
            '',
            'custom'
          ),
          (
            ${alphaObjectId}::uuid,
            ${configuredBusinessId}::uuid,
            'alpha',
            'Alpha',
            'Alphas',
            '',
            'custom'
          )
      `;
      await transaction`
        insert into public.field_definitions (
          id,
          business_id,
          object_definition_id,
          key,
          label,
          field_type,
          position
        )
        values
          (
            ${alphaSecondFieldId}::uuid,
            ${configuredBusinessId}::uuid,
            ${alphaObjectId}::uuid,
            'second',
            'Second',
            'short_text',
            1
          ),
          (
            ${zetaFieldId}::uuid,
            ${configuredBusinessId}::uuid,
            ${zetaObjectId}::uuid,
            'name',
            'Name',
            'short_text',
            0
          ),
          (
            ${alphaFirstFieldId}::uuid,
            ${configuredBusinessId}::uuid,
            ${alphaObjectId}::uuid,
            'name',
            'Name',
            'short_text',
            0
          )
      `;
      await transaction`
        insert into public.relationship_definitions (
          id,
          business_id,
          key,
          source_object_definition_id,
          target_object_definition_id,
          source_label,
          target_label,
          cardinality
        )
        values (
          ${relationshipId}::uuid,
          ${configuredBusinessId}::uuid,
          'alpha_to_zeta',
          ${alphaObjectId}::uuid,
          ${zetaObjectId}::uuid,
          'Zetas',
          'Alphas',
          'many_to_many'
        )
      `;
      await transaction`
        insert into public.views (
          id,
          business_id,
          key,
          name,
          view_type,
          object_definition_id,
          config_json,
          audience
        )
        values (
          ${viewId}::uuid,
          ${configuredBusinessId}::uuid,
          'alpha_list',
          'Alphas',
          'table',
          ${alphaObjectId}::uuid,
          '{"fields":["name","second"]}'::jsonb,
          'internal'
        )
      `;
      await transaction`
        insert into public.forms (
          id,
          business_id,
          key,
          name,
          object_definition_id,
          mode,
          config_json,
          audience
        )
        values (
          ${formId}::uuid,
          ${configuredBusinessId}::uuid,
          'alpha_create',
          'New Alpha',
          ${alphaObjectId}::uuid,
          'create',
          '{"fields":[{"field":"name"},{"field":"second"}]}'::jsonb,
          'internal'
        )
      `;
      await transaction`
        insert into public.pages (
          id,
          business_id,
          key,
          title,
          slug,
          audience,
          layout_json,
          status
        )
        values (
          ${pageId}::uuid,
          ${configuredBusinessId}::uuid,
          'alpha_workspace',
          'Alpha workspace',
          'alpha-workspace',
          'internal',
          '{
            "blocks":[
              {"type":"view","view_key":"alpha_list"},
              {"type":"form","form_key":"alpha_create"}
            ]
          }'::jsonb,
          'draft'
        )
      `;
      await transaction`
        insert into public.records (
          id,
          business_id,
          object_definition_id,
          data_json
        )
        values (
          ${recordId}::uuid,
          ${configuredBusinessId}::uuid,
          ${alphaObjectId}::uuid,
          '{"name":"Operational row"}'::jsonb
        )
      `;
      await transaction`
        select private.initialize_business_configuration_baseline(
          ${configuredBusinessId}::uuid
        )
      `;
    });

    const [stored] = await sql<
      { snapshot_json: SnapshotV1; current_snapshot: SnapshotV1 }[]
    >`
      select
        version.snapshot_json,
        private.configuration_snapshot_v1(
          ${configuredBusinessId}::uuid
        ) as current_snapshot
      from public.configuration_versions as version
      join public.business_configuration_heads as head
        on head.business_id = version.business_id
        and head.active_version_id = version.id
      where version.business_id = ${configuredBusinessId}::uuid
        and version.version_number = 1
        and head.head_revision = 1
    `;

    expect(stored?.snapshot_json).toEqual(stored?.current_snapshot);
    expect(
      stored?.snapshot_json.object_definitions.map(({ key }) => key),
    ).toEqual(["alpha", "zeta"]);
    expect(
      stored?.snapshot_json.field_definitions.map(
        ({ object_key, position, key }) => [object_key, position, key],
      ),
    ).toEqual([
      ["alpha", 0, "name"],
      ["alpha", 1, "second"],
      ["zeta", 0, "name"],
    ]);
    expect(stored?.snapshot_json.object_definitions[0]?.id).toBe(alphaObjectId);
    expect(stored?.snapshot_json.relationship_definitions[0]?.id).toBe(
      relationshipId,
    );
    expect(stored?.snapshot_json.views[0]?.id).toBe(viewId);
    expect(stored?.snapshot_json.forms[0]?.id).toBe(formId);
    expect(stored?.snapshot_json.pages[0]?.id).toBe(pageId);
    expect(JSON.stringify(stored?.snapshot_json)).not.toContain("business_id");
    expect(JSON.stringify(stored?.snapshot_json)).not.toContain(recordId);
    expect(stored?.snapshot_json).not.toHaveProperty("records");
  });

  it("reads and hashes the same identity-bearing configuration deterministically", async () => {
    const rows = await sql<
      {
        first_snapshot: SnapshotV1;
        second_snapshot: SnapshotV1;
        checksum: string;
      }[]
    >`
      select
        private.configuration_snapshot_v1(
          ${business.id}::uuid
        ) as first_snapshot,
        private.configuration_snapshot_v1(
          ${business.id}::uuid
        ) as second_snapshot,
        private.configuration_snapshot_checksum_v1(
          private.configuration_snapshot_v1(${business.id}::uuid)
        ) as checksum
    `;
    const result = rows[0];

    expect(result?.first_snapshot).toEqual(result?.second_snapshot);
    expect(result?.checksum).toBe(
      (await getBaseline(business.id)).snapshot_checksum,
    );
  });

  it("allows Owner and Admin reads while hiding history and heads from Staff", async () => {
    for (const client of [owner.client, administrator.client]) {
      const [versions, heads] = await Promise.all([
        client
          .from("configuration_versions")
          .select("business_id, version_number")
          .eq("business_id", business.id),
        client
          .from("business_configuration_heads")
          .select("business_id, head_revision")
          .eq("business_id", business.id),
      ]);
      expect(versions.error).toBeNull();
      expect(versions.data).toEqual([
        { business_id: business.id, version_number: 1 },
      ]);
      expect(heads.error).toBeNull();
      expect(heads.data).toEqual([
        { business_id: business.id, head_revision: 1 },
      ]);
    }

    const [versions, heads] = await Promise.all([
      staff.client
        .from("configuration_versions")
        .select("id")
        .eq("business_id", business.id),
      staff.client
        .from("business_configuration_heads")
        .select("business_id")
        .eq("business_id", business.id),
    ]);
    expect(versions.error).toBeNull();
    expect(versions.data).toEqual([]);
    expect(heads.error).toBeNull();
    expect(heads.data).toEqual([]);
  });

  it("denies authenticated inserts, updates and deletes on versions and heads", async () => {
    const baseline = await getBaseline(business.id);
    const versionInsert = await owner.client
      .from("configuration_versions")
      .insert({
        business_id: business.id,
        version_number: 2,
        kind: "change",
        parent_version_id: baseline.id,
        source_change_set_id: crypto.randomUUID(),
        snapshot_schema_version: 1,
        snapshot_json: baseline.snapshot_json,
        snapshot_checksum: baseline.snapshot_checksum,
        created_by: owner.user.id,
      });
    const versionUpdate = await owner.client
      .from("configuration_versions")
      .update({ snapshot_checksum: baseline.snapshot_checksum })
      .eq("id", baseline.id);
    const versionDelete = await owner.client
      .from("configuration_versions")
      .delete()
      .eq("id", baseline.id);
    const headInsert = await owner.client
      .from("business_configuration_heads")
      .insert({
        business_id: crypto.randomUUID(),
        active_version_id: baseline.id,
      });
    const headUpdate = await owner.client
      .from("business_configuration_heads")
      .update({ head_revision: 2 })
      .eq("business_id", business.id);
    const headDelete = await owner.client
      .from("business_configuration_heads")
      .delete()
      .eq("business_id", business.id);

    for (const result of [
      versionInsert,
      versionUpdate,
      versionDelete,
      headInsert,
      headUpdate,
      headDelete,
    ]) {
      expect(result.error?.code).toBe("42501");
    }
  });

  it("rejects direct individual version updates and deletions for privileged callers", async () => {
    const baseline = await getBaseline(business.id);

    await expect(
      sql`
        update public.configuration_versions
        set snapshot_checksum = ${baseline.snapshot_checksum}
        where id = ${baseline.id}::uuid
      `,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`
        delete from public.configuration_versions
        where id = ${baseline.id}::uuid
      `,
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("structurally rejects cross-Business version and head references", async () => {
    const baseline = await getBaseline(business.id);
    const otherBaseline = await getBaseline(otherBusiness.id);

    await expect(
      sql`
        insert into public.configuration_versions (
          business_id,
          version_number,
          kind,
          parent_version_id,
          source_change_set_id,
          snapshot_schema_version,
          snapshot_json,
          snapshot_checksum,
          created_by
        )
        values (
          ${business.id}::uuid,
          2,
          'change',
          ${otherBaseline.id}::uuid,
          ${crypto.randomUUID()}::uuid,
          1,
          ${sql.json(baseline.snapshot_json)}::jsonb,
          ${baseline.snapshot_checksum},
          ${owner.user.id}::uuid
        )
      `,
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      sql`
        update public.business_configuration_heads
        set active_version_id = ${otherBaseline.id}::uuid
        where business_id = ${business.id}::uuid
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("allows legitimate Business deletion to cascade its immutable baseline and head", async () => {
    const doomed = await createOwnedBusiness(
      owner,
      `Disposable Versioned Business ${crypto.randomUUID()}`,
    );
    const baseline = await getBaseline(doomed.id);

    const { error: deleteError } = await admin
      .from("businesses")
      .delete()
      .eq("id", doomed.id);
    expect(deleteError).toBeNull();

    const [versions, heads] = await Promise.all([
      admin
        .from("configuration_versions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", doomed.id),
      admin
        .from("business_configuration_heads")
        .select("business_id", { count: "exact", head: true })
        .eq("business_id", doomed.id),
    ]);
    expect(versions.count).toBe(0);
    expect(heads.count).toBe(0);
    expect(baseline.id).toBeTruthy();
  });
});
