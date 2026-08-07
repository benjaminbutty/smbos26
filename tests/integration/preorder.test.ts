import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createExperienceService } from "../../src/core/experience/service";
import { defaultPreorderEmailAdapter } from "../../src/core/preorder/email";
import {
  claimPreorderConfirmationEmail,
  completePreorderConfirmationEmail,
} from "../../src/core/preorder/service";
import {
  publicPreorderCatalogueSchema,
  publicPreorderResultSchema,
  type PreorderConfig,
  type PublicPreorderCatalogue,
  type PublicPreorderResult,
  type PublicPreorderSubmission,
} from "../../src/core/preorder/schemas";
import { processPreorderSubmission } from "../../src/app/api/preorder/[businessSlug]/[pageSlug]/route";
import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import { submitExperienceForm } from "../../src/runtime/forms/submission";
import { ViewRenderer } from "../../src/runtime/views/view-renderer";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";
import { createConfigurationFixtures } from "./support/configuration-fixtures";
import { createLocationWithCurrentness } from "./support/location-rpc";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type ObjectDefinition = Tables<"object_definitions">;
type ProductRecord = Tables<"records">;
type RelationshipDefinition = Tables<"relationship_definitions">;

interface Identity {
  client: Client;
  user: User;
}

interface OtherTenantFixture {
  business: Business;
  location: Tables<"locations">;
  object: ObjectDefinition;
  relationship: RelationshipDefinition;
  record: ProductRecord;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
}

const password = "Milestone-4-test-password!";
const demoPassword = "Local-demo-2026!";
const businessSlug = "bedford-bakery-demo";
const preorderKey = "bakery_preorder";
const pageSlug = "preorder";
const createdUserIds: string[] = [];

let settings: LocalSupabaseSettings;
let admin: Client;
let anonymous: Client;
let owner: Client;
let staff: Client;
let administrator: Identity;
let otherOwner: Identity;
let business: Business;
let other: OtherTenantFixture;
let preorder: Tables<"preorder_experiences">;
let originalConfig: PreorderConfig;
let customerObject: ObjectDefinition;
let productObject: ObjectDefinition;
let orderObject: ObjectDefinition;
let orderItemObject: ObjectDefinition;
let relationships: Record<string, RelationshipDefinition>;
let locations: Record<string, Tables<"locations">>;
let products: Record<string, ProductRecord>;
let catalogue: PublicPreorderCatalogue;
let databaseUrl: string;
let fixtureSql: Sql;
let configurationFixtures: ReturnType<typeof createConfigurationFixtures>;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

async function signIn(email: string, loginPassword: string): Promise<Client> {
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
  const { error } = await client.auth.signInWithPassword({
    email,
    password: loginPassword,
  });
  if (error) {
    throw error;
  }
  return client;
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `m4-${Date.now()}-${label}-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}`);
  }
  createdUserIds.push(created.data.user.id);
  return {
    client: await signIn(email, password),
    user: created.data.user,
  };
}

function asObject(value: Json): Record<string, Json | undefined> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  return value;
}

function requestHash(): string {
  return createHash("sha256").update(crypto.randomUUID(), "utf8").digest("hex");
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
    `Timed out waiting for ${applicationName} to block on a row lock.`,
  );
}

async function submitRawThroughDatabase(
  connection: Sql,
  applicationName: string,
  submission: PublicPreorderSubmission,
): Promise<PublicPreorderResult> {
  return connection.begin(async (transaction) => {
    await transaction`
      select set_config('application_name', ${applicationName}, true)
    `;
    const [submitted] = await transaction<{ result: Json }[]>`
      select public.submit_public_preorder(
        ${businessSlug},
        ${pageSlug},
        ${preorderKey},
        ${transaction.json(submission as unknown as Json)}::jsonb,
        ${requestHash()}
      ) as result
    `;
    if (!submitted) {
      throw new Error("Concurrent submission returned no result.");
    }
    return publicPreorderResultSchema.parse(submitted.result);
  });
}

async function resolveCatalogue(): Promise<PublicPreorderCatalogue> {
  const { data, error } = await anonymous.rpc("resolve_public_preorder", {
    requested_business_slug: businessSlug,
    requested_page_slug: pageSlug,
    requested_preorder_key: preorderKey,
  });
  if (error) {
    throw error;
  }
  return publicPreorderCatalogueSchema.parse(data);
}

async function resolveCatalogueAt(
  referenceNow: string,
): Promise<PublicPreorderCatalogue> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [resolved] = await sql<{ catalogue: Json }[]>`
      select private.resolve_preorder_catalogue_at(
        ${businessSlug},
        ${pageSlug},
        ${preorderKey},
        ${referenceNow}::timestamptz
      ) as catalogue
    `;
    if (!resolved) {
      throw new Error("Private preorder catalogue resolver returned no row.");
    }
    return publicPreorderCatalogueSchema.parse(resolved.catalogue);
  } finally {
    await sql.end();
  }
}

function pickSlot(index: number): {
  location: Tables<"locations">;
  collectionAt: string;
} {
  const bedford = locations.Bedford;
  if (!bedford) {
    throw new Error("Bedford Location is missing.");
  }
  const resolvedLocation = catalogue.preorder.locations.find(
    ({ id }) => id === bedford.id,
  );
  const slot = resolvedLocation?.slots.filter(({ available }) => available)[
    index
  ];
  if (!slot) {
    throw new Error(`No available preorder slot at index ${index}.`);
  }
  return { location: bedford, collectionAt: slot.collection_at };
}

function baseSubmission(
  slotIndex: number,
  options?: {
    idempotencyToken?: string;
    locationId?: string;
    productId?: string;
    quantity?: number;
  },
): PublicPreorderSubmission {
  const slot = pickSlot(slotIndex);
  const product = products["Afternoon Tea Box"];
  if (!product) {
    throw new Error("Afternoon Tea Box is missing.");
  }
  return {
    idempotency_token: options?.idempotencyToken ?? crypto.randomUUID(),
    location_id: options?.locationId ?? slot.location.id,
    collection_at: slot.collectionAt,
    items: [
      {
        product_id: options?.productId ?? product.id,
        quantity: options?.quantity ?? 1,
      },
    ],
    fields: {
      customer: {
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "01234 567890",
      },
      order: {
        dietary_requirements: "Vegetarian",
        occasion: "Birthday",
      },
    },
    website: "",
  };
}

function formatCollectionDisplay(
  collectionAt: string,
  timeZone: string,
): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(new Date(collectionAt))
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

async function submitRaw(
  submission: Json,
  hash = requestHash(),
): Promise<PublicPreorderResult> {
  const { data, error } = await admin.rpc("submit_public_preorder", {
    requested_business_slug: businessSlug,
    requested_page_slug: pageSlug,
    requested_preorder_key: preorderKey,
    requested_request_hash: hash,
    submission,
  });
  if (error) {
    throw error;
  }
  return publicPreorderResultSchema.parse(data);
}

async function countGraphRows(): Promise<{
  records: number;
  relationships: number;
  locationLinks: number;
  submissions: number;
}> {
  const [recordResult, relationshipResult, linkResult, submissionResult] =
    await Promise.all([
      admin
        .from("records")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id),
      admin
        .from("record_relationships")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id),
      admin
        .from("record_location_links")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id),
      admin
        .from("preorder_submissions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id),
    ]);
  for (const result of [
    recordResult,
    relationshipResult,
    linkResult,
    submissionResult,
  ]) {
    if (result.error) {
      throw result.error;
    }
  }
  return {
    records: recordResult.count ?? 0,
    relationships: relationshipResult.count ?? 0,
    locationLinks: linkResult.count ?? 0,
    submissions: submissionResult.count ?? 0,
  };
}

async function updateConfig(config: PreorderConfig): Promise<void> {
  await configurationFixtures.updateById("preorder_experiences", preorder.id, {
    config_json: config,
  });
}

function walkSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkSourceFiles(path) : [path];
  });
}

describe("Milestone 4 preorder", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    databaseUrl = settings.databaseUrl;
    fixtureSql = postgres(databaseUrl, { max: 1 });
    configurationFixtures = createConfigurationFixtures(fixtureSql);
    execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

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
    [owner, staff] = await Promise.all([
      signIn("demo@smbos.local", demoPassword),
      signIn("staff@smbos.local", demoPassword),
    ]);
    [administrator, otherOwner] = await Promise.all([
      createIdentity("administrator"),
      createIdentity("other-owner"),
    ]);

    business = requireData(
      await admin
        .from("businesses")
        .select("*")
        .eq("slug", businessSlug)
        .single(),
      "Could not load Bedford Bakery",
    );
    const membership = await admin.from("business_memberships").insert({
      business_id: business.id,
      user_id: administrator.user.id,
      role: "admin",
    });
    if (membership.error) {
      throw membership.error;
    }

    const otherBusiness = requireData(
      await otherOwner.client.rpc("create_business", {
        business_name: `Other Bakery ${crypto.randomUUID()}`,
        requested_business_type: "bakery",
        requested_timezone: "Europe/London",
      }),
      "Could not create the other tenant",
    );
    const otherLocation = requireData(
      await createLocationWithCurrentness(
        otherOwner.client,
        otherOwner.user.id,
        otherBusiness.id,
        "Other Location",
        "Europe/London",
      ),
      "Could not create the other Location",
    );
    const otherObjects = await configurationFixtures.insert(
      "object_definitions",
      [
        {
          business_id: otherBusiness.id,
          key: "thing",
          singular_label: "Thing",
          plural_label: "Things",
          description: "",
          kind: "custom",
        },
        {
          business_id: otherBusiness.id,
          key: "other_thing",
          singular_label: "Other Thing",
          plural_label: "Other Things",
          description: "",
          kind: "custom",
        },
      ],
    );
    const [otherObject, otherTargetObject] = otherObjects;
    if (!otherObject || !otherTargetObject) {
      throw new Error("Other tenant Objects are incomplete.");
    }
    await configurationFixtures.insert("field_definitions", [
      {
        business_id: otherBusiness.id,
        object_definition_id: otherObject.id,
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        settings_json: {},
        position: 0,
      },
      {
        business_id: otherBusiness.id,
        object_definition_id: otherTargetObject.id,
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        settings_json: {},
        position: 0,
      },
    ]);
    const [otherRelationship] = await configurationFixtures.insert(
      "relationship_definitions",
      {
        business_id: otherBusiness.id,
        key: "thing_has_other",
        source_object_definition_id: otherObject.id,
        target_object_definition_id: otherTargetObject.id,
        source_label: "has",
        target_label: "belongs to",
        cardinality: "one_to_many",
        is_required: false,
      },
    );
    if (!otherRelationship) {
      throw new Error("Could not create the other tenant Relationship");
    }
    const otherRecord = requireData(
      await otherOwner.client
        .from("records")
        .insert({
          business_id: otherBusiness.id,
          object_definition_id: otherObject.id,
          data_json: { name: "Other tenant product" },
        })
        .select("*")
        .single(),
      "Could not create the other tenant Record",
    );
    other = {
      business: otherBusiness,
      location: otherLocation,
      object: otherObject,
      relationship: otherRelationship,
      record: otherRecord,
    };

    const [objectRows, relationshipRows, locationRows, preorderRow] =
      await Promise.all([
        owner
          .from("object_definitions")
          .select("*")
          .eq("business_id", business.id),
        owner
          .from("relationship_definitions")
          .select("*")
          .eq("business_id", business.id),
        admin.from("locations").select("*").eq("business_id", business.id),
        owner
          .from("preorder_experiences")
          .select("*")
          .eq("business_id", business.id)
          .eq("key", preorderKey)
          .single(),
      ]);
    if (
      objectRows.error ||
      relationshipRows.error ||
      locationRows.error ||
      preorderRow.error
    ) {
      throw (
        objectRows.error ??
        relationshipRows.error ??
        locationRows.error ??
        preorderRow.error
      );
    }
    const objectByKey = Object.fromEntries(
      (objectRows.data ?? []).map((object) => [object.key, object]),
    );
    const demoCustomerObject = objectByKey.customer;
    const demoProductObject = objectByKey.product;
    const demoOrderObject = objectByKey.order;
    const demoOrderItemObject = objectByKey.order_item;
    if (
      !demoCustomerObject ||
      !demoProductObject ||
      !demoOrderObject ||
      !demoOrderItemObject
    ) {
      throw new Error("Demo graph Objects are incomplete.");
    }
    customerObject = demoCustomerObject;
    productObject = demoProductObject;
    orderObject = demoOrderObject;
    orderItemObject = demoOrderItemObject;
    relationships = Object.fromEntries(
      (relationshipRows.data ?? []).map((relationship) => [
        relationship.key,
        relationship,
      ]),
    );
    locations = Object.fromEntries(
      (locationRows.data ?? []).map((location) => [location.name, location]),
    );
    preorder = preorderRow.data;
    originalConfig = preorder.config_json as PreorderConfig;

    const productRows = requireData(
      await admin
        .from("records")
        .select("*")
        .eq("business_id", business.id)
        .eq("object_definition_id", productObject.id),
      "Could not load demo Products",
    );
    products = Object.fromEntries(
      productRows.map((product) => [
        String(asObject(product.data_json).name),
        product,
      ]),
    );
    catalogue = await resolveCatalogue();
  }, 60_000);

  afterAll(async () => {
    if (admin && other?.business) {
      await admin.from("businesses").delete().eq("id", other.business.id);
    }
    if (fixtureSql && business) {
      await fixtureSql`
        delete from public.businesses
        where id = ${business.id}::uuid
      `;
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
    if (fixtureSql) {
      await fixtureSql.end();
    }
  });

  it("denies unversioned preorder configuration writes for every member role", async () => {
    const changedConfig = structuredClone(originalConfig);
    changedConfig.schedule.cutoff_hours = 72;
    const adminUpdate = await administrator.client
      .from("preorder_experiences")
      .update({ config_json: changedConfig })
      .eq("business_id", business.id)
      .eq("id", preorder.id)
      .select("id");
    expect(adminUpdate.error?.code).toBe("42501");
    expect(adminUpdate.data).toBeNull();

    const staffUpdate = await staff
      .from("preorder_experiences")
      .update({ config_json: originalConfig })
      .eq("business_id", business.id)
      .eq("id", preorder.id)
      .select("id");
    expect(staffUpdate.error?.code).toBe("42501");
    expect(staffUpdate.data).toBeNull();

    const otherRead = await otherOwner.client
      .from("preorder_experiences")
      .select("id")
      .eq("business_id", business.id);
    expect(otherRead.error).toBeNull();
    expect(otherRead.data).toEqual([]);
    const otherUpdate = await otherOwner.client
      .from("preorder_experiences")
      .update({ config_json: originalConfig })
      .eq("business_id", business.id)
      .eq("id", preorder.id)
      .select("id");
    expect(otherUpdate.error?.code).toBe("42501");
    expect(otherUpdate.data).toBeNull();
  });

  it("structurally rejects cross-tenant Object, Relationship, Record and Location references", async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    const constraints = await sql<{ conname: string }[]>`
      select conname
      from pg_constraint
      where conname in (
        'preorder_experiences_tenant_product_object_fkey',
        'preorder_experiences_tenant_customer_order_relationship_fkey',
        'record_location_links_tenant_record_fkey',
        'record_location_links_tenant_location_fkey'
      )
    `;
    await sql.end();
    expect(constraints.map(({ conname }) => conname).sort()).toEqual(
      [
        "preorder_experiences_tenant_customer_order_relationship_fkey",
        "preorder_experiences_tenant_product_object_fkey",
        "record_location_links_tenant_location_fkey",
        "record_location_links_tenant_record_fkey",
      ].sort(),
    );

    const customerRelationship = relationships.customer_places_order;
    const itemRelationship = relationships.order_contains_order_item;
    const productRelationship = relationships.product_appears_in_order_item;
    if (!customerRelationship || !itemRelationship || !productRelationship) {
      throw new Error("Demo Relationships are incomplete.");
    }
    await expect(
      configurationFixtures.insert("preorder_experiences", {
        business_id: business.id,
        key: `cross_object_${crypto.randomUUID().replaceAll("-", "")}`,
        product_object_definition_id: other.object.id,
        customer_object_definition_id: customerObject.id,
        order_object_definition_id: orderObject.id,
        order_item_object_definition_id: orderItemObject.id,
        customer_places_order_relationship_definition_id:
          customerRelationship.id,
        order_contains_item_relationship_definition_id: itemRelationship.id,
        product_appears_in_item_relationship_definition_id:
          productRelationship.id,
        config_json: originalConfig,
        is_active: false,
      }),
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      configurationFixtures.insert("preorder_experiences", {
        business_id: business.id,
        key: `cross_relationship_${crypto.randomUUID().replaceAll("-", "")}`,
        product_object_definition_id: productObject.id,
        customer_object_definition_id: customerObject.id,
        order_object_definition_id: orderObject.id,
        order_item_object_definition_id: orderItemObject.id,
        customer_places_order_relationship_definition_id: other.relationship.id,
        order_contains_item_relationship_definition_id: itemRelationship.id,
        product_appears_in_item_relationship_definition_id:
          productRelationship.id,
        config_json: originalConfig,
        is_active: false,
      }),
    ).rejects.toMatchObject({ code: "23503" });

    const bedford = locations.Bedford;
    const product = products["Afternoon Tea Box"];
    if (!bedford || !product) {
      throw new Error("Demo availability data is incomplete.");
    }
    const recordAttempt = await admin.from("record_location_links").insert({
      business_id: business.id,
      record_id: other.record.id,
      location_id: bedford.id,
    });
    expect(recordAttempt.error).not.toBeNull();
    const locationAttempt = await admin.from("record_location_links").insert({
      business_id: business.id,
      record_id: product.id,
      location_id: other.location.id,
    });
    expect(locationAttempt.error).not.toBeNull();
  });

  it("rejects uncovered required Fields for every preorder-created Object", async () => {
    for (const [objectDefinition, key] of [
      [customerObject, "uncovered_customer"],
      [orderObject, "uncovered_order"],
      [orderItemObject, "uncovered_order_item"],
    ] as const) {
      await expect(
        configurationFixtures.insert("field_definitions", {
          business_id: business.id,
          object_definition_id: objectDefinition.id,
          key,
          label: `Uncovered ${objectDefinition.singular_label}`,
          field_type: "short_text",
          required: true,
          settings_json: {},
          position: 90,
        }),
      ).rejects.toMatchObject({ code: "23514" });

      const persisted = await owner
        .from("field_definitions")
        .select("id")
        .eq("business_id", business.id)
        .eq("object_definition_id", objectDefinition.id)
        .eq("key", key);
      expect(persisted.error).toBeNull();
      expect(persisted.data).toEqual([]);
    }
  });

  it("rejects removal of required public coverage while permitting optional Fields", async () => {
    const fieldKey = `company_${crypto.randomUUID().replaceAll("-", "")}`;
    const [optionalField] = await configurationFixtures.insert(
      "field_definitions",
      {
        business_id: business.id,
        object_definition_id: customerObject.id,
        key: fieldKey,
        label: "Company",
        field_type: "short_text",
        required: false,
        settings_json: {},
        position: 90,
      },
    );
    if (!optionalField) {
      throw new Error("Could not add an optional Customer Field");
    }

    const coveredConfig = structuredClone(originalConfig);
    coveredConfig.public_fields.push({
      target: "customer",
      field: fieldKey,
      label: "Company",
      required: true,
      autocomplete: "organization",
    });
    await updateConfig(coveredConfig);

    await configurationFixtures.updateById(
      "field_definitions",
      optionalField.id,
      { required: true },
    );

    const uncoveredConfig = structuredClone(coveredConfig);
    uncoveredConfig.public_fields = uncoveredConfig.public_fields.filter(
      ({ target, field }) => !(target === "customer" && field === fieldKey),
    );
    await expect(
      configurationFixtures.updateById("preorder_experiences", preorder.id, {
        config_json: uncoveredConfig,
      }),
    ).rejects.toMatchObject({ code: "23514" });

    const retained = requireData(
      await owner
        .from("preorder_experiences")
        .select("config_json")
        .eq("business_id", business.id)
        .eq("id", preorder.id)
        .single(),
      "Could not reload retained preorder configuration",
    );
    expect(
      (retained.config_json as PreorderConfig).public_fields.some(
        ({ target, field }) => target === "customer" && field === fieldKey,
      ),
    ).toBe(true);

    await configurationFixtures.updateById(
      "field_definitions",
      optionalField.id,
      { required: false },
    );
    await updateConfig(originalConfig);
    await configurationFixtures.updateById(
      "field_definitions",
      optionalField.id,
      { is_active: false },
    );
  });

  it("permits a required default only when the Record insert path applies it", async () => {
    const [defaultField] = await configurationFixtures.insert(
      "field_definitions",
      {
        business_id: business.id,
        object_definition_id: orderItemObject.id,
        key: "packing_note",
        label: "Packing note",
        field_type: "short_text",
        required: true,
        default_value: "Standard",
        settings_json: {},
        position: 90,
      },
    );
    if (!defaultField) {
      throw new Error("Could not add the default-backed Order Item Field");
    }

    const submitted = await submitRaw(baseSubmission(0));
    expect(submitted.ok).toBe(true);
    const itemRecords = requireData(
      await owner
        .from("records")
        .select("data_json")
        .eq("business_id", business.id)
        .eq("object_definition_id", orderItemObject.id),
      "Could not load default-backed Order Items",
    );
    expect(
      itemRecords.some(
        ({ data_json }) => asObject(data_json).packing_note === "Standard",
      ),
    ).toBe(true);

    await configurationFixtures.updateById(
      "field_definitions",
      defaultField.id,
      { is_active: false },
    );
  });

  it("does not use an absent Customer phone default to cover a required Order snapshot", async () => {
    const customerPhoneKey = originalConfig.field_mappings.customer.phone;
    const orderPhoneKey = originalConfig.field_mappings.order.customer_phone;
    if (!customerPhoneKey || !orderPhoneKey) {
      throw new Error("Demo phone Field mappings are incomplete.");
    }

    const customerPhoneField = requireData(
      await owner
        .from("field_definitions")
        .select("*")
        .eq("business_id", business.id)
        .eq("object_definition_id", customerObject.id)
        .eq("key", customerPhoneKey)
        .single(),
      "Could not load the Customer phone Field",
    );
    const orderPhoneField = requireData(
      await owner
        .from("field_definitions")
        .select("*")
        .eq("business_id", business.id)
        .eq("object_definition_id", orderObject.id)
        .eq("key", orderPhoneKey)
        .single(),
      "Could not load the Order customer-phone Field",
    );

    await configurationFixtures.updateById(
      "field_definitions",
      customerPhoneField.id,
      { default_value: "" },
    );

    try {
      await expect(
        configurationFixtures.updateById(
          "field_definitions",
          orderPhoneField.id,
          { required: true },
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const retainedOrderPhone = requireData(
        await owner
          .from("field_definitions")
          .select("required")
          .eq("business_id", business.id)
          .eq("id", orderPhoneField.id)
          .single(),
        "Could not reload the Order customer-phone Field",
      );
      expect(retainedOrderPhone.required).toBe(false);
    } finally {
      await configurationFixtures.updateById(
        "field_definitions",
        customerPhoneField.id,
        { default_value: null },
      );
    }
  });

  it("resolves only a published public Page with an active same-tenant preorder", async () => {
    expect(catalogue.business).toEqual({
      name: "Bedford Bakery",
      slug: businessSlug,
    });
    const draftSlug = `draft-${crypto.randomUUID()}`;
    await configurationFixtures.insert("pages", {
      business_id: business.id,
      key: `draft_${crypto.randomUUID().replaceAll("-", "")}`,
      title: "Draft preorder",
      slug: draftSlug,
      audience: "public",
      status: "draft",
      layout_json: {
        blocks: [{ type: "preorder", preorder_key: preorderKey }],
      },
    });
    const draftResolution = await anonymous.rpc("resolve_public_preorder", {
      requested_business_slug: businessSlug,
      requested_page_slug: draftSlug,
      requested_preorder_key: preorderKey,
    });
    expect(draftResolution.error).toBeNull();
    expect(draftResolution.data).toBeNull();

    await expect(
      configurationFixtures.insert("pages", {
        business_id: business.id,
        key: `internal_${crypto.randomUUID().replaceAll("-", "")}`,
        title: "Internal preorder",
        slug: `internal-${crypto.randomUUID()}`,
        audience: "internal",
        status: "published",
        layout_json: {
          blocks: [{ type: "preorder", preorder_key: preorderKey }],
        },
      }),
    ).rejects.toMatchObject({ code: "23514" });

    const inactiveKey = `inactive_${crypto.randomUUID().replaceAll("-", "")}`;
    const [inactiveExperience] = await configurationFixtures.insert(
      "preorder_experiences",
      {
        business_id: business.id,
        key: inactiveKey,
        product_object_definition_id: productObject.id,
        customer_object_definition_id: customerObject.id,
        order_object_definition_id: orderObject.id,
        order_item_object_definition_id: orderItemObject.id,
        customer_places_order_relationship_definition_id:
          relationships.customer_places_order?.id ?? "",
        order_contains_item_relationship_definition_id:
          relationships.order_contains_order_item?.id ?? "",
        product_appears_in_item_relationship_definition_id:
          relationships.product_appears_in_order_item?.id ?? "",
        config_json: originalConfig,
        is_active: false,
      },
    );
    if (!inactiveExperience) {
      throw new Error("Could not create inactive preorder fixture.");
    }
    await expect(
      configurationFixtures.insert("pages", {
        business_id: business.id,
        key: `inactive_page_${crypto.randomUUID().replaceAll("-", "")}`,
        title: "Inactive preorder",
        slug: `inactive-${crypto.randomUUID()}`,
        audience: "public",
        status: "published",
        layout_json: {
          blocks: [{ type: "preorder", preorder_key: inactiveKey }],
        },
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("excludes archived allowed Locations from catalogues and submissions", async () => {
    const miltonKeynes = locations["Milton Keynes"];
    if (!miltonKeynes) {
      throw new Error("Milton Keynes Location is missing.");
    }
    const association = requireData(
      await owner
        .from("preorder_experience_locations")
        .select("*")
        .eq("business_id", business.id)
        .eq("preorder_experience_id", preorder.id)
        .eq("location_id", miltonKeynes.id)
        .single(),
      "Could not load the allowed Location association",
    );
    const bedfordAssociation = requireData(
      await owner
        .from("preorder_experience_locations")
        .select("*")
        .eq("business_id", business.id)
        .eq("preorder_experience_id", preorder.id)
        .eq("location_id", locations.Bedford?.id ?? "")
        .single(),
      "Could not load the Bedford allowed Location association",
    );
    await expect(
      configurationFixtures.updateById(
        "preorder_experience_locations",
        association.id,
        { id: crypto.randomUUID() },
      ),
    ).rejects.toMatchObject({ code: "22023" });

    try {
      await configurationFixtures.updateById(
        "preorder_experience_locations",
        association.id,
        { is_active: false },
      );

      const filtered = await resolveCatalogue();
      expect(
        filtered.preorder.locations.some(({ id }) => id === miltonKeynes.id),
      ).toBe(false);
      expect(
        filtered.preorder.products.some(({ location_ids }) =>
          location_ids.includes(miltonKeynes.id),
        ),
      ).toBe(false);

      await expect(
        configurationFixtures.updateById(
          "preorder_experience_locations",
          bedfordAssociation.id,
          { is_active: false },
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const rejected = await submitRaw(
        baseSubmission(0, { locationId: miltonKeynes.id }),
      );
      expect(rejected).toEqual({ ok: false, code: "invalid_location" });
    } finally {
      await configurationFixtures.updateById(
        "preorder_experience_locations",
        association.id,
        { is_active: true },
      );
    }
  });

  it("does not resolve or accept submissions through an archived preorder Page", async () => {
    const page = requireData(
      await owner
        .from("pages")
        .select("*")
        .eq("business_id", business.id)
        .eq("slug", pageSlug)
        .single(),
      "Could not load the preorder Page",
    );

    try {
      await configurationFixtures.updateById("pages", page.id, {
        is_active: false,
      });

      const resolution = await anonymous.rpc("resolve_public_preorder", {
        requested_business_slug: businessSlug,
        requested_page_slug: pageSlug,
        requested_preorder_key: preorderKey,
      });
      expect(resolution.error).toBeNull();
      expect(resolution.data).toBeNull();

      const rejected = await submitRaw(baseSubmission(0));
      expect(rejected).toEqual({ ok: false, code: "not_found" });
    } finally {
      await configurationFixtures.updateById("pages", page.id, {
        is_active: true,
      });
    }
  });

  it("waits for a concurrent Page archive and rejects the stale submission", async () => {
    const page = requireData(
      await owner
        .from("pages")
        .select("id")
        .eq("business_id", business.id)
        .eq("slug", pageSlug)
        .single(),
      "Could not load the preorder Page",
    );
    const input = baseSubmission(0);
    const archiveConnection = postgres(databaseUrl, { max: 1 });
    const submissionConnection = postgres(databaseUrl, { max: 1 });
    const observer = postgres(databaseUrl, { max: 1 });
    const archiveLocked = createDeferred<void>();
    const releaseArchive = createDeferred<void>();
    const submissionApplication = `m5-page-submit-${crypto.randomUUID()}`;
    let archivePromise: Promise<unknown> | undefined;
    let submissionPromise: Promise<PublicPreorderResult> | undefined;
    let submissionSettled = false;

    try {
      archivePromise = archiveConnection.begin(async (transaction) => {
        await transaction`
          update public.pages
          set is_active = false
          where business_id = ${business.id}::uuid
            and id = ${page.id}::uuid
        `;
        archiveLocked.resolve(undefined);
        await releaseArchive.promise;
      });
      void archivePromise.catch((error) => archiveLocked.reject(error));
      await archiveLocked.promise;

      submissionPromise = submitRawThroughDatabase(
        submissionConnection,
        submissionApplication,
        input,
      ).finally(() => {
        submissionSettled = true;
      });
      await waitForDatabaseLock(observer, submissionApplication);
      expect(submissionSettled).toBe(false);

      releaseArchive.resolve(undefined);
      await archivePromise;
      expect(await submissionPromise).toEqual({
        ok: false,
        code: "not_found",
      });

      const { count } = await admin
        .from("preorder_submissions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .eq("idempotency_token", input.idempotency_token);
      expect(count).toBe(0);
    } finally {
      releaseArchive.resolve(undefined);
      await Promise.allSettled(
        [archivePromise, submissionPromise].filter(
          (promise): promise is Promise<unknown> => promise !== undefined,
        ),
      );
      await Promise.all([
        archiveConnection.end(),
        submissionConnection.end(),
        observer.end(),
      ]);
      await configurationFixtures.updateById("pages", page.id, {
        is_active: true,
      });
    }
  });

  it("waits for a concurrent allowed-Location archive and rejects the stale submission", async () => {
    const miltonKeynes = locations["Milton Keynes"];
    if (!miltonKeynes) {
      throw new Error("Milton Keynes Location is missing.");
    }
    const association = requireData(
      await owner
        .from("preorder_experience_locations")
        .select("id")
        .eq("business_id", business.id)
        .eq("preorder_experience_id", preorder.id)
        .eq("location_id", miltonKeynes.id)
        .single(),
      "Could not load the allowed Location association",
    );
    const input = baseSubmission(0, { locationId: miltonKeynes.id });
    const archiveConnection = postgres(databaseUrl, { max: 1 });
    const submissionConnection = postgres(databaseUrl, { max: 1 });
    const observer = postgres(databaseUrl, { max: 1 });
    const archiveLocked = createDeferred<void>();
    const releaseArchive = createDeferred<void>();
    const submissionApplication = `m5-location-submit-${crypto.randomUUID()}`;
    let archivePromise: Promise<unknown> | undefined;
    let submissionPromise: Promise<PublicPreorderResult> | undefined;
    let submissionSettled = false;

    try {
      archivePromise = archiveConnection.begin(async (transaction) => {
        await transaction`
          update public.preorder_experience_locations
          set is_active = false
          where business_id = ${business.id}::uuid
            and id = ${association.id}::uuid
        `;
        archiveLocked.resolve(undefined);
        await releaseArchive.promise;
      });
      void archivePromise.catch((error) => archiveLocked.reject(error));
      await archiveLocked.promise;

      submissionPromise = submitRawThroughDatabase(
        submissionConnection,
        submissionApplication,
        input,
      ).finally(() => {
        submissionSettled = true;
      });
      await waitForDatabaseLock(observer, submissionApplication);
      expect(submissionSettled).toBe(false);

      releaseArchive.resolve(undefined);
      await archivePromise;
      expect(await submissionPromise).toEqual({
        ok: false,
        code: "invalid_location",
      });

      const { count } = await admin
        .from("preorder_submissions")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .eq("idempotency_token", input.idempotency_token);
      expect(count).toBe(0);
    } finally {
      releaseArchive.resolve(undefined);
      await Promise.allSettled(
        [archivePromise, submissionPromise].filter(
          (promise): promise is Promise<unknown> => promise !== undefined,
        ),
      );
      await Promise.all([
        archiveConnection.end(),
        submissionConnection.end(),
        observer.end(),
      ]);
      await configurationFixtures.updateById(
        "preorder_experience_locations",
        association.id,
        { is_active: true },
      );
    }
  });

  it("canonically snapshots preorder configuration without operational rows", async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const [resolved] = await sql<{ snapshot: Json }[]>`
        select private.configuration_snapshot_v1(
          ${business.id}::uuid
        ) as snapshot
      `;
      const snapshot = asObject(resolved?.snapshot ?? null);
      const experiences = snapshot.preorder_experiences;
      const associations = snapshot.preorder_experience_locations;
      const pages = snapshot.pages;
      if (
        !Array.isArray(experiences) ||
        !Array.isArray(associations) ||
        !Array.isArray(pages)
      ) {
        throw new Error("Canonical preorder snapshot arrays are missing.");
      }

      expect(
        experiences.some(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            value.id === preorder.id &&
            value.key === preorderKey,
        ),
      ).toBe(true);
      const mainAssociations = associations.filter(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value) &&
          value.preorder_experience_id === preorder.id,
      );
      expect(mainAssociations).toHaveLength(2);
      expect(
        mainAssociations.every(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            value.is_active === true &&
            typeof value.id === "string" &&
            typeof value.location_id === "string",
        ),
      ).toBe(true);
      expect(
        pages.some(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            value.slug === pageSlug &&
            value.status === "published" &&
            value.is_active === true,
        ),
      ).toBe(true);

      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain("business_id");
      expect(serialized).not.toContain(products["Afternoon Tea Box"]?.id ?? "");
      expect(snapshot).not.toHaveProperty("records");
      expect(snapshot).not.toHaveProperty("record_location_links");
      expect(snapshot).not.toHaveProperty("preorder_submissions");
      expect(snapshot).not.toHaveProperty("preorder_slot_counters");
      expect(snapshot).not.toHaveProperty("preorder_rate_limits");
    } finally {
      await sql.end();
    }
  });

  it("uses authoritative server time and rejects an anonymous alternate clock", async () => {
    const current = await resolveCatalogue();
    expect(
      Math.abs(Date.now() - new Date(current.generated_at).valueOf()),
    ).toBeLessThan(60_000);

    const historicalCollection = "2025-08-02T10:00:00+00:00";
    const historicalCounter = await admin.from("preorder_slot_counters").upsert(
      {
        business_id: business.id,
        preorder_experience_id: preorder.id,
        location_id: locations.Bedford?.id ?? "",
        collection_at: historicalCollection,
        reservation_count: 10,
      },
      {
        onConflict:
          "business_id,preorder_experience_id,location_id,collection_at",
      },
    );
    expect(historicalCounter.error).toBeNull();

    const normalResolution = await resolveCatalogue();
    expect(
      normalResolution.preorder.locations
        .flatMap(({ slots }) => slots)
        .some(
          ({ collection_at }) =>
            new Date(collection_at).toISOString() ===
            new Date(historicalCollection).toISOString(),
        ),
    ).toBe(false);

    const forgedClock = await anonymous.rpc("resolve_public_preorder", {
      requested_business_slug: businessSlug,
      requested_page_slug: pageSlug,
      requested_preorder_key: preorderKey,
      reference_now: "2025-07-28T10:00:00+00:00",
    } as never);
    expect(forgedClock.error).not.toBeNull();
    expect(forgedClock.data).toBeNull();

    const cleanup = await admin
      .from("preorder_slot_counters")
      .delete()
      .eq("business_id", business.id)
      .eq("preorder_experience_id", preorder.id)
      .eq("location_id", locations.Bedford?.id ?? "")
      .eq("collection_at", historicalCollection);
    expect(cleanup.error).toBeNull();
  });

  it("keeps deterministic cutoff and horizon checks behind a private boundary", async () => {
    const deterministic = structuredClone(originalConfig);
    deterministic.schedule = {
      ...deterministic.schedule,
      days_of_week: [6],
      start_time: "11:00",
      end_time: "11:00",
      cutoff_hours: 48,
      booking_horizon_days: 2,
    };

    try {
      await updateConfig(deterministic);
      const exactlyAtCutoff = await resolveCatalogueAt(
        "2026-07-30T10:00:00+00:00",
      );
      expect(
        exactlyAtCutoff.preorder.locations
          .flatMap(({ slots }) => slots)
          .some(
            ({ collection_at }) =>
              new Date(collection_at).toISOString() ===
              "2026-08-01T10:00:00.000Z",
          ),
      ).toBe(true);

      const insideCutoff = await resolveCatalogueAt(
        "2026-07-30T10:01:00+00:00",
      );
      expect(
        insideCutoff.preorder.locations
          .flatMap(({ slots }) => slots)
          .some(
            ({ collection_at }) =>
              new Date(collection_at).toISOString() ===
              "2026-08-01T10:00:00.000Z",
          ),
      ).toBe(false);

      const shortHorizon = structuredClone(deterministic);
      shortHorizon.schedule.cutoff_hours = 0;
      shortHorizon.schedule.booking_horizon_days = 1;
      await updateConfig(shortHorizon);
      const horizonOne = await resolveCatalogueAt("2026-07-30T10:00:00+00:00");
      expect(
        horizonOne.preorder.locations.flatMap(({ slots }) => slots),
      ).toEqual([]);

      await updateConfig({
        ...shortHorizon,
        schedule: {
          ...shortHorizon.schedule,
          booking_horizon_days: 2,
        },
      });
      const horizonTwo = await resolveCatalogueAt("2026-07-30T10:00:00+00:00");
      expect(
        horizonTwo.preorder.locations
          .flatMap(({ slots }) => slots)
          .some(({ date }) => date === "2026-08-01"),
      ).toBe(true);
    } finally {
      await updateConfig(originalConfig);
    }
  });

  it("keeps generic and preorder tables private from anonymous callers", async () => {
    for (const table of [
      "records",
      "views",
      "forms",
      "preorder_experiences",
      "preorder_experience_locations",
      "preorder_slot_counters",
      "preorder_submissions",
    ] as const) {
      const result = await anonymous.from(table).select("*").limit(1);
      expect(
        result.error !== null ||
          result.data === null ||
          result.data.length === 0,
      ).toBe(true);
    }

    const directWrite = await anonymous.rpc("submit_public_preorder", {
      requested_business_slug: businessSlug,
      requested_page_slug: pageSlug,
      requested_preorder_key: preorderKey,
      requested_request_hash: requestHash(),
      submission: baseSubmission(0),
    });
    expect(directWrite.error).not.toBeNull();
    expect(directWrite.data).toBeNull();
  });

  it("returns only allow-listed active catalogue data and enforces Location availability", async () => {
    expect(Object.keys(catalogue).sort()).toEqual(
      ["business", "generated_at", "page", "preorder"].sort(),
    );
    expect(Object.keys(catalogue.preorder).sort()).toEqual(
      [
        "currency",
        "key",
        "locations",
        "products",
        "public_fields",
        "schedule",
      ].sort(),
    );
    for (const product of catalogue.preorder.products) {
      expect(Object.keys(product).sort()).toEqual(
        ["description", "id", "image_url", "location_ids", "name", "price"]
          .filter((key) => key !== "image_url" || product.image_url)
          .sort(),
      );
      expect(product).not.toHaveProperty("data_json");
      expect(product).not.toHaveProperty("status");
    }
    const localTimes = catalogue.preorder.locations.flatMap(({ slots }) =>
      slots.slice(0, 11).map(({ time }) => time),
    );
    expect(new Set(localTimes)).toEqual(
      new Set([
        "11:00",
        "11:30",
        "12:00",
        "12:30",
        "13:00",
        "13:30",
        "14:00",
        "14:30",
        "15:00",
        "15:30",
        "16:00",
      ]),
    );
    const firstSlot = catalogue.preorder.locations[0]?.slots[0];
    if (!firstSlot) {
      throw new Error("The public catalogue has no slots.");
    }
    expect(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Europe/London",
      }).format(new Date(firstSlot.collection_at)),
    ).toBe(firstSlot.time);

    const kids = catalogue.preorder.products.find(
      ({ name }) => name === "Kids Afternoon Tea",
    );
    expect(kids?.location_ids).toEqual([locations.Bedford?.id]);
    const miltonKeynes = locations["Milton Keynes"];
    const kidsProduct = products["Kids Afternoon Tea"];
    if (!miltonKeynes || !kidsProduct) {
      throw new Error("Seeded product availability is incomplete.");
    }
    const ownerIdentity = await owner.auth.getUser();
    if (ownerIdentity.error || !ownerIdentity.data.user) {
      throw ownerIdentity.error ?? new Error("Could not resolve the Owner.");
    }

    const preparedUnlink = await owner.rpc(
      "get_confirmed_record_location_link_state",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerIdentity.data.user.id,
        target_object_key: "product",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Kids Afternoon Tea",
        },
        target_location_id: locations.Bedford?.id ?? "",
        requested_action: "unlink",
      },
    );
    expect(preparedUnlink.error).toBeNull();
    expect(preparedUnlink.data).toMatchObject({
      state: "ready",
      target_record_id: kidsProduct.id,
      target_location_id: locations.Bedford?.id,
      expected_pair_state: "linked",
    });
    const preparedUnlinkPair = await owner
      .from("record_location_links")
      .select("id")
      .eq("business_id", business.id)
      .eq("record_id", kidsProduct.id)
      .eq("location_id", locations.Bedford?.id ?? "")
      .single();
    if (preparedUnlinkPair.error || !preparedUnlinkPair.data) {
      throw (
        preparedUnlinkPair.error ??
        new Error("Missing Product Location connection.")
      );
    }
    const removed = await owner.rpc("remove_record_location_link", {
      expected_business_id: business.id,
      target_record_location_link_id: preparedUnlinkPair.data.id,
    });
    expect(removed.error).toBeNull();
    const withoutKids = await resolveCatalogue();
    expect(
      withoutKids.preorder.products.some(
        ({ name }) => name === "Kids Afternoon Tea",
      ),
    ).toBe(false);
    expect(
      withoutKids.preorder.products.find(
        ({ name }) => name === "Afternoon Tea Box",
      )?.location_ids,
    ).toEqual(
      catalogue.preorder.products.find(
        ({ name }) => name === "Afternoon Tea Box",
      )?.location_ids,
    );
    const restoredKids = await owner.rpc("create_record_location_link", {
      expected_business_id: business.id,
      target_record_id: kidsProduct.id,
      target_location_id: locations.Bedford?.id ?? "",
    });
    expect(restoredKids.error).toBeNull();

    const unavailable = await submitRaw(
      baseSubmission(1, {
        locationId: miltonKeynes.id,
        productId: kidsProduct.id,
      }),
    );
    expect(unavailable).toEqual({ ok: false, code: "unavailable_product" });
    const otherProduct = await submitRaw(
      baseSubmission(1, { productId: other.record.id }),
    );
    expect(otherProduct).toEqual({
      ok: false,
      code: "unavailable_product",
    });

    const inactiveProduct = requireData(
      await owner
        .from("records")
        .insert({
          business_id: business.id,
          object_definition_id: productObject.id,
          data_json: {
            name: "Hidden Box",
            description: "Not publicly available.",
            price: 12,
            status: "Inactive",
          },
        })
        .select("*")
        .single(),
      "Could not create inactive Product",
    );
    const inactiveLink = await owner.rpc("create_record_location_link", {
      expected_business_id: business.id,
      target_record_id: inactiveProduct.id,
      target_location_id: locations.Bedford?.id ?? "",
    });
    expect(inactiveLink.error).toBeNull();

    const inactiveLocation = requireData(
      await createLocationWithCurrentness(
        owner,
        undefined,
        business.id,
        `Inactive ${crypto.randomUUID()}`,
        "Europe/London",
      ),
      "Could not create inactive Location",
    );
    const [inactiveAssociation] = await configurationFixtures.insert(
      "preorder_experience_locations",
      {
        business_id: business.id,
        preorder_experience_id: preorder.id,
        location_id: inactiveLocation.id,
      },
    );
    if (!inactiveAssociation) {
      throw new Error("Could not add the inactive Location fixture.");
    }
    const deactivated = await owner
      .from("locations")
      .update({ is_active: false })
      .eq("business_id", business.id)
      .eq("id", inactiveLocation.id);
    expect(deactivated.error).toBeNull();

    const filtered = await resolveCatalogue();
    expect(
      filtered.preorder.products.some(({ name }) => name === "Hidden Box"),
    ).toBe(false);
    expect(
      filtered.preorder.locations.some(({ id }) => id === inactiveLocation.id),
    ).toBe(false);
    await configurationFixtures.deleteById(
      "preorder_experience_locations",
      inactiveAssociation.id,
    );
  });

  it("rejects invalid slots, cutoffs, horizons, fields, quantities and forged values", async () => {
    const valid = baseSubmission(2);
    const invalidTime = {
      ...valid,
      idempotency_token: crypto.randomUUID(),
      collection_at: new Date(
        new Date(valid.collection_at).valueOf() + 15 * 60_000,
      ).toISOString(),
    };
    expect(await submitRaw(invalidTime)).toEqual({
      ok: false,
      code: "invalid_slot",
    });

    const missingProduct = { ...valid, items: [] };
    expect(await submitRaw(missingProduct)).toEqual({
      ok: false,
      code: "invalid_submission",
    });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        items: [{ ...valid.items[0], quantity: 0 }],
      }),
    ).toEqual({ ok: false, code: "invalid_quantity" });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        items: [{ ...valid.items[0], quantity: 1.5 }],
      }),
    ).toEqual({ ok: false, code: "invalid_quantity" });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        items: [{ ...valid.items[0], quantity: 21 }],
      }),
    ).toEqual({ ok: false, code: "invalid_quantity" });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        fields: {
          customer: { email: "missing-name@example.test" },
          order: {},
        },
      }),
    ).toEqual({ ok: false, code: "required_field" });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        fields: {
          customer: {
            ...valid.fields.customer,
            arbitrary_url: "https://example.test/unsafe",
          },
          order: valid.fields.order,
        },
      }),
    ).toEqual({ ok: false, code: "unsupported_field" });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        business_id: other.business.id,
      }),
    ).toEqual({ ok: false, code: "invalid_submission" });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        created_by: otherOwner.user.id,
        total: 0.01,
      }),
    ).toEqual({ ok: false, code: "invalid_submission" });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        items: [
          {
            ...valid.items[0],
            unit_price: 0.01,
            line_total: 0.01,
          },
        ],
      }),
    ).toEqual({ ok: false, code: "invalid_quantity" });
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        website: "bot.example",
      }),
    ).toEqual({ ok: false, code: "rejected" });

    const cutoffConfig = structuredClone(originalConfig);
    cutoffConfig.schedule = {
      ...cutoffConfig.schedule,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      start_time: "00:00",
      end_time: "23:55",
      slot_interval_minutes: 5,
      cutoff_hours: 48,
    };
    await updateConfig(cutoffConfig);
    const nearCollection = new Date(
      Math.ceil((Date.now() + 60 * 60_000) / (5 * 60_000)) * (5 * 60_000),
    ).toISOString();
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        collection_at: nearCollection,
      }),
    ).toEqual({ ok: false, code: "invalid_slot" });

    const horizonConfig = structuredClone(cutoffConfig);
    horizonConfig.schedule.cutoff_hours = 0;
    horizonConfig.schedule.booking_horizon_days = 1;
    await updateConfig(horizonConfig);
    const beyondHorizon = new Date(
      Math.ceil((Date.now() + 3 * 24 * 60 * 60_000) / (5 * 60_000)) *
        (5 * 60_000),
    ).toISOString();
    expect(
      await submitRaw({
        ...valid,
        idempotency_token: crypto.randomUUID(),
        collection_at: beyondHorizon,
      }),
    ).toEqual({ ok: false, code: "invalid_slot" });
    await updateConfig(originalConfig);
  });

  it("rolls back Customer, Order, Order Items, Relationships, Location and capacity on forced failure", async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    await sql`
      create or replace function private.test_force_preorder_bundle_failure()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        raise exception 'controlled_test_failure' using errcode = 'P0001';
      end;
      $$
    `;
    await sql`
      create trigger test_force_preorder_bundle_failure
      before insert on public.record_relationships
      for each row
      execute function private.test_force_preorder_bundle_failure()
    `;

    try {
      const before = await countGraphRows();
      const slot = pickSlot(3);
      const result = await submitRaw(baseSubmission(3));
      const after = await countGraphRows();
      expect(result).toEqual({ ok: false, code: "invalid_submission" });
      expect(after).toEqual(before);
      const counter = await admin
        .from("preorder_slot_counters")
        .select("reservation_count")
        .eq("business_id", business.id)
        .eq("preorder_experience_id", preorder.id)
        .eq("location_id", slot.location.id)
        .eq("collection_at", slot.collectionAt);
      expect(counter.error).toBeNull();
      expect(counter.data).toEqual([]);
    } finally {
      await sql`
        drop trigger if exists test_force_preorder_bundle_failure
        on public.record_relationships
      `;
      await sql`
        drop function if exists private.test_force_preorder_bundle_failure()
      `;
      await sql.end();
    }
  });

  it("creates an authoritative generic graph bundle and immutable snapshots atomically", async () => {
    const before = await countGraphRows();
    const submission = baseSubmission(4, { quantity: 2 });
    const result = await submitRaw(submission);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected successful preorder.");
    }
    const after = await countGraphRows();
    expect(after.records - before.records).toBe(3);
    expect(after.relationships - before.relationships).toBe(3);
    expect(after.locationLinks - before.locationLinks).toBe(1);
    expect(after.submissions - before.submissions).toBe(1);
    expect(result.confirmation.total).toBe(60);
    expect(result.confirmation.items).toEqual([
      {
        name: "Afternoon Tea Box",
        quantity: 2,
        unit_price: 30,
        line_total: 60,
      },
    ]);
    expect(Object.keys(result.confirmation).sort()).toEqual(
      [
        "collection_at",
        "collection_location",
        "confirmation_email",
        "item_summary",
        "items",
        "public_reference",
        "timezone",
        "total",
      ].sort(),
    );
    expect(result.confirmation.public_reference).toMatch(/^PO-[A-F0-9]{8}$/);
    expect(JSON.stringify(result.confirmation)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );

    const orderRows = requireData(
      await admin
        .from("records")
        .select("*")
        .eq("business_id", business.id)
        .eq("object_definition_id", orderObject.id),
      "Could not load Orders",
    );
    const order = orderRows.find(
      (record) =>
        asObject(record.data_json).public_reference ===
        result.confirmation.public_reference,
    );
    expect(order?.created_by).toBeNull();
    expect(order && asObject(order.data_json)).toMatchObject({
      public_reference: result.confirmation.public_reference,
      customer_name: "Ada Lovelace",
      customer_email: "ada@example.test",
      customer_phone: "01234 567890",
      dietary_requirements: "Vegetarian",
      occasion: "Birthday",
      collection_location_name: "Bedford",
      collection_timezone: "Europe/London",
      item_summary: "2 × Afternoon Tea Box",
      total: 60,
      status: "New",
    });

    if (!order || !locations.Bedford) {
      throw new Error("The submitted Order or Bedford Location is missing.");
    }
    const genericAvailabilityAttempt = await owner.rpc(
      "create_record_location_link",
      {
        expected_business_id: business.id,
        target_record_id: order.id,
        target_location_id: locations.Bedford.id,
      },
    );
    expect(genericAvailabilityAttempt.data).toBeNull();
    expect(genericAvailabilityAttempt.error?.message).toMatch(
      /record_location_link_object_ineligible/,
    );
    const orderLink = await owner
      .from("record_location_links")
      .select("id")
      .eq("business_id", business.id)
      .eq("record_id", order.id)
      .eq("location_id", locations.Bedford.id)
      .single();
    if (orderLink.error || !orderLink.data) {
      throw (
        orderLink.error ??
        new Error("The submitted Order connection is missing.")
      );
    }
    const genericUnlinkAttempt = await owner.rpc(
      "remove_record_location_link",
      {
        expected_business_id: business.id,
        target_record_location_link_id: orderLink.data.id,
      },
    );
    expect(genericUnlinkAttempt.data).toBeNull();
    expect(genericUnlinkAttempt.error?.message).toMatch(
      /record_location_link_object_ineligible/,
    );

    const product = products["Afternoon Tea Box"];
    if (!product) {
      throw new Error("Product is missing.");
    }
    const changedProduct = await owner.rpc("update_graph_record", {
      expected_business_id: business.id,
      target_record_id: product.id,
      data_patch: { name: "Renamed Tea Box", price: 99 },
    });
    expect(changedProduct.error).toBeNull();
    const unchangedOrder = requireData(
      await admin
        .from("records")
        .select("data_json")
        .eq("business_id", business.id)
        .eq("id", order?.id ?? "")
        .single(),
      "Could not reload Order snapshot",
    );
    expect(asObject(unchangedOrder.data_json)).toMatchObject({
      item_summary: "2 × Afternoon Tea Box",
      total: 60,
    });
    const restoreProduct = await owner.rpc("update_graph_record", {
      expected_business_id: business.id,
      target_record_id: product.id,
      data_patch: { name: "Afternoon Tea Box", price: 30 },
    });
    expect(restoreProduct.error).toBeNull();
  });

  it("uses an atomic counter so 11 concurrent requests yield 10 Orders and one sold-out result", async () => {
    const capacityConfig = structuredClone(originalConfig);
    capacityConfig.schedule.slot_capacity = 10;
    await updateConfig(capacityConfig);
    const beforeOrders = requireData(
      await admin
        .from("records")
        .select("id")
        .eq("business_id", business.id)
        .eq("object_definition_id", orderObject.id),
      "Could not count Orders before concurrency",
    ).length;
    const slot = pickSlot(5);
    const submissions = Array.from({ length: 11 }, () =>
      submitRaw(baseSubmission(5), requestHash()),
    );
    const results = await Promise.all(submissions);
    expect(results.filter((result) => result.ok)).toHaveLength(10);
    expect(
      results.filter((result) => !result.ok && result.code === "sold_out"),
    ).toHaveLength(1);

    const afterOrders = requireData(
      await admin
        .from("records")
        .select("*")
        .eq("business_id", business.id)
        .eq("object_definition_id", orderObject.id),
      "Could not count Orders after concurrency",
    );
    expect(afterOrders.length - beforeOrders).toBe(10);
    const ordersForSlot = afterOrders.filter(
      (record) =>
        asObject(record.data_json).collection_at === slot.collectionAt,
    );
    expect(ordersForSlot).toHaveLength(10);
    const counter = requireData(
      await admin
        .from("preorder_slot_counters")
        .select("*")
        .eq("business_id", business.id)
        .eq("preorder_experience_id", preorder.id)
        .eq("location_id", slot.location.id)
        .eq("collection_at", slot.collectionAt)
        .single(),
      "Could not load the capacity counter",
    );
    expect(counter.reservation_count).toBe(10);
  });

  it("returns the original safe confirmation on idempotent retry and consumes capacity once", async () => {
    const token = crypto.randomUUID();
    const slot = pickSlot(6);
    const before = await countGraphRows();
    const first = await submitRaw(
      baseSubmission(6, { idempotencyToken: token }),
    );
    const retry = await submitRaw(
      baseSubmission(6, { idempotencyToken: token }),
    );
    const after = await countGraphRows();
    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    if (!first.ok || !retry.ok) {
      throw new Error("Expected idempotent success.");
    }
    expect(first.idempotent).toBe(false);
    expect(retry.idempotent).toBe(true);
    expect(retry.confirmation).toEqual(first.confirmation);
    expect(after.records - before.records).toBe(3);
    expect(after.submissions - before.submissions).toBe(1);
    const counter = requireData(
      await admin
        .from("preorder_slot_counters")
        .select("reservation_count")
        .eq("business_id", business.id)
        .eq("preorder_experience_id", preorder.id)
        .eq("location_id", slot.location.id)
        .eq("collection_at", slot.collectionAt)
        .single(),
      "Could not load idempotent capacity",
    );
    expect(counter.reservation_count).toBe(1);
  });

  it("delivers committed confirmation emails after the Page is archived", async () => {
    const page = requireData(
      await owner
        .from("pages")
        .select("id")
        .eq("business_id", business.id)
        .eq("slug", pageSlug)
        .single(),
      "Could not load the preorder Page",
    );
    const deliveredInput = baseSubmission(7);
    const failedInput = baseSubmission(8);
    const deliveredOrder = await submitRaw(deliveredInput);
    const failedOrder = await submitRaw(failedInput);
    expect(deliveredOrder.ok).toBe(true);
    expect(failedOrder.ok).toBe(true);
    if (!deliveredOrder.ok || !failedOrder.ok) {
      throw new Error("Expected both Orders to commit before Page archival.");
    }
    expect(deliveredOrder.email_status).toBe("pending");
    expect(failedOrder.email_status).toBe("pending");

    const legacyClaim = await admin.rpc("claim_preorder_confirmation_email", {
      requested_business_slug: businessSlug,
      requested_page_slug: pageSlug,
      requested_preorder_key: preorderKey,
      requested_idempotency_token: deliveredInput.idempotency_token,
    } as never);
    expect(legacyClaim.error).not.toBeNull();

    try {
      await configurationFixtures.updateById("pages", page.id, {
        is_active: false,
      });

      const deliveredClaim = await claimPreorderConfirmationEmail(
        admin,
        businessSlug,
        preorderKey,
        deliveredInput.idempotency_token,
      );
      expect(deliveredClaim).toEqual(deliveredOrder.confirmation);
      expect(
        await claimPreorderConfirmationEmail(
          admin,
          businessSlug,
          preorderKey,
          deliveredInput.idempotency_token,
        ),
      ).toBeNull();

      const failedClaim = await claimPreorderConfirmationEmail(
        admin,
        businessSlug,
        preorderKey,
        failedInput.idempotency_token,
      );
      expect(failedClaim).toEqual(failedOrder.confirmation);

      expect(
        await completePreorderConfirmationEmail(
          admin,
          businessSlug,
          preorderKey,
          deliveredInput.idempotency_token,
          { succeeded: true },
        ),
      ).toBe(true);
      expect(
        await completePreorderConfirmationEmail(
          admin,
          businessSlug,
          preorderKey,
          failedInput.idempotency_token,
          { succeeded: false, error: "Provider unavailable." },
        ),
      ).toBe(true);

      const { data: emailStates, error: emailStateError } = await admin
        .from("preorder_submissions")
        .select("email_status, email_error, idempotency_token")
        .eq("business_id", business.id)
        .in("idempotency_token", [
          deliveredInput.idempotency_token,
          failedInput.idempotency_token,
        ])
        .order("idempotency_token");
      expect(emailStateError).toBeNull();
      expect(emailStates).toEqual(
        [
          {
            email_status: "delivered",
            email_error: null,
            idempotency_token: deliveredInput.idempotency_token,
          },
          {
            email_status: "failed",
            email_error: "Provider unavailable.",
            idempotency_token: failedInput.idempotency_token,
          },
        ].sort((left, right) =>
          left.idempotency_token.localeCompare(right.idempotency_token),
        ),
      );

      expect(await submitRaw(baseSubmission(0))).toEqual({
        ok: false,
        code: "not_found",
      });
    } finally {
      await configurationFixtures.updateById("pages", page.id, {
        is_active: true,
      });
    }
  });

  it("delivers authoritative email data after commit and preserves Orders on delivery failure", async () => {
    const sent: Json[] = [];
    const successInput = baseSubmission(7);
    const success = await processPreorderSubmission({
      client: admin,
      businessSlug,
      pageSlug,
      preorderKey,
      body: successInput,
      requestHash: requestHash(),
      emailAdapter: {
        async sendConfirmation(confirmation) {
          const existingOrder = requireData(
            await admin
              .from("records")
              .select("id")
              .eq("business_id", business.id)
              .eq("object_definition_id", orderObject.id),
            "Order was not committed before email delivery",
          );
          expect(existingOrder.length).toBeGreaterThan(0);
          sent.push(confirmation);
        },
      },
    });
    expect(success.ok).toBe(true);
    if (!success.ok) {
      throw new Error("Expected email success.");
    }
    expect(success.email_status).toBe("delivered");
    expect(sent).toEqual([success.confirmation]);
    expect(success.confirmation.total).toBe(30);

    const beforeOrders = requireData(
      await admin
        .from("records")
        .select("id")
        .eq("business_id", business.id)
        .eq("object_definition_id", orderObject.id),
      "Could not count Orders before email failure",
    ).length;
    const failureInput = baseSubmission(8);
    const failed = await processPreorderSubmission({
      client: admin,
      businessSlug,
      pageSlug,
      preorderKey,
      body: failureInput,
      requestHash: requestHash(),
      emailAdapter: defaultPreorderEmailAdapter("production"),
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) {
      throw new Error("Expected persisted Order despite email failure.");
    }
    expect(failed.email_status).toBe("failed");
    const afterOrders = requireData(
      await admin
        .from("records")
        .select("id")
        .eq("business_id", business.id)
        .eq("object_definition_id", orderObject.id),
      "Could not count Orders after email failure",
    ).length;
    expect(afterOrders - beforeOrders).toBe(1);
    const failedDelivery = requireData(
      await admin
        .from("preorder_submissions")
        .select("email_status, email_error")
        .eq("business_id", business.id)
        .eq("idempotency_token", failureInput.idempotency_token)
        .single(),
      "Could not load failed email state",
    );
    expect(failedDelivery).toEqual({
      email_status: "failed",
      email_error: "No production preorder email provider is configured.",
    });
  });

  it("shows and operates submitted Orders through generic Views, detail and edit Form", async () => {
    const viewSubmission = baseSubmission(9);
    const viewSubmissionResult = await submitRaw(viewSubmission);
    expect(viewSubmissionResult.ok).toBe(true);
    if (!viewSubmissionResult.ok) {
      throw new Error(
        "Expected the generic View fixture Order to be submitted.",
      );
    }

    const experience = createExperienceService(staff, {
      businessId: business.id,
    });
    const orders = await experience.loadView("orders");
    expect(orders.definition.view_type).toBe("table");
    expect(orders.definition.object_definition_id).toBe(orderObject.id);
    expect(orders.records.length).toBeGreaterThanOrEqual(13);
    expect(orders.config).toMatchObject({
      fields: expect.arrayContaining([
        "public_reference",
        "customer_name",
        "collection_location_name",
        "collection_local_display",
        "item_summary",
        "total",
        "status",
      ]),
    });
    const detail = await experience.loadDetailViewForObject(orderObject.id);
    expect(detail?.definition.key).toBe("order_detail");
    expect(detail?.config).toMatchObject({
      edit_form_key: "order_status_edit",
    });
    expect(detail?.config).toMatchObject({
      fields: expect.arrayContaining([
        "collection_local_display",
        "collection_timezone",
      ]),
    });
    const form = await experience.loadForm("order_status_edit");
    expect(form.definition.mode).toBe("edit");
    expect(form.config.fields).toEqual([
      expect.objectContaining({ field: "status" }),
    ]);

    const record = orders.records[0];
    if (!record) {
      throw new Error("No submitted Order was visible to Staff.");
    }
    const formData = new FormData();
    formData.set("status", "Ready");
    const updated = await submitExperienceForm(
      staff,
      { businessId: business.id },
      {
        formKey: "order_status_edit",
        recordId: record.id,
        formData,
      },
    );
    expect(asObject(updated.data_json).status).toBe("Ready");

    const submittedOrder = orders.records.find(
      (candidate) =>
        asObject(candidate.data_json).public_reference ===
        viewSubmissionResult.confirmation.public_reference,
    );
    if (!submittedOrder) {
      throw new Error("The submitted generic View fixture Order is missing.");
    }
    const collectionAt = new Date(viewSubmission.collection_at).toISOString();
    const localDisplay = formatCollectionDisplay(collectionAt, "Europe/London");
    const utcDisplay = formatCollectionDisplay(collectionAt, "UTC");
    expect(
      new Date(
        String(asObject(submittedOrder.data_json).collection_at),
      ).toISOString(),
    ).toBe(collectionAt);
    expect(asObject(submittedOrder.data_json)).toMatchObject({
      collection_local_display: localDisplay,
      collection_timezone: "Europe/London",
    });

    const previousTimezone = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const html = renderToStaticMarkup(
        createElement(ViewRenderer, {
          bundle: orders,
          businessSlug,
        }),
      );
      const submittedRow = html
        .split("</tr>")
        .find((row) =>
          row.includes(viewSubmissionResult.confirmation.public_reference),
        );
      expect(submittedRow).toContain(localDisplay);
      if (localDisplay !== utcDisplay) {
        expect(submittedRow).not.toContain(utcDisplay);
      }
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it("responds to all six acceptance changes through configuration/data only and has no domain persistence/UI", async () => {
    const changed = structuredClone(originalConfig);
    changed.schedule.cutoff_hours = 72;
    changed.schedule.days_of_week = [6];
    changed.schedule.slot_capacity = 3;
    changed.public_fields = changed.public_fields
      .filter(
        ({ target, field }) => !(target === "order" && field === "occasion"),
      )
      .map((field) =>
        field.target === "customer" && field.field === "phone"
          ? { ...field, required: true }
          : field,
      );
    await updateConfig(changed);
    const changedCatalogue = await resolveCatalogue();
    expect(changedCatalogue.preorder.schedule).toMatchObject({
      cutoff_hours: 72,
      days_of_week: [6],
      slot_capacity: 3,
    });
    expect(
      changedCatalogue.preorder.public_fields.find(
        ({ target, field }) => target === "customer" && field === "phone",
      )?.required,
    ).toBe(true);
    expect(
      changedCatalogue.preorder.public_fields.some(
        ({ target, field }) => target === "order" && field === "occasion",
      ),
    ).toBe(false);
    expect(
      changedCatalogue.preorder.locations
        .flatMap(({ slots }) => slots)
        .every(({ date }) => new Date(`${date}T12:00:00Z`).getUTCDay() === 6),
    ).toBe(true);

    const celebration = products["Celebration Box"];
    const miltonKeynes = locations["Milton Keynes"];
    if (!celebration || !miltonKeynes) {
      throw new Error("Configuration-only availability fixture is missing.");
    }
    const link = requireData(
      await owner
        .from("record_location_links")
        .select("*")
        .eq("business_id", business.id)
        .eq("record_id", celebration.id)
        .eq("location_id", miltonKeynes.id)
        .single(),
      "Could not load Celebration availability",
    );
    const removed = await owner.rpc("remove_record_location_link", {
      expected_business_id: business.id,
      target_record_location_link_id: link.id,
    });
    expect(removed.error).toBeNull();
    const availabilityCatalogue = await resolveCatalogue();
    expect(
      availabilityCatalogue.preorder.products
        .find(({ name }) => name === "Celebration Box")
        ?.location_ids.includes(miltonKeynes.id),
    ).toBe(false);
    const restored = await owner.rpc("create_record_location_link", {
      expected_business_id: business.id,
      target_record_id: celebration.id,
      target_location_id: miltonKeynes.id,
    });
    expect(restored.error).toBeNull();

    await updateConfig(originalConfig);
    const restoredCatalogue = await resolveCatalogue();
    expect(
      restoredCatalogue.preorder.public_fields.find(
        ({ target, field }) => target === "customer" && field === "phone",
      )?.required,
    ).toBe(false);
    expect(
      restoredCatalogue.preorder.public_fields.some(
        ({ target, field }) => target === "order" && field === "occasion",
      ),
    ).toBe(true);

    const sql = postgres(databaseUrl, { max: 1 });
    const domainTables = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('customers', 'products', 'orders', 'order_items')
    `;
    await sql.end();
    expect(domainTables).toEqual([]);

    const sourceRoot = join(process.cwd(), "src");
    const forbiddenComponents =
      /(?:OrderTable|OrderDetail|BedfordBakeryOrders)\.tsx$/;
    expect(
      walkSourceFiles(sourceRoot)
        .map((path) => relative(sourceRoot, path))
        .filter((path) => forbiddenComponents.test(path)),
    ).toEqual([]);
  });
});
