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

async function readState(
  targetObjectKey = "product",
  selectorValue = "Celebration Box",
  requestedUpdateFieldKeys = ["name", "price", "available"],
) {
  const { data, error } = await owner.rpc(
    "get_confirmed_graph_record_update_state",
    {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      target_object_key: targetObjectKey,
      requested_selector: [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: selectorValue,
        },
      ],
      requested_update_field_keys: requestedUpdateFieldKeys,
    },
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw error ?? new Error("Could not read Record update state.");
  }
  return data as {
    state: string;
    business_id: string;
    actor_id: string;
    base_version_id: string;
    head_revision: number;
    object_definition_id: string;
    object_key: string;
    object_schema_digest: string;
    canonical_selector: unknown;
    selector_digest: string;
    target_record_id: string;
    target_record_digest: string;
  };
}

describe("confirmed generic Record update boundary", () => {
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
    const created = await owner.rpc("create_graph_record", {
      expected_business_id: business.id,
      target_object_definition_id: product.id,
      requested_data: {
        name: "Celebration Box",
        price: 25,
        available: true,
      },
      requested_record_status: "active",
    });
    if (created.error || !created.data) {
      throw created.error ?? new Error("Could not create Record fixture.");
    }

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
    const equipmentRecord = await owner.rpc("create_graph_record", {
      expected_business_id: business.id,
      target_object_definition_id: equipment.id,
      requested_data: {
        name: "Projector",
        hire_price: 50,
        available: true,
      },
      requested_record_status: "active",
    });
    if (equipmentRecord.error || !equipmentRecord.data) {
      throw (
        equipmentRecord.error ??
        new Error("Could not create Equipment Record fixture.")
      );
    }
  });

  afterAll(async () => {
    for (const user of [ownerUser, outsiderUser]) {
      if (user) await admin.auth.admin.deleteUser(user.id);
    }
    await sql?.end();
  });

  it("resolves one Product and atomically updates the generic Record", async () => {
    const state = await readState();
    expect(state).toMatchObject({
      state: "ready",
      business_id: business.id,
      actor_id: ownerUser.id,
      object_key: "product",
    });
    const { data, error } = await owner.rpc("update_confirmed_graph_record", {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      expected_base_version_id: state.base_version_id,
      expected_head_revision: state.head_revision,
      target_object_key: state.object_key,
      expected_object_definition_id: state.object_definition_id,
      expected_object_schema_digest: state.object_schema_digest,
      requested_selector: state.canonical_selector as Json,
      expected_selector_digest: state.selector_digest,
      expected_record_id: state.target_record_id,
      expected_record_digest: state.target_record_digest,
      requested_data_patch: { name: "Celebration Platter", price: 30 },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: state.target_record_id,
      business_id: business.id,
      object_definition_id: product.id,
      record_status: "active",
      data_json: {
        name: "Celebration Platter",
        price: 30,
        available: true,
      },
    });
  });

  it("does not replay a stale target digest and discloses no candidate rows", async () => {
    const missing = await readState();
    expect(missing).toEqual({
      schema_version: 1,
      state: "not_found",
      object_key: "product",
      singular_label: "Product",
    });
    const state = await readState("product", "Celebration Platter");
    expect(state.state).toBe("ready");
    const secondRecord = await owner.rpc("create_graph_record", {
      expected_business_id: business.id,
      target_object_definition_id: product.id,
      requested_data: {
        name: "Second Box",
        price: 20,
        available: true,
      },
      requested_record_status: "active",
    });
    expect(secondRecord.error).toBeNull();
    const { data: ambiguousData, error: ambiguousError } = await owner.rpc(
      "get_confirmed_graph_record_update_state",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        target_object_key: "product",
        requested_selector: [
          {
            field_key: "available",
            field_type: "boolean",
            boolean_value: true,
          },
        ],
        requested_update_field_keys: ["price"],
      },
    );
    expect(ambiguousError).toBeNull();
    expect(ambiguousData).toEqual({
      schema_version: 1,
      state: "ambiguous",
      object_key: "product",
      singular_label: "Product",
      match_count_class: "2_or_more",
    });

    const changed = await owner.rpc("update_graph_record", {
      expected_business_id: business.id,
      target_record_id: state.target_record_id,
      data_patch: { price: 29 },
    });
    expect(changed.error).toBeNull();

    const replay = await owner.rpc("update_confirmed_graph_record", {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      expected_base_version_id: state.base_version_id,
      expected_head_revision: state.head_revision,
      target_object_key: state.object_key,
      expected_object_definition_id: state.object_definition_id,
      expected_object_schema_digest: state.object_schema_digest,
      requested_selector: state.canonical_selector as Json,
      expected_selector_digest: state.selector_digest,
      expected_record_id: state.target_record_id,
      expected_record_digest: state.target_record_digest,
      requested_data_patch: { price: 31 },
    });
    expect(replay.data).toBeNull();
    expect(replay.error?.message).toMatch(
      /record_update_(?:target_changed|selector_not_found)/,
    );
  });

  it("updates a generic Equipment Record with one selector and two Fields", async () => {
    const state = await readState("equipment", "Projector", [
      "hire_price",
      "available",
    ]);
    expect(state).toMatchObject({
      state: "ready",
      object_key: "equipment",
      object_definition_id: equipment.id,
    });
    const { data, error } = await owner.rpc("update_confirmed_graph_record", {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      expected_base_version_id: state.base_version_id,
      expected_head_revision: state.head_revision,
      target_object_key: state.object_key,
      expected_object_definition_id: state.object_definition_id,
      expected_object_schema_digest: state.object_schema_digest,
      requested_selector: state.canonical_selector as Json,
      expected_selector_digest: state.selector_digest,
      expected_record_id: state.target_record_id,
      expected_record_digest: state.target_record_digest,
      requested_data_patch: { hire_price: 65, available: false },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: state.target_record_id,
      business_id: business.id,
      object_definition_id: equipment.id,
      record_status: "active",
      data_json: {
        name: "Projector",
        hire_price: 65,
        available: false,
      },
    });
  });

  it("rejects an outsider before target resolution", async () => {
    const result = await outsider.rpc(
      "get_confirmed_graph_record_update_state",
      {
        expected_business_id: business.id,
        expected_actor_id: outsiderUser.id,
        target_object_key: "product",
        requested_selector: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Celebration Platter",
          },
        ],
        requested_update_field_keys: ["price"],
      },
    );
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/owner_or_admin_required/);
  });
});
