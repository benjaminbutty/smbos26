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
import {
  configurationOperationsSchema,
  semanticDiffSchema,
  type ConfigurationOperation,
} from "../../src/core/configuration/schemas";
import { preorderConfigSchema } from "../../src/core/preorder/schemas";
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
type Business = Tables<"businesses">;
type ChangeSet = Tables<"configuration_change_sets">;
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

const demoBusinessSlug = "bedford-bakery-demo";
const demoPassword = "Local-demo-2026!";
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];

let settings: LocalSupabaseSettings;
let admin: Client;
let sql: Sql;
let owner: Identity;
let staff: Identity;
let administrator: Identity;
let otherOwner: Identity;
let business: Business;
let otherBusiness: Business;
let otherLocation: Tables<"locations">;
let baselineSnapshot: SnapshotV1;
let operations: ConfigurationOperation[];
let proposal: ChangeSet;
let liveSnapshotBeforeProposal: Json;
let headBeforeProposal: Tables<"business_configuration_heads">;

function asSnapshot(value: Json): SnapshotV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a configuration snapshot object.");
  }
  return value as unknown as SnapshotV1;
}

function entity(
  values: JsonObject[],
  key: string,
  keyName = "key",
): JsonObject {
  const selected = values.find((value) => value[keyName] === key);
  if (!selected) {
    throw new Error(`Missing configuration entity ${keyName}=${key}.`);
  }
  return selected;
}

function requiredString(value: Json | undefined, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${name} to be a string.`);
  }
  return value;
}

function requiredBoolean(value: Json | undefined, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${name} to be a boolean.`);
  }
  return value;
}

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
  const email = `m5-changes-${label}-${crypto.randomUUID()}@example.test`;
  const password = "Milestone-5-phase-2a-test-password!";
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

async function seedDemo(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function currentLiveSnapshot(): Promise<Json> {
  const [row] = await sql<{ snapshot: Json }[]>`
    select private.configuration_snapshot_v1(
      ${business.id}::uuid
    ) as snapshot
  `;
  if (!row) {
    throw new Error("Could not read the live configuration snapshot.");
  }
  return row.snapshot;
}

async function currentHead(): Promise<Tables<"business_configuration_heads">> {
  return requireData(
    await admin
      .from("business_configuration_heads")
      .select("*")
      .eq("business_id", business.id)
      .single(),
    "Could not load configuration head",
  );
}

async function synchronizeTestBaseline(): Promise<void> {
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local session_replication_role = replica");
    await transaction`
      update public.configuration_versions as version
      set
        snapshot_json = private.configuration_snapshot_v1(
          ${business.id}::uuid
        ),
        snapshot_checksum = private.configuration_snapshot_checksum_v1(
          private.configuration_snapshot_v1(${business.id}::uuid)
        )
      where version.business_id = ${business.id}::uuid
        and version.id = (
          select head.active_version_id
          from public.business_configuration_heads as head
          where head.business_id = ${business.id}::uuid
        )
    `;
  });
}

function setObjectFrom(
  configuredObject: JsonObject,
  isActive: boolean,
): ConfigurationOperation {
  return {
    op: "set_object",
    key: requiredString(configuredObject.key, "Object key"),
    singular_label: requiredString(
      configuredObject.singular_label,
      "Object singular label",
    ),
    plural_label: requiredString(
      configuredObject.plural_label,
      "Object plural label",
    ),
    description: requiredString(
      configuredObject.description,
      "Object description",
    ),
    icon:
      configuredObject.icon === null
        ? null
        : requiredString(configuredObject.icon, "Object icon"),
    is_active: isActive,
  };
}

function makeOperations(snapshot: SnapshotV1): ConfigurationOperation[] {
  const phone = entity(
    snapshot.field_definitions.filter(
      (field) => field.object_key === "customer",
    ),
    "phone",
  );
  const publicPage = entity(snapshot.pages, "public_preorder");
  const preorder = entity(snapshot.preorder_experiences, "bakery_preorder");
  const activeProbe = entity(snapshot.object_definitions, "archive_probe");
  const inactiveProbe = entity(snapshot.object_definitions, "restore_probe");
  const bedfordLocation = requireData(
    { data: locationsByName.get("Bedford") ?? null, error: null },
    "Missing Bedford Location",
  );
  const config = preorderConfigSchema.parse(
    structuredClone(preorder.config_json),
  );
  config.schedule.days_of_week = [6];
  config.schedule.slot_capacity = 4;
  config.public_fields = config.public_fields.map((field) =>
    field.target === "customer" && field.field === "phone"
      ? { ...field, required: true }
      : field,
  );

  return configurationOperationsSchema.parse([
    {
      op: "set_object",
      key: "catering_enquiry",
      singular_label: "Catering enquiry",
      plural_label: "Catering enquiries",
      description: "A request for catering information",
      icon: null,
      is_active: true,
    },
    {
      op: "set_field",
      object_key: "catering_enquiry",
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
      op: "set_relationship",
      key: "customer_submits_catering_enquiry",
      source_object_key: "customer",
      target_object_key: "catering_enquiry",
      source_label: "Catering enquiries",
      target_label: "Customer",
      cardinality: "one_to_many",
      is_required: false,
      is_active: true,
    },
    {
      op: "set_form",
      key: "catering_enquiry_create",
      name: "New catering enquiry",
      object_key: "catering_enquiry",
      mode: "create",
      config_json: {
        fields: [{ field: "name" }],
        submit_label: "Save enquiry",
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_view",
      key: "catering_enquiries",
      name: "Catering enquiries",
      view_type: "table",
      object_key: "catering_enquiry",
      config_json: {
        fields: ["name"],
        create_form_key: "catering_enquiry_create",
        include_archived: false,
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_page",
      key: "catering_workspace",
      title: "Catering enquiries",
      slug: "catering-enquiries",
      audience: "internal",
      layout_json: {
        blocks: [
          { type: "view", view_key: "catering_enquiries" },
          { type: "form", form_key: "catering_enquiry_create" },
        ],
      },
      status: "draft",
      is_active: true,
    },
    {
      op: "set_field",
      object_key: "customer",
      key: "phone",
      label: requiredString(phone.label, "Phone label"),
      field_type: requiredString(phone.field_type, "Phone type") as "phone",
      required: true,
      default_value: phone.default_value ?? null,
      settings_json: (phone.settings_json ?? {}) as Record<string, Json>,
      position: Number(phone.position),
      is_active: requiredBoolean(phone.is_active, "Phone active state"),
    },
    {
      op: "set_page",
      key: "public_preorder",
      title: requiredString(publicPage.title, "Page title"),
      slug: requiredString(publicPage.slug, "Page slug"),
      audience: requiredString(
        publicPage.audience,
        "Page audience",
      ) as "public",
      layout_json: publicPage.layout_json as {
        blocks: [{ type: "preorder"; preorder_key: string }];
      },
      status: "draft",
      is_active: requiredBoolean(publicPage.is_active, "Page active state"),
    },
    {
      op: "set_preorder_experience",
      key: "bakery_preorder",
      product_object_key: requiredString(
        preorder.product_object_key,
        "Product Object key",
      ),
      customer_object_key: requiredString(
        preorder.customer_object_key,
        "Customer Object key",
      ),
      order_object_key: requiredString(
        preorder.order_object_key,
        "Order Object key",
      ),
      order_item_object_key: requiredString(
        preorder.order_item_object_key,
        "Order Item Object key",
      ),
      customer_places_order_relationship_key: requiredString(
        preorder.customer_places_order_relationship_key,
        "Customer Relationship key",
      ),
      order_contains_item_relationship_key: requiredString(
        preorder.order_contains_item_relationship_key,
        "Order Relationship key",
      ),
      product_appears_in_item_relationship_key: requiredString(
        preorder.product_appears_in_item_relationship_key,
        "Product Relationship key",
      ),
      config_json: config,
      allowed_location_ids: [bedfordLocation.id],
      is_active: requiredBoolean(preorder.is_active, "Preorder active state"),
    },
    setObjectFrom(activeProbe, false),
    setObjectFrom(inactiveProbe, true),
  ]);
}

const locationsByName = new Map<string, Tables<"locations">>();

async function expectEngineError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action;
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationChangeServiceError);
    expect((error as ConfigurationChangeServiceError).code).toBe(code);
  }
}

describe("Milestone 5 Phase 2A configuration proposals", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    await seedDemo();
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    sql = postgres(settings.databaseUrl, { max: 1 });
    [owner, staff, administrator, otherOwner] = await Promise.all([
      signIn("demo@smbos.local", demoPassword),
      signIn("staff@smbos.local", demoPassword),
      createIdentity("administrator"),
      createIdentity("other-owner"),
    ]);
    business = requireData(
      await admin
        .from("businesses")
        .select("*")
        .eq("slug", demoBusinessSlug)
        .single(),
      "Could not load Bedford Bakery",
    );
    createdBusinessIds.push(business.id);
    otherBusiness = requireData(
      await otherOwner.client.rpc("create_business", {
        business_name: `Other Phase 2A Business ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create the other Business",
    );
    createdBusinessIds.push(otherBusiness.id);
    otherLocation = requireData(
      await otherOwner.client.rpc("create_location", {
        target_business_id: otherBusiness.id,
        location_name: "Other Location",
        requested_timezone: "Europe/London",
      }),
      "Could not create the other Location",
    );

    const memberships = await admin.from("business_memberships").insert([
      {
        business_id: business.id,
        user_id: administrator.user.id,
        role: "admin",
      },
      {
        business_id: otherBusiness.id,
        user_id: owner.user.id,
        role: "admin",
      },
    ]);
    if (memberships.error) {
      throw memberships.error;
    }

    const probes = await owner.client.from("object_definitions").insert([
      {
        business_id: business.id,
        key: "archive_probe",
        singular_label: "Active probe",
        plural_label: "Active probes",
        description: "",
        kind: "custom",
        is_active: true,
      },
      {
        business_id: business.id,
        key: "restore_probe",
        singular_label: "Archived probe",
        plural_label: "Archived probes",
        description: "",
        kind: "custom",
        is_active: false,
      },
    ]);
    if (probes.error) {
      throw probes.error;
    }
    const locations = requireData(
      await admin.from("locations").select("*").eq("business_id", business.id),
      "Could not load demo Locations",
    );
    locations.forEach((location) =>
      locationsByName.set(location.name, location),
    );
  }, 90_000);

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

  it("rejects Bedford while its directly seeded projection differs from Version 1", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    await expectEngineError(
      service.proposeChangeSet({
        title: "Expected divergence",
        description: null,
        operations: [
          {
            op: "set_object",
            key: "proposal_probe",
            singular_label: "Proposal probe",
            plural_label: "Proposal probes",
            description: "",
            icon: null,
            is_active: true,
          },
        ],
      }),
      "configuration_projection_out_of_sync",
    );
  });

  it("materializes and stores one immutable complete candidate without changing the live projection or head", async () => {
    await synchronizeTestBaseline();
    const [version] = await sql<{ snapshot_json: Json }[]>`
      select version.snapshot_json
      from public.configuration_versions as version
      join public.business_configuration_heads as head
        on head.business_id = version.business_id
        and head.active_version_id = version.id
      where version.business_id = ${business.id}::uuid
    `;
    if (!version) {
      throw new Error("Could not load synchronized baseline.");
    }
    baselineSnapshot = asSnapshot(version.snapshot_json);
    operations = makeOperations(baselineSnapshot);
    liveSnapshotBeforeProposal = await currentLiveSnapshot();
    headBeforeProposal = await currentHead();

    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    proposal = await service.proposeChangeSet({
      title: "Saturday collection and catering enquiries",
      description: "A deterministic Phase 2A proposal.",
      operations,
    });

    expect(proposal).toMatchObject({
      base_head_revision: headBeforeProposal.head_revision,
      base_version_id: headBeforeProposal.active_version_id,
      business_id: business.id,
      kind: "change",
      operations_json: operations,
      operations_schema_version: 1,
      requested_by: owner.user.id,
      status: "proposed",
      validation_result_json: null,
      validated_at: null,
      validated_by: null,
      applied_at: null,
      applied_by: null,
      applied_version_id: null,
    });
    expect(proposal.candidate_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(await currentLiveSnapshot()).toEqual(liveSnapshotBeforeProposal);
    expect(await currentHead()).toEqual(headBeforeProposal);
    expect(
      Object.prototype.hasOwnProperty.call(
        asSnapshot(proposal.candidate_snapshot_json),
        "records",
      ),
    ).toBe(false);
  });

  it("allocates trusted stable IDs, preserves existing identities, and keeps canonical ordering", () => {
    const candidate = asSnapshot(proposal.candidate_snapshot_json);
    const allocations = proposal.id_allocations_json as JsonObject;
    const newObject = entity(candidate.object_definitions, "catering_enquiry");
    const existingCustomerBefore = entity(
      baselineSnapshot.object_definitions,
      "customer",
    );
    const existingCustomerAfter = entity(
      candidate.object_definitions,
      "customer",
    );

    expect(newObject).toMatchObject({
      id: allocations["object:catering_enquiry"],
      kind: "custom",
      semantic_type: null,
    });
    expect(allocations).not.toHaveProperty("object:customer");
    expect(existingCustomerAfter.id).toBe(existingCustomerBefore.id);
    expect(existingCustomerAfter.kind).toBe(existingCustomerBefore.kind);
    expect(existingCustomerAfter.semantic_type).toBe(
      existingCustomerBefore.semantic_type,
    );
    expect(entity(candidate.field_definitions, "phone").id).toBe(
      entity(baselineSnapshot.field_definitions, "phone").id,
    );

    const objectKeys = candidate.object_definitions.map(({ key }) => key);
    expect(objectKeys).toEqual(
      [...objectKeys].sort((left, right) =>
        String(left).localeCompare(String(right), "en"),
      ),
    );
    const untouchedOrderBefore = entity(
      baselineSnapshot.object_definitions,
      "order",
    );
    expect(entity(candidate.object_definitions, "order")).toEqual(
      untouchedOrderBefore,
    );
  });

  it("replays stored allocations exactly and is independent of operation order", async () => {
    const [replayed] = await sql<
      {
        candidate_checksum: string;
        candidate_snapshot: string;
        id_allocations: string;
        semantic_diff: string;
      }[]
    >`
      select
        materialized.result ->> 'candidate_checksum'
          as candidate_checksum,
        (materialized.result -> 'candidate_snapshot')::text
          as candidate_snapshot,
        (materialized.result -> 'id_allocations')::text
          as id_allocations,
        (materialized.result -> 'semantic_diff')::text
          as semantic_diff
      from (
        select private.configuration_materialize_candidate_v1(
          ${business.id}::uuid,
          ${sql.json(baselineSnapshot as unknown as Json)}::jsonb,
          ${sql.json([...operations].reverse() as unknown as Json)}::jsonb,
          ${sql.json(proposal.id_allocations_json)}::jsonb
        ) as result
      ) as materialized
    `;
    if (!replayed) {
      throw new Error("Candidate replay returned no row.");
    }
    expect(JSON.parse(replayed.candidate_snapshot)).toEqual(
      proposal.candidate_snapshot_json,
    );
    expect(replayed.candidate_checksum).toBe(proposal.candidate_checksum);
    expect(JSON.parse(replayed.id_allocations)).toEqual(
      proposal.id_allocations_json,
    );
    expect(JSON.parse(replayed.semantic_diff)).toEqual(
      proposal.semantic_diff_json,
    );
  });

  it("stores a deterministic owner-readable semantic diff for all four classifications", () => {
    const diff = semanticDiffSchema.parse(proposal.semantic_diff_json);
    expect(diff.counts).toMatchObject({
      created: expect.any(Number),
      updated: expect.any(Number),
      archived: expect.any(Number),
      restored: expect.any(Number),
    });
    expect(diff.counts.created).toBeGreaterThan(0);
    expect(diff.counts.updated).toBeGreaterThan(0);
    expect(diff.counts.archived).toBeGreaterThan(0);
    expect(diff.counts.restored).toBeGreaterThan(0);

    const phone = diff.changes.find(
      (change) => change.entity_key === "customer.phone",
    );
    expect(phone).toMatchObject({
      change_type: "updated",
      entity_type: "field",
      label: "Phone",
    });
    expect(phone?.properties).toContainEqual({
      property: "required",
      before: false,
      after: true,
    });
    const page = diff.changes.find(
      (change) => change.entity_key === "public_preorder",
    );
    expect(page?.properties).toContainEqual({
      property: "status",
      before: "published",
      after: "draft",
    });
    const preorder = diff.changes.find(
      (change) => change.entity_type === "preorder_experience",
    );
    expect(preorder?.properties).toEqual(
      expect.arrayContaining([
        {
          property: "schedule.days_of_week",
          before: [6, 7],
          after: [6],
        },
        {
          property: "schedule.slot_capacity",
          before: 10,
          after: 4,
        },
        expect.objectContaining({ property: "public_fields" }),
      ]),
    );
    expect(
      diff.changes.find(
        (change) =>
          change.entity_type === "preorder_location" &&
          change.change_type === "archived",
      ),
    ).toMatchObject({ label: "Milton Keynes" });
    expect(diff.changes.map(({ entity_key }) => entity_key)).toEqual(
      diff.changes
        .map(({ entity_key }) => entity_key)
        .sort((left, right) => {
          const leftChange = diff.changes.find(
            (change) => change.entity_key === left,
          );
          const rightChange = diff.changes.find(
            (change) => change.entity_key === right,
          );
          const ranks = [
            "object",
            "field",
            "relationship",
            "view",
            "form",
            "page",
            "preorder_experience",
            "preorder_location",
          ];
          const rank =
            ranks.indexOf(leftChange?.entity_type ?? "") -
            ranks.indexOf(rightChange?.entity_type ?? "");
          return rank || left.localeCompare(right, "en");
        }),
    );
  });

  it("rejects caller-controlled IDs and immutable identity replacement", async () => {
    const raw = owner.client as SupabaseClient<Database>;
    const relationship = entity(
      baselineSnapshot.relationship_definitions,
      "customer_places_order",
    );
    const view = entity(baselineSnapshot.views, "orders");
    const form = entity(baselineSnapshot.forms, "order_status_edit");
    const preorder = entity(
      baselineSnapshot.preorder_experiences,
      "bakery_preorder",
    );
    const baseProposal = {
      expected_business_id: business.id,
      requested_description: "",
      requested_title: "Rejected identity replacement",
    };

    const forbiddenId = await raw.rpc("propose_configuration_change", {
      ...baseProposal,
      requested_operations: [
        {
          ...operations[0],
          id: requiredString(
            entity(baselineSnapshot.object_definitions, "customer").id,
            "Customer ID",
          ),
          kind: "template",
        },
      ] as unknown as Json,
    });
    expect(forbiddenId.error?.message).toContain(
      "configuration_set_object_invalid",
    );

    const customerPhone = entity(
      baselineSnapshot.field_definitions.filter(
        (field) => field.object_key === "customer",
      ),
      "phone",
    );
    const fieldReparent = await raw.rpc("propose_configuration_change", {
      ...baseProposal,
      requested_operations: [
        {
          op: "set_field",
          id: customerPhone.id,
          object_key: "product",
          key: "phone",
          label: customerPhone.label,
          field_type: customerPhone.field_type,
          required: customerPhone.required,
          default_value: customerPhone.default_value,
          settings_json: customerPhone.settings_json,
          position: customerPhone.position,
          is_active: customerPhone.is_active,
        },
      ] as Json,
    });
    expect(fieldReparent.error?.message).toContain(
      "configuration_set_field_invalid",
    );

    const relationshipReplacement = await raw.rpc(
      "propose_configuration_change",
      {
        ...baseProposal,
        requested_operations: [
          {
            op: "set_relationship",
            key: relationship.key,
            source_object_key: "product",
            target_object_key: relationship.target_object_key,
            source_label: relationship.source_label,
            target_label: relationship.target_label,
            cardinality: relationship.cardinality,
            is_required: relationship.is_required,
            is_active: relationship.is_active,
          },
        ] as Json,
      },
    );
    expect(relationshipReplacement.error?.message).toContain(
      "configuration_relationship_endpoints_immutable",
    );

    for (const requestedOperations of [
      [
        {
          op: "set_view",
          key: view.key,
          name: view.name,
          view_type: view.view_type,
          object_key: "customer",
          config_json: { fields: ["name"], include_archived: false },
          audience: view.audience,
          is_active: view.is_active,
        },
      ],
      [
        {
          op: "set_form",
          key: form.key,
          name: form.name,
          object_key: "customer",
          mode: form.mode,
          config_json: form.config_json,
          audience: form.audience,
          is_active: form.is_active,
        },
      ],
      [
        {
          op: "set_form",
          key: form.key,
          name: form.name,
          object_key: form.object_key,
          mode: "create",
          config_json: form.config_json,
          audience: form.audience,
          is_active: form.is_active,
        },
      ],
      [
        {
          ...operations.find(
            (operation) => operation.op === "set_preorder_experience",
          ),
          product_object_key: "customer",
          key: preorder.key,
        },
      ],
    ]) {
      const rejected = await raw.rpc("propose_configuration_change", {
        ...baseProposal,
        requested_operations: requestedOperations as Json,
      });
      expect(rejected.error?.message).toMatch(
        /configuration_(view_object|form_identity|preorder_graph_references)_immutable/,
      );
    }
  });

  it("rejects structurally impossible references and cross-Business Location mixing", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    await expectEngineError(
      service.proposeChangeSet({
        title: "Missing Object",
        description: null,
        operations: [
          {
            op: "set_field",
            object_key: "missing_object",
            key: "name",
            label: "Name",
            field_type: "short_text",
            required: false,
            default_value: null,
            settings_json: {},
            position: 0,
            is_active: true,
          },
        ],
      }),
      "configuration_field_object_missing",
    );

    const preorderOperation = operations.find(
      (operation) => operation.op === "set_preorder_experience",
    );
    if (
      !preorderOperation ||
      preorderOperation.op !== "set_preorder_experience"
    ) {
      throw new Error("Missing preorder operation.");
    }
    await expectEngineError(
      service.proposeChangeSet({
        title: "Cross-tenant Location",
        description: null,
        operations: [
          {
            ...preorderOperation,
            allowed_location_ids: [otherLocation.id],
          },
        ],
      }),
      "configuration_preorder_location_invalid",
    );
  });

  it("allows Owner/Admin read and abandonment but denies Staff and cross-Business access", async () => {
    const ownerService = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const adminService = new ConfigurationChangeService(administrator.client, {
      actorId: administrator.user.id,
      businessId: business.id,
    });
    const staffService = new ConfigurationChangeService(staff.client, {
      actorId: staff.user.id,
      businessId: business.id,
    });
    const otherService = new ConfigurationChangeService(otherOwner.client, {
      actorId: otherOwner.user.id,
      businessId: business.id,
    });

    expect(await ownerService.getChangeSet(proposal.id)).toEqual(proposal);
    expect((await adminService.listChangeSets()).map(({ id }) => id)).toContain(
      proposal.id,
    );
    await expectEngineError(
      staffService.getChangeSet(proposal.id),
      "configuration_owner_or_admin_required",
    );
    await expectEngineError(
      otherService.getChangeSet(proposal.id),
      "configuration_owner_or_admin_required",
    );
    await expectEngineError(
      staffService.proposeChangeSet({
        title: "Staff proposal",
        description: null,
        operations: [
          setObjectFrom(
            entity(baselineSnapshot.object_definitions, "archive_probe"),
            true,
          ),
        ],
      }),
      "configuration_owner_or_admin_required",
    );
    const adminProposal = await adminService.proposeChangeSet({
      title: "Admin proposal",
      description: null,
      operations: [
        setObjectFrom(
          entity(baselineSnapshot.object_definitions, "archive_probe"),
          true,
        ),
      ],
    });
    expect(adminProposal.requested_by).toBe(administrator.user.id);

    const liveBefore = await currentLiveSnapshot();
    const headBefore = await currentHead();
    const abandoned = await adminService.abandonChangeSet(proposal.id);
    expect(abandoned).toMatchObject({
      closed_by: administrator.user.id,
      status: "abandoned",
    });
    expect(await currentLiveSnapshot()).toEqual(liveBefore);
    expect(await currentHead()).toEqual(headBefore);
    await expectEngineError(
      ownerService.abandonChangeSet(proposal.id),
      "configuration_change_set_not_abandonable",
    );
  });

  it("denies direct authenticated change-set insert, update, and delete", async () => {
    const inserted = await owner.client
      .from("configuration_change_sets")
      .insert({ ...proposal, id: crypto.randomUUID() });
    expect(inserted.error).not.toBeNull();
    const updated = await owner.client
      .from("configuration_change_sets")
      .update({ title: "Caller-controlled edit" })
      .eq("id", proposal.id);
    expect(updated.error).not.toBeNull();
    const deleted = await owner.client
      .from("configuration_change_sets")
      .delete()
      .eq("id", proposal.id);
    expect(deleted.error).not.toBeNull();
  });
});
