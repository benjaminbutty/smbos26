import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { siteDraftV1Schema } from "../src/core/sites/schemas";
import type { Database, Tables } from "../src/db/supabase/database.types";
import {
  getC1LocalSupabaseSettings,
  type C1LocalSupabaseSettings,
} from "./support/c1-local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type Identity = { client: Client; user: User };
type SiteState = {
  id: string;
  draft_json: Record<string, unknown>;
  draft_revision: number;
  draft_base_version_id: string;
  draft_base_head_revision: number;
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

async function readSiteState(): Promise<SiteState> {
  const rows = await sql<SiteState[]>`
    select id, draft_json, draft_revision, draft_base_version_id,
      draft_base_head_revision
    from public.site_states
    where business_id = ${business.id} and id = ${siteId}
  `;
  const state = rows[0];
  if (!state) throw new Error("Forms fixture Site state was not found.");
  return state;
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
  try {
    if (sql && createdBusinessIds.length > 0) {
      await sql.unsafe(
        "delete from public.site_states where business_id = any($1::uuid[])",
        [createdBusinessIds],
      );
      const deleted = await admin
        .from("businesses")
        .delete()
        .in("id", createdBusinessIds);
      if (deleted.error) throw deleted.error;
    }
    for (const userId of createdUserIds) {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) throw deleted.error;
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
});
