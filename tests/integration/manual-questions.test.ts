import { execFileSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";

const routeHarness = vi.hoisted(() => ({
  clients: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/supabase/server", () => ({
  createServerClient: async () => {
    const client = routeHarness.clients.shift();
    if (!client) {
      throw new Error("No authenticated manual-question client was queued.");
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

import { processPreorderSubmission } from "../../src/app/api/preorder/[businessSlug]/[pageSlug]/route";
import {
  prepareExistingPreorderQuestionAmendmentAction,
  prepareNewPreorderQuestionAmendmentAction,
} from "../../src/app/app/[businessSlug]/setup/actions";
import EditPreorderQuestionPage from "../../src/app/app/[businessSlug]/setup/preorder/[preorderKey]/questions/[target]/[fieldKey]/page";
import NewPreorderQuestionPage from "../../src/app/app/[businessSlug]/setup/preorder/[preorderKey]/questions/new/page";
import PreorderQuestionsPage from "../../src/app/app/[businessSlug]/setup/preorder/[preorderKey]/questions/page";
import {
  composePreorderQuestionAmendment,
  loadActiveManualAmendmentSnapshot,
} from "../../src/core/configuration/manual-amendments/service";
import { setFieldOperationSchema } from "../../src/core/configuration/schemas";
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import {
  resolveConfigurationPreviewPreorder,
  resolvePublicPreorder,
} from "../../src/core/preorder/service";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };
type RedirectResult = { message: string; name: string };

const businessSlug = "bedford-bakery-demo";
const preorderKey = "bakery_preorder";
const pageSlug = "preorder";
const ownerEmail = "demo@smbos.local";
const staffEmail = "staff@smbos.local";
const demoPassword = "Local-demo-2026!";

let settings: LocalSupabaseSettings;
let sql: Sql;
let serviceRole: Client;
let anonymous: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let crossBusinessOwner: Identity;
let business: Tables<"businesses">;
let configuration: ConfigurationChangeService;
const createdUserIds: string[] = [];
let otherBusinessId: string | null = null;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

async function signIn(email: string): Promise<Identity> {
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
    password: demoPassword,
  });
  if (signedIn.error || !signedIn.data.user) {
    throw signedIn.error ?? new Error(`Could not sign in ${email}.`);
  }
  return { client, user: signedIn.data.user };
}

async function createUser(
  prefix: string,
  role: "owner" | "admin",
  businessId: string,
): Promise<Identity> {
  const email = `${prefix}-${crypto.randomUUID()}@example.test`;
  const created = await serviceRole.auth.admin.createUser({
    email,
    password: demoPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${role}.`);
  }
  createdUserIds.push(created.data.user.id);
  requireData(
    await serviceRole
      .from("business_memberships")
      .insert({
        business_id: businessId,
        user_id: created.data.user.id,
        role,
      })
      .select("*")
      .single(),
    `Could not create ${role} membership.`,
  );
  return signIn(email);
}

function existingQuestionForm(
  baseVersionId: string,
  headRevision: number,
  input: {
    label: string;
    helpText?: string;
    required: boolean;
  },
): FormData {
  const form = new FormData();
  form.set("expectedBaseVersionId", baseVersionId);
  form.set("expectedHeadRevision", String(headRevision));
  form.set("label", input.label);
  form.set("helpText", input.helpText ?? "");
  if (input.required) {
    form.set("required", "on");
  }
  return form;
}

function newQuestionForm(
  baseVersionId: string,
  headRevision: number,
  input: {
    label: string;
    helpText?: string;
    required: boolean;
    answerStyle: "short_answer" | "long_answer";
  },
): FormData {
  const form = existingQuestionForm(baseVersionId, headRevision, input);
  form.set("answerStyle", input.answerStyle);
  return form;
}

async function invokeWithClient(
  identity: Identity | { client: Client },
  operation: () => Promise<unknown>,
): Promise<RedirectResult> {
  routeHarness.clients.push(identity.client);
  try {
    await operation();
  } catch (error) {
    if (
      error instanceof Error &&
      ["ActionNotFound", "ActionRedirect"].includes(error.name)
    ) {
      return { message: error.message, name: error.name };
    }
    throw error;
  }
  throw new Error("Expected the route or action to redirect or deny access.");
}

async function renderWithClient(
  identity: Identity,
  operation: () => Promise<unknown>,
): Promise<unknown> {
  routeHarness.clients.push(identity.client);
  return operation();
}

async function countRows(
  table: "configuration_change_sets" | "ai_execution_runs",
): Promise<number> {
  const rows =
    table === "configuration_change_sets"
      ? await sql<{ count: number }[]>`
          select count(*)::integer as count
          from public.configuration_change_sets
          where business_id = ${business.id}::uuid
        `
      : await sql<{ count: number }[]>`
          select count(*)::integer as count
          from public.ai_execution_runs
          where business_id = ${business.id}::uuid
        `;
  if (!rows[0]) {
    throw new Error(`Could not count ${table}.`);
  }
  return rows[0].count;
}

async function captureProtectedState() {
  const rows = await sql<
    {
      ai_execution_runs: Json;
      head: Json;
      projection: Json;
      records: Json;
      relationships: Json;
      versions: Json;
    }[]
  >`
    select
      (
        select to_jsonb(head_value)
        from public.business_configuration_heads as head_value
        where head_value.business_id = ${business.id}::uuid
      ) as head,
      (
        select coalesce(
          jsonb_agg(
            to_jsonb(version_value)
            order by version_value.version_number, version_value.id
          ),
          '[]'::jsonb
        )
        from public.configuration_versions as version_value
        where version_value.business_id = ${business.id}::uuid
      ) as versions,
      private.configuration_snapshot_v1(${business.id}::uuid) as projection,
      (
        select coalesce(
          jsonb_agg(to_jsonb(record_value) order by record_value.id),
          '[]'::jsonb
        )
        from public.records as record_value
        where record_value.business_id = ${business.id}::uuid
      ) as records,
      (
        select coalesce(
          jsonb_agg(to_jsonb(edge_value) order by edge_value.id),
          '[]'::jsonb
        )
        from public.record_relationships as edge_value
        where edge_value.business_id = ${business.id}::uuid
      ) as relationships,
      (
        select coalesce(
          jsonb_agg(to_jsonb(run_value) order by run_value.id),
          '[]'::jsonb
        )
        from public.ai_execution_runs as run_value
        where run_value.business_id = ${business.id}::uuid
      ) as ai_execution_runs
  `;
  if (!rows[0]) {
    throw new Error("Could not capture protected manual-question state.");
  }
  return rows[0];
}

function proposalIdFromRedirect(path: string): string {
  const proposalId = path.split("/").at(-1);
  if (!proposalId || !/^[0-9a-f-]{36}$/.test(proposalId)) {
    throw new Error(`Unexpected proposal redirect: ${path}`);
  }
  return proposalId;
}

function preorderFrom(
  active: Awaited<ReturnType<typeof loadActiveManualAmendmentSnapshot>>,
) {
  const preorder = active.snapshot.preorder_experiences.find(
    (candidate) => candidate.key === preorderKey,
  );
  if (!preorder) {
    throw new Error("Bedford preorder is missing.");
  }
  return preorder;
}

async function existingRowsByIds(
  table: "records" | "record_relationships",
  ids: string[],
): Promise<Json> {
  if (ids.length === 0) {
    return [];
  }
  return requireData(
    await serviceRole
      .from(table)
      .select("*")
      .eq("business_id", business.id)
      .in("id", ids)
      .order("id"),
    `Could not reload existing ${table}.`,
  ) as unknown as Json;
}

describe("Milestone 6 Phase 2A.2 manual preorder questions", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });
    sql = postgres(settings.databaseUrl, { max: 1 });
    serviceRole = createClient<Database>(
      settings.apiUrl,
      settings.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
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
      signIn(ownerEmail),
      signIn(staffEmail),
    ]);
    business = requireData(
      await serviceRole
        .from("businesses")
        .select("*")
        .eq("slug", businessSlug)
        .single(),
      "Could not load Bedford Bakery.",
    );
    administrator = await createUser("m6-question-admin", "admin", business.id);
    const otherBusiness = requireData(
      await serviceRole
        .from("businesses")
        .insert({
          name: "Other manual question business",
          slug: `other-manual-questions-${crypto.randomUUID()}`,
          business_type: "test",
          timezone: "Europe/London",
          settings_json: {},
        })
        .select("*")
        .single(),
      "Could not create the cross-Business fixture.",
    );
    otherBusinessId = otherBusiness.id;
    crossBusinessOwner = await createUser(
      "m6-question-cross",
      "owner",
      otherBusiness.id,
    );
    configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
  }, 180_000);

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await serviceRole.auth.admin.deleteUser(userId);
    }
    if (otherBusinessId) {
      await serviceRole.from("businesses").delete().eq("id", otherBusinessId);
    }
    if (sql) {
      await sql.end();
    }
  });

  it("allows Owner/Admin routes and denies Staff, anonymous and cross-Business access", async () => {
    await expect(
      renderWithClient(owner, () =>
        PreorderQuestionsPage({
          params: Promise.resolve({ businessSlug, preorderKey }),
        }),
      ),
    ).resolves.toBeTruthy();
    await expect(
      renderWithClient(administrator, () =>
        NewPreorderQuestionPage({
          params: Promise.resolve({ businessSlug, preorderKey }),
          searchParams: Promise.resolve({}),
        }),
      ),
    ).resolves.toBeTruthy();
    await expect(
      renderWithClient(owner, () =>
        EditPreorderQuestionPage({
          params: Promise.resolve({
            businessSlug,
            preorderKey,
            target: "customer",
            fieldKey: "phone",
          }),
          searchParams: Promise.resolve({}),
        }),
      ),
    ).resolves.toBeTruthy();

    expect(
      await invokeWithClient(staff, () =>
        PreorderQuestionsPage({
          params: Promise.resolve({ businessSlug, preorderKey }),
        }),
      ),
    ).toMatchObject({ name: "ActionNotFound" });
    expect(
      await invokeWithClient({ client: anonymous }, () =>
        PreorderQuestionsPage({
          params: Promise.resolve({ businessSlug, preorderKey }),
        }),
      ),
    ).toEqual({ name: "ActionRedirect", message: "/sign-in" });
    expect(
      await invokeWithClient(crossBusinessOwner, () =>
        PreorderQuestionsPage({
          params: Promise.resolve({ businessSlug, preorderKey }),
        }),
      ),
    ).toMatchObject({ name: "ActionNotFound" });
  });

  it("rejects no-op, duplicate, invalid, stale and unauthorized submissions without writes", async () => {
    const active = await loadActiveManualAmendmentSnapshot(configuration);
    expect(active.headRevision).toBe(2);
    const protectedBefore = await captureProtectedState();
    const proposalsBefore = await countRows("configuration_change_sets");

    const noOp = await invokeWithClient(owner, () =>
      prepareExistingPreorderQuestionAmendmentAction(
        businessSlug,
        preorderKey,
        "customer",
        "phone",
        existingQuestionForm(active.baseVersionId, active.headRevision, {
          label: "Phone",
          helpText: "Optional",
          required: false,
        }),
      ),
    );
    expect(noOp.message).toContain("notice=nothing_changed");

    const duplicate = await invokeWithClient(owner, () =>
      prepareNewPreorderQuestionAmendmentAction(
        businessSlug,
        preorderKey,
        newQuestionForm(active.baseVersionId, active.headRevision, {
          label: "  dietary REQUIREMENTS ",
          required: false,
          answerStyle: "long_answer",
        }),
      ),
    );
    expect(duplicate.message).toContain("notice=duplicate_question");

    const invalid = await invokeWithClient(owner, () =>
      prepareNewPreorderQuestionAmendmentAction(
        businessSlug,
        preorderKey,
        newQuestionForm(active.baseVersionId, active.headRevision, {
          label: "",
          required: false,
          answerStyle: "short_answer",
        }),
      ),
    );
    expect(invalid.message).toContain("notice=input_invalid");

    const staleVersion = await invokeWithClient(owner, () =>
      prepareNewPreorderQuestionAmendmentAction(
        businessSlug,
        preorderKey,
        newQuestionForm(crypto.randomUUID(), active.headRevision, {
          label: "Stale version question",
          required: false,
          answerStyle: "short_answer",
        }),
      ),
    );
    expect(staleVersion.message).toContain("notice=stale");

    const staleRevision = await invokeWithClient(owner, () =>
      prepareNewPreorderQuestionAmendmentAction(
        businessSlug,
        preorderKey,
        newQuestionForm(active.baseVersionId, active.headRevision + 1, {
          label: "Stale revision question",
          required: false,
          answerStyle: "short_answer",
        }),
      ),
    );
    expect(staleRevision.message).toContain("notice=stale");

    expect(
      await invokeWithClient(staff, () =>
        prepareNewPreorderQuestionAmendmentAction(
          businessSlug,
          preorderKey,
          newQuestionForm(active.baseVersionId, active.headRevision, {
            label: "Staff question",
            required: false,
            answerStyle: "short_answer",
          }),
        ),
      ),
    ).toMatchObject({ name: "ActionNotFound" });
    expect(
      await invokeWithClient(crossBusinessOwner, () =>
        prepareNewPreorderQuestionAmendmentAction(
          businessSlug,
          preorderKey,
          newQuestionForm(active.baseVersionId, active.headRevision, {
            label: "Cross business question",
            required: false,
            answerStyle: "short_answer",
          }),
        ),
      ),
    ).toMatchObject({ name: "ActionNotFound" });

    expect(await countRows("configuration_change_sets")).toBe(proposalsBefore);
    expect(await captureProtectedState()).toEqual(protectedBefore);
  });

  it("lets an Admin prepare only one ordinary proposed change", async () => {
    const adminConfiguration = new ConfigurationChangeService(
      administrator.client,
      {
        businessId: business.id,
        actorId: administrator.user.id,
      },
    );
    const active = await loadActiveManualAmendmentSnapshot(adminConfiguration);
    const protectedBefore = await captureProtectedState();
    const proposalsBefore = await countRows("configuration_change_sets");
    const redirectResult = await invokeWithClient(administrator, () =>
      prepareExistingPreorderQuestionAmendmentAction(
        businessSlug,
        preorderKey,
        "order",
        "dietary_requirements",
        existingQuestionForm(active.baseVersionId, active.headRevision, {
          label: "Allergies or dietary requirements",
          helpText: "Tell us about allergies or dietary needs.",
          required: false,
        }),
      ),
    );
    const proposal = await adminConfiguration.getChangeSet(
      proposalIdFromRedirect(redirectResult.message),
    );
    expect(proposal).toMatchObject({
      business_id: business.id,
      requested_by: administrator.user.id,
      status: "proposed",
      title: "Update preorder question",
      validation_result_json: null,
      applied_version_id: null,
    });
    expect(await countRows("configuration_change_sets")).toBe(
      proposalsBefore + 1,
    );
    expect(await captureProtectedState()).toEqual(protectedBefore);
  });

  it("proves the Bedford Phone-optional proposal, preview and deliberate lifecycle", async () => {
    const baseline = await loadActiveManualAmendmentSnapshot(configuration);
    const baselinePreorder = preorderFrom(baseline);
    const phoneField = baseline.snapshot.field_definitions.find(
      (field) =>
        field.object_key === baselinePreorder.customer_object_key &&
        field.key === "phone",
    );
    const phonePublic = baselinePreorder.config_json.public_fields.find(
      (field) => field.target === "customer" && field.field === "phone",
    );
    if (!phoneField || !phonePublic) {
      throw new Error("Bedford Phone configuration is missing.");
    }
    expect(phoneField.required).toBe(false);
    expect(phonePublic.required).toBe(false);

    const publicRequiredOperation = composePreorderQuestionAmendment(
      baseline.snapshot,
      {
        intent: "update_preorder_question",
        preorderKey,
        target: "customer",
        fieldKey: "phone",
        label: phonePublic.label,
        helpText: phonePublic.help_text ?? null,
        required: true,
      },
    ).operations[0]!;
    const globalRequiredOperation = setFieldOperationSchema.parse({
      op: "set_field",
      object_key: phoneField.object_key,
      key: phoneField.key,
      label: phoneField.label,
      field_type: phoneField.field_type,
      required: true,
      default_value: phoneField.default_value,
      settings_json: phoneField.settings_json,
      position: phoneField.position,
      is_active: phoneField.is_active,
    });
    const setupProposal = await configuration.proposeChangeSet({
      expectedBaseVersionId: baseline.baseVersionId,
      expectedHeadRevision: baseline.headRevision,
      title: "Acceptance setup: require Phone",
      description: "Require Phone before testing the optional amendment",
      operations: [globalRequiredOperation, publicRequiredOperation],
    });
    expect(
      (await configuration.validateChangeSet(setupProposal.id)).status,
    ).toBe("validated");
    const setupApplied = await configuration.applyChangeSet(setupProposal.id);
    expect(setupApplied.status).toBe("applied");

    const required = await loadActiveManualAmendmentSnapshot(configuration);
    expect(required.headRevision).toBe(3);
    const requiredPreorder = preorderFrom(required);
    expect(
      required.snapshot.field_definitions.find(
        (field) =>
          field.object_key === requiredPreorder.customer_object_key &&
          field.key === "phone",
      )?.required,
    ).toBe(true);
    expect(
      requiredPreorder.config_json.public_fields.find(
        (field) => field.target === "customer" && field.field === "phone",
      )?.required,
    ).toBe(true);
    const publicBefore = await resolvePublicPreorder(
      anonymous,
      businessSlug,
      pageSlug,
      preorderKey,
    );
    expect(
      publicBefore?.preorder.public_fields.find(
        (field) => field.target === "customer" && field.field === "phone",
      )?.required,
    ).toBe(true);

    const protectedBeforeProposal = await captureProtectedState();
    const recordsBefore = protectedBeforeProposal.records;
    const relationshipsBefore = protectedBeforeProposal.relationships;
    const proposalsBefore = await countRows("configuration_change_sets");
    const form = existingQuestionForm(
      required.baseVersionId,
      required.headRevision,
      {
        label: "Phone",
        helpText: "Optional",
        required: false,
      },
    );
    for (const [name, value] of Object.entries({
      business_id: crypto.randomUUID(),
      actor_id: administrator.user.id,
      preorderKey: "forged_preorder",
      target: "order",
      fieldKey: "customer_email",
      objectKey: "order",
      title: "Forged title",
      description: "Forged description",
      operation: "set_object",
      operations: '[{"op":"set_object"}]',
      fieldDefinition: "{}",
      preorderConfiguration: "{}",
      fieldMappings: "{}",
      publicFields: "[]",
      allowedLocationIds: "[]",
      isActive: "false",
      idAllocations: "{}",
      candidate: "{}",
      checksum: "forged",
      semanticDiff: "{}",
      validation: "{}",
      status: "applied",
      appliedVersion: crypto.randomUUID(),
    })) {
      form.set(name, value);
    }
    const redirectResult = await invokeWithClient(owner, () =>
      prepareExistingPreorderQuestionAmendmentAction(
        businessSlug,
        preorderKey,
        "customer",
        "phone",
        form,
      ),
    );
    const proposal = await configuration.getChangeSet(
      proposalIdFromRedirect(redirectResult.message),
    );
    expect(await countRows("configuration_change_sets")).toBe(
      proposalsBefore + 1,
    );
    expect(proposal).toMatchObject({
      business_id: business.id,
      requested_by: owner.user.id,
      base_version_id: required.baseVersionId,
      base_head_revision: required.headRevision,
      title: "Update preorder question",
      description: "Make Phone optional",
      status: "proposed",
      validation_result_json: null,
      applied_version_id: null,
    });
    const operations = proposal.operations_json as unknown as Array<
      Record<string, unknown>
    >;
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      op: "set_field",
      object_key: "customer",
      key: "phone",
      label: phoneField.label,
      field_type: phoneField.field_type,
      required: false,
      default_value: phoneField.default_value,
      settings_json: phoneField.settings_json,
      position: phoneField.position,
      is_active: phoneField.is_active,
    });
    expect(operations[1]).toMatchObject({
      op: "set_preorder_experience",
      key: preorderKey,
      config_json: {
        schedule: requiredPreorder.config_json.schedule,
        field_mappings: requiredPreorder.config_json.field_mappings,
      },
    });
    expect(
      (
        operations[1]?.config_json as {
          public_fields: Array<Record<string, unknown>>;
        }
      ).public_fields.find(
        (field) => field.target === "customer" && field.field === "phone",
      ),
    ).toMatchObject({ label: "Phone", required: false, help_text: "Optional" });
    expect(JSON.stringify(operations)).not.toContain("forged");
    expect(await captureProtectedState()).toEqual(protectedBeforeProposal);

    const preview = await resolveConfigurationPreviewPreorder(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
      changeSetId: proposal.id,
      pageKey: "public_preorder",
      preorderKey,
    });
    expect(
      preview?.preorder.public_fields.find(
        (field) => field.target === "customer" && field.field === "phone",
      )?.required,
    ).toBe(false);
    expect(
      (
        await resolvePublicPreorder(
          anonymous,
          businessSlug,
          pageSlug,
          preorderKey,
        )
      )?.preorder.public_fields.find(
        (field) => field.target === "customer" && field.field === "phone",
      )?.required,
    ).toBe(true);

    expect((await configuration.validateChangeSet(proposal.id)).status).toBe(
      "validated",
    );
    const applied = await configuration.applyChangeSet(proposal.id);
    expect(applied.status).toBe("applied");
    expect(await configuration.getActiveHead()).toMatchObject({
      active_version_id: applied.applied_version_id,
      head_revision: 4,
    });
    expect(
      (
        await resolvePublicPreorder(
          anonymous,
          businessSlug,
          pageSlug,
          preorderKey,
        )
      )?.preorder.public_fields.find(
        (field) => field.target === "customer" && field.field === "phone",
      )?.required,
    ).toBe(false);
    const protectedAfter = await captureProtectedState();
    expect(protectedAfter.records).toEqual(recordsBefore);
    expect(protectedAfter.relationships).toEqual(relationshipsBefore);
    expect(protectedAfter.ai_execution_runs).toEqual([]);
  }, 60_000);

  it("adds Gift message, persists it on an ordinary Order Record and preserves prior operations", async () => {
    const active = await loadActiveManualAmendmentSnapshot(configuration);
    expect(active.headRevision).toBe(4);
    const beforeProposal = await captureProtectedState();
    const liveBefore = await resolvePublicPreorder(
      anonymous,
      businessSlug,
      pageSlug,
      preorderKey,
    );
    expect(
      liveBefore?.preorder.public_fields.some(
        (field) => field.label === "Gift message",
      ),
    ).toBe(false);

    const form = newQuestionForm(active.baseVersionId, active.headRevision, {
      label: "Gift message",
      helpText: "Write a message for the recipient.",
      required: false,
      answerStyle: "long_answer",
    });
    for (const [name, value] of Object.entries({
      business_id: crypto.randomUUID(),
      actor_id: administrator.user.id,
      preorderKey: "forged",
      target: "customer",
      fieldKey: "forged_gift",
      objectKey: "customer",
      operations: '[{"op":"set_object"}]',
      config_json: "{}",
      public_fields: "[]",
      status: "applied",
    })) {
      form.set(name, value);
    }
    const redirectResult = await invokeWithClient(owner, () =>
      prepareNewPreorderQuestionAmendmentAction(
        businessSlug,
        preorderKey,
        form,
      ),
    );
    const proposal = await configuration.getChangeSet(
      proposalIdFromRedirect(redirectResult.message),
    );
    expect(proposal).toMatchObject({
      title: "Add preorder question",
      description: "Add optional question Gift message",
      status: "proposed",
      base_version_id: active.baseVersionId,
      base_head_revision: active.headRevision,
      validation_result_json: null,
      applied_version_id: null,
    });
    const operations = proposal.operations_json as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      op: "set_field",
      object_key: "order",
      key: "gift_message",
      label: "Gift message",
      field_type: "long_text",
      required: false,
      default_value: null,
      settings_json: {},
      is_active: true,
    });
    const activeOrderPositions = active.snapshot.field_definitions
      .filter((field) => field.object_key === "order")
      .map((field) => field.position);
    expect(operations[0]?.position).toBe(Math.max(...activeOrderPositions) + 1);
    const preservedPreorder = preorderFrom(active);
    expect(
      (
        operations[1]?.config_json as {
          public_fields: Array<Record<string, unknown>>;
          schedule: unknown;
          field_mappings: unknown;
        }
      ).public_fields.slice(0, -1),
    ).toEqual(preservedPreorder.config_json.public_fields);
    expect(
      (
        operations[1]?.config_json as {
          public_fields: Array<Record<string, unknown>>;
        }
      ).public_fields.at(-1),
    ).toEqual({
      target: "order",
      field: "gift_message",
      label: "Gift message",
      required: false,
      help_text: "Write a message for the recipient.",
      autocomplete: "off",
    });
    expect(JSON.stringify(operations)).not.toContain("forged");
    expect(await captureProtectedState()).toEqual(beforeProposal);

    const preview = await resolveConfigurationPreviewPreorder(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
      changeSetId: proposal.id,
      pageKey: "public_preorder",
      preorderKey,
    });
    expect(
      preview?.preorder.public_fields.find(
        (field) => field.field === "gift_message",
      ),
    ).toMatchObject({
      target: "order",
      label: "Gift message",
      field_type: "long_text",
      required: false,
      help_text: "Write a message for the recipient.",
    });
    expect(
      (
        await resolvePublicPreorder(
          anonymous,
          businessSlug,
          pageSlug,
          preorderKey,
        )
      )?.preorder.public_fields.some((field) => field.field === "gift_message"),
    ).toBe(false);

    expect((await configuration.validateChangeSet(proposal.id)).status).toBe(
      "validated",
    );
    const applied = await configuration.applyChangeSet(proposal.id);
    expect(applied.status).toBe("applied");
    expect(await configuration.getActiveHead()).toMatchObject({
      active_version_id: applied.applied_version_id,
      head_revision: 5,
    });
    const live = await resolvePublicPreorder(
      anonymous,
      businessSlug,
      pageSlug,
      preorderKey,
    );
    expect(
      live?.preorder.public_fields.find(
        (field) => field.field === "gift_message",
      ),
    ).toMatchObject({
      target: "order",
      label: "Gift message",
      field_type: "long_text",
      required: false,
      help_text: "Write a message for the recipient.",
    });
    const afterApplication = await captureProtectedState();
    expect(afterApplication.records).toEqual(beforeProposal.records);
    expect(afterApplication.relationships).toEqual(
      beforeProposal.relationships,
    );
    expect(afterApplication.ai_execution_runs).toEqual([]);

    if (!live) {
      throw new Error("Bedford public preorder is unavailable.");
    }
    const choice = live.preorder.locations
      .flatMap((location) =>
        location.slots
          .filter((slot) => slot.available)
          .map((slot) => ({ location, slot })),
      )
      .find(({ location }) =>
        live.preorder.products.some((product) =>
          product.location_ids.includes(location.id),
        ),
      );
    if (!choice) {
      throw new Error("No available Bedford acceptance slot was found.");
    }
    const product = live.preorder.products.find(({ location_ids }) =>
      location_ids.includes(choice.location.id),
    );
    if (!product) {
      throw new Error("No Bedford acceptance Product was found.");
    }
    const recordsBeforeSubmission = beforeProposal.records as unknown as Array<{
      id: string;
    }>;
    const relationshipsBeforeSubmission =
      beforeProposal.relationships as unknown as Array<{ id: string }>;
    const result = await processPreorderSubmission({
      client: serviceRole,
      businessSlug,
      pageSlug,
      preorderKey,
      body: {
        idempotency_token: crypto.randomUUID(),
        location_id: choice.location.id,
        collection_at: choice.slot.collection_at,
        items: [{ product_id: product.id, quantity: 1 }],
        fields: {
          customer: {
            name: "Gift Test Customer",
            email: "gift-question@example.test",
          },
          order: {
            gift_message: "Happy birthday from all of us.",
          },
        },
        website: "",
      },
      requestHash: "a".repeat(64),
      emailAdapter: {
        async sendConfirmation() {
          return undefined;
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Gift preorder failed with ${result.code}.`);
    }
    const stored = await sql<{ data_json: Json }[]>`
      select record_value.data_json
      from public.records as record_value
      join public.object_definitions as object_value
        on object_value.business_id = record_value.business_id
       and object_value.id = record_value.object_definition_id
      where record_value.business_id = ${business.id}::uuid
        and object_value.key = 'order'
        and record_value.data_json ->> 'public_reference' =
          ${result.confirmation.public_reference}
    `;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.data_json).toMatchObject({
      gift_message: "Happy birthday from all of us.",
      public_reference: result.confirmation.public_reference,
    });
    expect(
      await existingRowsByIds(
        "records",
        recordsBeforeSubmission.map((record) => record.id),
      ),
    ).toEqual(beforeProposal.records);
    expect(
      await existingRowsByIds(
        "record_relationships",
        relationshipsBeforeSubmission.map((edge) => edge.id),
      ),
    ).toEqual(beforeProposal.relationships);
    expect(await countRows("ai_execution_runs")).toBe(0);
    const domainTables = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'gift_messages',
          'preorder_questions',
          'order_questions'
        )
    `;
    expect(domainTables).toEqual([]);
  }, 60_000);

  it("retains the NULL-safe seven-argument proposal and direct-DML boundaries", async () => {
    const signatures = await sql<
      {
        arguments: string;
        authenticated_can_execute: boolean;
      }[]
    >`
      select
        pg_get_function_identity_arguments(procedure_value.oid) as arguments,
        has_function_privilege(
          'authenticated',
          procedure_value.oid,
          'execute'
        ) as authenticated_can_execute
      from pg_catalog.pg_proc as procedure_value
      join pg_catalog.pg_namespace as namespace_value
        on namespace_value.oid = procedure_value.pronamespace
      where namespace_value.nspname = 'public'
        and procedure_value.proname = 'propose_configuration_change'
    `;
    expect(signatures).toEqual([
      {
        arguments:
          "expected_business_id uuid, expected_actor_id uuid, expected_base_version_id uuid, expected_head_revision bigint, requested_title text, requested_description text, requested_operations jsonb",
        authenticated_can_execute: true,
      },
    ]);

    const giftField = requireData(
      await owner.client
        .from("field_definitions")
        .select("*")
        .eq("business_id", business.id)
        .eq("key", "gift_message")
        .single(),
      "Could not load the applied Gift message Field.",
    );
    const directWrite = await owner.client
      .from("field_definitions")
      .update({ label: "Forged direct edit" })
      .eq("id", giftField.id);
    expect(directWrite.error).not.toBeNull();
    expect(
      requireData(
        await owner.client
          .from("field_definitions")
          .select("label")
          .eq("id", giftField.id)
          .single(),
        "Could not verify the protected Gift message Field.",
      ).label,
    ).toBe("Gift message");
    expect(await countRows("ai_execution_runs")).toBe(0);
  });
});
