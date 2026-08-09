import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const actionHarness = vi.hoisted(() => ({
  clients: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/supabase/server", () => ({
  createServerClient: async () => {
    const client = actionHarness.clients.shift();
    if (!client) {
      throw new Error("No authenticated manual-list client was queued.");
    }
    return client;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    const error = new Error("not-found");
    error.name = "ActionNotFound";
    throw error;
  },
  redirect: (path: string) => {
    const error = new Error(path);
    error.name = "ActionRedirect";
    throw error;
  },
}));

import { prepareManualListProposalAction } from "../../src/app/app/[businessSlug]/setup/actions";
import { loadRenderedConfigurationPreview } from "../../src/core/configuration/rendered-preview";
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import { configurationOperationsSchema } from "../../src/core/configuration/schemas";
import type { ManualListIntent } from "../../src/core/configuration/manual-lists/schemas";
import { createExperienceService } from "../../src/core/experience/service";
import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import { submitExperienceForm } from "../../src/runtime/forms/submission";
import { applyInlineRecordCellEdit } from "../../src/runtime/views/inline-edit-service";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };
type Business = Tables<"businesses">;

const password = "Milestone-14-phase-14b-manual-list!";
const createdUserIds: string[] = [];

let settings: LocalSupabaseSettings;
let admin: Client;
let sql: Sql;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let otherOwner: Identity;
let anonymous: Client;
let business: Business;
let otherBusiness: Business;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `phase14b-${label}-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
  createdUserIds.push(created.data.user.id);

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
    throw signedIn.error ?? new Error(`Could not sign in ${label}.`);
  }
  return { client, user: signedIn.data.user };
}

async function createBusiness(identity: Identity): Promise<Business> {
  return requireData(
    await identity.client.rpc("create_business", {
      business_name: `Phase 14B Lists ${crypto.randomUUID()}`,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    }),
    "Could not create the Phase 14B Business.",
  );
}

function listIntent() {
  return {
    singularItemLabel: "Test Item",
    pluralListLabel: "Test Items",
    mainNameLabel: "Name",
    information: [
      { label: "Quantity", type: "number" as const, required: true },
      {
        label: "Status",
        type: "status" as const,
        required: true,
        options: ["Active", "Inactive"],
      },
    ],
  };
}

function listForm(
  currentness: { expectedBaseVersionId: string; expectedHeadRevision: number },
  intent: ManualListIntent,
): FormData {
  const form = new FormData();
  form.set("expectedBaseVersionId", currentness.expectedBaseVersionId);
  form.set("expectedHeadRevision", String(currentness.expectedHeadRevision));
  form.set("singularItemLabel", intent.singularItemLabel);
  form.set("pluralListLabel", intent.pluralListLabel);
  form.set("mainNameLabel", intent.mainNameLabel);
  form.set("information", JSON.stringify(intent.information));
  return form;
}

async function actionRedirect(
  identity: Identity,
  form: FormData,
): Promise<string> {
  return actionRedirectForSlug(identity, business.slug, form);
}

async function actionRedirectForSlug(
  identity: Identity,
  businessSlug: string,
  form: FormData,
): Promise<string> {
  actionHarness.clients.push(identity.client);
  try {
    await prepareManualListProposalAction(businessSlug, form);
  } catch (error) {
    if (error instanceof Error && error.name === "ActionRedirect") {
      return error.message;
    }
    throw error;
  }
  throw new Error("Expected manual list preparation to redirect.");
}

function operation<T extends { op: string }>(
  operations: ReadonlyArray<T>,
  kind: T["op"],
): T {
  const found = operations.find((candidate) => candidate.op === kind);
  if (!found) {
    throw new Error(`Missing ${kind} operation.`);
  }
  return found;
}

function recordValues(record: Tables<"records">): Record<string, Json> {
  if (
    typeof record.data_json === "object" &&
    record.data_json !== null &&
    !Array.isArray(record.data_json)
  ) {
    return record.data_json as Record<string, Json>;
  }
  throw new Error("Expected a Record object payload.");
}

describe("Milestone 14 Phase 14B manual internal list acceptance", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    sql = postgres(settings.databaseUrl, { max: 1 });
    [owner, administrator, staff, otherOwner] = await Promise.all([
      createIdentity("owner"),
      createIdentity("admin"),
      createIdentity("staff"),
      createIdentity("other-owner"),
    ]);
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
    business = await createBusiness(owner);
    otherBusiness = await createBusiness(otherOwner);
    const membership = await admin.from("business_memberships").insert([
      {
        business_id: business.id,
        user_id: administrator.user.id,
        role: "admin",
      },
      {
        business_id: business.id,
        user_id: staff.user.id,
        role: "staff",
      },
    ]);
    if (membership.error) {
      throw membership.error;
    }
  }, 180_000);

  afterAll(async () => {
    if (admin && otherBusiness) {
      await admin.from("businesses").delete().eq("id", otherBusiness.id);
    }
    if (admin && business) {
      await admin.from("businesses").delete().eq("id", business.id);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
    if (sql) {
      await sql.end();
    }
  });

  it("allows Owner and Admin proposal preparation through the same M5 boundary", async () => {
    const configuration = new ConfigurationChangeService(administrator.client, {
      businessId: business.id,
      actorId: administrator.user.id,
    });
    const currentness = await configuration.getProposalCurrentness();
    const redirectPath = await actionRedirect(
      administrator,
      listForm(currentness, {
        singularItemLabel: "Admin note",
        pluralListLabel: "Admin notes",
        mainNameLabel: "Subject",
        information: [],
      }),
    );
    const proposal = await configuration.getChangeSet(
      redirectPath.split("/").at(-1)!,
    );

    expect(proposal.requested_by).toBe(administrator.user.id);
    expect(proposal.status).toBe("proposed");
    expect(proposal.validation_result_json).toBeNull();
    expect(proposal.applied_version_id).toBeNull();
    expect((await configuration.abandonChangeSet(proposal.id)).status).toBe(
      "abandoned",
    );
  });

  it("denies Staff and anonymous callers before any proposal is prepared", async () => {
    const currentness = {
      expectedBaseVersionId: "00000000-0000-4000-8000-000000000001",
      expectedHeadRevision: 1,
    };
    const form = listForm(currentness, listIntent());
    actionHarness.clients.push(staff.client);
    await expect(
      prepareManualListProposalAction(business.slug, form),
    ).rejects.toMatchObject({ name: "ActionNotFound" });

    actionHarness.clients.push(anonymous);
    await expect(
      prepareManualListProposalAction(business.slug, form),
    ).rejects.toThrow();
  });

  it("denies a non-member on a wrong Business route without creating a proposal", async () => {
    const sourceConfiguration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const targetConfiguration = new ConfigurationChangeService(
      otherOwner.client,
      {
        businessId: otherBusiness.id,
        actorId: otherOwner.user.id,
      },
    );
    const targetCurrentness =
      await targetConfiguration.getProposalCurrentness();
    const [sourceBefore, targetBefore] = await Promise.all([
      sourceConfiguration.listChangeSets(),
      targetConfiguration.listChangeSets(),
    ]);

    actionHarness.clients.push(owner.client);
    await expect(
      prepareManualListProposalAction(
        otherBusiness.slug,
        listForm(targetCurrentness, listIntent()),
      ),
    ).rejects.toMatchObject({ name: "ActionNotFound" });

    const [sourceAfter, targetAfter] = await Promise.all([
      sourceConfiguration.listChangeSets(),
      targetConfiguration.listChangeSets(),
    ]);
    expect(sourceAfter.map((proposal) => proposal.id)).toEqual(
      sourceBefore.map((proposal) => proposal.id),
    );
    expect(targetAfter.map((proposal) => proposal.id)).toEqual(
      targetBefore.map((proposal) => proposal.id),
    );
  });

  it("previews, applies, and runs the resulting generic list without configuration writes", async () => {
    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const currentness = await configuration.getProposalCurrentness();
    const ownerForm = listForm(currentness, listIntent());
    ownerForm.set("business_id", crypto.randomUUID());
    ownerForm.set("actor_id", administrator.user.id);
    ownerForm.set("operations_json", '[{"op":"set_object"}]');
    ownerForm.set("candidate_checksum", "forged");
    ownerForm.set("status", "applied");
    const proposalsBefore = await configuration.listChangeSets();
    const versionsBefore = await configuration.listVersions();
    const [aiRunsBefore] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.ai_execution_runs
      where business_id = ${business.id}::uuid
    `;
    const proposalPath = await actionRedirect(owner, ownerForm);
    const proposal = await configuration.getChangeSet(
      proposalPath.split("/").at(-1)!,
    );
    expect(proposal.business_id).toBe(business.id);
    expect(proposal.requested_by).toBe(owner.user.id);
    expect(JSON.stringify(proposal.operations_json)).not.toContain("forged");

    const operations = configurationOperationsSchema.parse(
      proposal.operations_json,
    );
    const fields = operations.filter(
      (candidate) => candidate.op === "set_field",
    );
    const createForm = operation(operations, "set_form") as Extract<
      (typeof operations)[number],
      { op: "set_form" }
    >;
    const editForm = operations
      .filter((candidate) => candidate.op === "set_form")
      .find(
        (
          candidate,
        ): candidate is Extract<
          (typeof operations)[number],
          { op: "set_form" }
        > => candidate.mode === "edit",
      );
    const view = operation(operations, "set_view") as Extract<
      (typeof operations)[number],
      { op: "set_view" }
    >;
    const page = operation(operations, "set_page") as Extract<
      (typeof operations)[number],
      { op: "set_page" }
    >;
    if (createForm.mode !== "create" || !editForm) {
      throw new Error("The proposal did not include create and edit Forms.");
    }

    expect(operations).toHaveLength(fields.length + 5);
    expect(proposal.candidate_snapshot_json).toBeTruthy();
    expect(
      (await configuration.listChangeSets()).filter(
        (candidate) => candidate.id === proposal.id,
      ),
    ).toHaveLength(1);
    expect((await configuration.listChangeSets()).length).toBe(
      proposalsBefore.length + 1,
    );

    const preview = await loadRenderedConfigurationPreview(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
      changeSetId: proposal.id,
      pageKey: page.key,
    });
    expect(preview.page.definition.key).toBe(page.key);
    expect(preview.page.layout.blocks).toEqual([
      { type: "heading", text: "Test Items", level: 1 },
      { type: "view", view_key: view.key },
    ]);
    expect(preview.views[view.key]?.definition.key).toBe(view.key);
    expect(preview.views[view.key]?.records).toEqual([]);
    expect(preview.views[view.key]?.config).toMatchObject({
      create_form_key: createForm.key,
      edit_form_key: editForm.key,
    });
    expect(preview.forms).toEqual({});

    expect((await configuration.validateChangeSet(proposal.id)).status).toBe(
      "validated",
    );
    const applied = await configuration.applyChangeSet(proposal.id);
    expect(applied.status).toBe("applied");
    expect((await configuration.listVersions()).length).toBe(
      versionsBefore.length + 1,
    );

    const experience = createExperienceService(owner.client, {
      businessId: business.id,
    });
    const navigation = await experience.listNavigation();
    expect(
      navigation.views.filter((candidate) => candidate.key === view.key),
    ).toHaveLength(1);
    expect(
      navigation.pages.some((candidate) => candidate.key === page.key),
    ).toBe(false);
    const livePage = await experience.loadPage(page.slug, "internal");
    expect(livePage.definition.key).toBe(page.key);
    const liveView = await experience.loadView(view.key, "internal");

    const createData = new FormData();
    createData.set("name", "Whole Milk");
    createData.set("quantity", "2");
    createData.set("status", "Active");
    createData.set("business_id", crypto.randomUUID());
    const created = await submitExperienceForm(
      owner.client,
      { businessId: business.id },
      { formKey: createForm.key, formData: createData },
    );
    expect(created.object_definition_id).toBe(liveView.object.id);
    expect(created.business_id).toBe(business.id);
    expect(created.data_json).toEqual({
      name: "Whole Milk",
      quantity: 2,
      status: "Active",
    });
    expect(created.data_json).not.toHaveProperty("business_id");

    const editData = new FormData();
    editData.set("name", "Whole Milk");
    editData.set("quantity", "2");
    editData.set("status", "Active");
    const edited = await submitExperienceForm(
      owner.client,
      { businessId: business.id },
      { formKey: editForm.key, formData: editData, recordId: created.id },
    );
    expect(edited.data_json).toEqual({
      name: "Whole Milk",
      quantity: 2,
      status: "Active",
    });

    const headBeforeOperationalWrites = await configuration.getActiveHead();
    const inlineData = new FormData();
    inlineData.set("name", "Semi-skimmed Milk");
    const inlineEdited = await applyInlineRecordCellEdit(
      owner.client,
      { businessId: business.id },
      {
        viewKey: view.key,
        recordId: created.id,
        fieldKey: fields[0]!.key,
        formData: inlineData,
      },
    );
    expect(inlineEdited.data_json).toMatchObject({
      name: "Semi-skimmed Milk",
      quantity: 2,
      status: "Active",
    });
    const inlineQuantity = new FormData();
    inlineQuantity.set("quantity", "3");
    const quantityEdited = await applyInlineRecordCellEdit(
      owner.client,
      { businessId: business.id },
      {
        viewKey: view.key,
        recordId: created.id,
        fieldKey: fields[1]!.key,
        formData: inlineQuantity,
      },
    );
    expect(recordValues(quantityEdited).quantity).toBe(3);
    const inlineStatus = new FormData();
    inlineStatus.set("status", "Inactive");
    const statusEdited = await applyInlineRecordCellEdit(
      owner.client,
      { businessId: business.id },
      {
        viewKey: view.key,
        recordId: created.id,
        fieldKey: fields[2]!.key,
        formData: inlineStatus,
      },
    );
    expect(recordValues(statusEdited).status).toBe("Inactive");

    const refreshed = await experience.loadView(view.key, "internal");
    expect(
      refreshed.records.find((record) => record.id === created.id)?.data_json,
    ).toEqual({
      name: "Semi-skimmed Milk",
      quantity: 3,
      status: "Inactive",
    });
    const finalEditData = new FormData();
    finalEditData.set("name", "Semi-skimmed Milk");
    finalEditData.set("quantity", "3");
    finalEditData.set("status", "Inactive");
    const fullyEdited = await submitExperienceForm(
      owner.client,
      { businessId: business.id },
      {
        formKey: editForm.key,
        formData: finalEditData,
        recordId: created.id,
      },
    );
    expect(fullyEdited.data_json).toEqual({
      name: "Semi-skimmed Milk",
      quantity: 3,
      status: "Inactive",
    });
    expect(await configuration.getActiveHead()).toEqual(
      headBeforeOperationalWrites,
    );
    expect((await configuration.listVersions()).length).toBe(
      versionsBefore.length + 1,
    );
    expect((await configuration.listChangeSets()).length).toBe(
      proposalsBefore.length + 1,
    );

    const stalePath = await actionRedirect(
      owner,
      listForm(currentness, {
        singularItemLabel: "Stale item",
        pluralListLabel: "Stale items",
        mainNameLabel: "Name",
        information: [],
      }),
    );
    expect(stalePath).toContain("notice=stale");
    expect((await configuration.listChangeSets()).length).toBe(
      proposalsBefore.length + 1,
    );

    const secondCurrentness = await configuration.getProposalCurrentness();
    const secondPath = await actionRedirect(
      owner,
      listForm(secondCurrentness, {
        singularItemLabel: "Customer",
        pluralListLabel: "Customers",
        mainNameLabel: "Customer name",
        information: [
          { label: "Phone", type: "phone", required: false },
          { label: "Active", type: "yes_no", required: false },
        ],
      }),
    );
    const secondProposal = await configuration.getChangeSet(
      secondPath.split("/").at(-1)!,
    );
    const secondOperations = configurationOperationsSchema.parse(
      secondProposal.operations_json,
    );
    const secondFields = secondOperations.filter(
      (candidate) => candidate.op === "set_field",
    );
    const secondCreateForm = secondOperations.find(
      (
        candidate,
      ): candidate is Extract<
        (typeof secondOperations)[number],
        { op: "set_form" }
      > => candidate.op === "set_form" && candidate.mode === "create",
    );
    const secondView = operation(secondOperations, "set_view") as Extract<
      (typeof secondOperations)[number],
      { op: "set_view" }
    >;
    if (!secondCreateForm) {
      throw new Error("The Customers proposal did not include a create Form.");
    }
    const phoneField = secondFields.find((field) => field.label === "Phone");
    const activeField = secondFields.find((field) => field.label === "Active");
    if (!phoneField || !activeField) {
      throw new Error(
        "The Customers proposal did not include Phone and Active.",
      );
    }
    expect(phoneField.field_type).toBe("phone");
    expect(activeField.field_type).toBe("boolean");
    expect(secondFields[0]?.label).toBe("Customer name");
    expect(
      (await configuration.validateChangeSet(secondProposal.id)).status,
    ).toBe("validated");
    expect((await configuration.applyChangeSet(secondProposal.id)).status).toBe(
      "applied",
    );

    const experienceAfterSecond = createExperienceService(owner.client, {
      businessId: business.id,
    });
    const navigationAfterSecond = await experienceAfterSecond.listNavigation();
    expect(
      navigationAfterSecond.views.filter(
        (candidate) => candidate.key === view.key,
      ),
    ).toHaveLength(1);
    expect(
      navigationAfterSecond.views.filter(
        (candidate) => candidate.key === secondView.key,
      ),
    ).toHaveLength(1);
    expect(navigationAfterSecond.pages).toHaveLength(0);

    const customerData = new FormData();
    customerData.set(secondFields[0]!.key, "Alex Smith");
    customerData.set(phoneField.key, "+44 7700 900123");
    customerData.set(activeField.key, "on");
    const customer = await submitExperienceForm(
      owner.client,
      { businessId: business.id },
      { formKey: secondCreateForm.key, formData: customerData },
    );
    expect(customer.data_json).toEqual({
      [secondFields[0]!.key]: "Alex Smith",
      [phoneField.key]: "+44 7700 900123",
      [activeField.key]: true,
    });
    await expect(
      applyInlineRecordCellEdit(
        owner.client,
        { businessId: business.id },
        {
          viewKey: secondView.key,
          recordId: customer.id,
          fieldKey: phoneField.key,
          formData: customerData,
        },
      ),
    ).rejects.toThrow("full edit form");

    const customerActiveEdit = new FormData();
    const customerAfterInline = await applyInlineRecordCellEdit(
      owner.client,
      { businessId: business.id },
      {
        viewKey: secondView.key,
        recordId: customer.id,
        fieldKey: activeField.key,
        formData: customerActiveEdit,
      },
    );
    expect(recordValues(customerAfterInline)[activeField.key]).toBe(false);
    const customerEdit = new FormData();
    customerEdit.set(secondFields[0]!.key, "Alex Smith");
    customerEdit.set(phoneField.key, "+44 7700 900124");
    customerEdit.set(activeField.key, "on");
    const customerFullyEdited = await submitExperienceForm(
      owner.client,
      { businessId: business.id },
      {
        formKey: secondOperations.find(
          (
            candidate,
          ): candidate is Extract<
            (typeof secondOperations)[number],
            { op: "set_form" }
          > => candidate.op === "set_form" && candidate.mode === "edit",
        )!.key,
        formData: customerEdit,
        recordId: customer.id,
      },
    );
    expect(recordValues(customerFullyEdited)[phoneField.key]).toBe(
      "+44 7700 900124",
    );

    const headAfterSecondApply = await configuration.getActiveHead();
    expect(headAfterSecondApply.head_revision).toBe(
      headBeforeOperationalWrites.head_revision + 1,
    );
    expect((await configuration.listVersions()).length).toBe(
      versionsBefore.length + 2,
    );
    expect((await configuration.listChangeSets()).length).toBe(
      proposalsBefore.length + 2,
    );
    const [aiRunsAfter] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.ai_execution_runs
      where business_id = ${business.id}::uuid
    `;
    expect(aiRunsAfter?.count).toBe(aiRunsBefore?.count);

    const [recordCount] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from public.records
      where business_id = ${business.id}::uuid
    `;
    expect(recordCount?.count).toBe(2);
  }, 60_000);
});
