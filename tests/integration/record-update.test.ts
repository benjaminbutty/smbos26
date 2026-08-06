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
  recordUpdateTargetStateSchema,
  type RecordUpdateReadyState,
} from "../../src/core/graph/record-update/schemas";
import { submitExperienceForm } from "../../src/runtime/forms/submission";
import { getLocalSupabaseSettings } from "./support/local-supabase";
import { createConfigurationFixtures } from "./support/configuration-fixtures";

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
    await createRecord(equipment.id, {
      name: "Projector",
      hire_price: 50,
      available: true,
    });
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
});
