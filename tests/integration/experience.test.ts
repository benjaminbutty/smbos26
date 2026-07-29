import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createExperienceService,
  ExperienceServiceError,
  resolvePublicPage,
} from "../../src/core/experience/service";
import type {
  Database,
  Enums,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import { FormRenderer } from "../../src/runtime/forms/form-renderer";
import { submitExperienceForm } from "../../src/runtime/forms/submission";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";
import { createConfigurationFixtures } from "./support/configuration-fixtures";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type ObjectDefinition = Tables<"object_definitions">;
type FieldDefinition = Tables<"field_definitions">;
type ExperienceForm = Tables<"forms">;
type ExperienceView = Tables<"views">;

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

const password = "Milestone-3-test-password!";
const createdUserIds: string[] = [];

function requireFixture<T>(rows: T[], message: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(message);
  }
  return row;
}

let admin: Client;
let anonymous: Client;
let databaseUrl: string;
let fixtureSql: Sql;
let configurationFixtures: ReturnType<typeof createConfigurationFixtures>;
let ownerA: TestIdentity;
let ownerB: TestIdentity;
let administratorA: TestIdentity;
let staffA: TestIdentity;
let businessA: Business;
let businessB: Business;
let cateringObject: ObjectDefinition;
let businessBObject: ObjectDefinition;
let cateringFields: FieldDefinition[];
let createForm: ExperienceForm;
let editForm: ExperienceForm;
let tableView: ExperienceView;
let businessBView: ExperienceView;

async function createIdentity(
  label: string,
  settings: LocalSupabaseSettings,
): Promise<TestIdentity> {
  const email = `m3-${Date.now()}-${label}-${crypto.randomUUID()}@example.test`;
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
    throw error ?? new Error(`Could not create ${name}`);
  }

  return data;
}

async function createObject(
  _client: Client,
  businessId: string,
  key: string,
  singularLabel: string,
): Promise<ObjectDefinition> {
  const [created] = await configurationFixtures.insert("object_definitions", {
    business_id: businessId,
    key,
    singular_label: singularLabel,
    plural_label:
      singularLabel === "Catering Enquiry"
        ? "Catering Enquiries"
        : `${singularLabel}s`,
    description: "",
    kind: "custom",
  });
  if (!created) {
    throw new Error(`Could not create Object ${key}`);
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

const cateringFormFields = [
  { field: "company_name" },
  { field: "event_date" },
  { field: "guest_count" },
  { field: "budget" },
  { field: "notes" },
  { field: "attachment" },
  { field: "status" },
];

describe("Milestone 3 experience runtime", () => {
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

    [ownerA, ownerB, administratorA, staffA] = await Promise.all([
      createIdentity("owner-a", settings),
      createIdentity("owner-b", settings),
      createIdentity("admin-a", settings),
      createIdentity("staff-a", settings),
    ]);
    businessA = await createOwnedBusiness(
      ownerA,
      `Experience A ${crypto.randomUUID()}`,
    );
    businessB = await createOwnedBusiness(
      ownerB,
      `Experience B ${crypto.randomUUID()}`,
    );
    const { error: membershipError } = await admin
      .from("business_memberships")
      .insert([
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
    if (membershipError) {
      throw membershipError;
    }

    cateringObject = await createObject(
      ownerA.client,
      businessA.id,
      "catering_enquiry",
      "Catering Enquiry",
    );
    cateringFields = await createFields(
      ownerA.client,
      businessA.id,
      cateringObject.id,
      [
        {
          key: "company_name",
          label: "Company",
          fieldType: "short_text",
          required: true,
        },
        {
          key: "event_date",
          label: "Event date",
          fieldType: "date",
          required: true,
        },
        {
          key: "guest_count",
          label: "Guests",
          fieldType: "number",
          required: true,
        },
        {
          key: "budget",
          label: "Budget",
          fieldType: "currency",
          settings: { currency: "GBP" },
        },
        { key: "notes", label: "Notes", fieldType: "long_text" },
        { key: "attachment", label: "Attachment", fieldType: "file" },
        {
          key: "status",
          label: "Status",
          fieldType: "status",
          defaultValue: "New",
          settings: { options: ["New", "Contacted", "Booked"] },
        },
      ],
    );

    businessBObject = await createObject(
      ownerB.client,
      businessB.id,
      "private_item",
      "Private Item",
    );
    await createFields(ownerB.client, businessB.id, businessBObject.id, [
      {
        key: "name",
        label: "Name",
        fieldType: "short_text",
        required: true,
      },
    ]);
    const [createdBusinessBView] = await configurationFixtures.insert("views", {
      business_id: businessB.id,
      key: "private_items",
      name: "Private Items",
      view_type: "table",
      object_definition_id: businessBObject.id,
      audience: "internal",
      config_json: { fields: ["name"], include_archived: false },
    });
    if (!createdBusinessBView) {
      throw new Error("Could not create Business B View");
    }
    businessBView = createdBusinessBView;
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

  it("builds Forms and a configured Table View integrity fixture", async () => {
    createForm = requireFixture(
      await configurationFixtures.insert("forms", {
        business_id: businessA.id,
        key: "catering_create",
        name: "New catering enquiry",
        object_definition_id: cateringObject.id,
        mode: "create",
        config_json: {
          fields: cateringFormFields,
          submit_label: "Add enquiry",
        },
        audience: "internal",
      }),
      "Could not create catering Form fixture.",
    );
    editForm = requireFixture(
      await configurationFixtures.insert("forms", {
        business_id: businessA.id,
        key: "catering_edit",
        name: "Edit catering enquiry",
        object_definition_id: cateringObject.id,
        mode: "edit",
        config_json: {
          fields: cateringFormFields,
          submit_label: "Save enquiry",
        },
        audience: "internal",
      }),
      "Could not create catering edit Form fixture.",
    );
    tableView = requireFixture(
      await configurationFixtures.insert("views", {
        business_id: businessA.id,
        key: "catering_enquiries",
        name: "Catering Enquiries",
        view_type: "table",
        object_definition_id: cateringObject.id,
        config_json: {
          fields: [
            "company_name",
            "event_date",
            "guest_count",
            "budget",
            "status",
          ],
          title_field: "company_name",
          create_form_key: createForm.key,
          edit_form_key: editForm.key,
          include_archived: false,
        },
        audience: "internal",
      }),
      "Could not create catering View fixture.",
    );

    expect(tableView.business_id).toBe(businessA.id);
    expect(tableView.config_json).toMatchObject({
      fields: ["company_name", "event_date", "guest_count", "budget", "status"],
      include_archived: false,
    });
  });

  it("updates an experience integrity fixture through the database-owner boundary", async () => {
    const list = requireFixture(
      await configurationFixtures.insert("views", {
        business_id: businessA.id,
        key: "catering_list",
        name: "Enquiry list",
        view_type: "list",
        object_definition_id: cateringObject.id,
        config_json: {
          primary_field: "company_name",
          secondary_fields: ["event_date", "status"],
          include_archived: false,
        },
        audience: "internal",
      }),
      "Could not create list View fixture.",
    );
    const updated = await configurationFixtures.updateById("views", list.id, {
      name: "Catering enquiry list",
    });

    expect(updated.name).toBe("Catering enquiry list");
  });

  it("prevents Staff from mutating experience configuration", async () => {
    const { error: insertError } = await staffA.client.from("forms").insert({
      business_id: businessA.id,
      key: "staff_form",
      name: "Staff Form",
      object_definition_id: cateringObject.id,
      mode: "edit",
      audience: "internal",
      config_json: { fields: cateringFormFields },
    });
    expect(insertError).not.toBeNull();

    const { data: updated, error: updateError } = await staffA.client
      .from("views")
      .update({ name: "Changed by Staff" })
      .eq("id", tableView.id)
      .select("id");
    expect(updateError?.code).toBe("42501");
    expect(updated).toBeNull();
  });

  it("isolates experience configuration between Businesses", async () => {
    const { data: hidden, error: readError } = await ownerA.client
      .from("views")
      .select("id")
      .eq("id", businessBView.id);
    expect(readError).toBeNull();
    expect(hidden).toEqual([]);

    const { data: changed, error: updateError } = await ownerA.client
      .from("views")
      .update({ name: "Intrusion" })
      .eq("id", businessBView.id)
      .select("id");
    expect(updateError?.code).toBe("42501");
    expect(changed).toBeNull();
  });

  it("rejects cross-tenant Object references structurally", async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await expect(
        sql`
          insert into public.views (
            business_id,
            key,
            name,
            view_type,
            object_definition_id,
            config_json,
            audience,
            is_active
          )
          values (
            ${businessA.id}::uuid,
            'cross_tenant_view',
            'Cross tenant',
            'table',
            ${businessBObject.id}::uuid,
            '{"fields":["name"]}'::jsonb,
            'internal',
            false
          )
        `,
      ).rejects.toMatchObject({
        code: "23503",
        constraint_name: "views_tenant_object_fkey",
      });

      await expect(
        sql`
          insert into public.forms (
            business_id,
            key,
            name,
            object_definition_id,
            mode,
            config_json,
            audience,
            is_active
          )
          values (
            ${businessA.id}::uuid,
            'cross_tenant_form',
            'Cross tenant',
            ${businessBObject.id}::uuid,
            'edit',
            '{"fields":[{"field":"name"}]}'::jsonb,
            'internal',
            false
          )
        `,
      ).rejects.toMatchObject({
        code: "23503",
        constraint_name: "forms_tenant_object_fkey",
      });
    } finally {
      await sql.end();
    }
  });

  it("rejects invalid field references and arbitrary configuration", async () => {
    await expect(
      configurationFixtures.insert("views", {
        business_id: businessA.id,
        key: "invalid_field_view",
        name: "Invalid field",
        view_type: "table",
        object_definition_id: cateringObject.id,
        audience: "internal",
        config_json: { fields: ["not_a_field"] },
      }),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      configurationFixtures.insert("forms", {
        business_id: businessA.id,
        key: "invalid_field_form",
        name: "Invalid field",
        object_definition_id: cateringObject.id,
        mode: "edit",
        audience: "internal",
        config_json: { fields: [{ field: "not_a_field" }] },
      }),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      configurationFixtures.insert("views", {
        business_id: businessA.id,
        key: "arbitrary_view",
        name: "Arbitrary",
        view_type: "table",
        object_definition_id: cateringObject.id,
        audience: "internal",
        config_json: {
          fields: ["company_name"],
          javascript: "alert(1)",
        },
      }),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("rejects View field arrays over 50 at the database boundary", async () => {
    await expect(
      configurationFixtures.insert("views", {
        business_id: businessA.id,
        key: "oversized_view",
        name: "Oversized View",
        view_type: "table",
        object_definition_id: cateringObject.id,
        audience: "internal",
        is_active: false,
        config_json: {
          fields: Array.from({ length: 51 }, (_, index) => `field_${index}`),
        },
      }),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("rejects Form field arrays over 50 at the database boundary", async () => {
    await expect(
      configurationFixtures.insert("forms", {
        business_id: businessA.id,
        key: "oversized_form",
        name: "Oversized Form",
        object_definition_id: cateringObject.id,
        mode: "edit",
        audience: "internal",
        is_active: false,
        config_json: {
          fields: Array.from({ length: 51 }, (_, index) => ({
            field: `field_${index}`,
          })),
        },
      }),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("rejects Page layouts over 100 blocks at the database boundary", async () => {
    await expect(
      configurationFixtures.insert("pages", {
        business_id: businessA.id,
        key: "oversized_page",
        title: "Oversized Page",
        slug: "oversized-page",
        audience: "internal",
        status: "draft",
        layout_json: {
          blocks: Array.from({ length: 101 }, () => ({ type: "divider" })),
        },
      }),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("rejects graph changes that would break active Views or Forms", async () => {
    const notesField = cateringFields.find(({ key }) => key === "notes");
    if (!notesField) {
      throw new Error("Notes Field missing");
    }

    await expect(
      configurationFixtures.updateById("field_definitions", notesField.id, {
        is_active: false,
      }),
    ).rejects.toMatchObject({ code: "23514" });

    const { data: retained } = await ownerA.client
      .from("field_definitions")
      .select("is_active")
      .eq("id", notesField.id)
      .single();
    expect(retained?.is_active).toBe(true);

    await expect(
      configurationFixtures.updateById(
        "object_definitions",
        cateringObject.id,
        { is_active: false },
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("creates and edits generic Records through configured Forms", async () => {
    const createData = new FormData();
    createData.set("company_name", "Integration Ltd");
    createData.set("event_date", "2026-11-21");
    createData.set("guest_count", "72");
    createData.set("budget", "3600");
    createData.set("notes", "Dinner");
    createData.set("status", "New");
    createData.set("business_id", businessB.id);
    createData.set("created_by", ownerB.user.id);

    const created = await submitExperienceForm(
      ownerA.client,
      { businessId: businessA.id },
      { formKey: createForm.key, formData: createData },
    );
    expect(created.business_id).toBe(businessA.id);
    expect(created.created_by).toBe(ownerA.user.id);
    expect(created.data_json).toMatchObject({
      company_name: "Integration Ltd",
      guest_count: 72,
      budget: 3600,
    });
    expect(created.data_json).not.toHaveProperty("business_id");
    expect(created.data_json).not.toHaveProperty("created_by");

    const editData = new FormData();
    editData.set("company_name", "Integration Ltd");
    editData.set("event_date", "2026-11-21");
    editData.set("guest_count", "75");
    editData.set("budget", "3750");
    editData.set("notes", "Dinner and drinks");
    editData.set("status", "Contacted");
    const updated = await submitExperienceForm(
      ownerA.client,
      { businessId: businessA.id },
      { formKey: editForm.key, formData: editData, recordId: created.id },
    );

    expect(updated.data_json).toMatchObject({
      guest_count: 75,
      notes: "Dinner and drinks",
      status: "Contacted",
    });
    expect(updated.created_by).toBe(ownerA.user.id);
  });

  it("preserves an object-backed File on unrelated edits and accepts a URL replacement", async () => {
    const existingFile = {
      url: "https://example.test/image.jpg",
      name: "image.jpg",
    };
    const { data: record, error: createError } = await ownerA.client
      .from("records")
      .insert({
        business_id: businessA.id,
        object_definition_id: cateringObject.id,
        data_json: {
          company_name: "File Test Ltd",
          event_date: "2026-12-01",
          guest_count: 40,
          budget: 2000,
          notes: "Original notes",
          attachment: existingFile,
          status: "New",
        },
      })
      .select("*")
      .single();
    expect(createError).toBeNull();
    if (!record) {
      throw new Error("Could not create the File preservation Record");
    }

    const unrelatedEdit = new FormData();
    unrelatedEdit.set("company_name", "File Test Ltd");
    unrelatedEdit.set("event_date", "2026-12-01");
    unrelatedEdit.set("guest_count", "45");
    unrelatedEdit.set("budget", "2000");
    unrelatedEdit.set("notes", "Updated notes");
    unrelatedEdit.set("attachment", "");
    unrelatedEdit.set("status", "Contacted");
    const preserved = await submitExperienceForm(
      ownerA.client,
      { businessId: businessA.id },
      {
        formKey: editForm.key,
        formData: unrelatedEdit,
        recordId: record.id,
      },
    );

    expect(preserved.data_json).toMatchObject({
      attachment: existingFile,
      guest_count: 45,
      notes: "Updated notes",
    });

    const replacementEdit = new FormData();
    replacementEdit.set("company_name", "File Test Ltd");
    replacementEdit.set("event_date", "2026-12-01");
    replacementEdit.set("guest_count", "45");
    replacementEdit.set("budget", "2000");
    replacementEdit.set("notes", "Updated notes");
    replacementEdit.set("attachment", "https://example.test/replacement.jpg");
    replacementEdit.set("status", "Contacted");
    const replaced = await submitExperienceForm(
      ownerA.client,
      { businessId: businessA.id },
      {
        formKey: editForm.key,
        formData: replacementEdit,
        recordId: record.id,
      },
    );

    expect(replaced.data_json).toMatchObject({
      attachment: "https://example.test/replacement.jpg",
      guest_count: 45,
      notes: "Updated notes",
    });
  });

  it("does not let a tenant-scoped service switch Businesses by identifier", async () => {
    const experienceA = createExperienceService(administratorA.client, {
      businessId: businessA.id,
    });
    await expect(
      experienceA.getViewById(businessBView.id),
    ).rejects.toBeInstanceOf(ExperienceServiceError);

    const experienceB = createExperienceService(administratorA.client, {
      businessId: businessB.id,
    });
    expect((await experienceB.getViewById(businessBView.id)).id).toBe(
      businessBView.id,
    );
  });

  it("renders configured Pages internally and keeps drafts/internal Pages private", async () => {
    const internalPage = requireFixture(
      await configurationFixtures.insert("pages", {
        business_id: businessA.id,
        key: "catering_workspace",
        title: "Catering workspace",
        slug: "catering-workspace",
        audience: "internal",
        status: "draft",
        layout_json: {
          blocks: [
            { type: "heading", text: "Catering Enquiries", level: 1 },
            { type: "view", view_key: tableView.key },
            { type: "form", form_key: createForm.key },
          ],
        },
      }),
      "Could not create internal Page fixture.",
    );
    expect(internalPage?.status).toBe("draft");

    const [publicDraft] = await configurationFixtures.insert("pages", {
      business_id: businessA.id,
      key: "public_draft",
      title: "Coming soon",
      slug: "coming-soon",
      audience: "public",
      status: "draft",
      layout_json: {
        blocks: [{ type: "text", text: "Not published yet." }],
      },
    });
    expect(publicDraft?.status).toBe("draft");

    expect(
      await resolvePublicPage(
        anonymous,
        businessA.slug,
        internalPage?.slug ?? "",
      ),
    ).toBeNull();
    expect(
      await resolvePublicPage(
        anonymous,
        businessA.slug,
        publicDraft?.slug ?? "",
      ),
    ).toBeNull();
  });

  it("publicly resolves only public and published static Pages", async () => {
    const [published] = await configurationFixtures.insert("pages", {
      business_id: businessA.id,
      key: "public_information",
      title: "Catering information",
      slug: "catering-information",
      audience: "public",
      status: "published",
      layout_json: {
        blocks: [
          { type: "heading", text: "Catering from Bedford Bakery", level: 1 },
          { type: "text", text: "Talk to our team about your next event." },
          {
            type: "button",
            label: "Email us",
            href: "mailto:catering@example.test",
          },
        ],
      },
    });

    const resolved = await resolvePublicPage(
      anonymous,
      businessA.slug,
      published?.slug ?? "",
    );
    expect(resolved?.business.name).toBe(businessA.name);
    expect(resolved?.page.layout.blocks).toHaveLength(3);

    await expect(
      configurationFixtures.insert("pages", {
        business_id: businessA.id,
        key: "unsafe_public_write",
        title: "Unsafe",
        slug: "unsafe",
        audience: "public",
        status: "published",
        layout_json: {
          blocks: [{ type: "form", form_key: createForm.key }],
        },
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("archives Pages without exposing them in navigation or public resolution", async () => {
    const experience = createExperienceService(ownerA.client, {
      businessId: businessA.id,
    });
    const internalPage = requireFixture(
      await configurationFixtures.insert("pages", {
        business_id: businessA.id,
        key: `archived_internal_${crypto.randomUUID().replaceAll("-", "")}`,
        title: "Archived internal Page",
        slug: `archived-internal-${crypto.randomUUID()}`,
        audience: "internal",
        layout_json: { blocks: [{ type: "text", text: "Internal content" }] },
        status: "draft",
        is_active: false,
      }),
      "Could not create archived internal Page fixture.",
    );
    const publicPage = requireFixture(
      await configurationFixtures.insert("pages", {
        business_id: businessA.id,
        key: `archived_public_${crypto.randomUUID().replaceAll("-", "")}`,
        title: "Archived public Page",
        slug: `archived-public-${crypto.randomUUID()}`,
        audience: "public",
        layout_json: { blocks: [{ type: "text", text: "Public content" }] },
        status: "published",
        is_active: false,
      }),
      "Could not create public Page fixture.",
    );

    const navigation = await experience.listNavigation();
    expect(navigation.pages.some(({ id }) => id === internalPage.id)).toBe(
      false,
    );
    await expect(experience.loadPage(internalPage.slug)).rejects.toBeInstanceOf(
      ExperienceServiceError,
    );
    expect(
      await resolvePublicPage(anonymous, businessA.slug, publicPage.slug),
    ).toBeNull();

    const dormantPage = requireFixture(
      await configurationFixtures.insert("pages", {
        business_id: businessA.id,
        key: `dormant_reference_${crypto.randomUUID().replaceAll("-", "")}`,
        title: "Dormant invalid reference",
        slug: `dormant-reference-${crypto.randomUUID()}`,
        audience: "internal",
        layout_json: {
          blocks: [{ type: "view", view_key: "missing_view" }],
        },
        status: "draft",
        is_active: false,
      }),
      "Could not create dormant Page fixture.",
    );
    await expect(
      configurationFixtures.updateById("pages", dormantPage.id, {
        is_active: true,
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("does not give anonymous callers broad configuration or Record access", async () => {
    const records = await anonymous.from("records").select("*");
    expect(records.error?.code).toBe("42501");

    const views = await anonymous.from("views").select("*");
    expect(views.error?.code).toBe("42501");

    const forms = await anonymous.from("forms").select("*");
    expect(forms.error?.code).toBe("42501");
  });

  it("proves Order Occasion is added, rendered, and submitted by configuration only", async () => {
    const orderObject = await createObject(
      ownerA.client,
      businessA.id,
      "experience_order",
      "Order",
    );
    await createFields(ownerA.client, businessA.id, orderObject.id, [
      {
        key: "order_number",
        label: "Order number",
        fieldType: "short_text",
        required: true,
      },
    ]);
    const orderForm = requireFixture(
      await configurationFixtures.insert("forms", {
        business_id: businessA.id,
        key: "experience_order_create",
        name: "New order",
        object_definition_id: orderObject.id,
        mode: "create",
        config_json: { fields: [{ field: "order_number" }] },
        audience: "internal",
      }),
      "Could not create Order Form fixture.",
    );
    const before = new FormData();
    before.set("order_number", "ORD-001");
    const firstOrder = await submitExperienceForm(
      ownerA.client,
      { businessId: businessA.id },
      { formKey: orderForm.key, formData: before },
    );
    expect(firstOrder.data_json).toEqual({ order_number: "ORD-001" });

    await createFields(ownerA.client, businessA.id, orderObject.id, [
      {
        key: "occasion",
        label: "Occasion",
        fieldType: "short_text",
      },
    ]);
    await configurationFixtures.updateById("forms", orderForm.id, {
      config_json: {
        fields: [
          { field: "order_number" },
          {
            field: "occasion",
            label: "What is the occasion?",
            help_text: "Optional",
          },
        ],
      },
    });

    const experience = createExperienceService(ownerA.client, {
      businessId: businessA.id,
    });
    const configured = await experience.loadForm(orderForm.key);
    const html = renderToStaticMarkup(
      createElement(FormRenderer, {
        bundle: configured,
        action: "/submit",
      }),
    );
    expect(html).toContain("What is the occasion?");

    const after = new FormData();
    after.set("order_number", "ORD-002");
    after.set("occasion", "Anniversary");
    const secondOrder = await submitExperienceForm(
      ownerA.client,
      { businessId: businessA.id },
      { formKey: orderForm.key, formData: after },
    );
    expect(secondOrder.data_json).toEqual({
      occasion: "Anniversary",
      order_number: "ORD-002",
    });
  });

  it("keeps the Catering demo out of domain-specific runtime source", () => {
    const sourceFiles = readdirSync(join(process.cwd(), "src"), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.toLowerCase());

    expect(
      sourceFiles.some(
        (name) =>
          name.includes("catering-enquiry") ||
          name.includes("catering_enquiry") ||
          name.includes("cateringenquiry"),
      ),
    ).toBe(false);
  });
});
