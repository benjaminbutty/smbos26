import { execFileSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../../src/core/configuration/service";
import type {
  ConfigurationOperation,
  SemanticDiff,
} from "../../src/core/configuration/schemas";
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
type ChangeSet = Tables<"configuration_change_sets">;
type Version = Tables<"configuration_versions">;
type JsonObject = Record<string, Json | undefined>;

interface Identity {
  client: Client;
  user: User;
}

interface SnapshotV1 {
  schema_version: number;
  object_definitions: JsonObject[];
  field_definitions: JsonObject[];
  relationship_definitions: JsonObject[];
  views: JsonObject[];
  forms: JsonObject[];
  pages: JsonObject[];
  preorder_experiences: JsonObject[];
  preorder_experience_locations: JsonObject[];
}

const demoPassword = "Local-demo-2026!";
const createdUserIds: string[] = [];
let settings: LocalSupabaseSettings;
let sql: Sql;
let admin: Client;
let anonymous: Client;
let serviceRole: Client;
let owner: Identity;
let staff: Identity;
let administrator: Identity;
let business: Tables<"businesses">;
let otherBusiness: Tables<"businesses">;
let ownerService: ConfigurationChangeService;
let adminService: ConfigurationChangeService;
let version2: Version;
let preorder: Tables<"preorder_experiences">;
let locationIds: string[];
let sundayRemoval: ConfigurationOperation;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

function snapshot(value: Json): SnapshotV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a schema-v1 snapshot.");
  }
  return value as unknown as SnapshotV1;
}

function objectValue(value: Json, message: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as JsonObject;
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
  const email = `m5-rollback-${label}-${crypto.randomUUID()}@example.test`;
  const password = "Milestone-5-phase-4a-test-password!";
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

async function membership(
  identity: Identity,
  targetBusiness: Tables<"businesses">,
  role: "owner" | "admin" | "staff",
): Promise<void> {
  const inserted = await admin.from("business_memberships").insert({
    business_id: targetBusiness.id,
    user_id: identity.user.id,
    role,
  });
  if (inserted.error) {
    throw inserted.error;
  }
}

async function createBusiness(
  identity: Identity,
  name: string,
): Promise<Tables<"businesses">> {
  return requireData(
    await identity.client.rpc("create_business", {
      business_name: name,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    }),
    `Could not create ${name}`,
  );
}

async function preorderOperation(
  daysOfWeek: number[],
  allowedLocationIds = locationIds,
): Promise<ConfigurationOperation> {
  const objectRows = requireData(
    await owner.client
      .from("object_definitions")
      .select("id,key")
      .eq("business_id", business.id),
    "Could not load preorder Objects",
  );
  const relationshipRows = requireData(
    await owner.client
      .from("relationship_definitions")
      .select("id,key")
      .eq("business_id", business.id),
    "Could not load preorder Relationships",
  );
  const objectKey = new Map(objectRows.map((row) => [row.id, row.key]));
  const relationshipKey = new Map(
    relationshipRows.map((row) => [row.id, row.key]),
  );
  const config = structuredClone(preorder.config_json) as JsonObject;
  const schedule = objectValue(
    config.schedule as Json,
    "Missing preorder schedule.",
  );
  schedule.days_of_week = daysOfWeek;

  return {
    op: "set_preorder_experience",
    key: preorder.key,
    product_object_key:
      objectKey.get(preorder.product_object_definition_id) ?? "",
    customer_object_key:
      objectKey.get(preorder.customer_object_definition_id) ?? "",
    order_object_key: objectKey.get(preorder.order_object_definition_id) ?? "",
    order_item_object_key:
      objectKey.get(preorder.order_item_object_definition_id) ?? "",
    customer_places_order_relationship_key:
      relationshipKey.get(
        preorder.customer_places_order_relationship_definition_id,
      ) ?? "",
    order_contains_item_relationship_key:
      relationshipKey.get(
        preorder.order_contains_item_relationship_definition_id,
      ) ?? "",
    product_appears_in_item_relationship_key:
      relationshipKey.get(
        preorder.product_appears_in_item_relationship_definition_id,
      ) ?? "",
    config_json: config,
    allowed_location_ids: allowedLocationIds,
    is_active: true,
  } as ConfigurationOperation;
}

async function proposeValidateApply(
  title: string,
  operations: ConfigurationOperation[],
): Promise<{ proposal: ChangeSet; version: Version }> {
  const proposed = await ownerService.proposeChangeSet({
    ...(await ownerService.getProposalCurrentness()),
    title,
    description: null,
    operations,
  });
  const validated = await ownerService.validateChangeSet(proposed.id);
  expect(validated.status).toBe("validated");
  const applied = await ownerService.applyChangeSet(proposed.id);
  expect(applied.status).toBe("applied");
  return {
    proposal: applied,
    version: await ownerService.getVersion(applied.applied_version_id!),
  };
}

async function operationalCounts(): Promise<Record<string, number>> {
  const [counts] = await sql<Record<string, number>[]>`
    select
      (select count(*)::integer from public.records
        where business_id = ${business.id}::uuid) as records,
      (select count(*)::integer from public.record_relationships
        where business_id = ${business.id}::uuid) as record_relationships,
      (select count(*)::integer from public.record_location_links
        where business_id = ${business.id}::uuid) as record_location_links,
      (select count(*)::integer from public.preorder_submissions
        where business_id = ${business.id}::uuid) as preorder_submissions,
      (select count(*)::integer from public.preorder_slot_counters
        where business_id = ${business.id}::uuid) as preorder_slot_counters
  `;
  if (!counts) {
    throw new Error("Could not count operational data.");
  }
  return counts;
}

async function publicScheduleDays(): Promise<number[]> {
  const resolved = requireData(
    await anonymous.rpc("resolve_public_preorder", {
      requested_business_slug: business.slug,
      requested_page_slug: "preorder",
      requested_preorder_key: "bakery_preorder",
    }),
    "Could not resolve the public preorder",
  );
  const catalogue = objectValue(resolved, "Invalid public preorder catalogue.");
  const resolvedPreorder = objectValue(
    catalogue.preorder as Json,
    "Missing public preorder configuration.",
  );
  const schedule = objectValue(
    resolvedPreorder.schedule as Json,
    "Missing public preorder schedule.",
  );
  return schedule.days_of_week as number[];
}

describe("Milestone 5 Phase 4A forward configuration rollback", () => {
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
    serviceRole = admin;
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
    [owner, staff, administrator] = await Promise.all([
      signIn("demo@smbos.local", demoPassword),
      signIn("staff@smbos.local", demoPassword),
      createIdentity("admin"),
    ]);
    business = requireData(
      await admin
        .from("businesses")
        .select("*")
        .eq("slug", "bedford-bakery-demo")
        .single(),
      "Could not load Bedford Bakery",
    );
    await membership(administrator, business, "admin");
    otherBusiness = await createBusiness(owner, "Rollback Other Business");
    preorder = requireData(
      await owner.client
        .from("preorder_experiences")
        .select("*")
        .eq("business_id", business.id)
        .eq("key", "bakery_preorder")
        .single(),
      "Could not load Bedford preorder",
    );
    locationIds = requireData(
      await owner.client
        .from("preorder_experience_locations")
        .select("location_id")
        .eq("business_id", business.id)
        .eq("preorder_experience_id", preorder.id)
        .eq("is_active", true)
        .order("location_id"),
      "Could not load Bedford preorder Locations",
    ).map(({ location_id }) => location_id);
    ownerService = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    adminService = new ConfigurationChangeService(administrator.client, {
      businessId: business.id,
      actorId: administrator.user.id,
    });
    version2 = (await ownerService.listVersions()).find(
      ({ version_number }) => version_number === 2,
    )!;
    sundayRemoval = await preorderOperation([6]);
  });

  afterAll(async () => {
    if (admin && otherBusiness) {
      await admin.from("businesses").delete().eq("id", otherBusiness.id);
    }
    if (createdUserIds.length > 0) {
      await Promise.all(
        createdUserIds.map((userId) => admin.auth.admin.deleteUser(userId)),
      );
    }
    await owner?.client.auth.signOut();
    await staff?.client.auth.signOut();
    await administrator?.client.auth.signOut();
    await sql?.end();
  });

  it("proves Bedford V2 -> V3 -> V4, security, conflict and idempotency", async () => {
    const orderObject = requireData(
      await owner.client
        .from("object_definitions")
        .select("id")
        .eq("business_id", business.id)
        .eq("key", "order")
        .single(),
      "Could not load the Order Object",
    );
    const operationalOrderData = {
      public_reference: "ROLLBACK-PROOF-ORDER",
      status: "New",
      collection_at: "2026-08-08T11:00:00.000Z",
      collection_local_display: "8 August 2026 at 12:00",
      collection_timezone: "Europe/London",
      collection_location_name: "Bedford",
      customer_name: "Rollback Proof",
      customer_email: "rollback-proof@example.test",
      item_summary: "Rollback proof box × 1",
      total: 25,
    };
    const operationalOrder = requireData(
      await owner.client.rpc("create_graph_record", {
        expected_business_id: business.id,
        target_object_definition_id: orderObject.id,
        requested_data: operationalOrderData,
        requested_record_status: "active",
      }),
      "Could not create the pre-existing rollback proof Order",
    );
    const beforeOperational = await operationalCounts();
    const { version: version3 } = await proposeValidateApply(
      "Remove Sunday collection",
      [sundayRemoval],
    );
    expect(version3.version_number).toBe(3);
    expect(await publicScheduleDays()).toEqual([6]);
    expect(
      objectValue(
        snapshot(version3.snapshot_json).preorder_experiences[0]!
          .config_json as Json,
        "Missing V3 preorder config",
      ),
    ).toBeTruthy();

    const rollback = await ownerService.prepareRollback({
      expectedBaseVersionId: version3.id,
      expectedHeadRevision: 3,
      targetVersionId: version2.id,
      title: "Restore weekend collection",
      description: "Restore the configured Version 2 schedule.",
    });
    const competing = await adminService.prepareRollback({
      expectedBaseVersionId: version3.id,
      expectedHeadRevision: 3,
      targetVersionId: version2.id,
      title: "Competing weekend rollback",
      description: null,
    });

    expect(rollback).toMatchObject({
      kind: "rollback",
      status: "proposed",
      base_version_id: version3.id,
      base_head_revision: 3,
      rollback_target_version_id: version2.id,
      requested_by: owner.user.id,
      operations_json: [
        { op: "restore_configuration_version", schema_version: 1 },
      ],
      id_allocations_json: {},
    });
    const diff = rollback.semantic_diff_json as unknown as SemanticDiff;
    expect(
      diff.changes.some(
        (change) =>
          change.entity_type === "preorder_experience" &&
          change.properties.some(
            (property) =>
              property.property === "schedule.days_of_week" &&
              JSON.stringify(property.after) === "[6,7]",
          ),
      ),
    ).toBe(true);

    const proposalCountBeforeStaleChecks = (
      await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.configuration_change_sets
        where business_id = ${business.id}::uuid
      `
    )[0]?.count;
    for (const [expectedSource, expectedRevision] of [
      [version2.id, 3],
      [version3.id, 2],
    ] as const) {
      const stale = await owner.client.rpc("prepare_configuration_rollback", {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        expected_active_source_version_id: expectedSource,
        expected_head_revision: expectedRevision,
        requested_target_version_id: version2.id,
        requested_title: "Stale rollback context",
        requested_description: null as unknown as string,
      });
      expect(stale.error?.message).toContain("configuration_proposal_stale");
    }
    const proposalCountAfterStaleChecks = (
      await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.configuration_change_sets
        where business_id = ${business.id}::uuid
      `
    )[0]?.count;
    expect(proposalCountAfterStaleChecks).toBe(proposalCountBeforeStaleChecks);

    const obsoleteSignature = await owner.client.rpc(
      "prepare_configuration_rollback",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_target_version_id: version2.id,
        requested_title: "Obsolete rollback signature",
        requested_description: null as unknown as string,
      } as never,
    );
    expect(obsoleteSignature.error).not.toBeNull();

    const staffService = new ConfigurationChangeService(staff.client, {
      businessId: business.id,
      actorId: staff.user.id,
    });
    await expect(
      staffService.prepareRollback({
        expectedBaseVersionId: version3.id,
        expectedHeadRevision: 3,
        targetVersionId: version2.id,
        title: "Forbidden Staff rollback",
        description: null,
      }),
    ).rejects.toMatchObject({ code: "configuration_owner_or_admin_required" });
    await expect(staffService.listVersions()).rejects.toBeInstanceOf(
      ConfigurationChangeServiceError,
    );

    const otherVersions = await new ConfigurationChangeService(owner.client, {
      businessId: otherBusiness.id,
      actorId: owner.user.id,
    }).listVersions();
    await expect(
      ownerService.prepareRollback({
        expectedBaseVersionId: version3.id,
        expectedHeadRevision: 3,
        targetVersionId: otherVersions[0]!.id,
        title: "Cross-Business rollback",
        description: null,
      }),
    ).rejects.toMatchObject({
      code: "configuration_rollback_target_not_found",
    });
    await expect(
      ownerService.prepareRollback({
        expectedBaseVersionId: version3.id,
        expectedHeadRevision: 3,
        targetVersionId: version3.id,
        title: "Active-version rollback",
        description: null,
      }),
    ).rejects.toMatchObject({ code: "configuration_rollback_target_invalid" });

    const mismatch = await owner.client.rpc("prepare_configuration_rollback", {
      expected_business_id: business.id,
      expected_actor_id: administrator.user.id,
      expected_active_source_version_id: version3.id,
      expected_head_revision: 3,
      requested_target_version_id: version2.id,
      requested_title: "Actor mismatch",
      requested_description: null as unknown as string,
    });
    expect(mismatch.error?.message).toContain(
      "configuration_actor_context_mismatch",
    );
    for (const client of [anonymous, serviceRole]) {
      const denied = await client.rpc("prepare_configuration_rollback", {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        expected_active_source_version_id: version3.id,
        expected_head_revision: 3,
        requested_target_version_id: version2.id,
        requested_title: "Unauthenticated rollback",
        requested_description: null as unknown as string,
      });
      expect(denied.error).not.toBeNull();
    }
    const descriptorInjection = await owner.client.rpc(
      "propose_configuration_change",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        expected_base_version_id: (await ownerService.getProposalCurrentness())
          .expectedBaseVersionId,
        expected_head_revision: (await ownerService.getProposalCurrentness())
          .expectedHeadRevision,
        requested_title: "Descriptor injection",
        requested_description: null as unknown as string,
        requested_operations: [
          { op: "restore_configuration_version", schema_version: 1 },
        ],
      },
    );
    expect(descriptorInjection.error).not.toBeNull();

    const validated = await ownerService.validateChangeSet(rollback.id);
    expect(validated.status).toBe("validated");
    const versionsBeforeApply = await ownerService.listVersions();
    const [firstApply, retryApply] = await Promise.all([
      ownerService.applyChangeSet(rollback.id),
      ownerService.applyChangeSet(rollback.id),
    ]);
    expect(firstApply.applied_version_id).toBe(retryApply.applied_version_id);
    expect((await ownerService.listVersions()).length).toBe(
      versionsBeforeApply.length + 1,
    );

    const version4 = await ownerService.getVersion(
      firstApply.applied_version_id!,
    );
    expect(version4).toMatchObject({
      version_number: 4,
      kind: "rollback",
      parent_version_id: version3.id,
      restored_from_version_id: version2.id,
      source_change_set_id: rollback.id,
      created_by: owner.user.id,
    });
    expect(version4.snapshot_json).toEqual(version2.snapshot_json);
    expect(await publicScheduleDays()).toEqual([6, 7]);
    expect(await operationalCounts()).toEqual(beforeOperational);
    expect(
      requireData(
        await owner.client
          .from("records")
          .select("data_json")
          .eq("business_id", business.id)
          .eq("id", operationalOrder.id)
          .single(),
        "Could not reload the pre-existing rollback proof Order",
      ).data_json,
    ).toEqual(operationalOrderData);

    const stale = await adminService.validateChangeSet(competing.id);
    expect(stale.status).toBe("conflicted");
  });

  it("archives post-target entities with stable IDs and no hard deletes", async () => {
    const laterOperations: ConfigurationOperation[] = [
      {
        op: "set_object",
        key: "equipment",
        singular_label: "Equipment",
        plural_label: "Equipment",
        description: "Later rollback archival proof",
        icon: null,
        is_active: true,
      },
      {
        op: "set_field",
        object_key: "equipment",
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        position: 0,
        is_active: true,
      },
      {
        op: "set_form",
        key: "equipment_create",
        name: "New equipment",
        object_key: "equipment",
        mode: "create",
        config_json: {
          fields: [{ field: "name", hidden: false }],
          submit_label: "Save equipment",
        },
        audience: "internal",
        is_active: true,
      },
      {
        op: "set_view",
        key: "equipment",
        name: "Equipment",
        view_type: "table",
        object_key: "equipment",
        config_json: {
          fields: ["name"],
          title_field: "name",
          include_archived: false,
        },
        audience: "internal",
        is_active: true,
      },
      {
        op: "set_page",
        key: "equipment_workspace",
        title: "Equipment",
        slug: "equipment",
        audience: "internal",
        layout_json: {
          blocks: [{ type: "view", view_key: "equipment" }],
        },
        status: "draft",
        is_active: true,
      },
    ];
    const beforeOperational = await operationalCounts();
    const { version: version5 } = await proposeValidateApply(
      "Add equipment workspace",
      laterOperations,
    );
    const version5Snapshot = snapshot(version5.snapshot_json);
    const stableIds = {
      object: version5Snapshot.object_definitions.find(
        ({ key }) => key === "equipment",
      )!.id,
      field: version5Snapshot.field_definitions.find(
        ({ object_key, key }) => object_key === "equipment" && key === "name",
      )!.id,
      form: version5Snapshot.forms.find(
        ({ key }) => key === "equipment_create",
      )!.id,
      view: version5Snapshot.views.find(({ key }) => key === "equipment")!.id,
      page: version5Snapshot.pages.find(
        ({ key }) => key === "equipment_workspace",
      )!.id,
    };

    const rollback = await ownerService.prepareRollback({
      ...(await ownerService.getProposalCurrentness()),
      targetVersionId: version2.id,
      title: "Restore Version 2 and archive later workspace",
      description: null,
    });
    const candidate = snapshot(rollback.candidate_snapshot_json);
    for (const [section, key] of [
      ["object_definitions", "equipment"],
      ["forms", "equipment_create"],
      ["views", "equipment"],
      ["pages", "equipment_workspace"],
    ] as const) {
      expect(
        candidate[section].find((entity) => entity.key === key)?.is_active,
      ).toBe(false);
    }
    expect(
      candidate.field_definitions.find(
        ({ object_key, key }) => object_key === "equipment" && key === "name",
      )?.is_active,
    ).toBe(false);

    await ownerService.validateChangeSet(rollback.id);
    const applied = await ownerService.applyChangeSet(rollback.id);
    const rollbackVersion = await ownerService.getVersion(
      applied.applied_version_id!,
    );
    expect(rollbackVersion.kind).toBe("rollback");
    expect(rollbackVersion.restored_from_version_id).toBe(version2.id);
    expect(rollbackVersion.snapshot_checksum).not.toBe(
      version2.snapshot_checksum,
    );

    const projected = await Promise.all([
      owner.client
        .from("object_definitions")
        .select("id,is_active")
        .eq("business_id", business.id)
        .eq("key", "equipment")
        .single(),
      owner.client
        .from("field_definitions")
        .select("id,is_active")
        .eq("business_id", business.id)
        .eq("id", stableIds.field as string)
        .single(),
      owner.client
        .from("forms")
        .select("id,is_active")
        .eq("business_id", business.id)
        .eq("key", "equipment_create")
        .single(),
      owner.client
        .from("views")
        .select("id,is_active")
        .eq("business_id", business.id)
        .eq("key", "equipment")
        .single(),
      owner.client
        .from("pages")
        .select("id,is_active")
        .eq("business_id", business.id)
        .eq("key", "equipment_workspace")
        .single(),
    ]);
    expect(projected.map(({ data }) => data?.is_active)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(projected.map(({ data }) => data?.id)).toEqual([
      stableIds.object,
      stableIds.field,
      stableIds.form,
      stableIds.view,
      stableIds.page,
    ]);
    expect(await operationalCounts()).toEqual(beforeOperational);
  });

  it("rejects rollback when a historical Location is now inactive", async () => {
    const locationRows = requireData(
      await owner.client
        .from("locations")
        .select("id,name,is_active")
        .eq("business_id", business.id)
        .order("id"),
      "Could not load Locations",
    );
    const removedLocation = locationRows[0]!;
    const retainedLocation = locationRows[1]!;
    preorder = requireData(
      await owner.client
        .from("preorder_experiences")
        .select("*")
        .eq("business_id", business.id)
        .eq("key", "bakery_preorder")
        .single(),
      "Could not reload preorder",
    );
    await proposeValidateApply("Use Saturday at one Location", [
      await preorderOperation([6], [retainedLocation.id]),
    ]);
    const archived = await owner.client
      .from("locations")
      .update({ is_active: false })
      .eq("business_id", business.id)
      .eq("id", removedLocation.id)
      .select()
      .single();
    expect(archived.error).toBeNull();

    const beforeHead = requireData(
      await owner.client
        .from("business_configuration_heads")
        .select("*")
        .eq("business_id", business.id)
        .single(),
      "Could not load head",
    );
    const beforeOperational = await operationalCounts();
    const rollback = await ownerService.prepareRollback({
      ...(await ownerService.getProposalCurrentness()),
      targetVersionId: version2.id,
      title: "Restore both historical Locations",
      description: null,
    });
    expect(
      objectValue(rollback.display_context_json, "Missing display context")
        .locations,
    ).toBeTruthy();
    const rejected = await ownerService.validateChangeSet(rollback.id);
    expect(rejected.status).toBe("rejected");
    expect(
      objectValue(rejected.validation_result_json!, "Missing validation result")
        .errors,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "location_ineligible" }),
      ]),
    );
    expect(
      requireData(
        await owner.client
          .from("locations")
          .select("is_active")
          .eq("business_id", business.id)
          .eq("id", removedLocation.id)
          .single(),
        "Could not reload archived Location",
      ).is_active,
    ).toBe(false);
    expect(
      requireData(
        await owner.client
          .from("business_configuration_heads")
          .select("*")
          .eq("business_id", business.id)
          .single(),
        "Could not reload head",
      ),
    ).toEqual(beforeHead);
    expect(await operationalCounts()).toEqual(beforeOperational);

    const restored = await owner.client
      .from("locations")
      .update({ is_active: true })
      .eq("business_id", business.id)
      .eq("id", removedLocation.id);
    expect(restored.error).toBeNull();
  });

  it("rejects rollback when current Records use a newer status option", async () => {
    const baseOperations: ConfigurationOperation[] = [
      {
        op: "set_object",
        key: "rollback_probe",
        singular_label: "Rollback probe",
        plural_label: "Rollback probes",
        description: "Operational compatibility proof",
        icon: null,
        is_active: true,
      },
      {
        op: "set_field",
        object_key: "rollback_probe",
        key: "status",
        label: "Status",
        field_type: "status",
        required: true,
        default_value: "A",
        settings_json: { options: ["A", "B"] },
        position: 0,
        is_active: true,
      },
    ];
    const { version: oldStatusVersion } = await proposeValidateApply(
      "Add rollback compatibility probe",
      baseOperations,
    );
    const newerOperations = structuredClone(baseOperations);
    const statusOperation = newerOperations[1] as Extract<
      ConfigurationOperation,
      { op: "set_field" }
    >;
    statusOperation.settings_json = { options: ["A", "B", "C"] };
    await proposeValidateApply(
      "Add current-only status option",
      newerOperations,
    );

    const probeObject = requireData(
      await owner.client
        .from("object_definitions")
        .select("id")
        .eq("business_id", business.id)
        .eq("key", "rollback_probe")
        .single(),
      "Could not load rollback probe",
    );
    const record = requireData(
      await owner.client.rpc("create_graph_record", {
        expected_business_id: business.id,
        target_object_definition_id: probeObject.id,
        requested_data: { status: "C" },
        requested_record_status: "active",
      }),
      "Could not create compatibility Record",
    );
    const beforeHead = requireData(
      await owner.client
        .from("business_configuration_heads")
        .select("*")
        .eq("business_id", business.id)
        .single(),
      "Could not load compatibility head",
    );
    const beforeOperational = await operationalCounts();
    const rollback = await ownerService.prepareRollback({
      ...(await ownerService.getProposalCurrentness()),
      targetVersionId: oldStatusVersion.id,
      title: "Restore the older status options",
      description: null,
    });
    const rejected = await ownerService.validateChangeSet(rollback.id);
    expect(rejected.status).toBe("rejected");
    expect(
      requireData(
        await owner.client
          .from("records")
          .select("data_json")
          .eq("business_id", business.id)
          .eq("id", record.id)
          .single(),
        "Could not reload compatibility Record",
      ).data_json,
    ).toEqual({ status: "C" });
    expect(
      requireData(
        await owner.client
          .from("business_configuration_heads")
          .select("*")
          .eq("business_id", business.id)
          .single(),
        "Could not reload compatibility head",
      ),
    ).toEqual(beforeHead);
    expect(await operationalCounts()).toEqual(beforeOperational);
  });

  it("keeps replay helpers private and cascades rollback history only with its Business", async () => {
    const privileges = await sql<
      { function_name: string; role_name: string; executable: boolean }[]
    >`
      select
        function_name,
        role_name,
        pg_catalog.has_function_privilege(
          role_name,
          format('%I.%I(%s)', 'private', function_name, identity_arguments),
          'EXECUTE'
        ) as executable
      from (
        values
          ('configuration_rollback_candidate_v1',
            'uuid, jsonb, jsonb, jsonb'),
          ('replay_configuration_change_set_v1',
            'public.configuration_change_sets, public.configuration_versions')
      ) as function(function_name, identity_arguments)
      cross join (
        values ('anon'), ('authenticated'), ('service_role')
      ) as role(role_name)
    `;
    expect(privileges.every(({ executable }) => !executable)).toBe(true);

    const historyCount = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_versions
      where business_id = ${business.id}::uuid
        and kind = 'rollback'
    `;
    expect(historyCount[0]?.count).toBeGreaterThanOrEqual(2);
    expect(
      await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.configuration_versions
        where business_id = ${otherBusiness.id}::uuid
      `,
    ).toEqual([{ count: 1 }]);

    const cascadeBusiness = await createBusiness(
      owner,
      "Rollback Cascade Business",
    );
    const cascadeService = new ConfigurationChangeService(owner.client, {
      businessId: cascadeBusiness.id,
      actorId: owner.user.id,
    });
    const cascadeV2Proposal = await cascadeService.proposeChangeSet({
      ...(await cascadeService.getProposalCurrentness()),
      title: "Add cascade probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "cascade_probe",
          singular_label: "Cascade probe",
          plural_label: "Cascade probes",
          description: "Rollback history cascade proof",
          icon: null,
          is_active: true,
        },
      ],
    });
    await cascadeService.validateChangeSet(cascadeV2Proposal.id);
    const cascadeV2Applied = await cascadeService.applyChangeSet(
      cascadeV2Proposal.id,
    );
    const cascadeV2 = await cascadeService.getVersion(
      cascadeV2Applied.applied_version_id!,
    );
    const cascadeV3Proposal = await cascadeService.proposeChangeSet({
      ...(await cascadeService.getProposalCurrentness()),
      title: "Rename cascade probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "cascade_probe",
          singular_label: "Renamed cascade probe",
          plural_label: "Renamed cascade probes",
          description: "Rollback history cascade proof",
          icon: null,
          is_active: true,
        },
      ],
    });
    await cascadeService.validateChangeSet(cascadeV3Proposal.id);
    await cascadeService.applyChangeSet(cascadeV3Proposal.id);
    const cascadeRollback = await cascadeService.prepareRollback({
      ...(await cascadeService.getProposalCurrentness()),
      targetVersionId: cascadeV2.id,
      title: "Restore cascade probe",
      description: null,
    });
    await cascadeService.validateChangeSet(cascadeRollback.id);
    await cascadeService.applyChangeSet(cascadeRollback.id);
    expect(
      (await cascadeService.listVersions()).map(({ kind }) => kind),
    ).toEqual(["rollback", "change", "change", "baseline"]);

    await sql`
      delete from public.businesses
      where id = ${cascadeBusiness.id}::uuid
    `;
    expect(
      await sql<{ versions: number; change_sets: number; records: number }[]>`
        select
          (select count(*)::integer from public.configuration_versions
            where business_id = ${cascadeBusiness.id}::uuid) as versions,
          (select count(*)::integer from public.configuration_change_sets
            where business_id = ${cascadeBusiness.id}::uuid) as change_sets,
          (select count(*)::integer from public.records
            where business_id = ${cascadeBusiness.id}::uuid) as records
      `,
    ).toEqual([{ versions: 0, change_sets: 0, records: 0 }]);
  });
});
