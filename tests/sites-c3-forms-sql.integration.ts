import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { composeStarterComposition } from "../src/core/acquisition/composer";
import { composeInitialPreorderOperations } from "../src/core/configuration/initial-preorder/service";
import { ConfigurationChangeService } from "../src/core/configuration/service";
import { siteDraftV1Schema } from "../src/core/sites/schemas";
import type { Database, Tables } from "../src/db/supabase/database.types";
import {
  getC1LocalSupabaseSettings,
  type C1LocalSupabaseSettings,
} from "./support/c1-local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type Location = Tables<"locations">;
type Identity = { client: Client; user: User };
type SiteState = {
  id: string;
  draft_json: Record<string, unknown>;
  draft_revision: number;
  draft_base_version_id: string;
  draft_base_head_revision: number;
};
type SqlSiteState = Omit<
  SiteState,
  "draft_revision" | "draft_base_head_revision"
> & {
  draft_revision: number | string;
  draft_base_head_revision: number | string;
};
type PreparedRelease = {
  id: string;
  status: string;
  projection_schema_version: number;
};
type SubmissionResult = {
  ok: boolean;
  idempotent?: boolean;
  code?: string;
  confirmation?: { public_reference: string };
};
type RpcClient = {
  rpc<T>(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<{
    data: T | null;
    error: { code?: string; message?: string } | null;
  }>;
};
type ConfigurationOperations = Parameters<
  ConfigurationChangeService["proposeChangeSet"]
>[0]["operations"];

let settings: C1LocalSupabaseSettings;
let sql: Sql;
let admin: Client;
let anonymous: Client;
let owner: Identity;
let business: Business;
let siteId: string;
const createdBusinessIds: string[] = [];
const createdUserIds: string[] = [];
const password = "Sites-C3-forms-integration-password!";

function rpc(client: Client): RpcClient {
  return client as unknown as RpcClient;
}

async function createOwner(): Promise<Identity> {
  const email = `sites-c3-forms-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw (
      created.error ?? new Error("Could not create the Forms fixture user.")
    );
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
    throw (
      signedIn.error ?? new Error("Could not sign in the Forms fixture user.")
    );
  }
  return { client, user: signedIn.data.user };
}

async function readSiteStateFor(
  targetBusinessId: string,
  targetSiteId: string,
): Promise<SiteState> {
  const rows = await sql<SqlSiteState[]>`
    select id, draft_json, draft_revision, draft_base_version_id,
      draft_base_head_revision
    from public.site_states
    where business_id = ${targetBusinessId} and id = ${targetSiteId}
  `;
  const state = rows[0];
  if (!state) throw new Error("Forms fixture Site state was not found.");
  return {
    ...state,
    draft_revision: Number(state.draft_revision),
    draft_base_head_revision: Number(state.draft_base_head_revision),
  };
}

async function readSiteState(): Promise<SiteState> {
  return readSiteStateFor(business.id, siteId);
}

async function callRpc<T>(
  client: Client,
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const result = await rpc(client).rpc<T>(name, parameters);
  if (result.error || result.data === null) {
    throw new Error(`${name} failed: ${result.error?.message ?? "no data"}`);
  }
  return result.data;
}

async function createFixtureBusiness(label: string): Promise<Business> {
  const created = await callRpc<Business>(owner.client, "create_business", {
    business_name: `${label} ${crypto.randomUUID()}`,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  createdBusinessIds.push(created.id);
  return created;
}

async function applyFixtureConfiguration(
  targetBusiness: Business,
  operations: ConfigurationOperations,
  title: string,
): Promise<void> {
  const configuration = new ConfigurationChangeService(owner.client, {
    businessId: targetBusiness.id,
    actorId: owner.user.id,
  });
  const proposal = await configuration.proposeChangeSet({
    ...(await configuration.getProposalCurrentness()),
    title,
    description: "Sites C3 operational integration fixture.",
    operations,
  });
  const validated = await configuration.validateChangeSet(proposal.id);
  expect(validated.status).toBe("validated");
  await configuration.applyChangeSet(proposal.id);
}

async function createFixtureSite(
  targetBusiness: Business,
  draft: Record<string, unknown>,
): Promise<SiteState> {
  return callRpc<SiteState>(owner.client, "create_site_draft_v2", {
    expected_business_id: targetBusiness.id,
    expected_actor_id: owner.user.id,
    requested_draft: draft,
  });
}

function releaseCurrentness(state: SiteState) {
  return {
    expected_draft_revision: state.draft_revision,
    expected_base_version_id: state.draft_base_version_id,
    expected_base_head_revision: state.draft_base_head_revision,
  };
}

beforeAll(async () => {
  settings = getC1LocalSupabaseSettings();
  admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  anonymous = createClient<Database>(settings.apiUrl, settings.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  sql = postgres(settings.databaseUrl, { max: 1 });
  owner = await createOwner();
  business = await callRpc<Business>(owner.client, "create_business", {
    business_name: `Sites C3 Forms ${crypto.randomUUID()}`,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  createdBusinessIds.push(business.id);

  const pageId = crypto.randomUUID();
  const formBlockId = crypto.randomUUID();
  const formId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  const draft = siteDraftV1Schema.parse({
    schema_version: 1,
    branding: { name: "Forms integration", accent: "forest" },
    pages: [
      {
        id: pageId,
        title: "Contact",
        slug: "contact",
        navigation_label: "Contact",
        is_home: true,
        is_in_navigation: true,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "heading",
              id: crypto.randomUUID(),
              text: "Contact us",
              level: 1,
            },
            {
              type: "public_form",
              id: formBlockId,
              form_key: "contact_enquiry",
            },
          ],
        },
      },
    ],
    forms: [
      {
        id: formId,
        key: "contact_enquiry",
        name: "Contact enquiry",
        object_mode: "new",
        object_key: "contact_enquiry",
        singular_label: "Enquiry",
        plural_label: "Enquiries",
        view_mode: "new",
        view_key: "contact_enquiry_table",
        view_name: "Contact enquiries",
        submit_label: "Send enquiry",
        questions: [
          {
            id: questionId,
            key: "name",
            field_mode: "new",
            label: "Name",
            field_type: "short_text",
            required: true,
          },
        ],
      },
    ],
  });
  const createdState = await callRpc<SiteState>(
    owner.client,
    "create_site_draft_v2",
    {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_draft: draft,
    },
  );
  siteId = createdState.id;
});

afterAll(async () => {
  let retainProtectedFixture = false;
  try {
    if (sql && createdBusinessIds.length > 0) {
      const [protectedRelease] = await sql.unsafe<
        { protected_release: boolean }[]
      >(
        `select exists (
           select 1
           from public.site_release_actions_v3
           where business_id = any($1::uuid[])
         ) as protected_release`,
        [createdBusinessIds],
      );
      if (!protectedRelease?.protected_release) {
        await sql.unsafe(
          "delete from public.site_states where business_id = any($1::uuid[])",
          [createdBusinessIds],
        );
        const deleted = await admin
          .from("businesses")
          .delete()
          .in("id", createdBusinessIds);
        if (deleted.error) throw deleted.error;
      } else {
        retainProtectedFixture = true;
      }
      // Published C3 actions are immutable by design. The isolated runner
      // disposes this database after the test, so retain that protected
      // business rather than bypassing the release-authority trigger.
    }
    if (!retainProtectedFixture) {
      for (const userId of createdUserIds) {
        const deleted = await admin.auth.admin.deleteUser(userId);
        if (deleted.error) throw deleted.error;
      }
    }
  } finally {
    if (sql) await sql.end();
  }
});

describe("Sites C3 Form SQL boundary", () => {
  it("keeps public submission service-only", async () => {
    const [privileges] = await sql<
      {
        anon_execute: boolean;
        authenticated_execute: boolean;
        service_execute: boolean;
      }[]
    >`
      select
        has_function_privilege(
          'anon',
          'public.submit_public_site_form_v3(text,text,text,text,uuid,uuid,jsonb,uuid[],text)',
          'execute'
        ) as anon_execute,
        has_function_privilege(
          'authenticated',
          'public.submit_public_site_form_v3(text,text,text,text,uuid,uuid,jsonb,uuid[],text)',
          'execute'
        ) as authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.submit_public_site_form_v3(text,text,text,text,uuid,uuid,jsonb,uuid[],text)',
          'execute'
        ) as service_execute
    `;

    expect(privileges).toEqual({
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
    });
  });

  it("keeps v4 operational writes service-only and rejects an unavailable action before any write", async () => {
    const [privileges] = await sql<
      {
        booking_anon_execute: boolean;
        booking_authenticated_execute: boolean;
        booking_service_execute: boolean;
        preorder_anon_execute: boolean;
        preorder_authenticated_execute: boolean;
        preorder_service_execute: boolean;
      }[]
    >`
      select
        has_function_privilege(
          'anon',
          'public.submit_public_site_booking_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as booking_anon_execute,
        has_function_privilege(
          'authenticated',
          'public.submit_public_site_booking_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as booking_authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.submit_public_site_booking_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as booking_service_execute,
        has_function_privilege(
          'anon',
          'public.submit_public_site_preorder_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as preorder_anon_execute,
        has_function_privilege(
          'authenticated',
          'public.submit_public_site_preorder_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as preorder_authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.submit_public_site_preorder_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as preorder_service_execute
    `;
    expect(privileges).toEqual({
      booking_anon_execute: false,
      booking_authenticated_execute: false,
      booking_service_execute: true,
      preorder_anon_execute: false,
      preorder_authenticated_execute: false,
      preorder_service_execute: true,
    });

    const [before] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${business.id}
    `;
    const unavailable = await callRpc<{ ok: boolean; code: string }>(
      admin,
      "submit_public_site_preorder_v4",
      {
        requested_business_slug: business.slug,
        requested_page_slug: "contact",
        requested_action_key: "o_" + "f".repeat(64),
        requested_release_token: "s_" + "e".repeat(64),
        requested_idempotency_token: crypto.randomUUID(),
        submission: {
          idempotency_token: crypto.randomUUID(),
          location_id: crypto.randomUUID(),
          collection_at: "2026-10-20T10:00:00.000Z",
          items: [],
          fields: { customer: {}, order: {} },
          website: "",
        },
        requested_request_hash: "d".repeat(64),
      },
    );
    expect(unavailable).toEqual({ ok: false, code: "action_unavailable" });
    const [after] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${business.id}
    `;
    expect(after?.count).toBe(before?.count);
  });

  it("canonicalizes hidden defaults without making them condition answers", async () => {
    const [result] = await sql<{ answers: unknown }[]>`
      select private.site_canonicalize_submission_answers_v3(
        ${sql.json({
          action_key: "a_" + "a".repeat(64),
        })}::jsonb,
        ${sql.json([
          {
            field_key: "legacy_source",
            field_type: "short_text",
            hidden: true,
            required: true,
            form_default_value: "trusted",
            visible_when: null,
            settings_json: {},
          },
          {
            field_key: "follow_up",
            field_type: "short_text",
            hidden: false,
            required: false,
            form_default_value: null,
            visible_when: {
              field: "legacy_source",
              operator: "equals",
              value: "trusted",
            },
            settings_json: {},
          },
        ])}::jsonb,
        '{}'::jsonb
      ) as answers
    `;

    expect(result?.answers).toEqual({ legacy_source: "trusted" });
  });

  it("uses the pre-file answer and grant manifest for the retry digest", async () => {
    const [result] = await sql<{ first: string; second: string }[]>`
      select
        private.site_form_submission_digest_v3(
          ${sql.json({ action_key: "a_" + "b".repeat(64) })}::jsonb,
          ${sql.json({ name: "Baker" })}::jsonb,
          array[
            '00000000-0000-4000-8000-000000000001'::uuid,
            '00000000-0000-4000-8000-000000000002'::uuid
          ]
        ) as first,
        private.site_form_submission_digest_v3(
          ${sql.json({ action_key: "a_" + "b".repeat(64) })}::jsonb,
          ${sql.json({ name: "Baker" })}::jsonb,
          array[
            '00000000-0000-4000-8000-000000000002'::uuid,
            '00000000-0000-4000-8000-000000000001'::uuid
          ]
        ) as second
    `;

    expect(result?.first).toMatch(/^[a-f0-9]{64}$/);
    expect(result?.second).toBe(result?.first);
  });

  it("publishes and submits a new Form, retries it, then appends a Property", async () => {
    let state = await readSiteState();
    const prePublishDraft = structuredClone(state.draft_json);
    const prepare = await callRpc<PreparedRelease>(
      owner.client,
      "prepare_site_release_v3",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        expected_draft_revision: state.draft_revision,
        expected_base_version_id: state.draft_base_version_id,
        expected_head_revision: state.draft_base_head_revision,
      },
    );
    expect(prepare).toMatchObject({
      status: "prepared",
      projection_schema_version: 3,
    });
    const preparedActions = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.site_release_actions_v3
      where business_id = ${business.id} and release_id = ${prepare.id}
    `;
    expect(preparedActions[0]?.count).toBe(0);

    const published = await callRpc<PreparedRelease>(
      owner.client,
      "publish_site_release_v3",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        requested_candidate_id: prepare.id,
        expected_draft_revision: state.draft_revision,
        expected_base_version_id: state.draft_base_version_id,
        expected_head_revision: state.draft_base_head_revision,
      },
    );
    expect(published).toMatchObject({
      status: "published",
      projection_schema_version: 3,
    });

    const [action] = await sql<
      {
        release_id: string;
        release_token: string;
        action_key: string;
        form_id: string;
        object_definition_id: string;
        view_id: string;
      }[]
    >`
      select release_id, release_token, action_key, form_id,
        object_definition_id, view_id
      from public.site_release_actions_v3
      where business_id = ${business.id} and release_id = ${published.id}
    `;
    if (!action) throw new Error("Published Forms action was not indexed.");
    expect(action.action_key).toMatch(/^a_[a-f0-9]{64}$/);
    expect(action.release_token).toMatch(/^s_[a-f0-9]{64}$/);

    const [destinationView] = await sql<
      {
        audience: string;
        object_definition_id: string;
        config_json: Record<string, unknown>;
      }[]
    >`
      select audience, object_definition_id, config_json
      from public.views
      where business_id = ${business.id} and id = ${action.view_id}
    `;
    expect(destinationView).toMatchObject({
      audience: "internal",
      object_definition_id: action.object_definition_id,
      config_json: {
        fields: ["name"],
        title_field: "name",
        include_archived: false,
      },
    });
    expect(destinationView?.config_json).not.toHaveProperty("create_form_key");
    expect(destinationView?.config_json).not.toHaveProperty("edit_form_key");

    const resolvedPage = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_page",
      {
        requested_business_slug: business.slug,
        requested_page_slug: "contact",
      },
    );
    const page = resolvedPage.page as {
      layout: { blocks: Array<Record<string, unknown>> };
    };
    const formBlock = page.layout.blocks.find((block) => block.type === "form");
    expect(formBlock).toMatchObject({
      action: {
        action_key: action.action_key,
        release_token: action.release_token,
        questions: [{ key: "name", field_type: "short_text", required: true }],
      },
    });

    const idempotencyToken = crypto.randomUUID();
    const requestHash = "c".repeat(64);
    const submitParameters = {
      requested_business_slug: business.slug,
      requested_page_slug: "contact",
      requested_action_key: action.action_key,
      requested_release_token: action.release_token,
      requested_idempotency_token: idempotencyToken,
      requested_submission_attempt_id: idempotencyToken,
      requested_answers: { name: "Ada" },
      requested_grant_ids: [],
      requested_request_hash: requestHash,
    };
    const firstSubmission = await callRpc<{
      ok: boolean;
      idempotent: boolean;
      confirmation: { public_reference: string };
    }>(admin, "submit_public_site_form_v3", submitParameters);
    expect(firstSubmission).toMatchObject({ ok: true, idempotent: false });
    const [receipt] = await sql<
      {
        id: string;
        record_id: string;
        canonical_answers: Record<string, unknown>;
        request_digest: string;
      }[]
    >`
      select id, record_id, canonical_answers, request_digest
      from public.public_form_submissions
      where business_id = ${business.id}
        and action_key = ${action.action_key}
        and idempotency_token = ${idempotencyToken}
    `;
    expect(receipt?.canonical_answers).toEqual({ name: "Ada" });
    expect(receipt?.request_digest).toMatch(/^[a-f0-9]{64}$/);
    if (!receipt) throw new Error("Form submission receipt was not created.");
    const [record] = await sql<{ data_json: Record<string, unknown> }[]>`
      select data_json
      from public.records
      where business_id = ${business.id} and id = ${receipt.record_id}
    `;
    expect(record?.data_json).toMatchObject({ name: "Ada" });

    const retry = await callRpc<{
      ok: boolean;
      idempotent: boolean;
      confirmation: { public_reference: string };
    }>(admin, "submit_public_site_form_v3", submitParameters);
    expect(retry).toMatchObject({
      ok: true,
      idempotent: true,
      confirmation: {
        public_reference: firstSubmission.confirmation.public_reference,
      },
    });

    const publishedState = await readSiteState();
    expect(publishedState.draft_revision).toBe(state.draft_revision + 1);

    // Keep the publication placement guard exercised alongside the valid
    // placement above. A missing Form must fail before any release is built.
    const invalidPlacementDraft = structuredClone(
      publishedState.draft_json,
    ) as {
      pages: Array<{
        layout: { blocks: Array<Record<string, unknown>> };
      }>;
    };
    const invalidFormBlock = invalidPlacementDraft.pages
      .flatMap((page) => page.layout.blocks)
      .find((block) => block.type === "public_form");
    expect(invalidFormBlock).toBeDefined();
    invalidFormBlock!.form_key = "missing_form";
    const invalidPlacementState = await callRpc<SiteState>(
      owner.client,
      "save_site_draft_v2",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        expected_draft_revision: publishedState.draft_revision,
        requested_draft: siteDraftV1Schema.parse(invalidPlacementDraft),
      },
    );
    const invalidPrepare = await rpc(owner.client).rpc<PreparedRelease>(
      "prepare_site_release_v3",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        expected_draft_revision: invalidPlacementState.draft_revision,
        expected_base_version_id: invalidPlacementState.draft_base_version_id,
        expected_head_revision: invalidPlacementState.draft_base_head_revision,
      },
    );
    expect(invalidPrepare.data).toBeNull();
    expect(invalidPrepare.error?.message).toContain("site_form_page_missing");
    const restoredState = await callRpc<SiteState>(
      owner.client,
      "save_site_draft_v2",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        expected_draft_revision: invalidPlacementState.draft_revision,
        requested_draft: siteDraftV1Schema.parse(publishedState.draft_json),
      },
    );
    const staleSave = await rpc(owner.client).rpc<SiteState>(
      "save_site_draft_v2",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        expected_draft_revision: state.draft_revision,
        requested_draft: prePublishDraft,
      },
    );
    expect(staleSave.data).toBeNull();
    expect(staleSave.error?.code).toBe("P0001");
    state = restoredState;
    const editedDraft = structuredClone(state.draft_json) as {
      forms: Array<{
        key: string;
        questions: Array<Record<string, unknown>>;
      }>;
    };
    const editedForm = editedDraft.forms.find(
      (form) => form.key === "contact_enquiry",
    );
    expect(editedForm).toBeDefined();
    editedForm!.questions.push({
      id: crypto.randomUUID(),
      key: "email",
      field_mode: "new",
      label: "Email",
      field_type: "email",
      required: false,
    });
    const saved = await callRpc<SiteState>(owner.client, "save_site_draft_v2", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_site_id: siteId,
      expected_draft_revision: state.draft_revision,
      requested_draft: siteDraftV1Schema.parse(editedDraft),
    });
    const secondPrepare = await callRpc<PreparedRelease>(
      owner.client,
      "prepare_site_release_v3",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        expected_draft_revision: saved.draft_revision,
        expected_base_version_id: saved.draft_base_version_id,
        expected_head_revision: saved.draft_base_head_revision,
      },
    );
    const secondPublish = await callRpc<PreparedRelease>(
      owner.client,
      "publish_site_release_v3",
      {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        requested_candidate_id: secondPrepare.id,
        expected_draft_revision: saved.draft_revision,
        expected_base_version_id: saved.draft_base_version_id,
        expected_head_revision: saved.draft_base_head_revision,
      },
    );
    expect(secondPublish).toMatchObject({ status: "published" });
    const [secondAction] = await sql<
      { action_key: string; release_token: string }[]
    >`
      select action_key, release_token
      from public.site_release_actions_v3
      where business_id = ${business.id} and release_id = ${secondPublish.id}
    `;
    if (!secondAction)
      throw new Error("Republished Forms action was not indexed.");
    expect(secondAction.action_key).toBe(action.action_key);
    expect(secondAction.release_token).not.toBe(action.release_token);

    const oldReleaseRetry = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_form_v3",
      submitParameters,
    );
    expect(oldReleaseRetry).toMatchObject({
      ok: true,
      idempotent: true,
      confirmation: {
        public_reference: firstSubmission.confirmation.public_reference,
      },
    });

    const [beforeStaleReceipts] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.public_form_submissions
      where business_id = ${business.id}
        and action_key = ${action.action_key}
    `;
    const [beforeStaleRecords] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${business.id}
        and object_definition_id = ${action.object_definition_id}
    `;
    const staleAttemptId = crypto.randomUUID();
    const staleReleaseAttempt = await rpc(admin).rpc<SubmissionResult>(
      "submit_public_site_form_v3",
      {
        ...submitParameters,
        requested_release_token: action.release_token,
        requested_idempotency_token: staleAttemptId,
        requested_submission_attempt_id: staleAttemptId,
        requested_answers: { name: "Stale release" },
        requested_request_hash: "d".repeat(64),
      },
    );
    expect(staleReleaseAttempt.error).toBeNull();
    expect(staleReleaseAttempt.data).toMatchObject({
      ok: false,
      code: "action_unavailable",
    });
    const [afterStaleReceipts] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.public_form_submissions
      where business_id = ${business.id}
        and action_key = ${action.action_key}
    `;
    const [afterStaleRecords] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${business.id}
        and object_definition_id = ${action.object_definition_id}
    `;
    expect(afterStaleReceipts?.count).toBe(beforeStaleReceipts?.count);
    expect(afterStaleRecords?.count).toBe(beforeStaleRecords?.count);

    const changedAttemptId = crypto.randomUUID();
    const changedAttempt = {
      ...submitParameters,
      requested_release_token: secondAction.release_token,
      requested_idempotency_token: changedAttemptId,
      requested_submission_attempt_id: changedAttemptId,
      requested_answers: { name: "Current release" },
      requested_request_hash: "e".repeat(64),
    };
    const currentSubmission = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_form_v3",
      changedAttempt,
    );
    expect(currentSubmission).toMatchObject({
      ok: true,
      idempotent: false,
    });
    const changedRetry = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_form_v3",
      {
        ...changedAttempt,
        requested_answers: { name: "Changed answer" },
      },
    );
    expect(changedRetry).toMatchObject({
      ok: false,
      code: "idempotency_conflict",
    });

    const concurrentAttemptId = crypto.randomUUID();
    const concurrentAttempt = {
      ...submitParameters,
      requested_release_token: secondAction.release_token,
      requested_idempotency_token: concurrentAttemptId,
      requested_submission_attempt_id: concurrentAttemptId,
      requested_answers: { name: "Concurrent answer" },
      requested_request_hash: "f".repeat(64),
    };
    const [beforeConcurrentRecords] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${business.id}
        and object_definition_id = ${action.object_definition_id}
    `;
    const concurrentResults = await Promise.all([
      rpc(admin).rpc<SubmissionResult>(
        "submit_public_site_form_v3",
        concurrentAttempt,
      ),
      rpc(admin).rpc<SubmissionResult>(
        "submit_public_site_form_v3",
        concurrentAttempt,
      ),
    ]);
    expect(
      concurrentResults.every(
        (result) => result.error === null && result.data !== null,
      ),
    ).toBe(true);
    const concurrentPayloads = concurrentResults.flatMap((result) =>
      result.data ? [result.data] : [],
    );
    expect(concurrentPayloads).toHaveLength(2);
    expect(
      concurrentPayloads.filter(
        (result) => result.ok && result.idempotent === false,
      ),
    ).toHaveLength(1);
    expect(
      concurrentPayloads.filter(
        (result) => result.ok && result.idempotent === true,
      ),
    ).toHaveLength(1);
    const concurrentConfirmations = concurrentPayloads.map(
      (result) => result.confirmation?.public_reference,
    );
    expect(concurrentConfirmations[0]).toBeDefined();
    expect(concurrentConfirmations[1]).toBe(concurrentConfirmations[0]);
    const [concurrentReceiptCount] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.public_form_submissions
      where business_id = ${business.id}
        and action_key = ${secondAction.action_key}
        and idempotency_token = ${concurrentAttemptId}
    `;
    const [concurrentRecordCount] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${business.id}
        and object_definition_id = ${action.object_definition_id}
    `;
    expect(concurrentReceiptCount?.count).toBe(1);
    expect(concurrentRecordCount?.count).toBe(
      (beforeConcurrentRecords?.count ?? 0) + 1,
    );

    const fieldRows = await sql<{ key: string; position: number }[]>`
      select key, position
      from public.field_definitions
      where business_id = ${business.id}
        and object_definition_id = ${action.object_definition_id}
        and key in ('name', 'email')
      order by position
    `;
    expect(fieldRows.map((field) => field.key)).toEqual(["name", "email"]);
    expect(fieldRows[1]?.position).toBeGreaterThan(
      fieldRows[0]?.position ?? -1,
    );
  });

  it("connects a Form to Customers, preserves duplicates for review, and serializes same-email creation", async () => {
    const customerBusiness = await createFixtureBusiness("Sites C3 Customer");
    const starter = composeStarterComposition(
      "enquiries",
      "Keep customer enquiries connected for review.",
    );
    await applyFixtureConfiguration(
      customerBusiness,
      starter.operations,
      "Create Customer and enquiry fixture",
    );

    const [customerObject] = await sql<{ id: string; key: string }[]>`
      select id, key
      from public.object_definitions
      where business_id = ${customerBusiness.id} and key = 'customer'
    `;
    const [enquiryObject] = await sql<{ id: string; key: string }[]>`
      select id, key
      from public.object_definitions
      where business_id = ${customerBusiness.id} and key = 'enquiry'
    `;
    const [relationship] = await sql<{ id: string; key: string }[]>`
      select id, key
      from public.relationship_definitions
      where business_id = ${customerBusiness.id}
        and key = 'customer_has_enquiry'
    `;
    if (!customerObject || !enquiryObject || !relationship) {
      throw new Error("Customer enquiry fixture configuration is incomplete.");
    }

    const draft = siteDraftV1Schema.parse({
      schema_version: 1,
      branding: { name: "Customer enquiry Site", accent: "forest" },
      pages: [
        {
          id: crypto.randomUUID(),
          title: "Contact",
          slug: "contact",
          navigation_label: "Contact",
          is_home: true,
          is_in_navigation: true,
          is_included: true,
          layout: {
            blocks: [
              {
                type: "heading",
                id: crypto.randomUUID(),
                text: "Tell us what you need",
                level: 1,
              },
              {
                type: "public_form",
                id: crypto.randomUUID(),
                form_key: "customer_enquiry",
              },
            ],
          },
        },
      ],
      forms: [
        {
          id: crypto.randomUUID(),
          key: "customer_enquiry",
          name: "Customer enquiry",
          object_mode: "existing",
          object_key: "enquiry",
          view_mode: "existing",
          view_key: "enquiry_view",
          submit_label: "Send enquiry",
          customer_connection: {
            enabled: true,
            customer_object_key: "customer",
            relationship_key: "customer_has_enquiry",
            email_field_key: "email",
            mappings: [
              { customer_field_key: "name", question_key: "name" },
              { customer_field_key: "email", question_key: "email" },
            ],
          },
          questions: [
            {
              id: crypto.randomUUID(),
              key: "subject",
              field_mode: "existing",
              label: "Subject",
              field_type: "short_text",
              required: true,
            },
            {
              id: crypto.randomUUID(),
              key: "name",
              field_mode: "new",
              label: "Name",
              field_type: "short_text",
              required: true,
            },
            {
              id: crypto.randomUUID(),
              key: "email",
              field_mode: "new",
              label: "Email",
              field_type: "email",
              required: true,
            },
          ],
        },
      ],
    });
    const site = await createFixtureSite(customerBusiness, draft);
    const prepare = await callRpc<PreparedRelease>(
      owner.client,
      "prepare_site_release_v3",
      {
        expected_business_id: customerBusiness.id,
        expected_actor_id: owner.user.id,
        requested_site_id: site.id,
        ...releaseCurrentness(site),
      },
    );
    const published = await callRpc<PreparedRelease>(
      owner.client,
      "publish_site_release_v3",
      {
        expected_business_id: customerBusiness.id,
        expected_actor_id: owner.user.id,
        requested_site_id: site.id,
        requested_candidate_id: prepare.id,
        ...releaseCurrentness(site),
      },
    );
    const [action] = await sql<
      {
        action_key: string;
        release_token: string;
        object_definition_id: string;
      }[]
    >`
      select action_key, release_token, object_definition_id
      from public.site_release_actions_v3
      where business_id = ${customerBusiness.id}
        and release_id = ${published.id}
        and form_key = 'customer_enquiry'
    `;
    if (!action) throw new Error("Customer Form action was not indexed.");
    expect(action.object_definition_id).toBe(enquiryObject.id);

    const [customerCountBeforeMissing] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${customerBusiness.id}
        and object_definition_id = ${customerObject.id}
    `;
    const missingEmailToken = crypto.randomUUID();
    const missingEmail = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_form_v3",
      {
        requested_business_slug: customerBusiness.slug,
        requested_page_slug: "contact",
        requested_action_key: action.action_key,
        requested_release_token: action.release_token,
        requested_idempotency_token: missingEmailToken,
        requested_submission_attempt_id: missingEmailToken,
        requested_answers: { subject: "Need help", name: "No email" },
        requested_grant_ids: [],
        requested_request_hash: "1".repeat(64),
      },
    );
    expect(missingEmail).toMatchObject({
      ok: false,
      code: "invalid_submission",
    });
    const [customerCountAfterMissing] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${customerBusiness.id}
        and object_definition_id = ${customerObject.id}
    `;
    expect(customerCountAfterMissing?.count).toBe(
      customerCountBeforeMissing?.count,
    );

    const existingCustomerIds: string[] = [];
    for (const name of ["First match", "Second match"]) {
      const created = await callRpc<{ id: string }>(
        owner.client,
        "create_graph_record",
        {
          expected_business_id: customerBusiness.id,
          target_object_definition_id: customerObject.id,
          requested_data: { name, email: "shared@example.test" },
        },
      );
      existingCustomerIds.push(created.id);
    }
    expect(existingCustomerIds).toHaveLength(2);

    const sharedAttempt = crypto.randomUUID();
    const sharedSubmission = {
      requested_business_slug: customerBusiness.slug,
      requested_page_slug: "contact",
      requested_action_key: action.action_key,
      requested_release_token: action.release_token,
      requested_idempotency_token: sharedAttempt,
      requested_submission_attempt_id: sharedAttempt,
      requested_answers: {
        subject: "Shared request",
        name: "Visitor name",
        email: "shared@example.test",
      },
      requested_grant_ids: [],
      requested_request_hash: "2".repeat(64),
    };
    const sharedResult = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_form_v3",
      sharedSubmission,
    );
    expect(sharedResult).toMatchObject({ ok: true, idempotent: false });

    const [sharedReceipt] = await sql<
      {
        id: string;
        record_id: string;
        original_customer_record_id: string;
        customer_record_id: string;
        customer_candidate_ids: string[];
        customer_match_count: number;
        customer_resolution_revision: number;
      }[]
    >`
      select id, record_id, original_customer_record_id, customer_record_id,
        customer_candidate_ids, customer_match_count,
        customer_resolution_revision
      from public.public_form_submissions
      where business_id = ${customerBusiness.id}
        and idempotency_token = ${sharedAttempt}
    `;
    if (!sharedReceipt) throw new Error("Shared Customer receipt is missing.");
    expect(sharedReceipt.customer_match_count).toBe(2);
    expect(sharedReceipt.customer_candidate_ids).toEqual(
      expect.arrayContaining(existingCustomerIds),
    );
    expect(sharedReceipt.original_customer_record_id).toBe(
      existingCustomerIds[0],
    );
    expect(sharedReceipt.customer_record_id).toBe(existingCustomerIds[0]);

    const reviewCases = await callRpc<Array<Record<string, unknown>>>(
      owner.client,
      "list_site_customer_resolution_cases",
      { expected_business_id: customerBusiness.id },
    );
    expect(reviewCases).toHaveLength(1);
    expect(reviewCases[0]).toMatchObject({
      kind: "form",
      receipt_id: sharedReceipt.id,
      submitted_details: {
        subject: "Shared request",
        name: "Visitor name",
        email: "shared@example.test",
      },
    });

    const relinked = await callRpc<Record<string, unknown>>(
      owner.client,
      "resolve_site_customer_resolution_case",
      {
        expected_business_id: customerBusiness.id,
        receipt_kind: "form",
        receipt_id: sharedReceipt.id,
        expected_resolution_revision:
          sharedReceipt.customer_resolution_revision,
        requested_customer_record_id: existingCustomerIds[1],
      },
    );
    expect(relinked).toMatchObject({
      ok: true,
      customer_record_id: existingCustomerIds[1],
    });
    const [relinkedEdge] = await sql<
      { source_record_id: string; target_record_id: string }[]
    >`
      select source_record_id, target_record_id
      from public.record_relationships
      where business_id = ${customerBusiness.id}
        and relationship_definition_id = ${relationship.id}
        and (source_record_id = ${sharedReceipt.record_id}
          or target_record_id = ${sharedReceipt.record_id})
    `;
    expect(relinkedEdge).toEqual(
      expect.objectContaining({
        source_record_id: existingCustomerIds[1],
        target_record_id: sharedReceipt.record_id,
      }),
    );
    const retryAfterRelink = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_form_v3",
      sharedSubmission,
    );
    expect(retryAfterRelink).toMatchObject({ ok: true, idempotent: true });
    const [receiptAfterRetry] = await sql<
      { customer_record_id: string; customer_resolution_state: string }[]
    >`
      select customer_record_id, customer_resolution_state
      from public.public_form_submissions
      where business_id = ${customerBusiness.id} and id = ${sharedReceipt.id}
    `;
    expect(receiptAfterRetry).toEqual({
      customer_record_id: existingCustomerIds[1],
      customer_resolution_state: "owner_relinked",
    });

    const concurrentEmail = "concurrent@example.test";
    const concurrent = await Promise.all(
      ["First concurrent", "Second concurrent"].map((name, index) => {
        const concurrentAttempt = crypto.randomUUID();
        return rpc(admin).rpc<SubmissionResult>("submit_public_site_form_v3", {
          ...sharedSubmission,
          requested_idempotency_token: concurrentAttempt,
          requested_submission_attempt_id: concurrentAttempt,
          requested_answers: {
            subject: name,
            name,
            email: concurrentEmail,
          },
          requested_request_hash: `${index + 3}`.repeat(64),
        });
      }),
    );
    expect(
      concurrent.every((result) => result.error === null && result.data?.ok),
    ).toBe(true);
    const [concurrentCustomers] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${customerBusiness.id}
        and object_definition_id = ${customerObject.id}
        and lower(data_json ->> 'email') = ${concurrentEmail}
    `;
    expect(concurrentCustomers?.count).toBe(1);
  });

  it("publishes a frozen preorder offer, validates required Customer fields, and enforces capacity", async () => {
    const preorderBusiness = await createFixtureBusiness("Sites C3 preorder");
    const locationState = await callRpc<
      Array<{
        business_timezone: string;
        location_state_digest: string;
      }>
    >(owner.client, "get_location_creation_state", {
      expected_business_id: preorderBusiness.id,
      expected_actor_id: owner.user.id,
    });
    const currentLocationState = locationState[0];
    if (!currentLocationState) {
      throw new Error("Preorder Location creation state is empty.");
    }
    const location = await callRpc<Location>(owner.client, "create_location", {
      expected_business_id: preorderBusiness.id,
      expected_actor_id: owner.user.id,
      expected_business_timezone: currentLocationState.business_timezone,
      expected_location_state_digest:
        currentLocationState.location_state_digest,
      location_name: "C3 Collection",
      requested_timezone: "Europe/London",
    });

    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: preorderBusiness.id,
      actorId: owner.user.id,
    });
    const currentness = await configuration.getProposalCurrentness();
    await applyFixtureConfiguration(
      preorderBusiness,
      composeInitialPreorderOperations({
        ...currentness,
        locationIds: [location.id],
        schedule: {
          days_of_week: [1, 2, 3, 4, 5, 6, 7],
          start_time: "09:00",
          end_time: "17:00",
          slot_interval_minutes: 60,
          slot_capacity: 1,
          cutoff_hours: 0,
          booking_horizon_days: 30,
        },
      }),
      "Create C3 preorder fixture",
    );

    const [productObject] = await sql<{ id: string }[]>`
      select id
      from public.object_definitions
      where business_id = ${preorderBusiness.id} and key = 'product'
    `;
    if (!productObject) throw new Error("Preorder Product Object is missing.");
    const product = await callRpc<{ id: string }>(
      owner.client,
      "create_graph_record",
      {
        expected_business_id: preorderBusiness.id,
        target_object_definition_id: productObject.id,
        requested_data: {
          name: "C3 Lunch Box",
          description: "Frozen for this Site release.",
          price: 12,
          status: "Active",
        },
      },
    );
    await callRpc(owner.client, "create_record_location_link", {
      expected_business_id: preorderBusiness.id,
      target_record_id: product.id,
      target_location_id: location.id,
    });

    const draft = siteDraftV1Schema.parse({
      schema_version: 1,
      branding: { name: "C3 preorder Site", accent: "ocean" },
      pages: [
        {
          id: crypto.randomUUID(),
          title: "Order ahead",
          slug: "preorder",
          navigation_label: "Order ahead",
          is_home: true,
          is_in_navigation: true,
          is_included: true,
          layout: {
            blocks: [
              {
                type: "heading",
                id: crypto.randomUUID(),
                text: "Order ahead",
                level: 1,
              },
              {
                type: "preorder",
                id: crypto.randomUUID(),
                preorder_key: "preorder",
              },
            ],
          },
        },
      ],
    });
    const site = await createFixtureSite(preorderBusiness, draft);
    const prepare = await callRpc<PreparedRelease>(
      owner.client,
      "prepare_site_release_v4",
      {
        expected_business_id: preorderBusiness.id,
        expected_actor_id: owner.user.id,
        requested_site_id: site.id,
        ...releaseCurrentness(site),
      },
    );
    expect(prepare).toMatchObject({
      status: "prepared",
      projection_schema_version: 4,
    });
    const published = await callRpc<PreparedRelease>(
      owner.client,
      "publish_site_release_v4",
      {
        expected_business_id: preorderBusiness.id,
        expected_actor_id: owner.user.id,
        requested_site_id: site.id,
        requested_candidate_id: prepare.id,
        ...releaseCurrentness(site),
      },
    );
    const [action] = await sql<
      {
        action_key: string;
        release_token: string;
        offer_json: { products: Array<Record<string, unknown>> };
      }[]
    >`
      select action_key, release_token, offer_json
      from public.site_release_actions_v4
      where business_id = ${preorderBusiness.id}
        and release_id = ${published.id}
        and action_kind = 'preorder'
    `;
    if (!action) throw new Error("Preorder action was not indexed.");
    expect(action.offer_json.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: product.id,
          name: "C3 Lunch Box",
          price: 12,
        }),
      ]),
    );

    const resolved = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_site_operational_action_v4",
      {
        requested_business_slug: preorderBusiness.slug,
        requested_page_slug: "preorder",
        requested_action_key: action.action_key,
        requested_release_token: action.release_token,
      },
    );
    expect(resolved).toMatchObject({
      kind: "preorder",
      action_key: action.action_key,
      release_token: action.release_token,
      catalogue: {
        products: expect.arrayContaining([
          expect.objectContaining({ id: product.id, price: 12 }),
        ]),
      },
    });

    const slotDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    slotDate.setUTCHours(11, 0, 0, 0);
    const slot = slotDate.toISOString();
    const missingCustomerToken = crypto.randomUUID();
    const missingCustomer = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_preorder_v4",
      {
        requested_business_slug: preorderBusiness.slug,
        requested_page_slug: "preorder",
        requested_action_key: action.action_key,
        requested_release_token: action.release_token,
        requested_idempotency_token: missingCustomerToken,
        submission: {
          idempotency_token: missingCustomerToken,
          location_id: location.id,
          collection_at: slot,
          items: [{ product_id: product.id, quantity: 1 }],
          fields: {
            customer: { email: "missing-name@example.test" },
            order: {},
          },
          website: "",
        },
        requested_request_hash: "4".repeat(64),
      },
    );
    expect(missingCustomer).toMatchObject({
      ok: false,
      code: "required_field",
    });

    const idempotencyToken = crypto.randomUUID();
    const submission = {
      idempotency_token: idempotencyToken,
      location_id: location.id,
      collection_at: slot,
      items: [{ product_id: product.id, quantity: 1 }],
      fields: {
        customer: { name: "C3 visitor", email: "c3@example.test" },
        order: {},
      },
      website: "",
    };
    const productUpdate = await owner.client.rpc("update_graph_record", {
      expected_business_id: preorderBusiness.id,
      target_record_id: product.id,
      data_patch: { name: "Renamed live product", price: 99 },
    });
    expect(productUpdate.error).toBeNull();
    const submitted = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_preorder_v4",
      {
        requested_business_slug: preorderBusiness.slug,
        requested_page_slug: "preorder",
        requested_action_key: action.action_key,
        requested_release_token: action.release_token,
        requested_idempotency_token: idempotencyToken,
        submission,
        requested_request_hash: "5".repeat(64),
      },
    );
    expect(submitted).toMatchObject({ ok: true, idempotent: false });
    expect(submitted.confirmation).toMatchObject({ total: 12 });

    const [orderCount] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${preorderBusiness.id}
        and object_definition_id = (
          select order_object_definition_id
          from public.preorder_experiences
          where business_id = ${preorderBusiness.id} and key = 'preorder'
        )
    `;
    expect(orderCount?.count).toBe(1);

    const secondSubmission = {
      ...submission,
      idempotency_token: crypto.randomUUID(),
      fields: {
        customer: { name: "Second visitor", email: "second@example.test" },
        order: {},
      },
    };
    const soldOut = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_preorder_v4",
      {
        requested_business_slug: preorderBusiness.slug,
        requested_page_slug: "preorder",
        requested_action_key: action.action_key,
        requested_release_token: action.release_token,
        requested_idempotency_token: secondSubmission.idempotency_token,
        submission: secondSubmission,
        requested_request_hash: "6".repeat(64),
      },
    );
    expect(soldOut).toMatchObject({ ok: false, code: "sold_out" });
  });
});
