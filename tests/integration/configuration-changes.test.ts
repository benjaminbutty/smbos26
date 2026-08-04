import { createHash } from "node:crypto";
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
import {
  preorderConfigSchema,
  publicPreorderCatalogueSchema,
  publicPreorderResultSchema,
  type PublicPreorderSubmission,
} from "../../src/core/preorder/schemas";
import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";
import { createLocationWithCurrentness } from "./support/location-rpc";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type ChangeSet = Tables<"configuration_change_sets">;
type JsonObject = Record<string, Json | undefined>;

interface Identity {
  client: Client;
  user: User;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
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

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitForDatabaseLock(
  observer: Sql,
  applicationName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const waiting = await observer<{ wait_event_type: string | null }[]>`
      select activity.wait_event_type
      from pg_catalog.pg_stat_activity as activity
      where activity.application_name = ${applicationName}
        and activity.state = 'active'
    `;
    if (waiting.some(({ wait_event_type }) => wait_event_type === "Lock")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for ${applicationName} to block on a database lock.`,
  );
}

async function applyThroughDatabase(
  connection: Sql,
  applicationName: string,
  actorId: string,
  changeSetId: string,
): Promise<ChangeSet> {
  return connection.begin(async (transaction) => {
    await transaction`
      select
        set_config('application_name', ${applicationName}, true),
        set_config('request.jwt.claim.sub', ${actorId}, true),
        set_config('request.jwt.claim.role', 'authenticated', true)
    `;
    const [applied] = await transaction<ChangeSet[]>`
      select result.*
      from public.apply_configuration_change(
        ${business.id}::uuid,
        ${actorId}::uuid,
        ${changeSetId}::uuid
      ) as result
    `;
    if (!applied) {
      throw new Error("Configuration application returned no row.");
    }
    return applied;
  });
}

function requestHash(): string {
  return createHash("sha256").update(crypto.randomUUID(), "utf8").digest("hex");
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
  execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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
      await createLocationWithCurrentness(
        otherOwner.client,
        otherOwner.user.id,
        otherBusiness.id,
        "Other Location",
        "Europe/London",
      ),
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

    const locations = requireData(
      await admin.from("locations").select("*").eq("business_id", business.id),
      "Could not load demo Locations",
    );
    locations.forEach((location) =>
      locationsByName.set(location.name, location),
    );

    const fixtureService = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const fixtureProposal = await fixtureService.proposeChangeSet({
      ...(await fixtureService.getProposalCurrentness()),
      title: "Install configuration engine test fixtures",
      description: "Ephemeral integration-test configuration.",
      operations: [
        {
          op: "set_object",
          key: "archive_probe",
          singular_label: "Active probe",
          plural_label: "Active probes",
          description: "",
          icon: null,
          is_active: true,
        },
        {
          op: "set_object",
          key: "compatibility_child",
          singular_label: "Compatibility child",
          plural_label: "Compatibility children",
          description: "",
          icon: null,
          is_active: true,
        },
        {
          op: "set_object",
          key: "compatibility_probe",
          singular_label: "Compatibility probe",
          plural_label: "Compatibility probes",
          description: "",
          icon: null,
          is_active: true,
        },
        {
          op: "set_object",
          key: "restore_probe",
          singular_label: "Archived probe",
          plural_label: "Archived probes",
          description: "",
          icon: null,
          is_active: false,
        },
        {
          op: "set_field",
          object_key: "compatibility_child",
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
          op: "set_field",
          object_key: "compatibility_probe",
          key: "category",
          label: "Category",
          field_type: "select",
          required: false,
          default_value: null,
          settings_json: { options: ["Alpha", "Beta"] },
          position: 1,
          is_active: true,
        },
        {
          op: "set_field",
          object_key: "compatibility_probe",
          key: "value",
          label: "Value",
          field_type: "short_text",
          required: true,
          default_value: null,
          settings_json: {},
          position: 0,
          is_active: true,
        },
        {
          op: "set_relationship",
          key: "compatibility_probe_has_child",
          source_object_key: "compatibility_probe",
          target_object_key: "compatibility_child",
          source_label: "Children",
          target_label: "Probe",
          cardinality: "one_to_many",
          is_required: false,
          is_active: true,
        },
        {
          op: "set_form",
          key: "compatibility_probe_create",
          name: "New compatibility probe",
          object_key: "compatibility_probe",
          mode: "create",
          config_json: {
            fields: [{ field: "value" }, { field: "category" }],
          },
          audience: "internal",
          is_active: true,
        },
        {
          op: "set_view",
          key: "compatibility_probes",
          name: "Compatibility probes",
          view_type: "table",
          object_key: "compatibility_probe",
          config_json: {
            fields: ["value", "category"],
            create_form_key: "compatibility_probe_create",
            include_archived: false,
          },
          audience: "internal",
          is_active: true,
        },
        {
          op: "set_page",
          key: "compatibility_workspace",
          title: "Compatibility workspace",
          slug: "compatibility-workspace",
          audience: "internal",
          layout_json: {
            blocks: [
              { type: "view", view_key: "compatibility_probes" },
              { type: "form", form_key: "compatibility_probe_create" },
            ],
          },
          status: "draft",
          is_active: true,
        },
      ],
    });
    const validatedFixture = await fixtureService.validateChangeSet(
      fixtureProposal.id,
    );
    if (validatedFixture.status !== "validated") {
      throw new Error("Could not validate configuration engine test fixtures.");
    }
    const appliedFixture = await fixtureService.applyChangeSet(
      fixtureProposal.id,
    );
    if (appliedFixture.status !== "applied") {
      throw new Error("Could not apply configuration engine test fixtures.");
    }

    const configuredObjects = requireData(
      await owner.client
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

    const relationship = requireData(
      await owner.client
        .from("relationship_definitions")
        .select("*")
        .eq("business_id", business.id)
        .eq("key", "compatibility_probe_has_child")
        .single(),
      "Could not load compatibility Relationship",
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
  }, 90_000);

  afterAll(async () => {
    if (sql) {
      for (const businessId of createdBusinessIds) {
        await sql`
          delete from public.businesses
          where id = ${businessId}::uuid
        `;
      }
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

  it("materializes and stores one immutable complete candidate without changing the live projection or head", async () => {
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
      ...(await service.getProposalCurrentness()),
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
      expected_base_version_id: headBeforeProposal.active_version_id,
      expected_head_revision: headBeforeProposal.head_revision,
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
        ...(await ownerService.getProposalCurrentness()),
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
      ...(await ownerService.getProposalCurrentness()),
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
          await owner.client
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
        ...(await service.getProposalCurrentness()),
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
      ...(await service.getProposalCurrentness()),
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
      ...(await service.getProposalCurrentness()),
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
      ...(await service.getProposalCurrentness()),
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
      ...(await service.getProposalCurrentness()),
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
      ...(await service.getProposalCurrentness()),
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

  it("denies unversioned divergence and marks a stale base conflicted", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const probe = entity(baselineSnapshot.object_definitions, "archive_probe");
    const divergent = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
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
    const changed = await owner.client
      .from("object_definitions")
      .update({ singular_label: "Unversioned divergence" })
      .eq("business_id", business.id)
      .eq("id", probeId);
    expect(changed.error?.code).toBe("42501");
    expect((await service.validateChangeSet(divergent.id)).status).toBe(
      "validated",
    );

    const stale = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
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
      await sql.begin(async (transaction) => {
        await transaction.unsafe(
          "set local session_replication_role = replica",
        );
        await transaction`
          update public.business_configuration_heads
          set head_revision = head_revision + 1
          where business_id = ${business.id}::uuid
        `;
      });
      const conflicted = await service.validateChangeSet(stale.id);
      expect(conflicted).toMatchObject({
        status: "conflicted",
        closed_by: owner.user.id,
        validation_result_json: null,
        validated_by: null,
      });
      expect(await currentLiveSnapshot()).toEqual(snapshotBeforeConflict);
    } finally {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(
          "set local session_replication_role = replica",
        );
        await transaction`
          update public.business_configuration_heads
          set head_revision = ${headBeforeProposal.head_revision}
          where business_id = ${business.id}::uuid
        `;
      });
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
      expected_base_version_id: headBeforeProposal.active_version_id,
      expected_business_id: business.id,
      expected_head_revision: headBeforeProposal.head_revision,
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
        ...(await service.getProposalCurrentness()),
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
        ...(await service.getProposalCurrentness()),
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
        ...(await ownerService.getProposalCurrentness()),
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
      ...(await adminService.getProposalCurrentness()),
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

  it("[application] applies an Owner proposal atomically and retries idempotently", async () => {
    baselineSnapshot = asSnapshot(await currentLiveSnapshot());
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const headBefore = await currentHead();
    const [recordCountBefore] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.records
      where business_id = ${business.id}::uuid
    `;
    const changeSet = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
      title: "Apply Owner configuration",
      description: "Phase 3A Owner application proof.",
      operations: [
        {
          op: "set_object",
          key: "phase_3_owner_probe",
          singular_label: "Owner application probe",
          plural_label: "Owner application probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    const validated = await service.validateChangeSet(changeSet.id);
    expect(validated).toMatchObject({
      status: "validated",
      validated_by: owner.user.id,
    });
    const storedValidation = validated.validation_result_json;
    const validatedAt = validated.validated_at;

    const applied = await service.applyChangeSet(changeSet.id);
    expect(applied).toMatchObject({
      status: "applied",
      applied_by: owner.user.id,
      closed_at: null,
      closed_by: null,
      validated_at: validatedAt,
      validation_result_json: storedValidation,
    });
    expect(applied.applied_version_id).not.toBeNull();

    const headAfter = await currentHead();
    expect(headAfter).toMatchObject({
      active_version_id: applied.applied_version_id,
      head_revision: headBefore.head_revision + 1,
    });
    const version = requireData(
      await admin
        .from("configuration_versions")
        .select("*")
        .eq("business_id", business.id)
        .eq("id", applied.applied_version_id as string)
        .single(),
      "Could not load applied configuration version",
    );
    expect(version).toMatchObject({
      kind: "change",
      version_number: Number(headAfter.head_revision),
      parent_version_id: headBefore.active_version_id,
      restored_from_version_id: null,
      source_change_set_id: applied.id,
      snapshot_schema_version: 1,
      snapshot_json: applied.candidate_snapshot_json,
      snapshot_checksum: applied.candidate_checksum,
      created_by: owner.user.id,
    });
    expect(await currentLiveSnapshot()).toEqual(
      applied.candidate_snapshot_json,
    );
    const [liveChecksum] = await sql<{ checksum: string }[]>`
      select private.configuration_snapshot_checksum_v1(
        private.configuration_snapshot_v1(${business.id}::uuid)
      ) as checksum
    `;
    expect(liveChecksum?.checksum).toBe(applied.candidate_checksum);
    expect(version.snapshot_checksum).toBe(liveChecksum?.checksum);
    const [recordCountAfter] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.records
      where business_id = ${business.id}::uuid
    `;
    expect(recordCountAfter?.count).toBe(recordCountBefore?.count);

    const versionCountBeforeRetry = await admin
      .from("configuration_versions")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id);
    expect(versionCountBeforeRetry.error).toBeNull();
    const retried = await service.applyChangeSet(changeSet.id);
    expect(retried).toMatchObject({
      status: "applied",
      applied_version_id: applied.applied_version_id,
      applied_at: applied.applied_at,
      applied_by: applied.applied_by,
    });
    expect(await currentHead()).toEqual(headAfter);
    const versionCountAfterRetry = await admin
      .from("configuration_versions")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id);
    expect(versionCountAfterRetry.error).toBeNull();
    expect(versionCountAfterRetry.count).toBe(versionCountBeforeRetry.count);
  });

  it("[application] allows Admin application and denies Staff, cross-Business, actor mismatch, and non-validated states", async () => {
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
    const otherTenantService = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: otherBusiness.id,
    });
    const proposed = await ownerService.proposeChangeSet({
      ...(await ownerService.getProposalCurrentness()),
      title: "Application permission probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "phase_3_permission_probe",
          singular_label: "Permission probe",
          plural_label: "Permission probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    const headBefore = await currentHead();
    const snapshotBefore = await currentLiveSnapshot();

    await expectEngineError(
      staffService.applyChangeSet(proposed.id),
      "configuration_owner_or_admin_required",
    );
    await expectEngineError(
      otherTenantService.applyChangeSet(proposed.id),
      "configuration_change_set_not_found",
    );
    const mismatched = await owner.client.rpc("apply_configuration_change", {
      expected_actor_id: administrator.user.id,
      expected_business_id: business.id,
      requested_change_set_id: proposed.id,
    });
    expect(mismatched.error?.message).toContain(
      "configuration_actor_context_mismatch",
    );
    await expectEngineError(
      ownerService.applyChangeSet(proposed.id),
      "configuration_change_set_not_applicable",
    );

    const abandonedProposal = await ownerService.proposeChangeSet({
      ...(await ownerService.getProposalCurrentness()),
      title: "Abandoned application probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "phase_3_abandoned_probe",
          singular_label: "Abandoned probe",
          plural_label: "Abandoned probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    await ownerService.abandonChangeSet(abandonedProposal.id);
    await expectEngineError(
      ownerService.applyChangeSet(abandonedProposal.id),
      "configuration_change_set_not_applicable",
    );
    expect(await currentHead()).toEqual(headBefore);
    expect(await currentLiveSnapshot()).toEqual(snapshotBefore);

    const adminProposal = await adminService.proposeChangeSet({
      ...(await adminService.getProposalCurrentness()),
      title: "Admin application",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "phase_3_admin_probe",
          singular_label: "Admin application probe",
          plural_label: "Admin application probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    await adminService.validateChangeSet(adminProposal.id);
    const applied = await adminService.applyChangeSet(adminProposal.id);
    expect(applied).toMatchObject({
      status: "applied",
      applied_by: administrator.user.id,
    });
  });

  it("[application] serializes duplicate and competing applications", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const duplicate = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
      title: "Concurrent duplicate application",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "phase_3_duplicate_probe",
          singular_label: "Duplicate probe",
          plural_label: "Duplicate probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    await service.validateChangeSet(duplicate.id);
    const headBeforeDuplicate = await currentHead();
    const [first, second] = await Promise.all([
      service.applyChangeSet(duplicate.id),
      service.applyChangeSet(duplicate.id),
    ]);
    expect(first.status).toBe("applied");
    expect(second.status).toBe("applied");
    expect(first.applied_version_id).toBe(second.applied_version_id);
    expect(first.applied_at).toBe(second.applied_at);
    expect((await currentHead()).head_revision).toBe(
      headBeforeDuplicate.head_revision + 1,
    );
    const duplicateVersions = requireData(
      await admin
        .from("configuration_versions")
        .select("id")
        .eq("business_id", business.id)
        .eq("source_change_set_id", duplicate.id),
      "Could not load duplicate application versions",
    );
    expect(duplicateVersions).toHaveLength(1);

    const proposalA = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
      title: "Same-base proposal A",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "phase_3_competing_a",
          singular_label: "Competing A",
          plural_label: "Competing A records",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    const proposalB = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
      title: "Same-base proposal B",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "phase_3_competing_b",
          singular_label: "Competing B",
          plural_label: "Competing B records",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    const validatedA = await service.validateChangeSet(proposalA.id);
    const validatedB = await service.validateChangeSet(proposalB.id);
    const [resultA, resultB] = await Promise.all([
      service.applyChangeSet(proposalA.id),
      service.applyChangeSet(proposalB.id),
    ]);
    const applied = resultA.status === "applied" ? resultA : resultB;
    const conflicted = resultA.status === "conflicted" ? resultA : resultB;
    const priorValidation =
      conflicted.id === validatedA.id ? validatedA : validatedB;
    expect(applied.status).toBe("applied");
    expect(conflicted).toMatchObject({
      status: "conflicted",
      closed_by: owner.user.id,
      validation_result_json: priorValidation.validation_result_json,
      validated_by: priorValidation.validated_by,
      validated_at: priorValidation.validated_at,
      applied_version_id: null,
    });
    const conflictedVersions = requireData(
      await admin
        .from("configuration_versions")
        .select("id")
        .eq("business_id", business.id)
        .eq("source_change_set_id", conflicted.id),
      "Could not inspect conflicted proposal versions",
    );
    expect(conflictedVersions).toHaveLength(0);
    expect(await currentLiveSnapshot()).toEqual(
      applied.candidate_snapshot_json,
    );
  });

  it("[application] rejects application-time incompatibility without changing projection, version, head, or Records", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const fixture = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
      title: "Create application compatibility fixture",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "phase_3_compatibility",
          singular_label: "Application compatibility record",
          plural_label: "Application compatibility records",
          description: "",
          icon: null,
          is_active: true,
        },
        {
          op: "set_field",
          object_key: "phase_3_compatibility",
          key: "value",
          label: "Value",
          field_type: "short_text",
          required: true,
          default_value: null,
          settings_json: {},
          position: 0,
          is_active: true,
        },
      ],
    });
    await service.validateChangeSet(fixture.id);
    await service.applyChangeSet(fixture.id);
    const current = asSnapshot(await currentLiveSnapshot());
    const field = entity(
      current.field_definitions.filter(
        (candidateField) =>
          candidateField.object_key === "phase_3_compatibility",
      ),
      "value",
    );
    const changeSet = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
      title: "Change field after validation",
      description: null,
      operations: [
        setFieldFrom(field, {
          field_type: "number",
        }),
      ],
    });
    const validated = await service.validateChangeSet(changeSet.id);
    expect(validated.status).toBe("validated");

    const configuredObject = entity(
      current.object_definitions,
      "phase_3_compatibility",
    );
    const createdRecord = requireData(
      await owner.client.rpc("create_graph_record", {
        expected_business_id: business.id,
        requested_data: { value: "old format" },
        target_object_definition_id: requiredString(
          configuredObject.id,
          "Compatibility Object ID",
        ),
      }),
      "Could not insert application-time compatibility Record",
    );
    const snapshotBefore = await currentLiveSnapshot();
    const headBefore = await currentHead();
    const versionsBefore = await admin
      .from("configuration_versions")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id);
    const rejected = await service.applyChangeSet(changeSet.id);

    expect(rejected).toMatchObject({
      status: "rejected",
      applied_version_id: null,
      closed_by: owner.user.id,
      validated_by: owner.user.id,
    });
    expect(rejected.validation_result_json).toMatchObject({
      outcome: "invalid",
      errors: [
        {
          code: "existing_records_incompatible",
        },
      ],
    });
    expect(rejected.validated_at).toBe(rejected.closed_at);
    expect(rejected.validation_result_json).not.toEqual(
      validated.validation_result_json,
    );
    expect(await currentLiveSnapshot()).toEqual(snapshotBefore);
    expect(await currentHead()).toEqual(headBefore);
    const versionsAfter = await admin
      .from("configuration_versions")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id);
    expect(versionsAfter.count).toBe(versionsBefore.count);
    expect(
      requireData(
        await admin
          .from("records")
          .select("data_json")
          .eq("business_id", business.id)
          .eq("id", createdRecord.id)
          .single(),
        "Application-time compatibility Record was lost",
      ).data_json,
    ).toEqual({ value: "old format" });
    await expectEngineError(
      service.applyChangeSet(changeSet.id),
      "configuration_change_set_not_applicable",
    );
  });

  it("[application] fails closed on immutable replay tampering and projection divergence", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });

    for (const tamperKind of [
      "operations",
      "allocation",
      "display_context",
    ] as const) {
      const changeSet = await service.proposeChangeSet({
        ...(await service.getProposalCurrentness()),
        title: `Application ${tamperKind} tamper`,
        description: null,
        operations: [
          {
            op: "set_object",
            key: `phase_3_${tamperKind}_tamper`,
            singular_label: "Tamper probe",
            plural_label: "Tamper probes",
            description: "",
            icon: null,
            is_active: true,
          },
        ],
      });
      await service.validateChangeSet(changeSet.id);
      const snapshotBefore = await currentLiveSnapshot();
      const headBefore = await currentHead();
      await sql.begin(async (transaction) => {
        await transaction.unsafe(
          "set local session_replication_role = replica",
        );
        if (tamperKind === "operations") {
          await transaction`
            update public.configuration_change_sets
            set operations_json = jsonb_set(
              operations_json,
              '{0,singular_label}',
              '"Tampered replay probe"'::jsonb
            )
            where business_id = ${business.id}::uuid
              and id = ${changeSet.id}::uuid
          `;
        } else if (tamperKind === "allocation") {
          await transaction`
            update public.configuration_change_sets
            set id_allocations_json = jsonb_build_object(
              ${`object:phase_3_${tamperKind}_tamper`}::text,
              gen_random_uuid()
            )
            where business_id = ${business.id}::uuid
              and id = ${changeSet.id}::uuid
          `;
        } else {
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
              and id = ${changeSet.id}::uuid
          `;
        }
      });
      await expectEngineError(
        service.applyChangeSet(changeSet.id),
        tamperKind === "display_context"
          ? "configuration_candidate_replay_failed"
          : "configuration_candidate_replay_mismatch",
      );
      expect((await service.getChangeSet(changeSet.id)).status).toBe(
        "validated",
      );
      expect(await currentLiveSnapshot()).toEqual(snapshotBefore);
      expect(await currentHead()).toEqual(headBefore);
    }

    const current = asSnapshot(await currentLiveSnapshot());
    const probe = entity(current.object_definitions, "phase_3_owner_probe");
    const divergent = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
      title: "Application projection divergence",
      description: null,
      operations: [
        {
          ...setObjectFrom(probe, true),
          plural_label: "Owner application divergence probes",
        },
      ],
    });
    await service.validateChangeSet(divergent.id);
    const headBefore = await currentHead();
    const changed = await owner.client
      .from("object_definitions")
      .update({ singular_label: "Unversioned application divergence" })
      .eq("business_id", business.id)
      .eq("id", requiredString(probe.id, "Owner probe ID"));
    expect(changed.error?.code).toBe("42501");
    const applied = await service.applyChangeSet(divergent.id);
    expect(applied.status).toBe("applied");
    expect((await currentHead()).head_revision).toBe(
      headBefore.head_revision + 1,
    );
  });

  it("[application] rolls back projection, version, head, and lifecycle at all three injected failure points", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const failurePoints = [
      "before_version",
      "before_head",
      "before_applied_status",
    ] as const;

    for (const failurePoint of failurePoints) {
      const changeSet = await service.proposeChangeSet({
        ...(await service.getProposalCurrentness()),
        title: `Atomic failure ${failurePoint}`,
        description: null,
        operations: [
          {
            op: "set_object",
            key: `phase_3_failure_${failurePoint}`,
            singular_label: "Atomic failure probe",
            plural_label: "Atomic failure probes",
            description: "",
            icon: null,
            is_active: true,
          },
        ],
      });
      await service.validateChangeSet(changeSet.id);
      const snapshotBefore = await currentLiveSnapshot();
      const headBefore = await currentHead();
      const versionsBefore = await admin
        .from("configuration_versions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id);
      const recordsBefore = await admin
        .from("records")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id);

      try {
        await sql`
          create function private.test_fail_configuration_application()
          returns trigger
          language plpgsql
          set search_path = ''
          as $$
          begin
            raise exception 'test_atomic_application_failure'
              using errcode = 'P0001';
          end;
          $$
        `;
        if (failurePoint === "before_version") {
          await sql`
            create trigger test_fail_configuration_application
            before insert on public.configuration_versions
            for each row
            when (new.kind = 'change')
            execute function
              private.test_fail_configuration_application()
          `;
        } else if (failurePoint === "before_head") {
          await sql`
            create trigger test_fail_configuration_application
            before update on public.business_configuration_heads
            for each row execute function
              private.test_fail_configuration_application()
          `;
        } else {
          await sql`
            create trigger test_fail_configuration_application
            before update on public.configuration_change_sets
            for each row
            when (new.status = 'applied')
            execute function
              private.test_fail_configuration_application()
          `;
        }

        await expect(
          service.applyChangeSet(changeSet.id),
        ).rejects.toBeInstanceOf(ConfigurationChangeServiceError);
      } finally {
        if (failurePoint === "before_version") {
          await sql`
            drop trigger if exists test_fail_configuration_application
            on public.configuration_versions
          `;
        } else if (failurePoint === "before_head") {
          await sql`
            drop trigger if exists test_fail_configuration_application
            on public.business_configuration_heads
          `;
        } else {
          await sql`
            drop trigger if exists test_fail_configuration_application
            on public.configuration_change_sets
          `;
        }
        await sql`
          drop function if exists
            private.test_fail_configuration_application()
        `;
      }

      expect(await currentLiveSnapshot()).toEqual(snapshotBefore);
      expect(await currentHead()).toEqual(headBefore);
      expect((await service.getChangeSet(changeSet.id)).status).toBe(
        "validated",
      );
      const versionsAfter = await admin
        .from("configuration_versions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id);
      const recordsAfter = await admin
        .from("records")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id);
      expect(versionsAfter.count).toBe(versionsBefore.count);
      expect(recordsAfter.count).toBe(recordsBefore.count);
    }
  });

  it("[application] serializes both Record/application race orderings through existing Object locks", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const installFixture = async (key: string): Promise<SnapshotV1> => {
      const fixture = await service.proposeChangeSet({
        ...(await service.getProposalCurrentness()),
        title: `Install ${key}`,
        description: null,
        operations: [
          {
            op: "set_object",
            key,
            singular_label: "Race record",
            plural_label: "Race records",
            description: "",
            icon: null,
            is_active: true,
          },
          {
            op: "set_field",
            object_key: key,
            key: "value",
            label: "Value",
            field_type: "short_text",
            required: true,
            default_value: null,
            settings_json: {},
            position: 0,
            is_active: true,
          },
        ],
      });
      await service.validateChangeSet(fixture.id);
      await service.applyChangeSet(fixture.id);
      return asSnapshot(await currentLiveSnapshot());
    };
    const proposeNumberField = async (
      snapshot: SnapshotV1,
      objectKey: string,
    ): Promise<ChangeSet> => {
      const field = entity(
        snapshot.field_definitions.filter(
          (candidateField) => candidateField.object_key === objectKey,
        ),
        "value",
      );
      const changeSet = await service.proposeChangeSet({
        ...(await service.getProposalCurrentness()),
        title: `Change ${objectKey} value to number`,
        description: null,
        operations: [
          setFieldFrom(field, {
            field_type: "number",
          }),
        ],
      });
      return service.validateChangeSet(changeSet.id);
    };

    const firstKey = "phase_3_record_first";
    const firstSnapshot = await installFixture(firstKey);
    const firstObject = entity(firstSnapshot.object_definitions, firstKey);
    const recordFirstProposal = await proposeNumberField(
      firstSnapshot,
      firstKey,
    );
    const recordConnection = postgres(settings.databaseUrl, { max: 1 });
    const applicationConnection = postgres(settings.databaseUrl, { max: 1 });
    const recordInserted = createDeferred<string>();
    const releaseRecord = createDeferred<void>();
    const applicationName = `m5-application-waits-${crypto.randomUUID()}`;
    let recordPromise: Promise<string> | undefined;
    try {
      recordPromise = recordConnection.begin(async (transaction) => {
        await transaction`
          select set_config(
            'application_name',
            'm5-record-write-first',
            true
          )
        `;
        const [inserted] = await transaction<{ id: string }[]>`
          insert into public.records (
            business_id,
            object_definition_id,
            data_json
          )
          values (
            ${business.id}::uuid,
            ${requiredString(firstObject.id, "Record-first Object ID")}::uuid,
            ${recordConnection.json({ value: "old format" })}::jsonb
          )
          returning id
        `;
        if (!inserted) {
          throw new Error("Record-first insert returned no row.");
        }
        recordInserted.resolve(inserted.id);
        await releaseRecord.promise;
        return inserted.id;
      });
      const recordId = await recordInserted.promise;
      const applicationPromise = applyThroughDatabase(
        applicationConnection,
        applicationName,
        owner.user.id,
        recordFirstProposal.id,
      );
      await waitForDatabaseLock(sql, applicationName);
      releaseRecord.resolve();
      expect(await recordPromise).toBe(recordId);
      const rejected = await applicationPromise;
      expect(rejected).toMatchObject({
        status: "rejected",
        applied_version_id: null,
      });
      expect(rejected.validation_result_json).toMatchObject({
        outcome: "invalid",
        errors: [{ code: "existing_records_incompatible" }],
      });
      expect(
        requireData(
          await admin
            .from("records")
            .select("id")
            .eq("business_id", business.id)
            .eq("id", recordId)
            .single(),
          "Record-first row did not survive rejected application",
        ).id,
      ).toBe(recordId);
    } finally {
      releaseRecord.resolve();
      await recordPromise?.catch(() => undefined);
      await recordConnection.end();
      await applicationConnection.end();
    }

    const secondKey = "phase_3_application_first";
    const secondSnapshot = await installFixture(secondKey);
    const secondObject = entity(secondSnapshot.object_definitions, secondKey);
    const applicationFirstProposal = await proposeNumberField(
      secondSnapshot,
      secondKey,
    );
    const blocker = postgres(settings.databaseUrl, { max: 1 });
    const applicationFirstConnection = postgres(settings.databaseUrl, {
      max: 1,
    });
    const waitingRecordConnection = postgres(settings.databaseUrl, { max: 1 });
    const pauseKey = 5300260728;
    const applicationFirstName = `m5-application-first-${crypto.randomUUID()}`;
    const waitingRecordName = `m5-record-waits-${crypto.randomUUID()}`;
    let applicationPromise: Promise<ChangeSet> | undefined;
    let waitingRecord:
      Promise<{ ok: true } | { error: unknown; ok: false }> | undefined;
    try {
      await sql`
        create function private.test_pause_application_object()
        returns trigger
        language plpgsql
        set search_path = ''
        as $$
        begin
          perform pg_advisory_xact_lock(5300260728);
          return new;
        end;
        $$
      `;
      await sql`
        create trigger test_pause_application_object
        before update on public.object_definitions
        for each row
        when (
          new.key = 'phase_3_application_first'
          and old.is_active
          and not new.is_active
        )
        execute function
          private.test_pause_application_object()
      `;

      await blocker.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(${pauseKey})`;
        applicationPromise = applyThroughDatabase(
          applicationFirstConnection,
          applicationFirstName,
          owner.user.id,
          applicationFirstProposal.id,
        );
        await waitForDatabaseLock(sql, applicationFirstName);

        waitingRecord = waitingRecordConnection
          .begin(async (recordTransaction) => {
            await recordTransaction`
              select set_config(
                'application_name',
                ${waitingRecordName},
                true
              )
            `;
            await recordTransaction`
              insert into public.records (
                business_id,
                object_definition_id,
                data_json
              )
              values (
                ${business.id}::uuid,
                ${requiredString(secondObject.id, "Application-first Object ID")}::uuid,
                ${waitingRecordConnection.json({
                  value: "old format",
                })}::jsonb
              )
            `;
          })
          .then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ error, ok: false as const }),
          );
        await waitForDatabaseLock(sql, waitingRecordName);
      });
      if (!applicationPromise || !waitingRecord) {
        throw new Error("Application-first race did not start.");
      }
      const applied = await applicationPromise;
      expect(applied.status).toBe("applied");
      const recordOutcome = await waitingRecord;
      expect(recordOutcome.ok).toBe(false);
      if (!recordOutcome.ok) {
        expect(String(recordOutcome.error)).toContain(
          "Invalid value for field",
        );
      }
      const staleRecords = requireData(
        await admin
          .from("records")
          .select("id")
          .eq("business_id", business.id)
          .eq(
            "object_definition_id",
            requiredString(secondObject.id, "Application-first Object ID"),
          ),
        "Could not inspect application-first Records",
      );
      expect(staleRecords).toHaveLength(0);
    } finally {
      await sql`
        drop trigger if exists test_pause_application_object
        on public.object_definitions
      `;
      await sql`
        drop function if exists private.test_pause_application_object()
      `;
      await blocker.end();
      await applicationFirstConnection.end();
      await waitingRecordConnection.end();
    }
  });

  it("[application] preserves an accepted preorder when Page application waits behind public locks", async () => {
    const service = new ConfigurationChangeService(owner.client, {
      actorId: owner.user.id,
      businessId: business.id,
    });
    const current = asSnapshot(await currentLiveSnapshot());
    const page = entity(current.pages, "public_preorder");
    const changeSet = await service.proposeChangeSet({
      ...(await service.getProposalCurrentness()),
      title: "Draft public preorder Page",
      description: null,
      operations: [
        {
          op: "set_page",
          key: "public_preorder",
          title: requiredString(page.title, "Public Page title"),
          slug: requiredString(page.slug, "Public Page slug"),
          audience: "public",
          layout_json: page.layout_json as {
            blocks: [{ preorder_key: string; type: "preorder" }];
          },
          status: "draft",
          is_active: requiredBoolean(page.is_active, "Public Page active"),
        },
      ],
    });
    await service.validateChangeSet(changeSet.id);

    const [catalogueRow] = await sql<{ catalogue: Json }[]>`
      select public.resolve_public_preorder(
        ${demoBusinessSlug},
        'preorder',
        'bakery_preorder'
      ) as catalogue
    `;
    if (!catalogueRow) {
      throw new Error("Public preorder catalogue returned no row.");
    }
    const catalogue = publicPreorderCatalogueSchema.parse(
      catalogueRow.catalogue,
    );
    const location = catalogue.preorder.locations.find(({ slots }) =>
      slots.some(({ available }) => available),
    );
    const slot = location?.slots.find(({ available }) => available);
    const product = catalogue.preorder.products[0];
    if (!location || !slot || !product) {
      throw new Error("No preorder product, Location, or slot for race test.");
    }
    const idempotencyToken = crypto.randomUUID();
    const submission: PublicPreorderSubmission = {
      idempotency_token: idempotencyToken,
      location_id: location.id,
      collection_at: slot.collection_at,
      items: [{ product_id: product.id, quantity: 1 }],
      fields: {
        customer: {
          name: "Phase Three Customer",
          email: "phase-three@example.test",
          phone: "01234 567890",
        },
        order: {
          dietary_requirements: "None",
          occasion: "Atomic application",
        },
      },
      website: "",
    };
    const submissionConnection = postgres(settings.databaseUrl, { max: 1 });
    const applicationConnection = postgres(settings.databaseUrl, { max: 1 });
    const accepted = createDeferred<Json>();
    const releaseSubmission = createDeferred<void>();
    const applicationName = `m5-preorder-application-${crypto.randomUUID()}`;
    let submissionPromise: Promise<Json> | undefined;
    try {
      submissionPromise = submissionConnection.begin(async (transaction) => {
        await transaction`
          select set_config(
            'application_name',
            'm5-preorder-accepted-first',
            true
          )
        `;
        const [submitted] = await transaction<{ result: Json }[]>`
          select public.submit_public_preorder(
            ${demoBusinessSlug},
            'preorder',
            'bakery_preorder',
            ${transaction.json(submission as unknown as Json)}::jsonb,
            ${requestHash()}
          ) as result
        `;
        if (!submitted) {
          throw new Error("Public preorder race returned no result.");
        }
        const result = publicPreorderResultSchema.parse(submitted.result);
        expect(result.ok).toBe(true);
        accepted.resolve(submitted.result);
        await releaseSubmission.promise;
        return submitted.result;
      });
      await accepted.promise;
      const applicationPromise = applyThroughDatabase(
        applicationConnection,
        applicationName,
        owner.user.id,
        changeSet.id,
      );
      await waitForDatabaseLock(sql, applicationName);
      releaseSubmission.resolve();
      const submitted = publicPreorderResultSchema.parse(
        await submissionPromise,
      );
      expect(submitted.ok).toBe(true);
      const applied = await applicationPromise;
      expect(applied.status).toBe("applied");

      const storedSubmission = requireData(
        await admin
          .from("preorder_submissions")
          .select("order_record_id")
          .eq("business_id", business.id)
          .eq("idempotency_token", idempotencyToken)
          .single(),
        "Accepted preorder was not preserved",
      );
      const orderRecordId = requiredString(
        storedSubmission.order_record_id,
        "Accepted Order Record ID",
      );
      expect(
        requireData(
          await admin
            .from("records")
            .select("id")
            .eq("business_id", business.id)
            .eq("id", orderRecordId)
            .single(),
          "Accepted Order Record was not preserved",
        ).id,
      ).toBe(orderRecordId);

      const laterSubmission = await admin.rpc("submit_public_preorder", {
        requested_business_slug: demoBusinessSlug,
        requested_page_slug: "preorder",
        requested_preorder_key: "bakery_preorder",
        requested_request_hash: requestHash(),
        submission: {
          ...submission,
          idempotency_token: crypto.randomUUID(),
        },
      });
      if (laterSubmission.error) {
        throw laterSubmission.error;
      }
      expect(publicPreorderResultSchema.parse(laterSubmission.data)).toEqual({
        code: "not_found",
        ok: false,
      });
    } finally {
      releaseSubmission.resolve();
      await submissionPromise?.catch(() => undefined);
      await submissionConnection.end();
      await applicationConnection.end();
    }
  });

  it("[application] enforces head advances and cascades an applied audit cycle only with whole-Business deletion", async () => {
    const currentHeadRow = await currentHead();
    await expect(
      sql`
        update public.business_configuration_heads
        set head_revision = head_revision + 2
        where business_id = ${business.id}::uuid
      `,
    ).rejects.toMatchObject({ code: "23514" });
    expect(await currentHead()).toEqual(currentHeadRow);

    const deletionOwner = await createIdentity("application-deletion");
    const deletionBusiness = requireData(
      await deletionOwner.client.rpc("create_business", {
        business_name: `Phase 3A deletion ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create Phase 3A deletion Business",
    );
    createdBusinessIds.push(deletionBusiness.id);
    const deletionService = new ConfigurationChangeService(
      deletionOwner.client,
      {
        actorId: deletionOwner.user.id,
        businessId: deletionBusiness.id,
      },
    );
    const changeSet = await deletionService.proposeChangeSet({
      ...(await deletionService.getProposalCurrentness()),
      title: "Applied deletion audit",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "deletion_probe",
          singular_label: "Deletion probe",
          plural_label: "Deletion probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    await deletionService.validateChangeSet(changeSet.id);
    const applied = await deletionService.applyChangeSet(changeSet.id);
    const versionId = applied.applied_version_id as string;

    await expect(
      sql`
        delete from public.configuration_versions
        where business_id = ${deletionBusiness.id}::uuid
          and id = ${versionId}::uuid
      `,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`
        delete from public.configuration_change_sets
        where business_id = ${deletionBusiness.id}::uuid
          and id = ${applied.id}::uuid
      `,
    ).rejects.toMatchObject({ code: "55000" });

    const deleted = await admin
      .from("businesses")
      .delete()
      .eq("id", deletionBusiness.id);
    expect(deleted.error).toBeNull();
    for (const table of [
      "businesses",
      "business_memberships",
      "configuration_change_sets",
      "configuration_versions",
      "business_configuration_heads",
      "object_definitions",
      "records",
    ] as const) {
      const [remaining] = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from ${sql(table)}
        where ${
          table === "businesses" ? sql("id") : sql("business_id")
        } = ${deletionBusiness.id}::uuid
      `;
      expect(remaining?.count, `${table} did not cascade`).toBe(0);
    }
  });
});
