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
import type { RecordCreationState } from "../../src/core/graph/record-creation/schemas";
import { createConfigurationFixtures } from "./support/configuration-fixtures";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type CreationState = RecordCreationState;

const password = "Milestone-12-record-test-password!";
let admin: Client;
let owner: Client;
let ownerUser: User;
let administrator: Client;
let administratorUser: User;
let staff: Client;
let staffUser: User;
let outsider: Client;
let anonymous: Client;
let outsiderUser: User;
let business: Tables<"businesses">;
let outsiderBusiness: Tables<"businesses">;
let product: Tables<"object_definitions">;
let equipment: Tables<"object_definitions">;
let cateringEnquiry: Tables<"object_definitions">;
let lead: Tables<"object_definitions">;
let protectedObject: Tables<"object_definitions">;
let requiredSourceObject: Tables<"object_definitions">;
let inactiveObject: Tables<"object_definitions">;
let sql: Sql;
let fixtures: ReturnType<typeof createConfigurationFixtures>;
let settings: LocalSupabaseSettings;

async function createIdentity(
  label: string,
  selectedPassword = password,
): Promise<{ client: Client; user: User }> {
  const email = `m12-record-${label}-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: selectedPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label} user.`);
  }
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
  const signedIn = await client.auth.signInWithPassword({
    email,
    password: selectedPassword,
  });
  if (signedIn.error || !signedIn.data.user) {
    throw signedIn.error ?? new Error(`Could not sign in ${label} user.`);
  }
  return { client, user: signedIn.data.user };
}

async function readCreationState(
  client: Client,
  targetObjectKey: string,
  expectedActorId: string,
  expectedBusinessId = business.id,
): Promise<CreationState> {
  const { data, error } = await client.rpc(
    "get_confirmed_graph_record_creation_state",
    {
      expected_business_id: expectedBusinessId,
      expected_actor_id: expectedActorId,
      target_object_key: targetObjectKey,
    },
  );
  if (error || !data?.[0]) {
    throw error ?? new Error(`Could not read ${targetObjectKey} state.`);
  }
  return data[0] as CreationState;
}

async function createFromState(
  client: Client,
  state: CreationState,
  requestedData: Json,
  overrides: Partial<{
    expectedBusinessId: string;
    expectedActorId: string;
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
    expectedObjectSchemaDigest: string;
    expectedRecordStateDigest: string;
    targetObjectKey: string;
  }> = {},
) {
  return client.rpc("create_confirmed_graph_record", {
    expected_business_id: overrides.expectedBusinessId ?? state.business_id,
    expected_actor_id: overrides.expectedActorId ?? state.actor_id,
    expected_base_version_id:
      overrides.expectedBaseVersionId ?? state.base_version_id,
    expected_head_revision:
      overrides.expectedHeadRevision ?? state.head_revision,
    target_object_key: overrides.targetObjectKey ?? state.object_key,
    expected_object_schema_digest:
      overrides.expectedObjectSchemaDigest ?? state.object_schema_digest,
    expected_record_state_digest:
      overrides.expectedRecordStateDigest ?? state.record_state_digest,
    requested_data: requestedData,
  });
}

describe("confirmed generic Record creation boundary", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    sql = postgres(settings.databaseUrl, { max: 1 });
    fixtures = createConfigurationFixtures(sql);
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const email = `m12-record-${crypto.randomUUID()}@example.test`;
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    if (createError || !created.user) {
      throw createError ?? new Error("Could not create the Record test user.");
    }
    ownerUser = created.user;
    owner = createClient<Database>(settings.apiUrl, settings.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const { error: signInError } = await owner.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      throw signInError;
    }
    const { data: createdBusiness, error: businessError } = await owner.rpc(
      "create_business",
      {
        business_name: `Record Boundary ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      },
    );
    if (businessError || !createdBusiness) {
      throw (
        businessError ?? new Error("Could not create the Record test Business.")
      );
    }
    business = createdBusiness;

    const adminIdentity = await createIdentity("admin");
    administrator = adminIdentity.client;
    administratorUser = adminIdentity.user;
    const staffIdentity = await createIdentity("staff");
    staff = staffIdentity.client;
    staffUser = staffIdentity.user;
    const outsiderIdentity = await createIdentity("outsider");
    outsider = outsiderIdentity.client;
    outsiderUser = outsiderIdentity.user;
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
    const membershipResult = await admin.from("business_memberships").insert([
      {
        business_id: business.id,
        user_id: administratorUser.id,
        role: "admin",
      },
      {
        business_id: business.id,
        user_id: staffUser.id,
        role: "staff",
      },
    ]);
    if (membershipResult.error) {
      throw membershipResult.error;
    }
    const outsiderBusinessResult = await outsider.rpc("create_business", {
      business_name: `Record Outsider ${crypto.randomUUID()}`,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    });
    if (outsiderBusinessResult.error || !outsiderBusinessResult.data) {
      throw (
        outsiderBusinessResult.error ??
        new Error("Could not create the outsider Business.")
      );
    }
    outsiderBusiness = outsiderBusinessResult.data;

    const [createdProduct] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "Products",
      kind: "template",
      semantic_type: "product",
    });
    if (!createdProduct) {
      throw new Error("Could not create the Product fixture.");
    }
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
        key: "description",
        label: "Description",
        field_type: "long_text",
        required: false,
        default_value: null,
        settings_json: {},
        position: 2,
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
        position: 3,
      },
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "status",
        label: "Status",
        field_type: "status",
        required: true,
        default_value: "Active",
        settings_json: { options: ["Active", "Paused"] },
        position: 4,
      },
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "image",
        label: "Image",
        field_type: "file",
        required: false,
        default_value: null,
        settings_json: {},
        position: 5,
      },
    ]);
    await fixtures.insert("views", {
      business_id: business.id,
      key: "products",
      name: "Products",
      view_type: "table",
      object_definition_id: product.id,
      config_json: { fields: ["name", "price"] },
      audience: "internal",
    });

    const [createdEquipment] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "equipment",
      singular_label: "Equipment",
      plural_label: "Equipment",
      description: "Equipment",
      kind: "custom",
      semantic_type: null,
    });
    if (!createdEquipment) {
      throw new Error("Could not create the Equipment fixture.");
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
      {
        business_id: business.id,
        object_definition_id: equipment.id,
        key: "category",
        label: "Category",
        field_type: "select",
        required: false,
        default_value: null,
        settings_json: {
          options: ["Audio Visual", "Furniture", "Catering"],
        },
        position: 4,
      },
      {
        business_id: business.id,
        object_definition_id: equipment.id,
        key: "tags",
        label: "Tags",
        field_type: "multi_select",
        required: false,
        default_value: null,
        settings_json: { options: ["Indoor", "Outdoor", "Powered"] },
        position: 5,
      },
    ]);
    await fixtures.insert("views", {
      business_id: business.id,
      key: "equipment",
      name: "Equipment",
      view_type: "table",
      object_definition_id: equipment.id,
      config_json: { fields: ["name", "hire_price", "available"] },
      audience: "internal",
    });

    const [createdCateringEnquiry] = await fixtures.insert(
      "object_definitions",
      {
        business_id: business.id,
        key: "catering_enquiry",
        singular_label: "Catering Enquiry",
        plural_label: "Catering Enquiries",
        description: "Catering enquiries",
        kind: "custom",
        semantic_type: null,
      },
    );
    if (!createdCateringEnquiry) {
      throw new Error("Could not create the Catering Enquiry fixture.");
    }
    cateringEnquiry = createdCateringEnquiry;
    await fixtures.insert("field_definitions", [
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "company_name",
        label: "Company name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        position: 1,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "event_date",
        label: "Event date",
        field_type: "date",
        required: true,
        default_value: null,
        settings_json: {},
        position: 2,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "event_start",
        label: "Event start",
        field_type: "datetime",
        required: false,
        default_value: null,
        settings_json: {},
        position: 3,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "guest_count",
        label: "Guest count",
        field_type: "number",
        required: true,
        default_value: null,
        settings_json: {},
        position: 4,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "budget",
        label: "Budget",
        field_type: "currency",
        required: true,
        default_value: null,
        settings_json: { currency: "GBP" },
        position: 5,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "notes",
        label: "Notes",
        field_type: "long_text",
        required: false,
        default_value: null,
        settings_json: {},
        position: 6,
      },
      {
        business_id: business.id,
        object_definition_id: cateringEnquiry.id,
        key: "status",
        label: "Status",
        field_type: "status",
        required: true,
        default_value: "New",
        settings_json: { options: ["New", "Contacted", "Closed"] },
        position: 7,
      },
    ]);
    await fixtures.insert("views", {
      business_id: business.id,
      key: "catering_enquiries",
      name: "Catering Enquiries",
      view_type: "table",
      object_definition_id: cateringEnquiry.id,
      config_json: {
        fields: [
          "company_name",
          "event_date",
          "event_start",
          "guest_count",
          "budget",
        ],
      },
      audience: "internal",
    });

    const [createdLead] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "lead",
      singular_label: "Lead",
      plural_label: "Leads",
      description: "Leads",
      kind: "custom",
      semantic_type: null,
    });
    if (!createdLead) {
      throw new Error("Could not create the Lead fixture.");
    }
    lead = createdLead;
    await fixtures.insert("field_definitions", [
      {
        business_id: business.id,
        object_definition_id: lead.id,
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
        object_definition_id: lead.id,
        key: "email",
        label: "Email",
        field_type: "email",
        required: false,
        default_value: null,
        settings_json: {},
        position: 2,
      },
      {
        business_id: business.id,
        object_definition_id: lead.id,
        key: "phone",
        label: "Phone",
        field_type: "phone",
        required: false,
        default_value: null,
        settings_json: {},
        position: 3,
      },
      {
        business_id: business.id,
        object_definition_id: lead.id,
        key: "website",
        label: "Website",
        field_type: "url",
        required: false,
        default_value: null,
        settings_json: {},
        position: 4,
      },
    ]);
    await fixtures.insert("views", {
      business_id: business.id,
      key: "leads",
      name: "Leads",
      view_type: "table",
      object_definition_id: lead.id,
      config_json: { fields: ["name", "email", "phone", "website"] },
      audience: "internal",
    });

    const [createdRequiredSource] = await fixtures.insert(
      "object_definitions",
      {
        business_id: business.id,
        key: "trusted_transaction",
        singular_label: "Trusted Transaction",
        plural_label: "Trusted Transactions",
        description: "Trusted transaction source",
        kind: "custom",
        semantic_type: null,
      },
    );
    const [createdProtected] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "transaction_detail",
      singular_label: "Transaction Detail",
      plural_label: "Transaction Details",
      description: "Required transaction detail",
      kind: "custom",
      semantic_type: null,
    });
    if (!createdRequiredSource || !createdProtected) {
      throw new Error("Could not create the eligibility fixtures.");
    }
    requiredSourceObject = createdRequiredSource;
    protectedObject = createdProtected;
    await fixtures.insert("field_definitions", {
      business_id: business.id,
      object_definition_id: protectedObject.id,
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 1,
    });
    await fixtures.insert("relationship_definitions", {
      business_id: business.id,
      key: "trusted_transaction_requires_detail",
      source_object_definition_id: requiredSourceObject.id,
      target_object_definition_id: protectedObject.id,
      source_label: "Transaction",
      target_label: "Detail",
      cardinality: "one_to_one",
      is_required: true,
    });

    const [createdInactive] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "inactive_object",
      singular_label: "Inactive Object",
      plural_label: "Inactive Objects",
      description: "Inactive generic Object",
      kind: "custom",
      semantic_type: null,
      is_active: false,
    });
    if (!createdInactive) {
      throw new Error("Could not create the inactive Object fixture.");
    }
    inactiveObject = createdInactive;
    await fixtures.insert("field_definitions", {
      business_id: business.id,
      object_definition_id: inactiveObject.id,
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 1,
    });
  });

  afterAll(async () => {
    for (const user of [
      ownerUser,
      administratorUser,
      staffUser,
      outsiderUser,
    ]) {
      if (user) {
        await admin.auth.admin.deleteUser(user.id);
      }
    }
    await sql?.end();
  });

  it("reads a bounded state, inserts one active Record, and rejects replay by state digest", async () => {
    const { data: stateRows, error: stateError } = await owner.rpc(
      "get_confirmed_graph_record_creation_state",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        target_object_key: "product",
      },
    );
    expect(stateError).toBeNull();
    expect(stateRows).toHaveLength(1);
    const state = stateRows?.[0];
    expect(state).toMatchObject({
      business_id: business.id,
      actor_id: ownerUser.id,
      object_definition_id: product.id,
      object_key: "product",
      is_active: true,
      eligibility: { eligible: true, reason_codes: [] },
    });
    expect(state?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "name", required: true }),
        expect.objectContaining({ key: "status", default_value: "Active" }),
      ]),
    );
    expect(state?.internal_views).toEqual([
      expect.objectContaining({ key: "products", view_type: "table" }),
    ]);

    const requestedData: Json = {
      name: "Afternoon Tea Box",
      description: "Afternoon tea for two",
      price: 30,
    };
    const attempts = await Promise.all([
      owner.rpc("create_confirmed_graph_record", {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        expected_base_version_id: state!.base_version_id,
        expected_head_revision: state!.head_revision,
        target_object_key: "product",
        expected_object_schema_digest: state!.object_schema_digest,
        expected_record_state_digest: state!.record_state_digest,
        requested_data: requestedData,
      }),
      owner.rpc("create_confirmed_graph_record", {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        expected_base_version_id: state!.base_version_id,
        expected_head_revision: state!.head_revision,
        target_object_key: "product",
        expected_object_schema_digest: state!.object_schema_digest,
        expected_record_state_digest: state!.record_state_digest,
        requested_data: requestedData,
      }),
    ]);
    const successful = attempts.filter((attempt) => !attempt.error);
    const stale = attempts.filter((attempt) => attempt.error);
    expect(successful).toHaveLength(1);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.error?.message).toContain("record_creation_state_changed");
    expect(successful[0]?.data).toMatchObject({
      business_id: business.id,
      object_definition_id: product.id,
      record_status: "active",
      created_by: ownerUser.id,
      data_json: {
        name: "Afternoon Tea Box",
        description: "Afternoon tea for two",
        price: 30,
        status: "Active",
      },
    });

    const { data: records, error: recordsError } = await owner
      .from("records")
      .select("id")
      .eq("business_id", business.id)
      .eq("object_definition_id", product.id);
    expect(recordsError).toBeNull();
    expect(records).toHaveLength(1);

    const { error: replayError } = await owner.rpc(
      "create_confirmed_graph_record",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        expected_base_version_id: state!.base_version_id,
        expected_head_revision: state!.head_revision,
        target_object_key: "product",
        expected_object_schema_digest: state!.object_schema_digest,
        expected_record_state_digest: state!.record_state_digest,
        requested_data: requestedData,
      },
    );
    expect(replayError?.message).toContain("record_creation_state_changed");
  });

  it("uses the same generic boundary for Equipment without a concept-specific path", async () => {
    const { data: stateRows, error: stateError } = await owner.rpc(
      "get_confirmed_graph_record_creation_state",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        target_object_key: "equipment",
      },
    );
    expect(stateError).toBeNull();
    expect(stateRows).toHaveLength(1);
    const state = stateRows?.[0];
    expect(state).toMatchObject({
      business_id: business.id,
      actor_id: ownerUser.id,
      object_definition_id: equipment.id,
      object_key: "equipment",
      is_active: true,
      eligibility: { eligible: true, reason_codes: [] },
    });

    const { data: created, error: createError } = await owner.rpc(
      "create_confirmed_graph_record",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        expected_base_version_id: state!.base_version_id,
        expected_head_revision: state!.head_revision,
        target_object_key: "equipment",
        expected_object_schema_digest: state!.object_schema_digest,
        expected_record_state_digest: state!.record_state_digest,
        requested_data: {
          name: "Projector",
          hire_price: 50,
          available: true,
          category: "Audio Visual",
          tags: ["Indoor", "Powered"],
        },
      },
    );
    expect(createError).toBeNull();
    expect(created).toMatchObject({
      business_id: business.id,
      object_definition_id: equipment.id,
      record_status: "active",
      created_by: ownerUser.id,
      data_json: {
        name: "Projector",
        hire_price: 50,
        available: true,
        category: "Audio Visual",
        tags: ["Indoor", "Powered"],
      },
    });
  });

  it("creates a Catering Enquiry through the same generic boundary", async () => {
    const state = await readCreationState(
      owner,
      "catering_enquiry",
      ownerUser.id,
    );
    expect(state.object_definition_id).toBe(cateringEnquiry.id);
    expect(state.eligibility).toEqual({ eligible: true, reason_codes: [] });

    const { data: created, error } = await createFromState(owner, state, {
      company_name: "The Olive Tree",
      event_date: "2026-09-12",
      event_start: "2026-09-12T11:30:00+01:00",
      guest_count: 42,
      budget: 1250,
      notes: "Vegetarian afternoon tea.",
    });
    expect(error).toBeNull();
    expect(created).toMatchObject({
      business_id: business.id,
      object_definition_id: cateringEnquiry.id,
      record_status: "active",
      created_by: ownerUser.id,
      data_json: {
        company_name: "The Olive Tree",
        event_date: "2026-09-12",
        event_start: "2026-09-12T11:30:00+01:00",
        guest_count: 42,
        budget: 1250,
        notes: "Vegetarian afternoon tea.",
        status: "New",
      },
    });
  });

  it("keeps Record currentness scoped to the target Object", async () => {
    const productState = await readCreationState(
      owner,
      "product",
      ownerUser.id,
    );
    const equipmentState = await readCreationState(
      owner,
      "equipment",
      ownerUser.id,
    );

    const { error: unrelatedError } = await createFromState(
      owner,
      equipmentState,
      {
        name: "Folding chairs",
        hire_price: 20,
        available: true,
      },
    );
    expect(unrelatedError).toBeNull();

    const { data: created, error } = await createFromState(
      owner,
      productState,
      {
        name: "Afternoon Tea Box Large",
        description: "Afternoon tea for four",
        price: 45,
      },
    );
    expect(error).toBeNull();
    expect(created).toMatchObject({
      object_definition_id: product.id,
      data_json: {
        name: "Afternoon Tea Box Large",
        description: "Afternoon tea for four",
        price: 45,
        status: "Active",
      },
    });
  });

  it("rejects invalid generic field data before any Record is inserted", async () => {
    const leadState = await readCreationState(owner, "lead", ownerUser.id);
    const invalidLeadRequests: Array<{
      requestedData: Json;
      message: string;
    }> = [
      { requestedData: {}, message: "Required field is missing: name" },
      {
        requestedData: { name: 123 },
        message: "Invalid value for field: name",
      },
      {
        requestedData: { name: "Lead", unexpected: true },
        message: "Unknown record field key: unexpected",
      },
      {
        requestedData: { name: "Lead", email: "not-an-email" },
        message: "Invalid value for field: email",
      },
      {
        requestedData: { name: "Lead", phone: 12345 },
        message: "Invalid value for field: phone",
      },
      {
        requestedData: { name: "Lead", website: "ftp://example.test" },
        message: "Invalid value for field: website",
      },
    ];
    for (const request of invalidLeadRequests) {
      const { data, error } = await createFromState(
        owner,
        leadState,
        request.requestedData,
      );
      expect(data).toBeNull();
      expect(error?.message).toContain(request.message);
    }

    const enquiryState = await readCreationState(
      owner,
      "catering_enquiry",
      ownerUser.id,
    );
    const validEnquiryBase = {
      company_name: "The Olive Tree",
      event_date: "2026-09-12",
      guest_count: 42,
      budget: 1250,
    };
    for (const requestedData of [
      { ...validEnquiryBase, event_date: "2026-02-30" },
      { ...validEnquiryBase, event_start: "2026-09-12T25:00:00+01:00" },
      { ...validEnquiryBase, guest_count: "42" },
      { ...validEnquiryBase, budget: "1250" },
      { ...validEnquiryBase, status: "Draft" },
    ] satisfies Json[]) {
      const { data, error } = await createFromState(
        owner,
        enquiryState,
        requestedData,
      );
      expect(data).toBeNull();
      expect(error?.message).toMatch(/Invalid value for field/);
    }

    const equipmentState = await readCreationState(
      owner,
      "equipment",
      ownerUser.id,
    );
    for (const requestedData of [
      {
        name: "Invalid equipment",
        hire_price: 20,
        available: true,
        category: "Decor",
      },
      {
        name: "Invalid equipment",
        hire_price: 20,
        available: true,
        tags: ["Indoor", "Indoor"],
      },
    ] satisfies Json[]) {
      const { data, error } = await createFromState(
        owner,
        equipmentState,
        requestedData,
      );
      expect(data).toBeNull();
      expect(error?.message).toMatch(/Invalid value for field/);
    }
  });

  it("reports generic eligibility and blocks inactive or capability-owned Objects", async () => {
    const inactiveState = await readCreationState(
      owner,
      "inactive_object",
      ownerUser.id,
    );
    expect(inactiveState.eligibility).toEqual({
      eligible: false,
      reason_codes: ["inactive_object"],
    });
    const inactiveAttempt = await createFromState(owner, inactiveState, {
      name: "Should not exist",
    });
    expect(inactiveAttempt.data).toBeNull();
    expect(inactiveAttempt.error?.message).toContain(
      "record_creation_object_ineligible",
    );

    const protectedState = await readCreationState(
      owner,
      "transaction_detail",
      ownerUser.id,
    );
    expect(protectedState.object_definition_id).toBe(protectedObject.id);
    expect(protectedState.eligibility).toEqual({
      eligible: false,
      reason_codes: ["required_relationship_target"],
    });
    const protectedAttempt = await createFromState(owner, protectedState, {
      name: "Should not exist",
    });
    expect(protectedAttempt.data).toBeNull();
    expect(protectedAttempt.error?.message).toContain(
      "record_creation_object_ineligible",
    );
  });

  it("enforces Owner/Admin membership, actor binding, tenant binding, and authentication", async () => {
    const administratorState = await readCreationState(
      administrator,
      "lead",
      administratorUser.id,
    );
    const administratorCreated = await createFromState(
      administrator,
      administratorState,
      {
        name: "Admin-created lead",
        email: "admin@example.test",
        phone: "+441234567890",
        website: "https://example.test/admin-lead",
      },
    );
    expect(administratorCreated.error).toBeNull();
    expect(administratorCreated.data).toMatchObject({
      created_by: administratorUser.id,
      data_json: {
        name: "Admin-created lead",
        email: "admin@example.test",
        phone: "+441234567890",
        website: "https://example.test/admin-lead",
      },
    });

    const staffAttempt = await staff.rpc(
      "get_confirmed_graph_record_creation_state",
      {
        expected_business_id: business.id,
        expected_actor_id: staffUser.id,
        target_object_key: "lead",
      },
    );
    expect(staffAttempt.data).toBeNull();
    expect(staffAttempt.error?.message).toContain(
      "record_creation_owner_or_admin_required",
    );

    const outsiderAttempt = await outsider.rpc(
      "get_confirmed_graph_record_creation_state",
      {
        expected_business_id: business.id,
        expected_actor_id: outsiderUser.id,
        target_object_key: "lead",
      },
    );
    expect(outsiderAttempt.data).toBeNull();
    expect(outsiderAttempt.error?.message).toContain(
      "record_creation_owner_or_admin_required",
    );

    const crossBusinessAttempt = await owner.rpc(
      "get_confirmed_graph_record_creation_state",
      {
        expected_business_id: outsiderBusiness.id,
        expected_actor_id: ownerUser.id,
        target_object_key: "product",
      },
    );
    expect(crossBusinessAttempt.data).toBeNull();
    expect(crossBusinessAttempt.error?.message).toContain(
      "record_creation_owner_or_admin_required",
    );

    const forgedActorAttempt = await administrator.rpc(
      "get_confirmed_graph_record_creation_state",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        target_object_key: "lead",
      },
    );
    expect(forgedActorAttempt.data).toBeNull();
    expect(forgedActorAttempt.error?.message).toContain(
      "record_creation_actor_context_mismatch",
    );

    const anonymousAttempt = await anonymous.rpc(
      "get_confirmed_graph_record_creation_state",
      {
        expected_business_id: business.id,
        expected_actor_id: ownerUser.id,
        target_object_key: "lead",
      },
    );
    expect(anonymousAttempt.data).toBeNull();
    expect(anonymousAttempt.error?.code).toBe("42501");
    expect(anonymousAttempt.error?.message).toMatch(
      /permission denied for function|record_creation_authentication_required/,
    );

    const adminStateBeforeMembershipRemoval = await readCreationState(
      administrator,
      "equipment",
      administratorUser.id,
    );
    const membershipRemoval = await admin
      .from("business_memberships")
      .delete()
      .eq("business_id", business.id)
      .eq("user_id", administratorUser.id);
    expect(membershipRemoval.error).toBeNull();
    const removedAdminAttempt = await createFromState(
      administrator,
      adminStateBeforeMembershipRemoval,
      { name: "No longer authorised", hire_price: 20, available: true },
    );
    expect(removedAdminAttempt.data).toBeNull();
    expect(removedAdminAttempt.error?.message).toContain(
      "record_creation_owner_or_admin_required",
    );
  });

  it("rejects stale schema and configuration-head confirmations", async () => {
    const statusFieldRows = await sql`
      select id, settings_json
      from public.field_definitions
      where business_id = ${business.id}::uuid
        and object_definition_id = ${product.id}::uuid
        and key = 'status'
    `;
    const statusField = statusFieldRows[0] as
      { id: string; settings_json: Json } | undefined;
    expect(statusField).toBeDefined();

    const productState = await readCreationState(
      owner,
      "product",
      ownerUser.id,
    );
    const originalStatusSettings = statusField!.settings_json;
    await fixtures.updateById("field_definitions", statusField!.id, {
      settings_json: { options: ["Active", "Paused", "Draft"] },
    });
    const staleSchemaAttempt = await createFromState(owner, productState, {
      name: "Stale schema product",
      price: 30,
    });
    expect(staleSchemaAttempt.data).toBeNull();
    expect(staleSchemaAttempt.error?.message).toContain(
      "record_creation_schema_changed",
    );
    await fixtures.updateById("field_definitions", statusField!.id, {
      settings_json: originalStatusSettings,
    });

    const equipmentState = await readCreationState(
      owner,
      "equipment",
      ownerUser.id,
    );
    const staleHeadAttempt = await createFromState(
      owner,
      equipmentState,
      { name: "Stale head equipment", hire_price: 20, available: true },
      { expectedHeadRevision: equipmentState.head_revision + 1 },
    );
    expect(staleHeadAttempt.data).toBeNull();
    expect(staleHeadAttempt.error?.message).toContain(
      "record_creation_configuration_changed",
    );
  });

  it("does not mutate configuration or create Location links while creating Records", async () => {
    const before = await sql`
      select
        (select count(*)::integer from public.object_definitions where business_id = ${business.id}::uuid) as object_count,
        (select count(*)::integer from public.field_definitions where business_id = ${business.id}::uuid) as field_count,
        (select count(*)::integer from public.views where business_id = ${business.id}::uuid) as view_count,
        (select count(*)::integer from public.relationship_definitions where business_id = ${business.id}::uuid) as relationship_count,
        (select count(*)::integer from public.locations where business_id = ${business.id}::uuid) as location_count,
        (select count(*)::integer from public.preorder_experience_locations where business_id = ${business.id}::uuid) as location_link_count,
        (select count(*)::integer from public.configuration_versions where business_id = ${business.id}::uuid) as version_count,
        (select active_version_id from public.business_configuration_heads where business_id = ${business.id}::uuid) as active_version_id,
        (select head_revision from public.business_configuration_heads where business_id = ${business.id}::uuid) as head_revision
    `;
    const leadState = await readCreationState(owner, "lead", ownerUser.id);
    const created = await createFromState(owner, leadState, {
      name: "Configuration-neutral lead",
    });
    expect(created.error).toBeNull();

    const after = await sql`
      select
        (select count(*)::integer from public.object_definitions where business_id = ${business.id}::uuid) as object_count,
        (select count(*)::integer from public.field_definitions where business_id = ${business.id}::uuid) as field_count,
        (select count(*)::integer from public.views where business_id = ${business.id}::uuid) as view_count,
        (select count(*)::integer from public.relationship_definitions where business_id = ${business.id}::uuid) as relationship_count,
        (select count(*)::integer from public.locations where business_id = ${business.id}::uuid) as location_count,
        (select count(*)::integer from public.preorder_experience_locations where business_id = ${business.id}::uuid) as location_link_count,
        (select count(*)::integer from public.configuration_versions where business_id = ${business.id}::uuid) as version_count,
        (select active_version_id from public.business_configuration_heads where business_id = ${business.id}::uuid) as active_version_id,
        (select head_revision from public.business_configuration_heads where business_id = ${business.id}::uuid) as head_revision
    `;
    expect(after).toEqual(before);
    expect(
      (after[0] as { location_link_count: number }).location_link_count,
    ).toBe(0);
  });
});
