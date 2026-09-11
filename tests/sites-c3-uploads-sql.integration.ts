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
  draft_revision: number;
  draft_base_version_id: string;
  draft_base_head_revision: number;
};
type PreparedRelease = { id: string; status: string };
type RpcResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};
type RpcClient = {
  rpc<T>(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<RpcResult<T>>;
};
type UploadAction = {
  action_key: string;
  release_token: string;
  release_id: string;
  form_id: string;
  question_key: string;
  field_key: string;
  object_definition_id: string;
  field_definition_id: string;
  upload_kind: "image" | "pdf";
  max_files: number;
};
type UploadGrant = {
  id: string;
  state: string;
  question_key: string;
  file_ordinal: number;
  reserved_bytes: number;
};

let settings: C1LocalSupabaseSettings;
let sql: Sql;
let admin: Client;
let anonymous: Client;
let owner: Identity;
let business: Business;
let otherBusiness: Business;
let siteId: string;
let uploadAction: UploadAction;

const createdBusinessIds: string[] = [];
const createdUserIds: string[] = [];
const password = "Sites-C3-uploads-integration-password!";

function rpc(client: Client): RpcClient {
  return client as unknown as RpcClient;
}

async function createOwner(): Promise<Identity> {
  const email = `sites-c3-uploads-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw (
      created.error ?? new Error("Could not create the upload fixture user.")
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
      signedIn.error ?? new Error("Could not sign in the upload fixture user.")
    );
  }
  return { client, user: signedIn.data.user };
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

async function expectDenied(
  client: Client,
  name: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const result = await rpc(client).rpc<unknown>(name, parameters);
  expect(result.data).toBeNull();
  expect(result.error).toBeTruthy();
}

async function readSiteState(): Promise<SiteState> {
  const rows = await sql<SiteState[]>`
    select id, draft_revision, draft_base_version_id, draft_base_head_revision
    from public.site_states
    where business_id = ${business.id} and id = ${siteId}
  `;
  const state = rows[0];
  if (!state) throw new Error("The upload fixture Site state was not found.");
  return state;
}

function issueParameters(
  attemptId: string,
  clientSubjectHash: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requested_business_slug: business.slug,
    requested_page_slug: "contact",
    requested_release_token: uploadAction.release_token,
    requested_business_id: business.id,
    requested_form_id: uploadAction.form_id,
    requested_release_id: uploadAction.release_id,
    requested_action_key: uploadAction.action_key,
    requested_submission_attempt_id: attemptId,
    requested_attempt_expires_at: new Date(
      Date.now() + 2 * 60 * 60 * 1000 + 14 * 60 * 1000,
    ).toISOString(),
    requested_client_subject_hash: clientSubjectHash,
    requested_questions: [
      {
        questionKey: uploadAction.question_key,
        fieldKey: uploadAction.field_key,
        objectDefinitionId: uploadAction.object_definition_id,
        fieldDefinitionId: uploadAction.field_definition_id,
        uploadKind: uploadAction.upload_kind,
        maxFiles: uploadAction.max_files,
      },
    ],
    requested_files: [{ question_key: uploadAction.question_key, count: 1 }],
    ...overrides,
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
    business_name: `Sites C3 Uploads ${crypto.randomUUID()}`,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  createdBusinessIds.push(business.id);
  otherBusiness = await callRpc<Business>(owner.client, "create_business", {
    business_name: `Sites C3 Other Uploads ${crypto.randomUUID()}`,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  createdBusinessIds.push(otherBusiness.id);

  const pageId = crypto.randomUUID();
  const formBlockId = crypto.randomUUID();
  const formId = crypto.randomUUID();
  const fileQuestionId = crypto.randomUUID();
  const draft = siteDraftV1Schema.parse({
    schema_version: 1,
    branding: { name: "Uploads integration", accent: "forest" },
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
            id: fileQuestionId,
            key: "documents",
            field_mode: "new",
            label: "Documents",
            field_type: "file",
            required: false,
            upload_kind: "pdf",
            upload_count: 2,
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
  const prepare = await callRpc<PreparedRelease>(
    owner.client,
    "prepare_site_release_v3",
    {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_site_id: siteId,
      expected_draft_revision: createdState.draft_revision,
      expected_base_version_id: createdState.draft_base_version_id,
      expected_head_revision: createdState.draft_base_head_revision,
    },
  );
  const published = await callRpc<PreparedRelease>(
    owner.client,
    "publish_site_release_v3",
    {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_site_id: siteId,
      requested_candidate_id: prepare.id,
      expected_draft_revision: createdState.draft_revision,
      expected_base_version_id: createdState.draft_base_version_id,
      expected_head_revision: createdState.draft_base_head_revision,
    },
  );
  const actions = await sql<UploadAction[]>`
    select
      action.action_key,
      action.release_token,
      action.release_id,
      action.form_id,
      binding.value ->> 'question_key' as question_key,
      binding.value ->> 'field_key' as field_key,
      binding.value ->> 'object_id' as object_definition_id,
      binding.value ->> 'field_id' as field_definition_id,
      binding.value ->> 'upload_kind' as upload_kind,
      (binding.value ->> 'upload_count')::integer as max_files
    from public.site_release_actions_v3 as action
    cross join lateral jsonb_array_elements(action.field_bindings_json)
      as binding(value)
    where action.business_id = ${business.id}
      and action.release_id = ${published.id}
      and binding.value ->> 'field_type' = 'file'
  `;
  uploadAction = actions[0]!;
  if (!uploadAction) throw new Error("The upload action was not indexed.");
  await readSiteState();
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

describe("Sites C3 private upload SQL boundary", () => {
  it("replays one exact manifest, preserves its reservation, and rejects public callers", async () => {
    const attemptId = crypto.randomUUID();
    const subjectHash = "a".repeat(64);
    const parameters = issueParameters(attemptId, subjectHash);
    const first = await callRpc<UploadGrant[]>(
      admin,
      "issue_site_public_upload_grants_v1",
      parameters,
    );
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      question_key: uploadAction.question_key,
      file_ordinal: 1,
      state: "reserved",
      reserved_bytes: 10 * 1024 * 1024,
    });

    const replay = await callRpc<UploadGrant[]>(
      admin,
      "issue_site_public_upload_grants_v1",
      parameters,
    );
    expect(replay.map((grant) => grant.id)).toEqual(
      first.map((grant) => grant.id),
    );
    const [reservation] = await sql<
      { grant_count: number; reserved_bytes: number }[]
    >`
      select count(*)::integer as grant_count,
        coalesce(sum(reserved_bytes), 0)::integer as reserved_bytes
      from public.site_public_upload_grants
      where business_id = ${business.id}
        and submission_attempt_id = ${attemptId}
    `;
    expect(reservation).toEqual({
      grant_count: 1,
      reserved_bytes: 10 * 1024 * 1024,
    });

    const changedManifest = await rpc(admin).rpc<unknown>(
      "issue_site_public_upload_grants_v1",
      {
        ...parameters,
        requested_files: [
          { question_key: uploadAction.question_key, count: 2 },
        ],
      },
    );
    expect(changedManifest.data).toBeNull();
    expect(changedManifest.error?.message).toContain(
      "site_upload_attempt_binding_invalid",
    );

    const changedSubject = await rpc(admin).rpc<unknown>(
      "issue_site_public_upload_grants_v1",
      issueParameters(attemptId, "b".repeat(64)),
    );
    expect(changedSubject.data).toBeNull();
    expect(changedSubject.error?.message).toContain(
      "site_upload_attempt_binding_invalid",
    );

    const crossTenant = await rpc(admin).rpc<unknown>(
      "issue_site_public_upload_grants_v1",
      issueParameters(crypto.randomUUID(), subjectHash, {
        requested_business_id: otherBusiness.id,
      }),
    );
    expect(crossTenant.data).toBeNull();
    expect(crossTenant.error?.message).toContain(
      "site_upload_action_context_mismatch",
    );

    const finalizationParameters = {
      requested_business_slug: business.slug,
      requested_page_slug: "contact",
      requested_release_token: uploadAction.release_token,
      requested_grant_id: first[0]!.id,
      requested_submission_attempt_id: attemptId,
      requested_business_id: business.id,
      requested_release_id: uploadAction.release_id,
      requested_form_id: uploadAction.form_id,
      requested_action_key: uploadAction.action_key,
      requested_claim_token: crypto.randomUUID(),
    };
    const mismatchedAttempt = await rpc(admin).rpc<unknown>(
      "claim_site_public_upload_finalization_v1",
      {
        ...finalizationParameters,
        requested_submission_attempt_id: crypto.randomUUID(),
      },
    );
    expect(mismatchedAttempt.data).toBeNull();
    expect(mismatchedAttempt.error?.message).toContain(
      "site_upload_attempt_binding_invalid",
    );

    await expectDenied(
      anonymous,
      "issue_site_public_upload_grants_v1",
      parameters,
    );
    await expectDenied(
      owner.client,
      "issue_site_public_upload_grants_v1",
      parameters,
    );
    await expectDenied(
      anonymous,
      "claim_site_public_upload_finalization_v1",
      finalizationParameters,
    );
    await expectDenied(
      owner.client,
      "claim_site_public_upload_finalization_v1",
      finalizationParameters,
    );

    const [privileges] = await sql<
      {
        anon_issue: boolean;
        authenticated_issue: boolean;
        service_issue: boolean;
        anon_finalize: boolean;
        authenticated_finalize: boolean;
        service_finalize: boolean;
      }[]
    >`
      select
        has_function_privilege(
          'anon',
          'public.issue_site_public_upload_grants_v1(text,text,text,uuid,uuid,uuid,text,uuid,timestamptz,text,jsonb,jsonb)',
          'execute'
        ) as anon_issue,
        has_function_privilege(
          'authenticated',
          'public.issue_site_public_upload_grants_v1(text,text,text,uuid,uuid,uuid,text,uuid,timestamptz,text,jsonb,jsonb)',
          'execute'
        ) as authenticated_issue,
        has_function_privilege(
          'service_role',
          'public.issue_site_public_upload_grants_v1(text,text,text,uuid,uuid,uuid,text,uuid,timestamptz,text,jsonb,jsonb)',
          'execute'
        ) as service_issue,
        has_function_privilege(
          'anon',
          'public.claim_site_public_upload_finalization_v1(text,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid)',
          'execute'
        ) as anon_finalize,
        has_function_privilege(
          'authenticated',
          'public.claim_site_public_upload_finalization_v1(text,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid)',
          'execute'
        ) as authenticated_finalize,
        has_function_privilege(
          'service_role',
          'public.claim_site_public_upload_finalization_v1(text,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid)',
          'execute'
        ) as service_finalize
    `;
    expect(privileges).toEqual({
      anon_issue: false,
      authenticated_issue: false,
      service_issue: true,
      anon_finalize: false,
      authenticated_finalize: false,
      service_finalize: true,
    });
  });
});
