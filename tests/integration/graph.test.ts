import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  Database,
  Enums,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";
import { createConfigurationFixtures } from "./support/configuration-fixtures";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type ObjectDefinition = Tables<"object_definitions">;
type FieldDefinition = Tables<"field_definitions">;
type RelationshipDefinition = Tables<"relationship_definitions">;
type GraphRecord = Tables<"records">;

interface TestIdentity {
  client: Client;
  user: User;
}

interface FieldInput {
  key: string;
  label: string;
  fieldType: Enums<"graph_field_type">;
  required?: boolean;
  defaultValue?: Json | null;
  settings?: Json;
  position?: number;
}

const password = "Milestone-2-test-password!";
const createdUserIds: string[] = [];

let admin: Client;
let databaseUrl: string;
let fixtureSql: Sql;
let configurationFixtures: ReturnType<typeof createConfigurationFixtures>;
let ownerA: TestIdentity;
let ownerB: TestIdentity;
let administratorA: TestIdentity;
let staffA: TestIdentity;
let businessA: Business;
let businessB: Business;
let businessBPrivateObject: ObjectDefinition;
let customerObject: ObjectDefinition;
let productObject: ObjectDefinition;
let orderObject: ObjectDefinition;
let orderItemObject: ObjectDefinition;
let validationObject: ObjectDefinition;
let validationNameField: FieldDefinition;
let customerPlacesOrder: RelationshipDefinition;
let productOrderManyToMany: RelationshipDefinition;

async function createIdentity(
  label: string,
  settings: LocalSupabaseSettings,
): Promise<TestIdentity> {
  const email = `m2-${Date.now()}-${label}-${crypto.randomUUID()}@example.test`;
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
    throw error ?? new Error(`Could not create business ${name}`);
  }

  return data;
}

async function createObject(
  _client: Client,
  businessId: string,
  key: string,
  singularLabel: string,
  kind: Enums<"object_definition_kind"> = "custom",
  semanticType: string | null = null,
): Promise<ObjectDefinition> {
  const [created] = await configurationFixtures.insert("object_definitions", {
    business_id: businessId,
    key,
    singular_label: singularLabel,
    plural_label: `${singularLabel}s`,
    description: `${singularLabel} definition`,
    kind,
    semantic_type: semanticType,
  });
  if (!created) {
    throw new Error(`Could not create object ${key}`);
  }
  return created;
}

async function createFields(
  _client: Client,
  businessId: string,
  objectDefinitionId: string,
  fields: FieldInput[],
): Promise<FieldDefinition[]> {
  return configurationFixtures.insert(
    "field_definitions",
    fields.map((field, index) => ({
      business_id: businessId,
      object_definition_id: objectDefinitionId,
      key: field.key,
      label: field.label,
      field_type: field.fieldType,
      required: field.required ?? false,
      default_value: field.defaultValue ?? null,
      settings_json: field.settings ?? {},
      position: field.position ?? index,
    })),
  );
}

async function createRelationshipDefinition(
  _client: Client,
  businessId: string,
  key: string,
  sourceObjectDefinitionId: string,
  targetObjectDefinitionId: string,
  cardinality: Enums<"relationship_cardinality">,
): Promise<RelationshipDefinition> {
  const [created] = await configurationFixtures.insert(
    "relationship_definitions",
    {
      business_id: businessId,
      key,
      source_object_definition_id: sourceObjectDefinitionId,
      target_object_definition_id: targetObjectDefinitionId,
      source_label: "connects",
      target_label: "connected from",
      cardinality,
    },
  );
  if (!created) {
    throw new Error(`Could not create relationship ${key}`);
  }
  return created;
}

async function createRecord(
  client: Client,
  businessId: string,
  objectDefinitionId: string,
  data: Json,
): Promise<GraphRecord> {
  const { data: created, error } = await client.rpc("create_graph_record", {
    expected_business_id: businessId,
    target_object_definition_id: objectDefinitionId,
    requested_data: data,
  });

  if (error || !created) {
    throw error ?? new Error("Could not create record");
  }

  return created;
}

async function createEdge(
  client: Client,
  businessId: string,
  relationshipDefinitionId: string,
  sourceRecordId: string,
  targetRecordId: string,
) {
  return client.rpc("create_graph_relationship", {
    expected_business_id: businessId,
    target_relationship_definition_id: relationshipDefinitionId,
    target_source_record_id: sourceRecordId,
    target_target_record_id: targetRecordId,
  });
}

describe("metadata-driven graph engine", () => {
  beforeAll(async () => {
    const settings = getLocalSupabaseSettings();
    databaseUrl = settings.databaseUrl;
    fixtureSql = postgres(databaseUrl, { max: 1 });
    configurationFixtures = createConfigurationFixtures(fixtureSql);
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    [ownerA, ownerB, administratorA, staffA] = await Promise.all([
      createIdentity("owner-a", settings),
      createIdentity("owner-b", settings),
      createIdentity("admin-a", settings),
      createIdentity("staff-a", settings),
    ]);

    businessA = await createOwnedBusiness(
      ownerA,
      `Graph Business A ${crypto.randomUUID()}`,
    );
    businessB = await createOwnedBusiness(
      ownerB,
      `Graph Business B ${crypto.randomUUID()}`,
    );

    const { error } = await admin.from("business_memberships").insert([
      {
        business_id: businessA.id,
        user_id: administratorA.user.id,
        role: "admin",
      },
      {
        business_id: businessA.id,
        user_id: staffA.user.id,
        role: "staff",
      },
      {
        business_id: businessB.id,
        user_id: administratorA.user.id,
        role: "staff",
      },
    ]);

    if (error) {
      throw error;
    }
  });

  afterAll(async () => {
    if (admin && businessA && businessB) {
      await admin
        .from("businesses")
        .delete()
        .in("id", [businessA.id, businessB.id]);
    }

    if (admin) {
      for (const userId of createdUserIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
    if (fixtureSql) {
      await fixtureSql.end();
    }
  });

  it("builds Customer, Product, Order and Order Item integrity fixtures", async () => {
    customerObject = await createObject(
      ownerA.client,
      businessA.id,
      "customer",
      "Customer",
      "template",
      "customer",
    );
    productObject = await createObject(
      ownerA.client,
      businessA.id,
      "product",
      "Product",
      "template",
      "product",
    );
    orderObject = await createObject(
      ownerA.client,
      businessA.id,
      "order",
      "Order",
      "template",
      "order",
    );
    orderItemObject = await createObject(
      ownerA.client,
      businessA.id,
      "order_item",
      "Order Item",
      "template",
    );

    await createFields(ownerA.client, businessA.id, customerObject.id, [
      {
        key: "name",
        label: "Name",
        fieldType: "short_text",
        required: true,
      },
      {
        key: "email",
        label: "Email",
        fieldType: "email",
        required: true,
      },
      {
        key: "phone",
        label: "Phone",
        fieldType: "phone",
        required: true,
      },
    ]);
    await createFields(ownerA.client, businessA.id, productObject.id, [
      {
        key: "name",
        label: "Name",
        fieldType: "short_text",
        required: true,
      },
      { key: "description", label: "Description", fieldType: "long_text" },
      { key: "image", label: "Image", fieldType: "file" },
      {
        key: "price",
        label: "Price",
        fieldType: "currency",
        required: true,
      },
      {
        key: "status",
        label: "Status",
        fieldType: "status",
        required: true,
        settings: { options: ["Active", "Inactive"] },
      },
    ]);
    await createFields(ownerA.client, businessA.id, orderObject.id, [
      {
        key: "order_number",
        label: "Order Number",
        fieldType: "short_text",
      },
      {
        key: "collection_date",
        label: "Collection Date",
        fieldType: "date",
        required: true,
      },
      {
        key: "collection_time",
        label: "Collection Time",
        fieldType: "short_text",
        required: true,
      },
      {
        key: "dietary_requirements",
        label: "Dietary Requirements",
        fieldType: "long_text",
      },
      {
        key: "status",
        label: "Status",
        fieldType: "status",
        required: true,
        defaultValue: "New",
        settings: {
          options: ["New", "Confirmed", "Ready", "Collected", "Cancelled"],
        },
      },
    ]);
    await createFields(ownerA.client, businessA.id, orderItemObject.id, [
      {
        key: "quantity",
        label: "Quantity",
        fieldType: "number",
        required: true,
      },
      {
        key: "unit_price",
        label: "Unit Price",
        fieldType: "currency",
        required: true,
      },
    ]);

    expect([
      customerObject.key,
      productObject.key,
      orderObject.key,
      orderItemObject.key,
    ]).toEqual(["customer", "product", "order", "order_item"]);
  });

  it("builds an additional graph integrity fixture", async () => {
    const definition = await createObject(
      administratorA.client,
      businessA.id,
      "admin_configured",
      "Admin Configured",
    );
    const [field] = await createFields(
      administratorA.client,
      businessA.id,
      definition.id,
      [
        {
          key: "name",
          label: "Name",
          fieldType: "short_text",
          required: true,
        },
      ],
    );

    expect(field?.business_id).toBe(businessA.id);
  });

  it("prevents Staff from mutating graph configuration", async () => {
    const { error: insertError } = await staffA.client
      .from("object_definitions")
      .insert({
        business_id: businessA.id,
        key: "staff_configured",
        singular_label: "Staff Configured",
        plural_label: "Staff Configured",
        kind: "custom",
      });
    expect(insertError?.code).toBe("42501");

    const { data: updated, error: updateError } = await staffA.client
      .from("object_definitions")
      .update({ singular_label: "Changed by Staff" })
      .eq("id", customerObject.id)
      .select("id");
    expect(updateError?.code).toBe("42501");
    expect(updated).toBeNull();
  });

  it("isolates definitions and Records between Businesses", async () => {
    businessBPrivateObject = await createObject(
      ownerB.client,
      businessB.id,
      "private_object",
      "Private Object",
    );
    await createFields(ownerB.client, businessB.id, businessBPrivateObject.id, [
      {
        key: "name",
        label: "Name",
        fieldType: "short_text",
        required: true,
      },
    ]);
    const privateRecord = await createRecord(
      ownerB.client,
      businessB.id,
      businessBPrivateObject.id,
      {
        name: "Business B only",
      },
    );

    const { data: definitions, error: definitionsError } = await ownerA.client
      .from("object_definitions")
      .select("id")
      .eq("id", businessBPrivateObject.id);
    expect(definitionsError).toBeNull();
    expect(definitions).toEqual([]);

    const { data: records, error: recordsError } = await ownerA.client
      .from("records")
      .select("id")
      .eq("id", privateRecord.id);
    expect(recordsError).toBeNull();
    expect(records).toEqual([]);

    const { data: changed, error: changeError } = await ownerA.client
      .from("records")
      .update({ data_json: { name: "Intrusion" } })
      .eq("id", privateRecord.id)
      .select("id");
    expect(changeError).toBeNull();
    expect(changed).toEqual([]);

    const { error: forgedTenantError } = await ownerA.client
      .from("records")
      .insert({
        business_id: businessB.id,
        object_definition_id: businessBPrivateObject.id,
        data_json: { name: "Intrusion" },
      });
    expect(forgedTenantError?.code).toBe("42501");
  });

  it("binds operational RPC identifiers to an explicit Business context", async () => {
    const businessBTargetObject = await createObject(
      ownerB.client,
      businessB.id,
      "tenant_context_target",
      "Tenant Context Target",
    );
    await createFields(ownerB.client, businessB.id, businessBTargetObject.id, [
      {
        key: "name",
        label: "Name",
        fieldType: "short_text",
        required: true,
      },
    ]);
    const businessBSourceRecord = await createRecord(
      ownerB.client,
      businessB.id,
      businessBPrivateObject.id,
      { name: "Business B source" },
    );
    const businessBTargetRecord = await createRecord(
      ownerB.client,
      businessB.id,
      businessBTargetObject.id,
      { name: "Business B target" },
    );
    const businessBRelationship = await createRelationshipDefinition(
      ownerB.client,
      businessB.id,
      "tenant_context_relationship",
      businessBPrivateObject.id,
      businessBTargetObject.id,
      "many_to_many",
    );
    const { data: businessBEdge, error: businessBEdgeError } = await createEdge(
      ownerB.client,
      businessB.id,
      businessBRelationship.id,
      businessBSourceRecord.id,
      businessBTargetRecord.id,
    );
    expect(businessBEdgeError).toBeNull();
    if (!businessBEdge) {
      throw new Error("Business B tenant-context edge was not created");
    }

    const { error: wrongCreateError } = await administratorA.client.rpc(
      "create_graph_record",
      {
        expected_business_id: businessA.id,
        target_object_definition_id: businessBPrivateObject.id,
        requested_data: { name: "Wrong Business context" },
      },
    );
    expect(wrongCreateError?.code).toBe("P0002");

    const { error: wrongUpdateError } = await administratorA.client.rpc(
      "update_graph_record",
      {
        expected_business_id: businessA.id,
        target_record_id: businessBSourceRecord.id,
        data_patch: { name: "Wrong Business update" },
      },
    );
    expect(wrongUpdateError?.code).toBe("P0002");

    const { error: wrongArchiveError } = await administratorA.client.rpc(
      "archive_graph_record",
      {
        expected_business_id: businessA.id,
        target_record_id: businessBSourceRecord.id,
      },
    );
    expect(wrongArchiveError?.code).toBe("P0002");

    const { data: unchangedRecord, error: unchangedRecordError } =
      await administratorA.client
        .from("records")
        .select("data_json, record_status")
        .eq("business_id", businessB.id)
        .eq("id", businessBSourceRecord.id)
        .single();
    expect(unchangedRecordError).toBeNull();
    expect(unchangedRecord).toMatchObject({
      data_json: { name: "Business B source" },
      record_status: "active",
    });

    const { error: wrongRelationshipCreateError } =
      await administratorA.client.rpc("create_graph_relationship", {
        expected_business_id: businessA.id,
        target_relationship_definition_id: businessBRelationship.id,
        target_source_record_id: businessBSourceRecord.id,
        target_target_record_id: businessBTargetRecord.id,
      });
    expect(wrongRelationshipCreateError?.code).toBe("P0002");

    const { data: wrongRemoveResult, error: wrongRemoveError } =
      await administratorA.client.rpc("remove_graph_relationship", {
        expected_business_id: businessA.id,
        target_record_relationship_id: businessBEdge.id,
      });
    expect(wrongRemoveError).toBeNull();
    expect(wrongRemoveResult).toBe(false);

    const { data: retainedEdge, error: retainedEdgeError } =
      await administratorA.client
        .from("record_relationships")
        .select("id")
        .eq("business_id", businessB.id)
        .eq("id", businessBEdge.id)
        .single();
    expect(retainedEdgeError).toBeNull();
    expect(retainedEdge?.id).toBe(businessBEdge.id);

    const { data: normalRecord, error: normalCreateError } =
      await administratorA.client.rpc("create_graph_record", {
        expected_business_id: businessB.id,
        target_object_definition_id: businessBPrivateObject.id,
        requested_data: { name: "Correct Business context" },
      });
    expect(normalCreateError).toBeNull();
    expect(normalRecord?.business_id).toBe(businessB.id);
    if (!normalRecord) {
      throw new Error("Dual-member Business B Record was not created");
    }

    const { data: normalUpdatedRecord, error: normalUpdateError } =
      await administratorA.client.rpc("update_graph_record", {
        expected_business_id: businessB.id,
        target_record_id: normalRecord.id,
        data_patch: { name: "Correct Business update" },
      });
    expect(normalUpdateError).toBeNull();
    expect(normalUpdatedRecord?.data_json).toMatchObject({
      name: "Correct Business update",
    });

    const { data: normalEdge, error: normalEdgeError } =
      await administratorA.client.rpc("create_graph_relationship", {
        expected_business_id: businessB.id,
        target_relationship_definition_id: businessBRelationship.id,
        target_source_record_id: normalRecord.id,
        target_target_record_id: businessBTargetRecord.id,
      });
    expect(normalEdgeError).toBeNull();
    expect(normalEdge?.business_id).toBe(businessB.id);
    if (!normalEdge) {
      throw new Error("Dual-member Business B edge was not created");
    }

    const { data: normalRemoveResult, error: normalRemoveError } =
      await administratorA.client.rpc("remove_graph_relationship", {
        expected_business_id: businessB.id,
        target_record_relationship_id: normalEdge.id,
      });
    expect(normalRemoveError).toBeNull();
    expect(normalRemoveResult).toBe(true);

    const { data: normalArchivedRecord, error: normalArchiveError } =
      await administratorA.client.rpc("archive_graph_record", {
        expected_business_id: businessB.id,
        target_record_id: normalRecord.id,
      });
    expect(normalArchiveError).toBeNull();
    expect(normalArchivedRecord?.record_status).toBe("archived");
  });

  it("rejects cross-tenant parent mismatches with database constraints", async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    const mismatchedFieldId = crypto.randomUUID();
    const mismatchedRelationshipId = crypto.randomUUID();

    try {
      await expect(
        sql`
          insert into public.field_definitions (
            id,
            business_id,
            object_definition_id,
            key,
            label,
            field_type
          )
          values (
            ${mismatchedFieldId}::uuid,
            ${businessA.id}::uuid,
            ${businessBPrivateObject.id}::uuid,
            'mismatch',
            'Mismatch',
            'short_text'
          )
        `,
      ).rejects.toMatchObject({
        code: "23503",
        constraint_name: "field_definitions_tenant_object_fkey",
      });

      await expect(
        sql`
          insert into public.relationship_definitions (
            id,
            business_id,
            key,
            source_object_definition_id,
            target_object_definition_id,
            source_label,
            target_label,
            cardinality,
            is_active
          )
          values (
            ${mismatchedRelationshipId}::uuid,
            ${businessA.id}::uuid,
            'cross_tenant_definition',
            ${customerObject.id}::uuid,
            ${businessBPrivateObject.id}::uuid,
            'source',
            'target',
            'many_to_many',
            false
          )
        `,
      ).rejects.toMatchObject({
        code: "23503",
        constraint_name: "relationship_definitions_tenant_target_object_fkey",
      });

      await expect(
        sql`
          insert into public.records (
            business_id,
            object_definition_id,
            data_json
          )
          values (
            ${businessA.id}::uuid,
            ${businessBPrivateObject.id}::uuid,
            '{"name":"Mismatch"}'::jsonb
          )
        `,
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await sql.end();
    }
  });

  it("keeps Object, Field and Relationship keys immutable", async () => {
    const validationFields = await createFields(
      ownerA.client,
      businessA.id,
      (
        await createObject(
          ownerA.client,
          businessA.id,
          "validation_object",
          "Validation Object",
        )
      ).id,
      [
        {
          key: "name",
          label: "Name",
          fieldType: "short_text",
          required: true,
        },
      ],
    );
    const validationNameCandidate = validationFields[0];
    if (!validationNameCandidate) {
      throw new Error("Validation name field was not created");
    }
    validationNameField = validationNameCandidate;
    const { data: definition } = await ownerA.client
      .from("object_definitions")
      .select("*")
      .eq("id", validationNameField.object_definition_id)
      .single();
    if (!definition) {
      throw new Error("Validation object was not found");
    }
    validationObject = definition;

    customerPlacesOrder = await createRelationshipDefinition(
      ownerA.client,
      businessA.id,
      "customer_places_order",
      customerObject.id,
      orderObject.id,
      "one_to_many",
    );

    await expect(
      configurationFixtures.updateById(
        "object_definitions",
        validationObject.id,
        { key: "changed_object" },
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      configurationFixtures.updateById(
        "field_definitions",
        validationNameField.id,
        { key: "changed_field" },
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      configurationFixtures.updateById(
        "relationship_definitions",
        customerPlacesOrder.id,
        { key: "changed_relationship" },
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("allows progressive Records while validating supplied and unknown values", async () => {
    const { data: progressiveRecord, error: progressiveError } =
      await ownerA.client.rpc("create_graph_record", {
        expected_business_id: businessA.id,
        target_object_definition_id: validationObject.id,
        requested_data: {},
      });
    expect(progressiveError).toBeNull();
    expect(progressiveRecord?.data_json).toEqual({});

    const { error: unknownError } = await ownerA.client.rpc(
      "create_graph_record",
      {
        expected_business_id: businessA.id,
        target_object_definition_id: validationObject.id,
        requested_data: { name: "Known", surprise: true },
      },
    );
    expect(unknownError?.code).toBe("22023");

    const validRecord = await createRecord(
      ownerA.client,
      businessA.id,
      validationObject.id,
      {
        name: "Complete",
      },
    );
    const { error: progressiveUpdateError } = await ownerA.client
      .from("records")
      .update({ data_json: {} })
      .eq("id", validRecord.id);
    expect(progressiveUpdateError).toBeNull();
  });

  it("rejects required defaults that do not satisfy generic presence semantics", async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    const emptyTextKey = `empty_text_${crypto.randomUUID().replaceAll("-", "")}`;
    const emptyMultiKey = `empty_multi_${crypto.randomUUID().replaceAll("-", "")}`;
    const jsonNullKey = `json_null_${crypto.randomUUID().replaceAll("-", "")}`;

    try {
      await expect(
        sql`
          insert into public.field_definitions (
            business_id,
            object_definition_id,
            key,
            label,
            field_type,
            required,
            default_value
          )
          values (
            ${businessA.id}::uuid,
            ${validationObject.id}::uuid,
            ${emptyTextKey},
            'Empty text default',
            'short_text',
            true,
            '""'::jsonb
          )
        `,
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        sql`
          insert into public.field_definitions (
            business_id,
            object_definition_id,
            key,
            label,
            field_type,
            required,
            default_value,
            settings_json
          )
          values (
            ${businessA.id}::uuid,
            ${validationObject.id}::uuid,
            ${emptyMultiKey},
            'Empty multi-select default',
            'multi_select',
            true,
            '[]'::jsonb,
            '{"options":["Standard"]}'::jsonb
          )
        `,
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        sql`
          insert into public.field_definitions (
            business_id,
            object_definition_id,
            key,
            label,
            field_type,
            required,
            default_value
          )
          values (
            ${businessA.id}::uuid,
            ${validationObject.id}::uuid,
            ${jsonNullKey},
            'JSON null default',
            'short_text',
            true,
            'null'::jsonb
          )
        `,
      ).rejects.toMatchObject({ code: "23514" });

      const persisted = await sql<{ key: string }[]>`
        select field_definition.key
        from public.field_definitions as field_definition
        where field_definition.business_id = ${businessA.id}::uuid
          and field_definition.object_definition_id =
            ${validationObject.id}::uuid
          and field_definition.key in (
            ${emptyTextKey},
            ${emptyMultiKey},
            ${jsonNullKey}
          )
      `;
      expect(persisted).toEqual([]);
    } finally {
      await sql.end();
    }
  });

  it("enforces primitive types, select/status options and multi-select shape", async () => {
    await createFields(ownerA.client, businessA.id, validationObject.id, [
      { key: "count", label: "Count", fieldType: "number" },
      {
        key: "stage",
        label: "Stage",
        fieldType: "select",
        settings: { options: ["New", "Won"] },
      },
      {
        key: "status",
        label: "Status",
        fieldType: "status",
        settings: { options: ["Open", "Closed"] },
      },
      {
        key: "tags",
        label: "Tags",
        fieldType: "multi_select",
        settings: { options: ["Priority", "Repeat"] },
      },
      { key: "due_date", label: "Due Date", fieldType: "date" },
      { key: "contact", label: "Contact", fieldType: "email" },
    ]);

    const invalidCases: Json[] = [
      { name: "Wrong number", count: "four" },
      { name: "Wrong select", stage: "Lost" },
      { name: "Wrong status", status: "Unknown" },
      { name: "Wrong multi", tags: "Priority" },
      { name: "Wrong multi option", tags: ["Other"] },
      { name: "Wrong date", due_date: "2026-02-30" },
      { name: "Wrong email", contact: "not-an-email" },
    ];

    for (const invalidData of invalidCases) {
      const { error } = await ownerA.client.rpc("create_graph_record", {
        expected_business_id: businessA.id,
        target_object_definition_id: validationObject.id,
        requested_data: invalidData,
      });
      expect(error?.code).toBe("22023");
    }
  });

  it("creates and updates valid generic Records and derives created_by", async () => {
    const { data: created, error: createError } = await ownerA.client
      .from("records")
      .insert({
        business_id: businessA.id,
        object_definition_id: validationObject.id,
        data_json: {
          name: "Valid",
          count: 4,
          stage: "New",
          status: "Open",
          tags: ["Priority"],
          due_date: "2026-12-24",
          contact: "owner@example.test",
        },
        created_by: ownerB.user.id,
      })
      .select("*")
      .single();

    expect(createError).toBeNull();
    expect(created?.created_by).toBe(ownerA.user.id);
    if (!created) {
      throw new Error("Valid record was not created");
    }

    const { data: updated, error: updateError } = await ownerA.client.rpc(
      "update_graph_record",
      {
        expected_business_id: businessA.id,
        target_record_id: created.id,
        data_patch: { count: 5 },
      },
    );
    expect(updateError).toBeNull();
    expect(updated?.data_json).toMatchObject({ name: "Valid", count: 5 });

    const { data: forgedUpdate, error: forgedUpdateError } = await ownerA.client
      .from("records")
      .update({ created_by: ownerB.user.id })
      .eq("id", created.id)
      .select("created_by")
      .single();
    expect(forgedUpdateError).toBeNull();
    expect(forgedUpdate?.created_by).toBe(ownerA.user.id);

    const { error: deleteError } = await ownerA.client
      .from("records")
      .delete()
      .eq("id", created.id);
    expect(deleteError?.code).toBe("42501");
  });

  it("enforces Relationship source and target Object types", async () => {
    const customer = await createRecord(
      ownerA.client,
      businessA.id,
      customerObject.id,
      {
        name: "Customer One",
        email: "customer-one@example.test",
        phone: "01234567890",
      },
    );
    const order = await createRecord(
      ownerA.client,
      businessA.id,
      orderObject.id,
      {
        collection_date: "2026-12-24",
        collection_time: "12:00",
      },
    );
    const product = await createRecord(
      ownerA.client,
      businessA.id,
      productObject.id,
      {
        name: "Tea Box",
        price: 30,
        status: "Active",
      },
    );

    const validEdge = await createEdge(
      ownerA.client,
      businessA.id,
      customerPlacesOrder.id,
      customer.id,
      order.id,
    );
    expect(validEdge.error).toBeNull();

    const invalidEdge = await createEdge(
      ownerA.client,
      businessA.id,
      customerPlacesOrder.id,
      product.id,
      order.id,
    );
    expect(invalidEdge.error?.code).toBe("23514");
  });

  it("makes cross-tenant graph edges structurally impossible", async () => {
    const businessBCustomerObject = await createObject(
      ownerB.client,
      businessB.id,
      "customer",
      "Customer",
    );
    await createFields(
      ownerB.client,
      businessB.id,
      businessBCustomerObject.id,
      [
        {
          key: "name",
          label: "Name",
          fieldType: "short_text",
          required: true,
        },
      ],
    );
    const businessBCustomer = await createRecord(
      ownerB.client,
      businessB.id,
      businessBCustomerObject.id,
      { name: "Business B Customer" },
    );
    const businessAOrder = await createRecord(
      ownerA.client,
      businessA.id,
      orderObject.id,
      {
        collection_date: "2026-12-25",
        collection_time: "12:30",
      },
    );
    const sql = postgres(databaseUrl, { max: 1 });

    try {
      await expect(
        sql`
          insert into public.record_relationships (
            business_id,
            relationship_definition_id,
            source_record_id,
            target_record_id
          )
          values (
            ${businessA.id}::uuid,
            ${customerPlacesOrder.id}::uuid,
            ${businessBCustomer.id}::uuid,
            ${businessAOrder.id}::uuid
          )
        `,
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await sql.end();
    }
  });

  it("enforces one-to-one cardinality in both directions", async () => {
    const passportObject = await createObject(
      ownerA.client,
      businessA.id,
      "passport",
      "Passport",
    );
    await createFields(ownerA.client, businessA.id, passportObject.id, [
      {
        key: "number",
        label: "Number",
        fieldType: "short_text",
        required: true,
      },
    ]);
    const definition = await createRelationshipDefinition(
      ownerA.client,
      businessA.id,
      "customer_has_passport",
      customerObject.id,
      passportObject.id,
      "one_to_one",
    );
    const customerOne = await createRecord(
      ownerA.client,
      businessA.id,
      customerObject.id,
      {
        name: "One",
        email: "one@example.test",
        phone: "1",
      },
    );
    const customerTwo = await createRecord(
      ownerA.client,
      businessA.id,
      customerObject.id,
      {
        name: "Two",
        email: "two@example.test",
        phone: "2",
      },
    );
    const passportOne = await createRecord(
      ownerA.client,
      businessA.id,
      passportObject.id,
      {
        number: "P1",
      },
    );
    const passportTwo = await createRecord(
      ownerA.client,
      businessA.id,
      passportObject.id,
      {
        number: "P2",
      },
    );

    expect(
      (
        await createEdge(
          ownerA.client,
          businessA.id,
          definition.id,
          customerOne.id,
          passportOne.id,
        )
      ).error,
    ).toBeNull();
    expect(
      (
        await createEdge(
          ownerA.client,
          businessA.id,
          definition.id,
          customerOne.id,
          passportTwo.id,
        )
      ).error?.code,
    ).toBe("23505");
    expect(
      (
        await createEdge(
          ownerA.client,
          businessA.id,
          definition.id,
          customerTwo.id,
          passportOne.id,
        )
      ).error?.code,
    ).toBe("23505");
  });

  it("enforces one-to-many cardinality while allowing multiple targets", async () => {
    const customerOne = await createRecord(
      ownerA.client,
      businessA.id,
      customerObject.id,
      {
        name: "One-to-many One",
        email: "otm-one@example.test",
        phone: "1",
      },
    );
    const customerTwo = await createRecord(
      ownerA.client,
      businessA.id,
      customerObject.id,
      {
        name: "One-to-many Two",
        email: "otm-two@example.test",
        phone: "2",
      },
    );
    const orderOne = await createRecord(
      ownerA.client,
      businessA.id,
      orderObject.id,
      {
        collection_date: "2026-12-26",
        collection_time: "13:00",
      },
    );
    const orderTwo = await createRecord(
      ownerA.client,
      businessA.id,
      orderObject.id,
      {
        collection_date: "2026-12-26",
        collection_time: "13:30",
      },
    );

    expect(
      (
        await createEdge(
          ownerA.client,
          businessA.id,
          customerPlacesOrder.id,
          customerOne.id,
          orderOne.id,
        )
      ).error,
    ).toBeNull();
    expect(
      (
        await createEdge(
          ownerA.client,
          businessA.id,
          customerPlacesOrder.id,
          customerOne.id,
          orderTwo.id,
        )
      ).error,
    ).toBeNull();
    expect(
      (
        await createEdge(
          ownerA.client,
          businessA.id,
          customerPlacesOrder.id,
          customerTwo.id,
          orderOne.id,
        )
      ).error?.code,
    ).toBe("23505");
  });

  it("supports many-to-many relationships", async () => {
    productOrderManyToMany = await createRelationshipDefinition(
      ownerA.client,
      businessA.id,
      "product_in_order",
      productObject.id,
      orderObject.id,
      "many_to_many",
    );
    const productOne = await createRecord(
      ownerA.client,
      businessA.id,
      productObject.id,
      {
        name: "Product One",
        price: 10,
        status: "Active",
      },
    );
    const productTwo = await createRecord(
      ownerA.client,
      businessA.id,
      productObject.id,
      {
        name: "Product Two",
        price: 12,
        status: "Active",
      },
    );
    const orderOne = await createRecord(
      ownerA.client,
      businessA.id,
      orderObject.id,
      {
        collection_date: "2026-12-27",
        collection_time: "14:00",
      },
    );
    const orderTwo = await createRecord(
      ownerA.client,
      businessA.id,
      orderObject.id,
      {
        collection_date: "2026-12-27",
        collection_time: "14:30",
      },
    );

    const edges = await Promise.all([
      createEdge(
        ownerA.client,
        businessA.id,
        productOrderManyToMany.id,
        productOne.id,
        orderOne.id,
      ),
      createEdge(
        ownerA.client,
        businessA.id,
        productOrderManyToMany.id,
        productOne.id,
        orderTwo.id,
      ),
      createEdge(
        ownerA.client,
        businessA.id,
        productOrderManyToMany.id,
        productTwo.id,
        orderOne.id,
      ),
    ]);

    expect(edges.every(({ error }) => error === null)).toBe(true);
  });

  it("serializes concurrent writes before enforcing cardinality", async () => {
    const customerOne = await createRecord(
      ownerA.client,
      businessA.id,
      customerObject.id,
      {
        name: "Concurrent One",
        email: "concurrent-one@example.test",
        phone: "1",
      },
    );
    const customerTwo = await createRecord(
      ownerA.client,
      businessA.id,
      customerObject.id,
      {
        name: "Concurrent Two",
        email: "concurrent-two@example.test",
        phone: "2",
      },
    );
    const order = await createRecord(
      ownerA.client,
      businessA.id,
      orderObject.id,
      {
        collection_date: "2026-12-28",
        collection_time: "15:00",
      },
    );

    async function insertConcurrently(sourceRecordId: string): Promise<void> {
      const sql = postgres(databaseUrl, { max: 1 });
      try {
        await sql.begin(async (transaction) => {
          await transaction`
            insert into public.record_relationships (
              business_id,
              relationship_definition_id,
              source_record_id,
              target_record_id
            )
            values (
              ${businessA.id}::uuid,
              ${customerPlacesOrder.id}::uuid,
              ${sourceRecordId}::uuid,
              ${order.id}::uuid
            )
          `;
          await transaction`select pg_sleep(0.2)`;
        });
      } finally {
        await sql.end();
      }
    }

    const results = await Promise.allSettled([
      insertConcurrently(customerOne.id),
      insertConcurrently(customerTwo.id),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "23505" },
      status: "rejected",
    });
  });

  it("serializes Field changes against Record validation in both lock orders", async () => {
    const concurrentObject = await createObject(
      ownerA.client,
      businessA.id,
      "concurrent_field_configuration",
      "Concurrent Field Configuration",
    );
    const [statusField] = await createFields(
      ownerA.client,
      businessA.id,
      concurrentObject.id,
      [
        {
          key: "status",
          label: "Status",
          fieldType: "status",
          required: true,
          settings: { options: ["Open", "Closed"] },
        },
      ],
    );
    if (!statusField) {
      throw new Error("Concurrent status Field was not created");
    }

    const recordId = crypto.randomUUID();
    const recordSql = postgres(databaseUrl, { max: 1 });
    const configurationSql = postgres(databaseUrl, { max: 1 });
    let announceRecordValidation: () => void = () => {};
    let announceConfigurationReady: () => void = () => {};
    const recordHasValidated = new Promise<void>((resolve) => {
      announceRecordValidation = resolve;
    });
    const configurationIsReady = new Promise<void>((resolve) => {
      announceConfigurationReady = resolve;
    });

    try {
      const recordWrite = recordSql.begin(async (transaction) => {
        await transaction`
          insert into public.records (
            id,
            business_id,
            object_definition_id,
            data_json
          )
          values (
            ${recordId}::uuid,
            ${businessA.id}::uuid,
            ${concurrentObject.id}::uuid,
            '{"status":"Open"}'::jsonb
          )
        `;
        announceRecordValidation();
        await configurationIsReady;
        await transaction`select pg_sleep(0.2)`;
      });

      const configurationWrite = configurationSql.begin(async (transaction) => {
        await recordHasValidated;
        announceConfigurationReady();
        await transaction`
            update public.field_definitions
            set settings_json = '{"options":["Closed"]}'::jsonb
            where business_id = ${businessA.id}::uuid
              and id = ${statusField.id}::uuid
          `;
      });

      const results = await Promise.allSettled([
        recordWrite,
        configurationWrite,
      ]);

      expect(results[0]).toMatchObject({ status: "fulfilled" });
      expect(results[1]).toMatchObject({
        reason: { code: "22023" },
        status: "rejected",
      });

      const [finalField] = await recordSql`
        select settings_json
        from public.field_definitions
        where id = ${statusField.id}::uuid
      `;
      const [finalRecord] = await recordSql`
        select data_json
        from public.records
        where id = ${recordId}::uuid
      `;

      expect(finalField?.settings_json).toEqual({
        options: ["Open", "Closed"],
      });
      expect(finalRecord?.data_json).toEqual({ status: "Open" });

      const configurationFirstObject = await createObject(
        ownerA.client,
        businessA.id,
        "concurrent_configuration_first",
        "Concurrent Configuration First",
      );
      const [configurationFirstField] = await createFields(
        ownerA.client,
        businessA.id,
        configurationFirstObject.id,
        [
          {
            key: "status",
            label: "Status",
            fieldType: "status",
            required: true,
            settings: { options: ["Open", "Closed"] },
          },
        ],
      );
      if (!configurationFirstField) {
        throw new Error("Configuration-first status Field was not created");
      }

      const rejectedRecordId = crypto.randomUUID();
      let announceConfigurationMutation: () => void = () => {};
      let announceRecordAttempt: () => void = () => {};
      const configurationHasMutated = new Promise<void>((resolve) => {
        announceConfigurationMutation = resolve;
      });
      const recordIsReady = new Promise<void>((resolve) => {
        announceRecordAttempt = resolve;
      });

      const configurationFirstWrite = configurationSql.begin(
        async (transaction) => {
          await transaction`
            update public.field_definitions
            set settings_json = '{"options":["Closed"]}'::jsonb
            where business_id = ${businessA.id}::uuid
              and id = ${configurationFirstField.id}::uuid
          `;
          announceConfigurationMutation();
          await recordIsReady;
          await transaction`select pg_sleep(0.2)`;
        },
      );

      const rejectedRecordWrite = recordSql.begin(async (transaction) => {
        await configurationHasMutated;
        announceRecordAttempt();
        await transaction`
          insert into public.records (
            id,
            business_id,
            object_definition_id,
            data_json
          )
          values (
            ${rejectedRecordId}::uuid,
            ${businessA.id}::uuid,
            ${configurationFirstObject.id}::uuid,
            '{"status":"Open"}'::jsonb
          )
        `;
      });

      const configurationFirstResults = await Promise.allSettled([
        configurationFirstWrite,
        rejectedRecordWrite,
      ]);

      expect(configurationFirstResults[0]).toMatchObject({
        status: "fulfilled",
      });
      expect(configurationFirstResults[1]).toMatchObject({
        reason: { code: "22023" },
        status: "rejected",
      });

      const [configurationFirstFinalField] = await configurationSql`
        select settings_json
        from public.field_definitions
        where id = ${configurationFirstField.id}::uuid
      `;
      const [rejectedRecord] = await recordSql`
        select id
        from public.records
        where id = ${rejectedRecordId}::uuid
      `;

      expect(configurationFirstFinalField?.settings_json).toEqual({
        options: ["Closed"],
      });
      expect(rejectedRecord).toBeUndefined();
    } finally {
      await Promise.all([recordSql.end(), configurationSql.end()]);
    }
  });

  it("handles archived configuration without corrupting historical data", async () => {
    const archiveObject = await createObject(
      ownerA.client,
      businessA.id,
      "archive_proof",
      "Archive Proof",
    );
    const [nameField, legacyField] = await createFields(
      ownerA.client,
      businessA.id,
      archiveObject.id,
      [
        {
          key: "name",
          label: "Name",
          fieldType: "short_text",
          required: true,
        },
        {
          key: "legacy",
          label: "Legacy",
          fieldType: "short_text",
        },
      ],
    );
    if (!nameField || !legacyField) {
      throw new Error("Archive fields were not created");
    }
    const existing = await createRecord(
      ownerA.client,
      businessA.id,
      archiveObject.id,
      {
        name: "Before archive",
        legacy: "Retained",
      },
    );

    await configurationFixtures.updateById(
      "field_definitions",
      legacyField.id,
      { is_active: false },
    );

    const { data: updated, error: updateError } = await ownerA.client.rpc(
      "update_graph_record",
      {
        expected_business_id: businessA.id,
        target_record_id: existing.id,
        data_patch: { name: "After field archive" },
      },
    );
    expect(updateError).toBeNull();
    expect(updated?.data_json).toMatchObject({ legacy: "Retained" });

    const { error: archivedFieldWriteError } = await ownerA.client.rpc(
      "update_graph_record",
      {
        expected_business_id: businessA.id,
        target_record_id: existing.id,
        data_patch: { legacy: "Changed" },
      },
    );
    expect(archivedFieldWriteError?.code).toBe("23514");

    const { error: archivedFieldCreateError } = await ownerA.client.rpc(
      "create_graph_record",
      {
        expected_business_id: businessA.id,
        target_object_definition_id: archiveObject.id,
        requested_data: { name: "New", legacy: "No longer writable" },
      },
    );
    expect(archivedFieldCreateError?.code).toBe("23514");

    const archiveTargetObject = await createObject(
      ownerA.client,
      businessA.id,
      "archive_target",
      "Archive Target",
    );
    await createFields(ownerA.client, businessA.id, archiveTargetObject.id, [
      {
        key: "name",
        label: "Name",
        fieldType: "short_text",
        required: true,
      },
    ]);
    const archiveTargetOne = await createRecord(
      ownerA.client,
      businessA.id,
      archiveTargetObject.id,
      { name: "Target one" },
    );
    const archiveTargetTwo = await createRecord(
      ownerA.client,
      businessA.id,
      archiveTargetObject.id,
      { name: "Target two" },
    );
    const archiveRelationship = await createRelationshipDefinition(
      ownerA.client,
      businessA.id,
      "archive_proof_targets",
      archiveObject.id,
      archiveTargetObject.id,
      "many_to_many",
    );
    const { data: existingEdge, error: existingEdgeError } = await createEdge(
      ownerA.client,
      businessA.id,
      archiveRelationship.id,
      existing.id,
      archiveTargetOne.id,
    );
    expect(existingEdgeError).toBeNull();
    if (!existingEdge) {
      throw new Error("Archive proof edge was not created");
    }

    await expect(
      configurationFixtures.updateById("object_definitions", archiveObject.id, {
        is_active: false,
      }),
    ).rejects.toMatchObject({ code: "23514" });

    await configurationFixtures.updateById(
      "relationship_definitions",
      archiveRelationship.id,
      { is_active: false },
    );

    const archivedRelationshipWrite = await createEdge(
      ownerA.client,
      businessA.id,
      archiveRelationship.id,
      existing.id,
      archiveTargetTwo.id,
    );
    expect(archivedRelationshipWrite.error?.code).toBe("23514");

    await configurationFixtures.updateById(
      "object_definitions",
      archiveObject.id,
      { is_active: false },
    );

    const { data: historicalEdges, error: historicalEdgesError } =
      await ownerA.client
        .from("record_relationships")
        .select("id")
        .eq("id", existingEdge.id);
    expect(historicalEdgesError).toBeNull();
    expect(historicalEdges).toEqual([{ id: existingEdge.id }]);

    const { data: removedEdge, error: removeEdgeError } =
      await ownerA.client.rpc("remove_graph_relationship", {
        expected_business_id: businessA.id,
        target_record_relationship_id: existingEdge.id,
      });
    expect(removeEdgeError).toBeNull();
    expect(removedEdge).toBe(true);

    const { error: newRecordError } = await ownerA.client.rpc(
      "create_graph_record",
      {
        expected_business_id: businessA.id,
        target_object_definition_id: archiveObject.id,
        requested_data: { name: "Too late" },
      },
    );
    expect(newRecordError?.code).toBe("23514");

    const { data: archivedRecord, error: archiveRecordError } =
      await ownerA.client.rpc("archive_graph_record", {
        expected_business_id: businessA.id,
        target_record_id: existing.id,
      });
    expect(archiveRecordError).toBeNull();
    expect(archivedRecord?.record_status).toBe("archived");
  });

  it("creates Catering Enquiry and two Records through graph configuration only", async () => {
    const cateringEnquiry = await createObject(
      ownerA.client,
      businessA.id,
      "catering_enquiry",
      "Catering Enquiry",
    );
    await createFields(ownerA.client, businessA.id, cateringEnquiry.id, [
      {
        key: "company_name",
        label: "Company Name",
        fieldType: "short_text",
        required: true,
      },
      {
        key: "event_date",
        label: "Event Date",
        fieldType: "date",
        required: true,
      },
      {
        key: "guest_count",
        label: "Guest Count",
        fieldType: "number",
        required: true,
      },
      { key: "budget", label: "Budget", fieldType: "currency" },
      { key: "notes", label: "Notes", fieldType: "long_text" },
      {
        key: "status",
        label: "Status",
        fieldType: "status",
        defaultValue: "New",
        settings: { options: ["New", "Contacted", "Booked", "Declined"] },
      },
    ]);

    const first = await createRecord(
      ownerA.client,
      businessA.id,
      cateringEnquiry.id,
      {
        company_name: "Acme Ltd",
        event_date: "2026-11-10",
        guest_count: 80,
        budget: 4000,
        notes: "Lunch service",
      },
    );
    const second = await createRecord(
      ownerA.client,
      businessA.id,
      cateringEnquiry.id,
      {
        company_name: "Example Co",
        event_date: "2026-12-05",
        guest_count: 45,
        status: "Contacted",
      },
    );

    const { data: records, error } = await ownerA.client
      .from("records")
      .select("*")
      .eq("object_definition_id", cateringEnquiry.id)
      .order("created_at");
    expect(error).toBeNull();
    expect(records?.map(({ id }) => id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(first.data_json).toMatchObject({ status: "New" });

    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const [tableCheck] = await sql`
        select to_regclass('public.catering_enquiries') as table_name
      `;
      expect(tableCheck?.table_name).toBeNull();
    } finally {
      await sql.end();
    }
  });
});
