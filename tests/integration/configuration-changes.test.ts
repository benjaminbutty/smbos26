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
  configurationDisplayContextSchema,
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
let compatibilityRecordId: string;

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
): Extract<ConfigurationOperation, { op: "set_object" }> {
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

function setFieldFrom(
  configuredField: JsonObject,
  overrides: Partial<Extract<ConfigurationOperation, { op: "set_field" }>> = {},
): Extract<ConfigurationOperation, { op: "set_field" }> {
  return {
    op: "set_field",
    object_key: requiredString(configuredField.object_key, "Field Object key"),
    key: requiredString(configuredField.key, "Field key"),
    label: requiredString(configuredField.label, "Field label"),
    field_type: requiredString(
      configuredField.field_type,
      "Field type",
    ) as Extract<ConfigurationOperation, { op: "set_field" }>["field_type"],
    required: requiredBoolean(configuredField.required, "Field required"),
    default_value: configuredField.default_value ?? null,
    settings_json: (configuredField.settings_json ?? {}) as Record<
      string,
      Json
    >,
    position: Number(configuredField.position),
    is_active: requiredBoolean(configuredField.is_active, "Field active"),
    ...overrides,
  };
}

function setRelationshipFrom(
  configuredRelationship: JsonObject,
  overrides: Partial<
    Extract<ConfigurationOperation, { op: "set_relationship" }>
  > = {},
): Extract<ConfigurationOperation, { op: "set_relationship" }> {
  return {
    op: "set_relationship",
    key: requiredString(configuredRelationship.key, "Relationship key"),
    source_object_key: requiredString(
      configuredRelationship.source_object_key,
      "Relationship source Object",
    ),
    target_object_key: requiredString(
      configuredRelationship.target_object_key,
      "Relationship target Object",
    ),
    source_label: requiredString(
      configuredRelationship.source_label,
      "Relationship source label",
    ),
    target_label: requiredString(
      configuredRelationship.target_label,
      "Relationship target label",
    ),
    cardinality: requiredString(
      configuredRelationship.cardinality,
      "Relationship cardinality",
    ) as Extract<
      ConfigurationOperation,
      { op: "set_relationship" }
    >["cardinality"],
    is_required: requiredBoolean(
      configuredRelationship.is_required,
      "Relationship required",
    ),
    is_active: requiredBoolean(
      configuredRelationship.is_active,
      "Relationship active",
    ),
    ...overrides,
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

describe("Milestone 5 Phase 2A proposals and Phase 2B validation", () => {
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
      {
        business_id: business.id,
        key: "compatibility_probe",
        singular_label: "Compatibility probe",
        plural_label: "Compatibility probes",
        description: "",
        kind: "custom",
        is_active: true,
      },
      {
        business_id: business.id,
        key: "compatibility_child",
        singular_label: "Compatibility child",
        plural_label: "Compatibility children",
        description: "",
        kind: "custom",
        is_active: true,
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

    const configuredObjects = requireData(
      await admin
        .from("object_definitions")
        .select("*")
        .eq("business_id", business.id)
        .in("key", ["compatibility_probe", "compatibility_child"]),
      "Could not load compatibility Objects",
    );
    const probeObject = configuredObjects.find(
      ({ key }) => key === "compatibility_probe",
    );
    const childObject = configuredObjects.find(
      ({ key }) => key === "compatibility_child",
    );
    if (!probeObject || !childObject) {
      throw new Error("Missing compatibility Objects.");
    }

    const fixtureFields = await owner.client.from("field_definitions").insert([
      {
        business_id: business.id,
        object_definition_id: probeObject.id,
        key: "value",
        label: "Value",
        field_type: "short_text",
        required: true,
        settings_json: {},
        position: 0,
      },
      {
        business_id: business.id,
        object_definition_id: probeObject.id,
        key: "category",
        label: "Category",
        field_type: "select",
        required: false,
        settings_json: { options: ["Alpha", "Beta"] },
        position: 1,
      },
      {
        business_id: business.id,
        object_definition_id: childObject.id,
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        settings_json: {},
        position: 0,
      },
    ]);
    if (fixtureFields.error) {
      throw fixtureFields.error;
    }

    const relationship = requireData(
      await owner.client
        .from("relationship_definitions")
        .insert({
          business_id: business.id,
          key: "compatibility_probe_has_child",
          source_object_definition_id: probeObject.id,
          target_object_definition_id: childObject.id,
          source_label: "Children",
          target_label: "Probe",
          cardinality: "one_to_many",
          is_required: false,
          is_active: true,
        })
        .select()
        .single(),
      "Could not create compatibility Relationship",
    );
    const probeRecord = requireData(
      await owner.client.rpc("create_graph_record", {
        expected_business_id: business.id,
        target_object_definition_id: probeObject.id,
        requested_data: { value: "stored", category: "Beta" },
      }),
      "Could not create compatibility Record",
    );
    compatibilityRecordId = probeRecord.id;
    const childRecord = requireData(
      await owner.client.rpc("create_graph_record", {
        expected_business_id: business.id,
        target_object_definition_id: childObject.id,
        requested_data: { name: "Stored child" },
      }),
      "Could not create compatibility child Record",
    );
    requireData(
      await owner.client.rpc("create_graph_relationship", {
        expected_business_id: business.id,
        target_relationship_definition_id: relationship.id,
        target_source_record_id: probeRecord.id,
        target_target_record_id: childRecord.id,
      }),
      "Could not create compatibility edge",
    );

    const form = requireData(
      await owner.client
        .from("forms")
        .insert({
          business_id: business.id,
          key: "compatibility_probe_create",
          name: "New compatibility probe",
          object_definition_id: probeObject.id,
          mode: "create",
          config_json: {
            fields: [{ field: "value" }, { field: "category" }],
          },
          audience: "internal",
          is_active: true,
        })
        .select()
        .single(),
      "Could not create compatibility Form",
    );
    const view = requireData(
      await owner.client
        .from("views")
        .insert({
          business_id: business.id,
          key: "compatibility_probes",
          name: "Compatibility probes",
          object_definition_id: probeObject.id,
          view_type: "table",
          config_json: {
            fields: ["value", "category"],
            create_form_key: form.key,
            include_archived: false,
          },
          audience: "internal",
          is_active: true,
        })
        .select()
        .single(),
      "Could not create compatibility View",
    );
    const fixturePage = await owner.client.from("pages").insert({
      business_id: business.id,
      key: "compatibility_workspace",
      title: "Compatibility workspace",
      slug: "compatibility-workspace",
      audience: "internal",
      layout_json: {
        blocks: [
          { type: "view", view_key: view.key },
          { type: "form", form_key: form.key },
        ],
      },
      status: "draft",
      is_active: true,
    });
    if (fixturePage.error) {
      throw fixturePage.error;
    }
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
    const displayContext = configurationDisplayContextSchema.parse(
      proposal.display_context_json,
    );
    expect(displayContext).toEqual({
      schema_version: 1,
      locations: {
        [locationsByName.get("Bedford")?.id ?? ""]: { name: "Bedford" },
        [locationsByName.get("Milton Keynes")?.id ?? ""]: {
          name: "Milton Keynes",
        },
      },
    });
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
          ${sql.json(proposal.id_allocations_json)}::jsonb,
          ${sql.json(proposal.display_context_json)}::jsonb
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

  it("verifies actor context before mutation and rejects no-op proposals", async () => {
    const [before] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_change_sets
      where business_id = ${business.id}::uuid
    `;
    if (!before) {
      throw new Error("Could not count configuration proposals.");
    }

    const mismatched = await owner.client.rpc("propose_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: staff.user.id,
      requested_title: "Mismatched actor",
      requested_description: null as unknown as string,
      requested_operations: [
        {
          ...setObjectFrom(
            entity(baselineSnapshot.object_definitions, "archive_probe"),
            true,
          ),
          singular_label: "Mismatched actor probe",
        },
      ],
    });
    expect(mismatched.error?.message).toContain(
      "configuration_actor_context_mismatch",
    );

    const ownerService = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const unchangedCustomer = entity(
      baselineSnapshot.object_definitions,
      "customer",
    );
    await expectEngineError(
      ownerService.proposeChangeSet({
        title: "Repeat existing state",
        description: null,
        operations: [
          setObjectFrom(
            unchangedCustomer,
            requiredBoolean(
              unchangedCustomer.is_active,
              "Customer active state",
            ),
          ),
        ],
      }),
      "configuration_proposal_no_changes",
    );

    const abandonTarget = await ownerService.proposeChangeSet({
      title: "Actor-safe abandonment",
      description: null,
      operations: [
        {
          ...setObjectFrom(
            entity(baselineSnapshot.object_definitions, "archive_probe"),
            true,
          ),
          singular_label: "Actor-safe probe",
        },
      ],
    });
    const wrongAbandon = await owner.client.rpc(
      "abandon_configuration_change_set",
      {
        expected_business_id: business.id,
        expected_actor_id: staff.user.id,
        requested_change_set_id: abandonTarget.id,
      },
    );
    expect(wrongAbandon.error?.message).toContain(
      "configuration_actor_context_mismatch",
    );
    const wrongValidation = await owner.client.rpc(
      "validate_configuration_change",
      {
        expected_business_id: business.id,
        expected_actor_id: staff.user.id,
        requested_change_set_id: abandonTarget.id,
      },
    );
    expect(wrongValidation.error?.message).toContain(
      "configuration_actor_context_mismatch",
    );
    expect((await ownerService.getChangeSet(abandonTarget.id)).status).toBe(
      "proposed",
    );

    const [after] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_change_sets
      where business_id = ${business.id}::uuid
    `;
    expect(after?.count).toBe(before.count + 1);
  });

  it("validates a compatible multi-entity candidate with active Locations invisibly and releases every sandbox lock", async () => {
    const ownerService = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const snapshotBefore = await currentLiveSnapshot();
    const headBefore = await currentHead();
    const recordBefore = requireData(
      await admin
        .from("records")
        .select("*")
        .eq("id", compatibilityRecordId)
        .single(),
      "Could not load compatibility Record",
    );
    const [versionCountBefore] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_versions
      where business_id = ${business.id}::uuid
    `;
    const [walBefore] = await sql<{ lsn: string }[]>`
      select pg_current_wal_lsn()::text as lsn
    `;
    const advisoryKey = 5200260728;
    const blocker = postgres(settings.databaseUrl, { max: 1 });
    let validationPromise:
      | Promise<Awaited<ReturnType<typeof ownerService.validateChangeSet>>>
      | undefined;

    try {
      await sql`
        create function private.test_pause_configuration_projector()
        returns trigger
        language plpgsql
        set search_path = ''
        as $$
        begin
          if old.is_active and not new.is_active then
            perform pg_advisory_xact_lock(5200260728);
          end if;
          return new;
        end;
        $$
      `;
      await sql`
        create trigger test_pause_configuration_projector
        before update on public.pages
        for each row execute function
          private.test_pause_configuration_projector()
      `;

      await blocker.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(${advisoryKey})`;
        validationPromise = ownerService.validateChangeSet(proposal.id);

        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
          const [lock] = await sql<{ waiting: boolean }[]>`
            select exists (
              select 1
              from pg_locks
              where locktype = 'advisory'
                and not granted
            ) as waiting
          `;
          waiting = lock?.waiting ?? false;
          if (!waiting) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        expect(waiting).toBe(true);

        const visiblePage = requireData(
          await admin
            .from("pages")
            .select("is_active, slug")
            .eq("business_id", business.id)
            .eq("key", "public_preorder")
            .single(),
          "Could not inspect the live Page during validation",
        );
        expect(visiblePage).toMatchObject({
          is_active: true,
          slug: "preorder",
        });
      });
      if (!validationPromise) {
        throw new Error("Validation did not start.");
      }
      proposal = await validationPromise;
    } finally {
      await blocker.end();
      await sql`
        drop trigger if exists test_pause_configuration_projector
        on public.pages
      `;
      await sql`
        drop function if exists
          private.test_pause_configuration_projector()
      `;
    }

    expect({
      status: proposal.status,
      validation: proposal.validation_result_json,
    }).toMatchObject({
      status: "validated",
      validation: { outcome: "valid" },
    });
    expect(proposal.validation_result_json).toMatchObject({
      schema_version: 1,
      outcome: "valid",
      base_version_id: proposal.base_version_id,
      base_head_revision: proposal.base_head_revision,
      candidate_checksum: proposal.candidate_checksum,
      errors: [],
      warnings: [],
    });
    expect(await currentLiveSnapshot()).toEqual(snapshotBefore);
    expect(await currentHead()).toEqual(headBefore);
    const [versionCountAfter] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_versions
      where business_id = ${business.id}::uuid
    `;
    expect(versionCountAfter?.count).toBe(versionCountBefore?.count);
    expect(
      requireData(
        await admin
          .from("records")
          .select("*")
          .eq("id", compatibilityRecordId)
          .single(),
        "Could not reload compatibility Record",
      ),
    ).toEqual(recordBefore);

    const validatedAt = proposal.validated_at;
    const retried = await ownerService.validateChangeSet(proposal.id);
    expect(retried.status).toBe("validated");
    expect(retried.validated_at).toBe(validatedAt);
    expect(retried.validation_result_json).toEqual(
      proposal.validation_result_json,
    );

    await sql.begin(async (transaction) => {
      await transaction.unsafe("set local lock_timeout = '1s'");
      await transaction`
        select id
        from public.pages
        where business_id = ${business.id}::uuid
        order by id
        for update
      `;
    });
    const [walAfter] = await sql<{ bytes: number }[]>`
      select pg_wal_lsn_diff(
        pg_current_wal_lsn(),
        ${walBefore?.lsn ?? "0/0"}::pg_lsn
      )::bigint::float8 as bytes
    `;
    expect(walAfter?.bytes).toBeGreaterThan(0);
  });

  it("rejects incompatible Records, required Fields, options, and Relationship shape without changing live state", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const valueField = entity(
      baselineSnapshot.field_definitions.filter(
        (field) => field.object_key === "compatibility_probe",
      ),
      "value",
    );
    const categoryField = entity(
      baselineSnapshot.field_definitions.filter(
        (field) => field.object_key === "compatibility_probe",
      ),
      "category",
    );
    const relationship = entity(
      baselineSnapshot.relationship_definitions,
      "compatibility_probe_has_child",
    );
    const createForm = entity(
      baselineSnapshot.forms,
      "compatibility_probe_create",
    );
    const snapshotBefore = await currentLiveSnapshot();
    const headBefore = await currentHead();
    const recordBefore = requireData(
      await admin
        .from("records")
        .select("*")
        .eq("id", compatibilityRecordId)
        .single(),
      "Could not load compatibility Record before rejection",
    );

    const cases: {
      title: string;
      operations: ConfigurationOperation[];
      expectedCode: string;
    }[] = [
      {
        title: "Incompatible populated Field type",
        operations: [setFieldFrom(valueField, { field_type: "number" })],
        expectedCode: "existing_records_incompatible",
      },
      {
        title: "Required Field without existing values",
        operations: [
          {
            op: "set_field",
            object_key: "compatibility_probe",
            key: "required_later",
            label: "Required later",
            field_type: "short_text",
            required: true,
            default_value: null,
            settings_json: {},
            position: 2,
            is_active: true,
          },
          {
            op: "set_form",
            key: requiredString(createForm.key, "Form key"),
            name: requiredString(createForm.name, "Form name"),
            object_key: requiredString(createForm.object_key, "Form Object"),
            mode: "create",
            config_json: {
              fields: [
                { field: "value", hidden: false },
                { field: "category", hidden: false },
                { field: "required_later", hidden: false },
              ],
            },
            audience: "internal",
            is_active: true,
          },
        ],
        expectedCode: "existing_records_incompatible",
      },
      {
        title: "Remove a selected option",
        operations: [
          setFieldFrom(categoryField, {
            settings_json: { options: ["Alpha"] },
          }),
        ],
        expectedCode: "existing_records_incompatible",
      },
      {
        title: "Change a populated Relationship shape",
        operations: [
          setRelationshipFrom(relationship, {
            cardinality: "one_to_one",
          }),
        ],
        expectedCode: "existing_relationships_incompatible",
      },
    ];

    for (const testCase of cases) {
      const changeSet = await service.proposeChangeSet({
        title: testCase.title,
        description: null,
        operations: testCase.operations,
      });
      const rejected = await service.validateChangeSet(changeSet.id);
      expect(rejected.status).toBe("rejected");
      expect(rejected.validation_result_json).toMatchObject({
        outcome: "invalid",
        errors: [
          {
            code: testCase.expectedCode,
          },
        ],
      });
      expect(rejected.validated_by).toBe(owner.user.id);
      expect(rejected.closed_by).toBe(owner.user.id);
      expect(rejected.validated_at).toBe(rejected.closed_at);
      expect(await currentLiveSnapshot()).toEqual(snapshotBefore);
      expect(await currentHead()).toEqual(headBefore);
      await expectEngineError(
        service.validateChangeSet(changeSet.id),
        "configuration_change_set_not_validatable",
      );
    }
    expect(
      requireData(
        await admin
          .from("records")
          .select("*")
          .eq("id", compatibilityRecordId)
          .single(),
        "Could not reload compatibility Record after rejection",
      ),
    ).toEqual(recordBefore);
  });

  it("defensively rejects invalid View, Form, Page, and preorder candidates inside the sandbox", async () => {
    const baseCandidate = asSnapshot(proposal.candidate_snapshot_json);
    const tamperedCandidates: {
      candidate: SnapshotV1;
      expectedCode: string;
    }[] = [];

    const invalidView = structuredClone(baseCandidate);
    entity(invalidView.views, "catering_enquiries").config_json = {
      fields: ["missing_field"],
      include_archived: false,
    };
    tamperedCandidates.push({
      candidate: invalidView,
      expectedCode: "experience_configuration_incompatible",
    });

    const invalidForm = structuredClone(baseCandidate);
    entity(invalidForm.forms, "catering_enquiry_create").config_json = {
      fields: [{ field: "missing_field" }],
    };
    tamperedCandidates.push({
      candidate: invalidForm,
      expectedCode: "experience_configuration_incompatible",
    });

    const invalidPage = structuredClone(baseCandidate);
    entity(invalidPage.pages, "catering_workspace").layout_json = {
      blocks: [{ type: "view", view_key: "missing_view" }],
    };
    tamperedCandidates.push({
      candidate: invalidPage,
      expectedCode: "page_configuration_incompatible",
    });

    const invalidPreorder = structuredClone(baseCandidate);
    const preorder = entity(
      invalidPreorder.preorder_experiences,
      "bakery_preorder",
    );
    const config = structuredClone(preorder.config_json) as JsonObject;
    const mappings = config.field_mappings as JsonObject;
    const product = mappings.product as JsonObject;
    product.price = "missing_price";
    preorder.config_json = config;
    tamperedCandidates.push({
      candidate: invalidPreorder,
      expectedCode: "preorder_configuration_incompatible",
    });

    const snapshotBefore = await currentLiveSnapshot();
    for (const testCase of tamperedCandidates) {
      const [result] = await sql<{ result: JsonObject }[]>`
        select private.validate_configuration_candidate_in_sandbox_v1(
          ${business.id}::uuid,
          ${proposal.base_version_id}::uuid,
          ${proposal.base_head_revision}::bigint,
          ${proposal.candidate_checksum},
          ${sql.json(testCase.candidate as unknown as Json)}::jsonb
        ) as result
      `;
      expect(result?.result).toMatchObject({
        outcome: "invalid",
        errors: [{ code: testCase.expectedCode }],
      });
      expect(await currentLiveSnapshot()).toEqual(snapshotBefore);
    }
  });

  it("replays proposal-time Location labels without live Location-name read after rename", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const preorderOperation = operations.find(
      (operation) => operation.op === "set_preorder_experience",
    );
    const bedford = locationsByName.get("Bedford");
    const miltonKeynes = locationsByName.get("Milton Keynes");
    if (
      !preorderOperation ||
      preorderOperation.op !== "set_preorder_experience" ||
      !bedford ||
      !miltonKeynes
    ) {
      throw new Error("Missing preorder operation or demo Locations.");
    }

    const changeSet = await service.proposeChangeSet({
      title: "Milton Keynes collection only",
      description: null,
      operations: [
        {
          ...preorderOperation,
          allowed_location_ids: [miltonKeynes.id],
        },
      ],
    });
    expect(
      configurationDisplayContextSchema.parse(changeSet.display_context_json)
        .locations,
    ).toEqual({
      [bedford.id]: { name: "Bedford" },
      [miltonKeynes.id]: { name: "Milton Keynes" },
    });
    expect(
      semanticDiffSchema
        .parse(changeSet.semantic_diff_json)
        .changes.find(
          ({ entity_key, entity_type }) =>
            entity_type === "preorder_location" &&
            entity_key.endsWith(`:${bedford.id}`),
        ),
    ).toMatchObject({
      change_type: "archived",
      label: "Bedford",
    });

    const snapshotBefore = await currentLiveSnapshot();
    const headBefore = await currentHead();
    const [versionCountBefore] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_versions
      where business_id = ${business.id}::uuid
    `;
    const replayRole = "m5_display_context_replay";
    let replayRoleCreated = false;
    let renameRestoreError: unknown;
    try {
      const renamed = await owner.client
        .from("locations")
        .update({ name: "Bedford Central" })
        .eq("business_id", business.id)
        .eq("id", bedford.id);
      if (renamed.error) {
        throw renamed.error;
      }

      await sql.unsafe(`create role ${replayRole} nologin`);
      replayRoleCreated = true;
      await sql.unsafe(`grant ${replayRole} to postgres`);
      await sql.unsafe(`grant usage on schema private to ${replayRole}`);
      await sql.unsafe(`grant usage on schema extensions to ${replayRole}`);
      await sql.unsafe(
        `grant execute on all functions in schema private to ${replayRole}`,
      );
      const [permission] = await sql<{ can_read_location_names: boolean }[]>`
        select has_table_privilege(
          ${replayRole},
          'public.locations',
          'select'
        ) as can_read_location_names
      `;
      expect(permission?.can_read_location_names).toBe(false);

      const replayed = await sql.begin(async (transaction) => {
        await transaction.unsafe(`set local role ${replayRole}`);
        const [result] = await transaction<
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
              ${sql.json(changeSet.operations_json)}::jsonb,
              ${sql.json(changeSet.id_allocations_json)}::jsonb,
              ${sql.json(changeSet.display_context_json)}::jsonb
            ) as result
          ) as materialized
        `;
        return result;
      });
      if (!replayed) {
        throw new Error("Renamed-Location replay returned no row.");
      }
      expect(JSON.parse(replayed.candidate_snapshot)).toEqual(
        changeSet.candidate_snapshot_json,
      );
      expect(replayed.candidate_checksum).toBe(changeSet.candidate_checksum);
      expect(JSON.parse(replayed.id_allocations)).toEqual(
        changeSet.id_allocations_json,
      );
      expect(JSON.parse(replayed.semantic_diff)).toEqual(
        changeSet.semantic_diff_json,
      );
      expect(
        semanticDiffSchema
          .parse(changeSet.semantic_diff_json)
          .changes.find(
            ({ entity_key, entity_type }) =>
              entity_type === "preorder_location" &&
              entity_key.endsWith(`:${bedford.id}`),
          )?.label,
      ).toBe("Bedford");

      const validated = await service.validateChangeSet(changeSet.id);
      expect(validated).toMatchObject({
        status: "validated",
        validation_result_json: { outcome: "valid" },
      });
      expect(await currentLiveSnapshot()).toEqual(snapshotBefore);
      expect(await currentHead()).toEqual(headBefore);
      const [versionCountAfter] = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.configuration_versions
        where business_id = ${business.id}::uuid
      `;
      expect(versionCountAfter?.count).toBe(versionCountBefore?.count);
    } finally {
      if (replayRoleCreated) {
        await sql.unsafe(`revoke ${replayRole} from postgres`);
        await sql.unsafe(
          `revoke execute on all functions in schema private from ${replayRole}`,
        );
        await sql.unsafe(
          `revoke usage on schema extensions from ${replayRole}`,
        );
        await sql.unsafe(`revoke usage on schema private from ${replayRole}`);
        await sql.unsafe(`drop role ${replayRole}`);
      }
      const restored = await owner.client
        .from("locations")
        .update({ name: "Bedford" })
        .eq("business_id", business.id)
        .eq("id", bedford.id);
      renameRestoreError = restored.error;
    }
    if (renameRestoreError) {
      throw renameRestoreError;
    }
  });

  it("replays immutably and rejects without updating a Location that became inactive after proposal", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const preorderOperation = operations.find(
      (operation) => operation.op === "set_preorder_experience",
    );
    if (
      !preorderOperation ||
      preorderOperation.op !== "set_preorder_experience"
    ) {
      throw new Error("Missing preorder operation.");
    }
    const changeSet = await service.proposeChangeSet({
      title: "Location eligibility recheck",
      description: null,
      operations: [
        {
          ...preorderOperation,
          config_json: {
            ...preorderOperation.config_json,
            schedule: {
              ...preorderOperation.config_json.schedule,
              slot_capacity: 9,
            },
          },
        },
      ],
    });
    const bedford = locationsByName.get("Bedford");
    if (!bedford) {
      throw new Error("Missing Bedford Location.");
    }
    const snapshotBefore = await currentLiveSnapshot();
    const headBefore = await currentHead();
    const [versionCountBefore] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_versions
      where business_id = ${business.id}::uuid
    `;
    let locationRestoreError: unknown;

    try {
      const archived = await owner.client
        .from("locations")
        .update({ is_active: false })
        .eq("business_id", business.id)
        .eq("id", bedford.id);
      if (archived.error) {
        throw archived.error;
      }

      await sql`
        create function private.test_reject_location_update()
        returns trigger
        language plpgsql
        set search_path = ''
        as $$
        begin
          raise exception 'test_location_update_attempted'
            using errcode = 'P0001';
        end;
        $$
      `;
      await sql`
        create trigger test_reject_location_update
        before update on public.locations
        for each row execute function private.test_reject_location_update()
      `;

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
            (
              select version.snapshot_json
              from public.configuration_versions as version
              where version.business_id = ${business.id}::uuid
                and version.id = ${changeSet.base_version_id}::uuid
            ),
            ${sql.json(changeSet.operations_json)}::jsonb,
            ${sql.json(changeSet.id_allocations_json)}::jsonb,
            ${sql.json(changeSet.display_context_json)}::jsonb
          ) as result
        ) as materialized
      `;
      if (!replayed) {
        throw new Error("Inactive-Location replay returned no row.");
      }
      expect(JSON.parse(replayed.candidate_snapshot)).toEqual(
        changeSet.candidate_snapshot_json,
      );
      expect(replayed.candidate_checksum).toBe(changeSet.candidate_checksum);
      expect(JSON.parse(replayed.id_allocations)).toEqual(
        changeSet.id_allocations_json,
      );
      expect(JSON.parse(replayed.semantic_diff)).toEqual(
        changeSet.semantic_diff_json,
      );

      const rejected = await service.validateChangeSet(changeSet.id);
      expect(rejected.status).toBe("rejected");
      expect(rejected.validation_result_json).toMatchObject({
        outcome: "invalid",
        errors: [{ code: "location_ineligible" }],
      });
      expect(
        requireData(
          await admin
            .from("locations")
            .select("is_active")
            .eq("business_id", business.id)
            .eq("id", bedford.id)
            .single(),
          "Could not reload the inactive Location",
        ).is_active,
      ).toBe(false);
      expect(await currentLiveSnapshot()).toEqual(snapshotBefore);
      expect(await currentHead()).toEqual(headBefore);
      const [versionCountAfter] = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from public.configuration_versions
        where business_id = ${business.id}::uuid
      `;
      expect(versionCountAfter?.count).toBe(versionCountBefore?.count);
    } finally {
      await sql`
        drop trigger if exists test_reject_location_update
        on public.locations
      `;
      await sql`
        drop function if exists private.test_reject_location_update()
      `;
      const restored = await owner.client
        .from("locations")
        .update({ is_active: true })
        .eq("business_id", business.id)
        .eq("id", bedford.id);
      locationRestoreError = restored.error;
    }
    if (locationRestoreError) {
      throw locationRestoreError;
    }
  });

  it("serializes concurrent validation and detects privileged replay tampering", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const probe = entity(baselineSnapshot.object_definitions, "restore_probe");
    const concurrent = await service.proposeChangeSet({
      title: "Concurrent validation",
      description: null,
      operations: [
        {
          ...setObjectFrom(probe, true),
          singular_label: "Concurrently validated probe",
        },
      ],
    });
    const [first, second] = await Promise.all([
      service.validateChangeSet(concurrent.id),
      service.validateChangeSet(concurrent.id),
    ]);
    expect(first.status).toBe("validated");
    expect(second.status).toBe("validated");
    expect(first.validated_at).toBe(second.validated_at);
    expect(first.validation_result_json).toEqual(second.validation_result_json);

    const tampered = await service.proposeChangeSet({
      title: "Tamper detection",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "tamper_probe",
          singular_label: "Tamper probe",
          plural_label: "Tamper probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    await sql.begin(async (transaction) => {
      await transaction.unsafe("set local session_replication_role = replica");
      await transaction`
        update public.configuration_change_sets
        set id_allocations_json = jsonb_build_object(
          'object:tamper_probe',
          gen_random_uuid()
        )
        where business_id = ${business.id}::uuid
          and id = ${tampered.id}::uuid
      `;
    });
    await expectEngineError(
      service.validateChangeSet(tampered.id),
      "configuration_candidate_replay_mismatch",
    );
    expect((await service.getChangeSet(tampered.id)).status).toBe("proposed");

    const displayContextTampered = await service.proposeChangeSet({
      title: "Display-context tamper detection",
      description: null,
      operations: [
        {
          ...setObjectFrom(probe, true),
          singular_label: "Display-context tamper probe",
        },
      ],
    });
    await expect(
      sql`
        update public.configuration_change_sets
        set display_context_json = jsonb_build_object(
          'schema_version',
          1,
          'locations',
          jsonb_build_object()
        )
        where business_id = ${business.id}::uuid
          and id = ${displayContextTampered.id}::uuid
      `,
    ).rejects.toMatchObject({ code: "55000" });
    await sql.begin(async (transaction) => {
      await transaction.unsafe("set local session_replication_role = replica");
      await transaction`
        update public.configuration_change_sets
        set display_context_json = jsonb_build_object(
          'schema_version',
          1,
          'locations',
          jsonb_build_object(
            ${otherLocation.id}::text,
            jsonb_build_object('name', 'Other Location')
          )
        )
        where business_id = ${business.id}::uuid
          and id = ${displayContextTampered.id}::uuid
      `;
    });
    await expectEngineError(
      service.validateChangeSet(displayContextTampered.id),
      "configuration_candidate_replay_failed",
    );
    expect((await service.getChangeSet(displayContextTampered.id)).status).toBe(
      "proposed",
    );

    const [displayContextGuards] = await sql<
      {
        bounded_names: boolean;
        bounded_payload: boolean;
        exact_properties: boolean;
      }[]
    >`
      select
        not private.configuration_display_context_v1_is_valid(
          jsonb_build_object(
            'schema_version',
            1,
            'locations',
            jsonb_build_object(
              ${otherLocation.id}::text,
              jsonb_build_object('name', repeat('x', 121))
            )
          )
        ) as bounded_names,
        not private.configuration_display_context_v1_is_valid(
          jsonb_build_object(
            'schema_version',
            1,
            'locations',
            (
              select jsonb_object_agg(
                gen_random_uuid()::text,
                jsonb_build_object('name', 'Location')
              )
              from generate_series(1, 4000)
            )
          )
        ) as bounded_payload,
        not private.configuration_display_context_v1_is_valid(
          jsonb_build_object(
            'schema_version',
            1,
            'locations',
            jsonb_build_object(),
            'unexpected',
            true
          )
        ) as exact_properties
    `;
    expect(displayContextGuards).toEqual({
      bounded_names: true,
      bounded_payload: true,
      exact_properties: true,
    });
  });

  it("fails closed on projection divergence and marks a stale base conflicted", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const probe = entity(baselineSnapshot.object_definitions, "archive_probe");
    const divergent = await service.proposeChangeSet({
      title: "Projection divergence",
      description: null,
      operations: [
        {
          ...setObjectFrom(probe, true),
          plural_label: "Divergence probes",
        },
      ],
    });
    const probeId = requiredString(probe.id, "Probe ID");
    const originalLabel = requiredString(
      probe.singular_label,
      "Probe singular label",
    );
    let projectionRestoreError: unknown;
    try {
      const changed = await owner.client
        .from("object_definitions")
        .update({ singular_label: "Unversioned divergence" })
        .eq("business_id", business.id)
        .eq("id", probeId);
      if (changed.error) {
        throw changed.error;
      }
      await expectEngineError(
        service.validateChangeSet(divergent.id),
        "configuration_projection_out_of_sync",
      );
      expect((await service.getChangeSet(divergent.id)).status).toBe(
        "proposed",
      );
    } finally {
      const restored = await owner.client
        .from("object_definitions")
        .update({ singular_label: originalLabel })
        .eq("business_id", business.id)
        .eq("id", probeId);
      projectionRestoreError = restored.error;
    }
    if (projectionRestoreError) {
      throw projectionRestoreError;
    }

    const stale = await service.proposeChangeSet({
      title: "Stale validation",
      description: null,
      operations: [
        {
          ...setObjectFrom(probe, true),
          plural_label: "Stale probes",
        },
      ],
    });
    const snapshotBeforeConflict = await currentLiveSnapshot();
    try {
      await sql`
        update public.business_configuration_heads
        set head_revision = head_revision + 1
        where business_id = ${business.id}::uuid
      `;
      const conflicted = await service.validateChangeSet(stale.id);
      expect(conflicted).toMatchObject({
        status: "conflicted",
        closed_by: owner.user.id,
        validation_result_json: null,
        validated_by: null,
      });
      expect(await currentLiveSnapshot()).toEqual(snapshotBeforeConflict);
    } finally {
      await sql`
        update public.business_configuration_heads
        set head_revision = ${headBeforeProposal.head_revision}
        where business_id = ${business.id}::uuid
      `;
    }
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
      expected_actor_id: owner.user.id,
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
    const callerDisplayContext = await raw.rpc("propose_configuration_change", {
      ...baseProposal,
      display_context_json: {
        schema_version: 1,
        locations: {
          [otherLocation.id]: { name: "Caller-controlled" },
        },
      },
      requested_operations: [operations[0]] as unknown as Json,
    } as never);
    expect(callerDisplayContext.error).not.toBeNull();

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
        {
          ...setObjectFrom(
            entity(baselineSnapshot.object_definitions, "archive_probe"),
            true,
          ),
          singular_label: "Admin proposal probe",
        },
      ],
    });
    expect(adminProposal.requested_by).toBe(administrator.user.id);

    const liveBefore = await currentLiveSnapshot();
    const headBefore = await currentHead();
    const abandoned = await adminService.abandonChangeSet(adminProposal.id);
    expect(abandoned).toMatchObject({
      closed_by: administrator.user.id,
      status: "abandoned",
    });
    expect(await currentLiveSnapshot()).toEqual(liveBefore);
    expect(await currentHead()).toEqual(headBefore);
    await expectEngineError(
      ownerService.abandonChangeSet(adminProposal.id),
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
