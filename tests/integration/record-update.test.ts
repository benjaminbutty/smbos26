import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import { createGraphService } from "../../src/core/graph/service";
import {
  createRecordLocationLinkService,
  RecordLocationLinkError,
} from "../../src/core/graph/location-links";
import {
  recordUpdateTargetStateSchema,
  type RecordUpdateReadyState,
} from "../../src/core/graph/record-update/schemas";
import { submitExperienceForm } from "../../src/runtime/forms/submission";
import { getLocalSupabaseSettings } from "./support/local-supabase";
import { createConfigurationFixtures } from "./support/configuration-fixtures";
import { createLocationWithCurrentness } from "./support/location-rpc";

type Client = SupabaseClient<Database>;
const password = "Milestone-12-record-update-password!";
let admin: Client;
let owner: Client;
let outsider: Client;
let ownerUser: User;
let outsiderUser: User;
let business: Tables<"businesses">;
let product: Tables<"object_definitions">;
let equipment: Tables<"object_definitions">;
let dog: Tables<"object_definitions">;
let customer: Tables<"object_definitions">;
let booking: Tables<"object_definitions">;
let bedford: Tables<"locations">;
let cambridge: Tables<"locations">;
let kidsProduct: Tables<"records">;
let projector: Tables<"records">;
let dogRecord: Tables<"records">;
let customerRecord: Tables<"records">;
let bookingRecord: Tables<"records">;
let sql: Sql;

async function createSignedInIdentity(
  label: string,
): Promise<{ client: Client; user: User }> {
  const email = `m12-update-${label}-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
  const client = createClient<Database>(
    getLocalSupabaseSettings().apiUrl,
    getLocalSupabaseSettings().publishableKey,
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

async function createRecord(
  objectDefinitionId: string,
  data: Record<string, Json>,
): Promise<Tables<"records">> {
  const result = await owner.rpc("create_graph_record", {
    expected_business_id: business.id,
    target_object_definition_id: objectDefinitionId,
    requested_data: data,
    requested_record_status: "active",
  });
  if (result.error || !result.data) {
    throw result.error ?? new Error("Could not create Record fixture.");
  }
  return result.data;
}

async function readRecord(recordId: string): Promise<Tables<"records">> {
  const result = await admin
    .from("records")
    .select("*")
    .eq("business_id", business.id)
    .eq("id", recordId)
    .single();
  if (result.error || !result.data) {
    throw result.error ?? new Error("Could not read Record fixture.");
  }
  return result.data;
}

async function readState(
  targetObjectKey = "product",
  selectorValue = "Celebration Box",
  requestedUpdateFieldKeys = ["name", "price", "available"],
): Promise<RecordUpdateReadyState | Extract<RecordUpdateReadyState, never>> {
  const { data, error } = await owner.rpc(
    "get_confirmed_graph_record_update_state",
    {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      target_object_key: targetObjectKey,
      requested_selector: {
        field_key: "name",
        field_type: "short_text",
        string_value: selectorValue,
      },
      requested_update_field_keys: requestedUpdateFieldKeys,
    },
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw error ?? new Error("Could not read Record update state.");
  }
  const parsed = recordUpdateTargetStateSchema.parse(data);
  if (parsed.state !== "ready") {
    throw new Error(`Expected ready state, received ${parsed.state}.`);
  }
  return parsed;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid timestamp: ${value}`);
  return parsed;
}

async function expectUpdatedAtChanges(
  recordId: string,
  mutate: () => Promise<unknown>,
): Promise<void> {
  const before = await readRecord(recordId);
  await mutate();
  const after = await readRecord(recordId);
  expect(timestamp(after.updated_at)).toBeGreaterThan(
    timestamp(before.updated_at),
  );
}

describe("lean confirmed generic Record update boundary", () => {
  beforeAll(async () => {
    const settings = getLocalSupabaseSettings();
    sql = postgres(settings.databaseUrl, { max: 1 });
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const ownerIdentity = await createSignedInIdentity("owner");
    owner = ownerIdentity.client;
    ownerUser = ownerIdentity.user;
    const createdBusiness = await owner.rpc("create_business", {
      business_name: `Record Update ${crypto.randomUUID()}`,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    });
    if (createdBusiness.error || !createdBusiness.data) {
      throw createdBusiness.error ?? new Error("Could not create Business.");
    }
    business = createdBusiness.data;

    const createdBedford = await createLocationWithCurrentness(
      owner,
      ownerUser.id,
      business.id,
      "Bedford",
      "Europe/London",
    );
    if (createdBedford.error || !createdBedford.data) {
      throw createdBedford.error ?? new Error("Could not create Bedford.");
    }
    bedford = createdBedford.data;
    const createdCambridge = await createLocationWithCurrentness(
      owner,
      ownerUser.id,
      business.id,
      "Cambridge",
      "Europe/London",
    );
    if (createdCambridge.error || !createdCambridge.data) {
      throw createdCambridge.error ?? new Error("Could not create Cambridge.");
    }
    cambridge = createdCambridge.data;

    const outsiderIdentity = await createSignedInIdentity("outsider");
    outsider = outsiderIdentity.client;
    outsiderUser = outsiderIdentity.user;

    const fixtures = createConfigurationFixtures(sql);
    const [createdProduct] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "Products",
      kind: "template",
      semantic_type: "product",
    });
    if (!createdProduct) throw new Error("Could not create Product fixture.");
    product = createdProduct;
    await fixtures.insert("field_definitions", [
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        position: 1,
      },
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "price",
        label: "Price",
        field_type: "currency",
        required: true,
        default_value: null,
        settings_json: { currency: "GBP" },
        position: 2,
      },
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "available",
        label: "Available",
        field_type: "boolean",
        required: true,
        default_value: null,
        settings_json: {},
        position: 3,
      },
    ]);
    await fixtures.insert("views", {
      business_id: business.id,
      key: "products",
      name: "Products",
      view_type: "table",
      object_definition_id: product.id,
      config_json: { fields: ["name", "price", "available"] },
      audience: "internal",
    });
    await fixtures.insert("forms", {
      business_id: business.id,
      key: "product_edit",
      name: "Edit Product",
      object_definition_id: product.id,
      mode: "edit",
      audience: "internal",
      config_json: {
        fields: [{ field: "name" }, { field: "price" }, { field: "available" }],
      },
    });
    await createRecord(product.id, {
      name: "Celebration Box",
      price: 25,
      available: true,
    });
    kidsProduct = await createRecord(product.id, {
      name: "Kids Afternoon Tea",
      price: 15,
      available: true,
    });

    const [createdEquipment] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "equipment",
      singular_label: "Equipment",
      plural_label: "Equipment",
      description: "Equipment available for hire",
      kind: "custom",
      semantic_type: null,
    });
    if (!createdEquipment) {
      throw new Error("Could not create Equipment fixture.");
    }
    equipment = createdEquipment;
    await fixtures.insert("field_definitions", [
      {
        business_id: business.id,
        object_definition_id: equipment.id,
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        position: 1,
      },
      {
        business_id: business.id,
        object_definition_id: equipment.id,
        key: "hire_price",
        label: "Hire price",
        field_type: "currency",
        required: true,
        default_value: null,
        settings_json: { currency: "GBP" },
        position: 2,
      },
      {
        business_id: business.id,
        object_definition_id: equipment.id,
        key: "available",
        label: "Available",
        field_type: "boolean",
        required: true,
        default_value: null,
        settings_json: {},
        position: 3,
      },
    ]);
    projector = await createRecord(equipment.id, {
      name: "Projector",
      hire_price: 50,
      available: true,
    });

    const [createdDog] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "dog",
      singular_label: "Dog",
      plural_label: "Dogs",
      description: "Dogs in the business records",
      kind: "custom",
      semantic_type: null,
    });
    if (!createdDog) throw new Error("Could not create Dog fixture.");
    dog = createdDog;
    await fixtures.insert("field_definitions", {
      business_id: business.id,
      object_definition_id: dog.id,
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 1,
    });
    dogRecord = await createRecord(dog.id, { name: "Milo" });

    const [createdCustomer] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "customer",
      singular_label: "Customer",
      plural_label: "Customers",
      description: "Customers in the business records",
      kind: "custom",
      semantic_type: null,
    });
    if (!createdCustomer) {
      throw new Error("Could not create Customer fixture.");
    }
    customer = createdCustomer;
    await fixtures.insert("field_definitions", {
      business_id: business.id,
      object_definition_id: customer.id,
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 1,
    });
    customerRecord = await createRecord(customer.id, { name: "Beth" });

    const [createdBooking] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "booking",
      singular_label: "Booking",
      plural_label: "Bookings",
      description: "Bookings in the business records",
      kind: "custom",
      semantic_type: null,
    });
    if (!createdBooking) {
      throw new Error("Could not create Booking fixture.");
    }
    booking = createdBooking;
    await fixtures.insert("field_definitions", {
      business_id: business.id,
      object_definition_id: booking.id,
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 1,
    });
    bookingRecord = await createRecord(booking.id, { name: "Milo booking" });

    const initialLink = await owner.rpc("create_record_location_link", {
      expected_business_id: business.id,
      target_record_id: kidsProduct.id,
      target_location_id: bedford.id,
    });
    if (initialLink.error) {
      throw initialLink.error;
    }
  });

  afterAll(async () => {
    for (const user of [ownerUser, outsiderUser]) {
      if (user) await admin.auth.admin.deleteUser(user.id);
    }
    await sql?.end();
  });

  it("accepts the generic Product rename and returns only bounded state", async () => {
    const state = await readState("product", "Celebration Box", ["name"]);
    expect(state).toMatchObject({
      state: "ready",
      business_id: business.id,
      actor_id: ownerUser.id,
      object_key: "product",
      object_definition_id: product.id,
      selector: { field_key: "name", value: "Celebration Box" },
    });
    expect(state).not.toHaveProperty("data_json");
    expect(state).not.toHaveProperty("candidates");
    expect(state).not.toHaveProperty("object_schema_digest");

    const before = await readRecord(state.target_record_id);
    const result = await owner.rpc("update_confirmed_graph_record", {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      expected_base_version_id: state.base_version_id,
      expected_head_revision: state.head_revision,
      target_object_key: state.object_key,
      expected_object_definition_id: state.object_definition_id,
      target_record_id: state.target_record_id,
      expected_record_updated_at: state.expected_updated_at,
      requested_data_patch: { name: "Celebration Platter" },
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      id: state.target_record_id,
      business_id: business.id,
      object_definition_id: product.id,
      record_status: "active",
      data_json: {
        name: "Celebration Platter",
        price: 25,
        available: true,
      },
    });
    expect(timestamp(result.data!.updated_at)).toBeGreaterThan(
      timestamp(before.updated_at),
    );
  });

  it("accepts the generic Equipment price and availability update", async () => {
    const state = await readState("equipment", "Projector", [
      "hire_price",
      "available",
    ]);
    const result = await owner.rpc("update_confirmed_graph_record", {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      expected_base_version_id: state.base_version_id,
      expected_head_revision: state.head_revision,
      target_object_key: state.object_key,
      expected_object_definition_id: state.object_definition_id,
      target_record_id: state.target_record_id,
      expected_record_updated_at: state.expected_updated_at,
      requested_data_patch: { hire_price: 65, available: false },
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      id: state.target_record_id,
      object_definition_id: equipment.id,
      data_json: {
        name: "Projector",
        hire_price: 65,
        available: false,
      },
    });
  });

  it("classifies zero and multiple matches without returning candidate rows", async () => {
    const missing = await owner.rpc("get_confirmed_graph_record_update_state", {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      target_object_key: "product",
      requested_selector: {
        field_key: "name",
        field_type: "short_text",
        string_value: "No Such Product",
      },
      requested_update_field_keys: ["price"],
    });
    expect(missing.error).toBeNull();
    expect(missing.data).toEqual({
      schema_version: 1,
      state: "not_found",
      object_key: "product",
      singular_label: "Product",
    });

    await createRecord(product.id, {
      name: "Duplicate Product",
      price: 20,
      available: true,
    });
    await createRecord(product.id, {
      name: "Duplicate Product",
      price: 21,
      available: true,
    });
    const ambiguous = await owner.rpc(
      "get_confirmed_graph_record_update_state",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        target_object_key: "product",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Duplicate Product",
        },
        requested_update_field_keys: ["price"],
      },
    );
    expect(ambiguous.error).toBeNull();
    expect(ambiguous.data).toEqual({
      schema_version: 1,
      state: "ambiguous",
      object_key: "product",
      singular_label: "Product",
      match_count_class: "2_or_more",
    });
    expect(ambiguous.data).not.toHaveProperty("candidate_records");
  });

  it("updates the prepared ID when a duplicate is created afterwards", async () => {
    const original = await createRecord(product.id, {
      name: "Duplicate After Preparation",
      price: 40,
      available: true,
    });
    const state = await readState("product", "Duplicate After Preparation", [
      "price",
    ]);
    await createRecord(product.id, {
      name: "Duplicate After Preparation",
      price: 41,
      available: true,
    });

    const result = await owner.rpc("update_confirmed_graph_record", {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      expected_base_version_id: state.base_version_id,
      expected_head_revision: state.head_revision,
      target_object_key: state.object_key,
      expected_object_definition_id: state.object_definition_id,
      target_record_id: state.target_record_id,
      expected_record_updated_at: state.expected_updated_at,
      requested_data_patch: { price: 45 },
    });
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe(original.id);
    expect((await readRecord(original.id)).data_json).toMatchObject({
      price: 45,
    });
  });

  it("rejects stale replay and lets only one concurrent confirmation win", async () => {
    const staleState = await readState("product", "Celebration Platter", [
      "price",
    ]);
    const changed = await owner.rpc("update_graph_record", {
      expected_business_id: business.id,
      target_record_id: staleState.target_record_id,
      data_patch: { price: 26 },
    });
    expect(changed.error).toBeNull();
    const replay = await owner.rpc("update_confirmed_graph_record", {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      expected_base_version_id: staleState.base_version_id,
      expected_head_revision: staleState.head_revision,
      target_object_key: staleState.object_key,
      expected_object_definition_id: staleState.object_definition_id,
      target_record_id: staleState.target_record_id,
      expected_record_updated_at: staleState.expected_updated_at,
      requested_data_patch: { price: 27 },
    });
    expect(replay.data).toBeNull();
    expect(replay.error?.message).toMatch(/record_update_target_changed/);

    const concurrentRecord = await createRecord(product.id, {
      name: "Concurrent Confirmation",
      price: 60,
      available: true,
    });
    const concurrentState = await readState(
      "product",
      "Concurrent Confirmation",
      ["price"],
    );
    const results = await Promise.all(
      [1, 2].map(() =>
        owner.rpc("update_confirmed_graph_record", {
          expected_business_id: business.id,
          expected_actor_id: ownerUser.id,
          expected_base_version_id: concurrentState.base_version_id,
          expected_head_revision: concurrentState.head_revision,
          target_object_key: concurrentState.object_key,
          expected_object_definition_id: concurrentState.object_definition_id,
          target_record_id: concurrentState.target_record_id,
          expected_record_updated_at: concurrentState.expected_updated_at,
          requested_data_patch: { price: 61 },
        }),
      ),
    );
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.data === null)).toHaveLength(1);
    expect((await readRecord(concurrentRecord.id)).data_json).toMatchObject({
      price: 61,
    });
  });

  it("proves updated_at changes across the bounded material update paths", async () => {
    const publicRecord = await createRecord(product.id, {
      name: "Timestamp Public RPC",
      price: 70,
      available: true,
    });
    await expectUpdatedAtChanges(publicRecord.id, async () => {
      const result = await owner.rpc("update_graph_record", {
        expected_business_id: business.id,
        target_record_id: publicRecord.id,
        data_patch: { price: 71 },
      });
      expect(result.error).toBeNull();
    });

    const graphRecord = await createRecord(product.id, {
      name: "Timestamp Graph Service",
      price: 72,
      available: true,
    });
    await expectUpdatedAtChanges(graphRecord.id, async () => {
      const updated = await createGraphService(owner, {
        businessId: business.id,
      }).updateRecord({
        recordId: graphRecord.id,
        dataPatch: { price: 73 },
      });
      expect(updated.id).toBe(graphRecord.id);
    });

    const formRecord = await createRecord(product.id, {
      name: "Timestamp Generated Form",
      price: 74,
      available: true,
    });
    await expectUpdatedAtChanges(formRecord.id, async () => {
      const formData = new FormData();
      formData.set("name", "Timestamp Generated Form");
      formData.set("price", "75");
      formData.set("available", "true");
      const updated = await submitExperienceForm(
        owner,
        { businessId: business.id },
        { formKey: "product_edit", formData, recordId: formRecord.id },
      );
      expect(updated.id).toBe(formRecord.id);
    });
  });

  it("rejects an outsider before target resolution", async () => {
    const result = await outsider.rpc(
      "get_confirmed_graph_record_update_state",
      {
        expected_business_id: business.id,
        expected_actor_id: outsiderUser.id,
        target_object_key: "product",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Celebration Platter",
        },
        requested_update_field_keys: ["price"],
      },
    );
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/owner_or_admin_required/);
  });

  it("resolves and unlinks one generic Product pair without exposing candidates", async () => {
    const identity = await owner.auth.getUser();
    if (identity.error || !identity.data.user) {
      throw identity.error ?? new Error("Could not resolve the Owner.");
    }
    const beforeHead = await admin
      .from("business_configuration_heads")
      .select("head_revision")
      .eq("business_id", business.id)
      .single();
    if (beforeHead.error) throw beforeHead.error;

    const prepared = await owner.rpc(
      "get_confirmed_record_location_link_state",
      {
        expected_business_id: business.id,
        expected_actor_id: identity.data.user.id,
        target_object_key: "product",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Kids Afternoon Tea",
        },
        target_location_id: bedford.id,
        requested_action: "unlink",
      },
    );
    expect(prepared.error).toBeNull();
    expect(prepared.data).toMatchObject({
      schema_version: 1,
      state: "ready",
      object_key: "product",
      target_record_id: kidsProduct.id,
      target_location_id: bedford.id,
      action: "unlink",
      expected_pair_state: "linked",
    });
    expect(prepared.data).not.toHaveProperty("candidate_records");
    expect(prepared.data).not.toHaveProperty("data_json");
    expect(prepared.data).not.toHaveProperty("base_version_id");
    expect(prepared.data).not.toHaveProperty("head_revision");

    const service = createRecordLocationLinkService(owner, {
      businessId: business.id,
      actorId: identity.data.user.id,
    });
    const current = await service.readCurrentPairState({
      objectKey: "product",
      expectedObjectDefinitionId: product.id,
      targetRecordId: kidsProduct.id,
      targetLocationId: bedford.id,
      action: "unlink",
    });
    expect(current).toMatchObject({
      objectDefinitionId: product.id,
      objectKey: "product",
      targetRecordId: kidsProduct.id,
      targetLocationId: bedford.id,
      pairState: "linked",
    });
    expect(current.linkId).toEqual(expect.any(String));
    await service.remove(current.linkId!);
    expect(
      await owner
        .from("record_location_links")
        .select("id")
        .eq("business_id", business.id)
        .eq("record_id", kidsProduct.id)
        .eq("location_id", bedford.id),
    ).toMatchObject({ data: [], error: null });

    const afterHead = await admin
      .from("business_configuration_heads")
      .select("head_revision")
      .eq("business_id", business.id)
      .single();
    expect(afterHead.data?.head_revision).toBe(beforeHead.data.head_revision);

    const repeated = await owner.rpc(
      "get_confirmed_record_location_link_state",
      {
        expected_business_id: business.id,
        expected_actor_id: identity.data.user.id,
        target_object_key: "product",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Kids Afternoon Tea",
        },
        target_location_id: bedford.id,
        requested_action: "unlink",
      },
    );
    expect(repeated.error).toBeNull();
    expect(repeated.data).toMatchObject({
      state: "already_unlinked",
      object_key: "product",
    });

    const restored = await owner.rpc("create_record_location_link", {
      expected_business_id: business.id,
      target_record_id: kidsProduct.id,
      target_location_id: bedford.id,
    });
    expect(restored.error).toBeNull();
  });

  it("uses the same bounded path for a generic Equipment link", async () => {
    const identity = await owner.auth.getUser();
    if (identity.error || !identity.data.user) {
      throw identity.error ?? new Error("Could not resolve the Owner.");
    }
    const prepared = await owner.rpc(
      "get_confirmed_record_location_link_state",
      {
        expected_business_id: business.id,
        expected_actor_id: identity.data.user.id,
        target_object_key: "equipment",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Projector",
        },
        target_location_id: cambridge.id,
        requested_action: "link",
      },
    );
    expect(prepared.error).toBeNull();
    expect(prepared.data).toMatchObject({
      state: "ready",
      object_key: "equipment",
      target_record_id: projector.id,
      target_location_id: cambridge.id,
      action: "link",
      expected_pair_state: "unlinked",
    });

    const state = prepared.data as {
      target_record_id: string;
      target_location_id: string;
    };
    const linked = await owner.rpc("create_record_location_link", {
      expected_business_id: business.id,
      target_record_id: state.target_record_id,
      target_location_id: state.target_location_id,
    });
    expect(linked.error).toBeNull();

    const noOp = await owner.rpc("get_confirmed_record_location_link_state", {
      expected_business_id: business.id,
      expected_actor_id: identity.data.user.id,
      target_object_key: "equipment",
      requested_selector: {
        field_key: "name",
        field_type: "short_text",
        string_value: "Projector",
      },
      target_location_id: cambridge.id,
      requested_action: "link",
    });
    expect(noOp.error).toBeNull();
    expect(noOp.data).toMatchObject({ state: "already_linked" });

    const pair = await owner
      .from("record_location_links")
      .select("id")
      .eq("business_id", business.id)
      .eq("record_id", projector.id)
      .eq("location_id", cambridge.id)
      .single();
    if (pair.error || !pair.data)
      throw pair.error ?? new Error("Missing pair.");
    const removed = await owner.rpc("remove_record_location_link", {
      expected_business_id: business.id,
      target_record_location_link_id: pair.data.id,
    });
    expect(removed.error).toBeNull();
  });

  it("keeps concurrent generic link and unlink mutations bounded", async () => {
    const first = createRecordLocationLinkService(owner, {
      businessId: business.id,
      actorId: ownerUser.id,
    });
    const second = createRecordLocationLinkService(owner, {
      businessId: business.id,
      actorId: ownerUser.id,
    });

    const linkResults = await Promise.allSettled([
      first.create(projector.id, cambridge.id),
      second.create(projector.id, cambridge.id),
    ]);
    expect(
      linkResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const linkErrors = linkResults
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    expect(linkErrors).toHaveLength(1);
    expect(linkErrors[0]).toBeInstanceOf(RecordLocationLinkError);
    expect((linkErrors[0] as RecordLocationLinkError).code).toBe(
      "record_location_link_pair_exists",
    );
    const linked = await first.readPair(projector.id, cambridge.id);
    expect(linked?.id).toEqual(expect.any(String));

    const linkId = linked?.id;
    if (!linkId) throw new Error("The concurrent link did not create a pair.");
    const unlinkResults = await Promise.allSettled([
      first.remove(linkId),
      second.remove(linkId),
    ]);
    expect(
      unlinkResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const unlinkErrors = unlinkResults
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    expect(unlinkErrors).toHaveLength(1);
    expect(unlinkErrors[0]).toBeInstanceOf(RecordLocationLinkError);
    expect((unlinkErrors[0] as RecordLocationLinkError).code).toBe(
      "record_location_link_not_found",
    );
    expect(await first.readPair(projector.id, cambridge.id)).toBeNull();
  });

  it("serves the manual availability control through the shared pair service", async () => {
    const service = createRecordLocationLinkService(owner, {
      businessId: business.id,
    });
    const initial = await service.readManualAvailability({
      recordId: kidsProduct.id,
      objectDefinitionId: product.id,
    });
    expect(initial.eligible).toBe(true);
    expect(initial.locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bedford.id,
          isActive: true,
          linkId: expect.any(String),
        }),
        expect.objectContaining({
          id: cambridge.id,
          isActive: true,
          linkId: null,
        }),
      ]),
    );

    const created = await service.create(kidsProduct.id, cambridge.id);
    const linked = await service.readManualAvailability({
      recordId: kidsProduct.id,
      objectDefinitionId: product.id,
    });
    expect(
      linked.locations.find((location) => location.id === cambridge.id),
    ).toMatchObject({ linkId: created.id, isActive: true });

    const deactivated = await admin
      .from("locations")
      .update({ is_active: false })
      .eq("business_id", business.id)
      .eq("id", cambridge.id);
    expect(deactivated.error).toBeNull();
    const inactive = await service.readManualAvailability({
      recordId: kidsProduct.id,
      objectDefinitionId: product.id,
    });
    expect(
      inactive.locations.find((location) => location.id === cambridge.id),
    ).toMatchObject({ linkId: created.id, isActive: false });

    await service.remove(created.id);
    const restoredLocation = await admin
      .from("locations")
      .update({ is_active: true })
      .eq("business_id", business.id)
      .eq("id", cambridge.id);
    expect(restoredLocation.error).toBeNull();
  });

  it("keeps manual availability contextual for unlinked generic Records", async () => {
    const service = createRecordLocationLinkService(owner, {
      businessId: business.id,
    });
    const dogState = await service.readManualAvailability({
      recordId: dogRecord.id,
      objectDefinitionId: dog.id,
    });
    const bookingState = await service.readManualAvailability({
      recordId: bookingRecord.id,
      objectDefinitionId: booking.id,
    });
    const customerState = await service.readManualAvailability({
      recordId: customerRecord.id,
      objectDefinitionId: customer.id,
    });
    const linkedProductState = await service.readManualAvailability({
      recordId: kidsProduct.id,
      objectDefinitionId: product.id,
    });

    expect(dogState.eligible).toBe(false);
    expect(customerState.eligible).toBe(false);
    expect(bookingState.eligible).toBe(false);
    expect(linkedProductState.eligible).toBe(true);
  });

  it("returns bounded no-match, ambiguity and inactive-location states", async () => {
    const identity = await owner.auth.getUser();
    if (identity.error || !identity.data.user) {
      throw identity.error ?? new Error("Could not resolve the Owner.");
    }
    const missing = await owner.rpc(
      "get_confirmed_record_location_link_state",
      {
        expected_business_id: business.id,
        expected_actor_id: identity.data.user.id,
        target_object_key: "equipment",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "No Such Equipment",
        },
        target_location_id: cambridge.id,
        requested_action: "link",
      },
    );
    expect(missing.error).toBeNull();
    expect(missing.data).toMatchObject({ state: "not_found" });
    expect(missing.data).not.toHaveProperty("candidate_records");

    await createRecord(equipment.id, {
      name: "Duplicate Projector",
      hire_price: 50,
      available: true,
    });
    await createRecord(equipment.id, {
      name: "Duplicate Projector",
      hire_price: 55,
      available: true,
    });
    const ambiguous = await owner.rpc(
      "get_confirmed_record_location_link_state",
      {
        expected_business_id: business.id,
        expected_actor_id: identity.data.user.id,
        target_object_key: "equipment",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Duplicate Projector",
        },
        target_location_id: cambridge.id,
        requested_action: "link",
      },
    );
    expect(ambiguous.error).toBeNull();
    expect(ambiguous.data).toMatchObject({
      state: "ambiguous",
      match_count_class: "2_or_more",
    });
    expect(ambiguous.data).not.toHaveProperty("candidate_records");

    const deactivated = await admin
      .from("locations")
      .update({ is_active: false })
      .eq("business_id", business.id)
      .eq("id", cambridge.id);
    expect(deactivated.error).toBeNull();
    const inactive = await owner.rpc(
      "get_confirmed_record_location_link_state",
      {
        expected_business_id: business.id,
        expected_actor_id: identity.data.user.id,
        target_object_key: "equipment",
        requested_selector: {
          field_key: "name",
          field_type: "short_text",
          string_value: "Projector",
        },
        target_location_id: cambridge.id,
        requested_action: "link",
      },
    );
    expect(inactive.error).toBeNull();
    expect(inactive.data).toMatchObject({
      state: "location_inactive",
      location_id: cambridge.id,
    });
  });
});
