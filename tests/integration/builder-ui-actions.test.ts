import { execFileSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";

const actionHarness = vi.hoisted(() => ({
  clients: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("../../src/db/supabase/server", () => ({
  createServerClient: async () => {
    const client = actionHarness.clients.shift();
    if (!client) {
      throw new Error("No authenticated action client was queued.");
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

import { createBuilderAction } from "../../src/app/app/[businessSlug]/builder/action-service";
import { runBuilderAction } from "../../src/app/app/[businessSlug]/builder/actions";
import { prepareBuilderUndoAction } from "../../src/app/app/[businessSlug]/builder/undo-actions";
import BuilderPage from "../../src/app/app/[businessSlug]/builder/page";
import ConfigurationChangeRoute from "../../src/app/app/[businessSlug]/changes/[changeSetId]/page";
import { BUILDER_UNSUPPORTED_MESSAGES } from "../../src/ai/builder/contracts";
import { createLocationConfirmationTokenService } from "../../src/ai/builder/location-confirmation-token";
import { AiExecutionError } from "../../src/ai/errors";
import { BUILDER_INITIAL_STATE } from "../../src/components/builder-ui-state";
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import { configurationSnapshotV1Schema } from "../../src/core/configuration/definition-source";
import {
  configurationOperationsSchema,
  semanticDiffSchema,
  setFieldOperationSchema,
  setPreorderExperienceOperationSchema,
} from "../../src/core/configuration/schemas";
import {
  composePreorderAmendmentBatch,
  composePreorderQuestionAmendment,
  composePreorderScheduleAmendment,
  getPreorderQuestionsSetup,
  listPreorderScheduleSetups,
  loadActiveManualAmendmentSnapshot,
} from "../../src/core/configuration/manual-amendments/service";
import {
  resolveConfigurationPreviewPreorder,
  resolvePublicPreorder,
} from "../../src/core/preorder/service";
import {
  createDeterministicBuilder,
  locationIntentOutput,
  preorderAmendmentDraft,
  preorderAmendmentDraftForRequest,
  preorderReadyPlan,
  providerUnavailableError,
  smallClarificationOutput,
  smallDraft,
  smallReadyPlan,
} from "./support/builder-ui-fixtures";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };
type Business = Tables<"businesses">;

const password = "Milestone-8-builder-ui-action-test!";
const createdUserIds: string[] = [];

let settings: LocalSupabaseSettings;
let database: Sql;
let serviceRole: Client;
let anonymous: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let outsider: Identity;
let business: Business;
let outsiderBusiness: Business;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

async function signIn(
  email: string,
  selectedPassword = "Local-demo-2026!",
): Promise<Identity> {
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
    throw signedIn.error ?? new Error(`Could not sign in ${email}.`);
  }
  return { client, user: signedIn.data.user };
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `m8-builder-ui-${label}-${crypto.randomUUID()}@example.test`;
  const created = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
  createdUserIds.push(created.data.user.id);
  return signIn(email, password);
}

function queueActionClient(client: Client): void {
  actionHarness.clients = [client];
}

function formWithRequest(request: string, forged = false): FormData {
  const form = new FormData();
  form.set("ownerRequest", request);
  if (forged) {
    form.set("businessId", "00000000-0000-4000-8000-000000000001");
    form.set("actorId", "00000000-0000-4000-8000-000000000002");
    form.set("plan", "forged-plan");
    form.set("draft", "forged-draft");
    form.set("proposalId", "forged-proposal");
    form.set("operation", "forged-operation");
  }
  return form;
}

function forgedUndoForm(): FormData {
  const form = new FormData();
  for (const [key, value] of [
    ["targetVersionId", "00000000-0000-4000-8000-000000000001"],
    ["parentVersionId", "00000000-0000-4000-8000-000000000002"],
    ["businessId", "00000000-0000-4000-8000-000000000003"],
    ["actorId", "00000000-0000-4000-8000-000000000004"],
    ["expectedHeadRevision", "999"],
    ["title", "Forged title"],
    ["description", "Forged description"],
    ["kind", "change"],
    ["status", "applied"],
  ] as const) {
    form.set(key, value);
  }
  return form;
}

async function expectNotFound(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toMatchObject({ name: "ActionNotFound" });
}

async function renderContextualBuilder(
  identity: Identity | Client,
  sourceVersionId: string,
  queryOverride?: { undoVersion?: string | string[] },
): Promise<string> {
  queueActionClient("client" in identity ? identity.client : identity);
  const page = await BuilderPage({
    params: Promise.resolve({ businessSlug: business.slug }),
    searchParams: Promise.resolve(
      queryOverride ?? { undoVersion: sourceVersionId },
    ),
  });
  return renderToStaticMarkup(page);
}

async function enableAi(
  options: { requestLimit?: number } = {},
): Promise<void> {
  const updated = await owner.client.rpc("update_business_ai_settings", {
    expected_business_id: business.id,
    expected_actor_id: owner.user.id,
    requested_is_enabled: true,
    requested_daily_request_limit: options.requestLimit ?? 25,
    requested_daily_input_token_limit: 1_000_000,
    requested_daily_output_token_limit: 1_000_000,
    requested_daily_cost_limit_microusd: 100_000_000,
  });
  if (updated.error) {
    throw updated.error;
  }
}

async function executionRows(): Promise<Record<string, unknown>[]> {
  return database<Record<string, unknown>[]>`
    select *
    from public.ai_execution_runs
    where business_id = ${business.id}::uuid
    order by reserved_at, id
  `;
}

async function proposalRows(): Promise<Record<string, unknown>[]> {
  return database<Record<string, unknown>[]>`
    select *
    from public.configuration_change_sets
    where business_id = ${business.id}::uuid
    order by created_at, id
  `;
}

async function tenantRows(tableName: string): Promise<Json[]> {
  const rows = await database<{ row: Json }[]>`
    select to_jsonb(tenant_row) as row
    from ${database(tableName)} as tenant_row
    where tenant_row.business_id = ${business.id}::uuid
    order by to_jsonb(tenant_row)::text
  `;
  return rows.map(({ row }) => row);
}

async function liveState() {
  const [head, versions, records, edges, locations, snapshot] =
    await Promise.all([
      serviceRole
        .from("business_configuration_heads")
        .select("*")
        .eq("business_id", business.id)
        .single(),
      serviceRole
        .from("configuration_versions")
        .select("id", { count: "exact" })
        .eq("business_id", business.id),
      serviceRole
        .from("records")
        .select("id", { count: "exact" })
        .eq("business_id", business.id),
      serviceRole
        .from("record_relationships")
        .select("id", { count: "exact" })
        .eq("business_id", business.id),
      serviceRole.from("locations").select("*").eq("business_id", business.id),
      database<{ snapshot: Json }[]>`
        select private.configuration_snapshot_v1(${business.id}::uuid) as snapshot
      `,
    ]);
  if (
    head.error ||
    !head.data ||
    versions.error ||
    records.error ||
    edges.error ||
    locations.error
  ) {
    throw new Error("Could not read live Business state.");
  }
  const [
    recordRows,
    relationshipRows,
    recordLocationRows,
    submissions,
    slotCounters,
    rateLimits,
    emailStates,
  ] = await Promise.all([
    tenantRows("records"),
    tenantRows("record_relationships"),
    tenantRows("record_location_links"),
    tenantRows("preorder_submissions"),
    tenantRows("preorder_slot_counters"),
    tenantRows("preorder_rate_limits"),
    database<
      {
        id: string;
        email_status: string;
        email_error: string | null;
        email_attempted_at: string | null;
      }[]
    >`
        select id, email_status, email_error, email_attempted_at
        from public.preorder_submissions
        where business_id = ${business.id}::uuid
        order by id
      `,
  ]);
  return {
    head: head.data,
    versionCount: versions.count,
    recordCount: records.count,
    edgeCount: edges.count,
    locations: locations.data,
    snapshot: snapshot[0]?.snapshot,
    recordRows,
    relationshipRows,
    recordLocationRows,
    submissions,
    slotCounters,
    rateLimits,
    emailStates,
  };
}

function expectOperationalStateUnchanged(
  before: Awaited<ReturnType<typeof liveState>>,
  after: Awaited<ReturnType<typeof liveState>>,
): void {
  expect(after.recordRows).toEqual(before.recordRows);
  expect(after.relationshipRows).toEqual(before.relationshipRows);
  expect(after.recordLocationRows).toEqual(before.recordLocationRows);
  expect(after.locations).toEqual(before.locations);
  expect(after.submissions).toEqual(before.submissions);
  expect(after.slotCounters).toEqual(before.slotCounters);
  expect(after.rateLimits).toEqual(before.rateLimits);
  expect(after.emailStates).toEqual(before.emailStates);
}

function createRpcRaceClient(hook: () => Promise<void>): Client {
  const base = owner.client;
  return new Proxy(base, {
    get(target, property) {
      if (property === "rpc") {
        return async (functionName: string, args: Record<string, unknown>) => {
          if (functionName === "prepare_configuration_rollback") {
            await hook();
          }
          return target.rpc(functionName as never, args as never);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Client;
}

async function applyOrdinaryCutoffChange(cutoffHours: number) {
  const configuration = new ConfigurationChangeService(owner.client, {
    businessId: business.id,
    actorId: owner.user.id,
  });
  const active = await loadActiveManualAmendmentSnapshot(configuration);
  const preorder = active.snapshot.preorder_experiences.find(
    ({ key, is_active }) => key === "bakery_preorder" && is_active,
  );
  if (!preorder) {
    throw new Error("The Bedford preorder fixture is incomplete.");
  }
  const amendment = composePreorderScheduleAmendment(active.snapshot, {
    intent: "update_preorder_schedule",
    preorderKey: preorder.key,
    schedule: { ...preorder.config_json.schedule, cutoff_hours: cutoffHours },
  });
  const proposal = await configuration.proposeChangeSet({
    expectedBaseVersionId: active.baseVersionId,
    expectedHeadRevision: active.headRevision,
    title: amendment.title,
    description: amendment.description,
    operations: [amendment.operation],
  });
  expect((await configuration.validateChangeSet(proposal.id)).status).toBe(
    "validated",
  );
  const applied = await configuration.applyChangeSet(proposal.id);
  expect(applied.status).toBe("applied");
  return applied;
}

async function preparePhase9AcceptanceFixture(): Promise<void> {
  const configuration = new ConfigurationChangeService(owner.client, {
    businessId: business.id,
    actorId: owner.user.id,
  });
  const active = await loadActiveManualAmendmentSnapshot(configuration);
  const preorder = active.snapshot.preorder_experiences.find(
    ({ key, is_active }) => key === "bakery_preorder" && is_active,
  );
  const phoneField = active.snapshot.field_definitions.find(
    (field) => field.object_key === "customer" && field.key === "phone",
  );
  const occasionField = active.snapshot.field_definitions.find(
    (field) => field.object_key === "order" && field.key === "occasion",
  );
  const phoneQuestion = preorder?.config_json.public_fields.find(
    (field) => field.target === "customer" && field.field === "phone",
  );
  if (!preorder || !phoneField || !occasionField || !phoneQuestion) {
    throw new Error("The Phase 9A acceptance fixture is incomplete.");
  }
  const phonePreorder = composePreorderQuestionAmendment(active.snapshot, {
    intent: "update_preorder_question",
    preorderKey: preorder.key,
    target: "customer",
    fieldKey: "phone",
    label: phoneQuestion.label,
    helpText: phoneQuestion.help_text ?? null,
    required: true,
  });
  const preorderOperation = phonePreorder.operations.find(
    (operation) => operation.op === "set_preorder_experience",
  );
  if (
    !preorderOperation ||
    preorderOperation.op !== "set_preorder_experience"
  ) {
    throw new Error("Could not compose the Phase 9A fixture preorder.");
  }
  const trimmedPublicFields =
    preorderOperation.config_json.public_fields.filter(
      (field) => field.field !== "occasion",
    );
  const operations = configurationOperationsSchema.parse([
    setFieldOperationSchema.parse({
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
    }),
    setPreorderExperienceOperationSchema.parse({
      ...preorderOperation,
      config_json: {
        ...preorderOperation.config_json,
        public_fields: trimmedPublicFields,
      },
    }),
  ]);
  const setup = await configuration.proposeChangeSet({
    expectedBaseVersionId: active.baseVersionId,
    expectedHeadRevision: active.headRevision,
    title: "Phase 9A acceptance fixture setup",
    description:
      "Prepare the existing preorder for Builder amendment coverage.",
    operations,
  });
  expect((await configuration.validateChangeSet(setup.id)).status).toBe(
    "validated",
  );
  expect((await configuration.applyChangeSet(setup.id)).status).toBe("applied");
}

async function runRealAction(
  service: ReturnType<typeof createDeterministicBuilder>["service"],
  identity: Identity = owner,
  request = "Prepare this bounded configuration request.",
  forged = false,
) {
  queueActionClient(identity.client);
  return createBuilderAction({ orchestrationService: service })(
    business.slug,
    BUILDER_INITIAL_STATE,
    formWithRequest(request, forged),
  );
}

describe("Milestone 8 Phase 8C real Builder action boundary", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    process.env.NEXT_PUBLIC_SUPABASE_URL = settings.apiUrl;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = settings.publishableKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = settings.serviceRoleKey;
    execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
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
    database = postgres(settings.databaseUrl, { max: 4 });

    owner = await signIn("demo@smbos.local");
    staff = await signIn("staff@smbos.local");
    administrator = await createIdentity("admin");
    outsider = await createIdentity("outsider");
    business = requireData(
      await owner.client
        .from("businesses")
        .select("*")
        .eq("slug", "bedford-bakery-demo")
        .single(),
      "Could not load Bedford Bakery.",
    );
    const membership = await serviceRole.from("business_memberships").insert({
      business_id: business.id,
      user_id: administrator.user.id,
      role: "admin",
    });
    if (membership.error) {
      throw membership.error;
    }
    outsiderBusiness = requireData(
      await outsider.client.rpc("create_business", {
        business_name: `Other Bakery ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create the cross-Business fixture.",
    );
  }, 180_000);

  beforeEach(async () => {
    actionHarness.clients = [];
    await database`
      delete from public.ai_execution_runs
      where business_id = ${business.id}::uuid
    `;
    await database`
      update public.business_ai_settings
      set is_enabled = false, updated_by = null
      where business_id = ${business.id}::uuid
    `;
  });

  afterAll(async () => {
    if (database) {
      if (outsiderBusiness) {
        await database`
          delete from public.businesses
          where id = ${outsiderBusiness.id}::uuid
        `;
      }
      await database`
        delete from public.business_memberships
        where user_id in ${database(createdUserIds)}
      `;
      await database.end();
    }
    if (serviceRole) {
      for (const userId of createdUserIds) {
        await serviceRole.auth.admin.deleteUser(userId);
      }
    }
  });

  it("runs real planning once for clarification and exposes only UI fields", async () => {
    await enableAi();
    const proposalsBefore = await proposalRows();
    const before = await liveState();
    const deterministic = createDeterministicBuilder(
      smallClarificationOutput(),
    );
    const result = await runRealAction(
      deterministic.service,
      owner,
      "  Clarify the equipment request BUILDER_ACTION_RAW_MARKER.  ",
      true,
    );

    expect(result).toMatchObject({
      state: "needs_clarification",
      understanding: "A bounded clarification is needed.",
      questions: [
        {
          response_style: "free_text",
          options: [],
        },
      ],
    });
    expect(result).not.toHaveProperty("questions.0.reference");
    expect(result).not.toHaveProperty("assumptions.0.reference");
    expect(result).not.toHaveProperty("assumptions.0.impact");
    expect(result).not.toHaveProperty("unsupported_requirements.0.reference");
    expect(result).not.toHaveProperty("unsupported_requirements.0.reason_code");
    expect(JSON.stringify(result)).not.toContain("BUILDER_ACTION_RAW_MARKER");

    expect(deterministic.calls).toHaveLength(1);
    expect(deterministic.calls[0]?.outputContract.name).toBe("builder_plan_v1");
    expect(deterministic.calls[0]?.input).toMatchObject({
      owner_request: "Clarify the equipment request BUILDER_ACTION_RAW_MARKER.",
    });
    const rows = await executionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "succeeded",
      task_key: "builder_plan_v1",
      policy_key: "builder_planning_terra_medium_v1",
      provider_key: "openai",
      model_key: "gpt-5.6-terra",
    });
    expect(
      rows.some((row) => row.task_key === "builder_configuration_draft_v1"),
    ).toBe(false);
    expect(await proposalRows()).toHaveLength(proposalsBefore.length);
    expect(await liveState()).toEqual(before);
    expect(JSON.stringify(rows)).not.toContain("BUILDER_ACTION_RAW_MARKER");
    expect(JSON.stringify(rows)).not.toContain("BUILDER_PROVIDER_MARKER");
  });

  it("settles one planning execution for operational and mixed unsupported requests", async () => {
    for (const kind of ["operational_update", "mixed"] as const) {
      await database`
        delete from public.ai_execution_runs
        where business_id = ${business.id}::uuid
      `;
      await enableAi();
      const proposalsBefore = await proposalRows();
      const before = await liveState();
      const deterministic = createDeterministicBuilder(smallReadyPlan(kind));
      const result = await runRealAction(deterministic.service, owner);

      expect(result).toEqual({
        state: "unsupported",
        message:
          kind === "operational_update"
            ? BUILDER_UNSUPPORTED_MESSAGES.operational_plan_unavailable
            : BUILDER_UNSUPPORTED_MESSAGES.mixed_plan_unavailable,
      });
      expect(deterministic.calls).toHaveLength(1);
      expect(await executionRows()).toHaveLength(1);
      expect(await proposalRows()).toHaveLength(proposalsBefore.length);
      expect(await liveState()).toEqual(before);
    }
  });

  it("prepares and confirms one Location without M5 or a second AI execution", async () => {
    await enableAi();
    const proposalsBefore = await proposalRows();
    const before = await liveState();
    const deterministic = createDeterministicBuilder(
      smallReadyPlan("operational"),
      smallDraft(),
      { locationIntentOutput: locationIntentOutput("Cambridge") },
    );
    const tokenService = createLocationConfirmationTokenService({
      secret: "location-confirmation-test-secret-0123456789",
      now: () => 1_000,
    });
    const action = createBuilderAction({
      orchestrationService: deterministic.service,
      createLocationConfirmationTokenService: () => tokenService,
    });

    queueActionClient(owner.client);
    const prepared = await action(
      business.slug,
      BUILDER_INITIAL_STATE,
      formWithRequest("Add Cambridge as a new Location.", true),
    );
    expect(prepared).toMatchObject({
      state: "location_confirmation",
      location_name: "Cambridge",
      timezone: "Europe/London",
      timezone_source: "business_timezone",
    });
    expect(prepared).toHaveProperty("confirmation_token");
    expect(await executionRows()).toHaveLength(2);
    expect(await proposalRows()).toHaveLength(proposalsBefore.length);
    expect((await liveState()).locations).toEqual(before.locations);
    expect(deterministic.calls.map((call) => call.outputContract.name)).toEqual(
      ["builder_plan_v1", "builder_location_creation_intent_v1"],
    );

    const confirmation = new FormData();
    confirmation.set(
      "confirmationToken",
      (prepared as { confirmation_token: string }).confirmation_token,
    );
    confirmation.set("businessId", "forged-business");
    confirmation.set("locationName", "forged-name");
    confirmation.set("timezone", "Mars/Olympus");
    queueActionClient(owner.client);
    const created = await action(business.slug, prepared, confirmation);

    expect(created).toEqual({
      state: "location_created",
      location_name: "Cambridge",
      timezone: "Europe/London",
      message: "The Location was added to your Business.",
    });
    expect(deterministic.calls).toHaveLength(2);
    expect(await executionRows()).toHaveLength(2);
    expect(await proposalRows()).toHaveLength(proposalsBefore.length);
    const after = await liveState();
    expect(after.head).toEqual(before.head);
    expect(after.versionCount).toBe(before.versionCount);
    expect(after.recordCount).toBe(before.recordCount);
    expect(after.edgeCount).toBe(before.edgeCount);
    expect(after.recordRows).toEqual(before.recordRows);
    expect(after.relationshipRows).toEqual(before.relationshipRows);
    expect(after.recordLocationRows).toEqual(before.recordLocationRows);
    expect(after.submissions).toEqual(before.submissions);
    expect(after.slotCounters).toEqual(before.slotCounters);
    expect(after.rateLimits).toEqual(before.rateLimits);
    expect(after.emailStates).toEqual(before.emailStates);
    expect(after.locations).toHaveLength(before.locations.length + 1);
    expect(after.locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          business_id: business.id,
          name: "Cambridge",
          slug: "cambridge",
          timezone: "Europe/London",
          is_active: true,
        }),
      ]),
    );
  });

  it("runs planning and drafting once for a small additive generic object proposal", async () => {
    await enableAi();
    const proposalsBefore = await proposalRows();
    const before = await liveState();
    const deterministic = createDeterministicBuilder(
      smallReadyPlan("configuration"),
      smallDraft(),
    );
    const result = await runRealAction(
      deterministic.service,
      owner,
      "Create an equipment information type BUILDER_PROPOSAL_RAW_MARKER.",
      true,
    );

    expect(result.state).toBe("proposed");
    expect(Object.keys(result).sort()).toEqual([
      "operation_count",
      "proposal_id",
      "state",
      "summary",
    ]);
    expect(result).not.toHaveProperty("base_version_id");
    expect(result).not.toHaveProperty("base_head_revision");
    expect(result).not.toHaveProperty("status");
    expect(JSON.stringify(result)).not.toContain("BUILDER_PROPOSAL_RAW_MARKER");

    expect(deterministic.calls).toHaveLength(2);
    expect(deterministic.calls.map((call) => call.outputContract.name)).toEqual(
      ["builder_plan_v1", "builder_configuration_draft_v1"],
    );
    const rows = await executionRows();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_key: "builder_plan_v1",
          policy_key: "builder_planning_terra_medium_v1",
          provider_key: "openai",
          model_key: "gpt-5.6-terra",
          status: "succeeded",
        }),
        expect.objectContaining({
          task_key: "builder_configuration_draft_v1",
          policy_key: "builder_configuration_drafting_terra_medium_v1",
          provider_key: "openai",
          model_key: "gpt-5.6-terra",
          status: "succeeded",
        }),
      ]),
    );
    const proposals = await proposalRows();
    expect(proposals).toHaveLength(proposalsBefore.length + 1);
    const proposal = proposals.at(-1)!;
    expect(proposal).toMatchObject({
      business_id: business.id,
      requested_by: owner.user.id,
      kind: "change",
      status: "proposed",
      base_head_revision: expect.stringMatching(/^\d+$/),
    });
    const operations = configurationOperationsSchema.parse(
      proposal.operations_json,
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]?.op).toBe("set_object");
    expect(await liveState()).toEqual(before);
    const durable = JSON.stringify({ rows, proposal });
    expect(durable).not.toContain("BUILDER_PROPOSAL_RAW_MARKER");
    expect(durable).not.toContain("BUILDER_PROVIDER_MARKER");
  });

  it("runs the Phase 9A combined preorder amendment through the real action boundary", async () => {
    await enableAi();
    const proposalsBefore = await proposalRows();
    const before = await liveState();
    const deterministic = createDeterministicBuilder(
      preorderReadyPlan(),
      smallDraft(),
      { amendmentOutput: preorderAmendmentDraft() },
    );
    const result = await runRealAction(
      deterministic.service,
      owner,
      "Remove Sunday collection and change the cutoff from 48 to 72 hours.",
      true,
    );

    expect(result).toMatchObject({
      state: "proposed",
      operation_count: 1,
    });
    expect(deterministic.calls).toHaveLength(2);
    expect(deterministic.calls.map((call) => call.outputContract.name)).toEqual(
      ["builder_plan_v1", "builder_preorder_amendment_v1"],
    );
    const rows = await executionRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_key: "builder_plan_v1",
          policy_key: "builder_planning_terra_medium_v1",
          status: "succeeded",
        }),
        expect.objectContaining({
          task_key: "builder_preorder_amendment_v1",
          policy_key: "builder_preorder_amendment_terra_medium_v1",
          status: "succeeded",
        }),
      ]),
    );
    const proposals = await proposalRows();
    expect(proposals).toHaveLength(proposalsBefore.length + 1);
    const proposal = proposals.at(-1)!;
    expect(proposal).toMatchObject({
      business_id: business.id,
      requested_by: owner.user.id,
      kind: "change",
      status: "proposed",
      title: "Proposed preorder changes",
      validated_at: null,
      applied_at: null,
    });
    expect(proposal.description).toContain("Sunday");
    expect(proposal.description).toContain("72");
    const operations = configurationOperationsSchema.parse(
      proposal.operations_json,
    );
    expect(operations).toHaveLength(1);
    const operation = operations[0]!;
    expect(operation).toMatchObject({
      op: "set_preorder_experience",
      key: "bakery_preorder",
      config_json: {
        schedule: {
          days_of_week: [6],
          cutoff_hours: 72,
          start_time: "11:00",
          end_time: "16:00",
          slot_interval_minutes: 30,
          slot_capacity: 10,
          booking_horizon_days: 90,
        },
      },
    });
    expect(await liveState()).toEqual(before);
    const durable = JSON.stringify({ rows, proposal });
    expect(durable).not.toContain(
      "Remove Sunday collection and change the cutoff",
    );
    expect(durable).not.toContain("BUILDER_PROVIDER_MARKER");
  });

  it("maps a drafting budget reservation rejection without invoking drafting", async () => {
    await enableAi({ requestLimit: 1 });
    const proposalsBefore = await proposalRows();
    const deterministic = createDeterministicBuilder(smallReadyPlan());
    const result = await runRealAction(deterministic.service);

    expect(result).toEqual({
      state: "unavailable",
      reason: "budget_reached",
      message: "This Business has reached its AI usage limit for today.",
    });
    expect(deterministic.calls).toHaveLength(1);
    expect(deterministic.calls[0]?.outputContract.name).toBe("builder_plan_v1");
    const rows = await executionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_key: "builder_plan_v1",
      status: "succeeded",
    });
    expect(await proposalRows()).toHaveLength(proposalsBefore.length);
  });

  it("keeps disabled AI on the safe path without accounting or proposal writes", async () => {
    const before = await liveState();
    const proposalsBefore = await proposalRows();
    const deterministic = createDeterministicBuilder(
      smallClarificationOutput(),
    );
    const result = await runRealAction(deterministic.service);

    expect(result).toEqual({
      state: "unavailable",
      reason: "ai_disabled",
      message: "Builder is not enabled for this Business.",
    });
    expect(deterministic.calls).toHaveLength(0);
    expect(await executionRows()).toHaveLength(0);
    expect(await proposalRows()).toHaveLength(proposalsBefore.length);
    expect(await liveState()).toEqual(before);
  });

  it("maps a deterministic provider-unavailable failure without retry or raw details", async () => {
    await enableAi();
    const proposalsBefore = await proposalRows();
    const deterministic = createDeterministicBuilder(
      smallClarificationOutput(),
      smallDraft(),
      {
        failure: {
          taskKey: "builder_plan_v1",
          error: providerUnavailableError(),
        },
      },
    );
    const result = await runRealAction(deterministic.service);

    expect(result).toEqual({
      state: "unavailable",
      reason: "temporarily_unavailable",
      message:
        "Builder is temporarily unavailable. Your live Business setup has not changed.",
    });
    expect(deterministic.calls).toHaveLength(1);
    const rows = await executionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_key: "builder_plan_v1",
      status: "failed",
      outcome_code: "ai_provider_unavailable",
      provider_invocation_started: true,
    });
    expect(await proposalRows()).toHaveLength(proposalsBefore.length);
    expect(JSON.stringify(result)).not.toContain(
      "deterministic provider unavailable",
    );
    expect(JSON.stringify(rows)).not.toContain(
      "deterministic provider unavailable",
    );
  });

  it("retains Owner/Admin access and controlled Staff, anonymous and non-member denial", async () => {
    const proposedResult = {
      schema_version: 1 as const,
      state: "proposed" as const,
      proposal_id: "10000000-0000-4000-8000-000000000011",
      status: "proposed" as const,
      base_version_id: "10000000-0000-4000-8000-000000000012",
      base_head_revision: 7,
      operation_count: 1,
      summary: "A bounded Builder proposal is ready for review.",
    };
    const orchestrationService = {
      run: vi.fn().mockResolvedValue(proposedResult),
    };
    const action = createBuilderAction({ orchestrationService });

    for (const identity of [owner, administrator]) {
      queueActionClient(identity.client);
      await expect(
        action(
          business.slug,
          BUILDER_INITIAL_STATE,
          formWithRequest("Prepare an enquiry form."),
        ),
      ).resolves.toMatchObject({ state: "proposed" });
    }
    for (const identity of [staff, outsider]) {
      queueActionClient(identity.client);
      await expectNotFound(
        action(
          business.slug,
          BUILDER_INITIAL_STATE,
          formWithRequest("Prepare an enquiry form."),
        ),
      );
    }
    queueActionClient(anonymous);
    await expectNotFound(
      action(
        business.slug,
        BUILDER_INITIAL_STATE,
        formWithRequest("Prepare an enquiry form."),
      ),
    );
    expect(orchestrationService.run).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid input and route slugs before the server boundary", async () => {
    const invalid = await runBuilderAction(
      business.slug,
      BUILDER_INITIAL_STATE,
      formWithRequest(" "),
    );
    expect(invalid).toEqual({
      state: "input_invalid",
      message:
        "Describe what you would like SMBOS to build in 4,000 characters or fewer.",
    });
    expect(actionHarness.clients).toHaveLength(0);

    queueActionClient(owner.client);
    await expectNotFound(
      runBuilderAction(
        "../other-business",
        BUILDER_INITIAL_STATE,
        formWithRequest("Prepare an enquiry form."),
      ),
    );
    expect(actionHarness.clients).toHaveLength(1);
  });

  it("maps an injected disabled execution error to the fixed UI state", async () => {
    const orchestrationService = {
      run: vi.fn().mockRejectedValue(new AiExecutionError("ai_disabled")),
    };
    queueActionClient(owner.client);
    await expect(
      createBuilderAction({ orchestrationService })(
        business.slug,
        BUILDER_INITIAL_STATE,
        formWithRequest("Prepare an enquiry form."),
      ),
    ).resolves.toEqual({
      state: "unavailable",
      reason: "ai_disabled",
      message: "Builder is not enabled for this Business.",
    });
  });

  it("prepares one server-derived forward undo proposal through the real action boundary", async () => {
    const before = await liveState();
    const proposalsBefore = await proposalRows();
    const sourceVersionId = before.head.active_version_id;
    const sourceVersion = requireData(
      await serviceRole
        .from("configuration_versions")
        .select("*")
        .eq("business_id", business.id)
        .eq("id", sourceVersionId)
        .single(),
      "Could not load the active source Version.",
    );

    queueActionClient(owner.client);
    await expect(
      prepareBuilderUndoAction(business.slug, sourceVersionId, new FormData()),
    ).rejects.toMatchObject({
      name: "ActionRedirect",
      message: expect.stringMatching(
        new RegExp(
          `/app/${business.slug}/changes/[0-9a-f-]+\\?notice=rollback_prepared`,
        ),
      ),
    });

    const proposals = await proposalRows();
    expect(proposals).toHaveLength(proposalsBefore.length + 1);
    const proposal = proposals.at(-1)!;
    expect(proposal).toMatchObject({
      business_id: business.id,
      kind: "rollback",
      status: "proposed",
      title: "Undo latest configuration change",
      base_version_id: sourceVersionId,
      rollback_target_version_id: sourceVersion.parent_version_id,
      requested_by: owner.user.id,
    });
    expect(String(proposal.base_head_revision)).toBe(
      String(before.head.head_revision),
    );
    expect(proposal.description).toContain(
      `immediately before Version ${sourceVersion.version_number}`,
    );
    expect(await liveState()).toEqual(before);
  });

  it("covers contextual authorization, malformed routes and forged form data", async () => {
    const before = await liveState();
    const sourceVersionId = before.head.active_version_id;
    const proposalsBefore = await proposalRows();
    const executionsBefore = await executionRows();

    const adminHtml = await renderContextualBuilder(
      administrator,
      sourceVersionId,
    );
    expect(adminHtml).toContain("Undo that.");
    expect(adminHtml).toContain(`Version ${before.head.head_revision}`);

    queueActionClient(administrator.client);
    await expect(
      prepareBuilderUndoAction(
        business.slug,
        sourceVersionId,
        forgedUndoForm(),
      ),
    ).rejects.toMatchObject({ name: "ActionRedirect" });
    const adminProposalRows = await proposalRows();
    expect(adminProposalRows).toHaveLength(proposalsBefore.length + 1);
    const adminProposal = adminProposalRows.at(-1)!;
    expect(adminProposal).toMatchObject({
      requested_by: administrator.user.id,
      kind: "rollback",
      status: "proposed",
      base_version_id: sourceVersionId,
      base_head_revision: String(before.head.head_revision),
    });
    expect(adminProposal.rollback_target_version_id).not.toBe(
      "00000000-0000-4000-8000-000000000002",
    );
    expect(adminProposal.title).toBe("Undo latest configuration change");
    expect(adminProposal.description).toContain(
      `Version ${before.head.head_revision}`,
    );
    expect(JSON.stringify(adminProposal)).not.toContain("Forged");
    expect(await executionRows()).toEqual(executionsBefore);

    for (const identity of [staff, outsider]) {
      await expectNotFound(renderContextualBuilder(identity, sourceVersionId));
      queueActionClient("client" in identity ? identity.client : identity);
      await expectNotFound(
        prepareBuilderUndoAction(
          business.slug,
          sourceVersionId,
          forgedUndoForm(),
        ),
      );
    }
    await expectNotFound(renderContextualBuilder(anonymous, sourceVersionId));
    queueActionClient(anonymous);
    await expect(
      prepareBuilderUndoAction(
        business.slug,
        sourceVersionId,
        forgedUndoForm(),
      ),
    ).rejects.toMatchObject({ name: "ActionRedirect", message: "/sign-in" });

    await expectNotFound(
      renderContextualBuilder(owner, "not-a-version-id", {
        undoVersion: "not-a-version-id",
      }),
    );
    await expectNotFound(
      renderContextualBuilder(owner, sourceVersionId, {
        undoVersion: [sourceVersionId, sourceVersionId],
      }),
    );
    queueActionClient(owner.client);
    await expectNotFound(
      prepareBuilderUndoAction(
        business.slug,
        "not-a-version-id",
        forgedUndoForm(),
      ),
    );

    expect(await proposalRows()).toHaveLength(proposalsBefore.length + 1);
    expect(await liveState()).toEqual(before);
    expect(await executionRows()).toEqual(executionsBefore);
  });

  it("intercepts every normal no-context undo phrase without AI or proposal state", async () => {
    const orchestrationService = { run: vi.fn() };
    for (const phrase of ["Undo that", "Undo that.", "undo that"]) {
      const proposalsBefore = await proposalRows();
      const executionsBefore = await executionRows();
      queueActionClient(owner.client);
      await expect(
        createBuilderAction({ orchestrationService })(
          business.slug,
          BUILDER_INITIAL_STATE,
          formWithRequest(phrase),
        ),
      ).resolves.toMatchObject({ state: "context_required" });
      expect(orchestrationService.run).not.toHaveBeenCalled();
      expect(await proposalRows()).toEqual(proposalsBefore);
      expect(await executionRows()).toEqual(executionsBefore);
    }
  });

  it("rejects a stale contextual confirmation at the rollback RPC boundary", async () => {
    const before = await liveState();
    const staleSourceVersionId = before.head.active_version_id;
    const rollbackCountBefore = (await proposalRows()).filter(
      (proposal) => proposal.kind === "rollback",
    ).length;
    const executionsBefore = await executionRows();
    let advancedState: Awaited<ReturnType<typeof liveState>> | undefined;
    let raceApplied = false;
    const racingClient = createRpcRaceClient(async () => {
      if (!raceApplied) {
        raceApplied = true;
        await applyOrdinaryCutoffChange(72);
        advancedState = await liveState();
      }
    });

    try {
      queueActionClient(racingClient);
      await expect(
        prepareBuilderUndoAction(
          business.slug,
          staleSourceVersionId,
          forgedUndoForm(),
        ),
      ).rejects.toMatchObject({
        name: "ActionRedirect",
        message: `/app/${business.slug}/builder?undoVersion=${staleSourceVersionId}`,
      });

      expect(raceApplied).toBe(true);
      expect(advancedState).toBeDefined();
      expect(
        (await proposalRows()).filter(
          (proposal) => proposal.kind === "rollback",
        ),
      ).toHaveLength(rollbackCountBefore);
      expect(await liveState()).toEqual(advancedState);
      expect(await executionRows()).toEqual(executionsBefore);

      const movedOnHtml = await renderContextualBuilder(
        owner,
        staleSourceVersionId,
      );
      expect(movedOnHtml).toContain("The setup has moved on");
      expect(movedOnHtml).not.toContain("Undo that.");
    } finally {
      if (raceApplied) {
        await applyOrdinaryCutoffChange(48);
      }
    }
  });

  it("proves the complete contextual undo lifecycle through Changes", async () => {
    await enableAi();
    const operationalBefore = await liveState();
    expect(
      (
        await resolvePublicPreorder(
          anonymous,
          business.slug,
          "preorder",
          "bakery_preorder",
        )
      )?.preorder.schedule.days_of_week,
    ).toEqual([6, 7]);

    const amendmentBuilder = createDeterministicBuilder(
      preorderReadyPlan(),
      smallDraft(),
      {
        amendmentOutput: preorderAmendmentDraftForRequest(
          "Remove Sunday collection.",
        ),
      },
    );
    const amendmentResult = await runRealAction(
      amendmentBuilder.service,
      owner,
      "Remove Sunday collection.",
    );
    expect(amendmentResult).toMatchObject({
      state: "proposed",
      operation_count: 1,
    });
    const amendmentProposal = (await proposalRows()).at(-1)!;
    expect(amendmentProposal).toMatchObject({
      kind: "change",
      status: "proposed",
      requested_by: owner.user.id,
    });

    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const amendmentProposalId = String(amendmentProposal.id);
    expect(
      (await configuration.validateChangeSet(amendmentProposalId)).status,
    ).toBe("validated");
    const appliedAmendment =
      await configuration.applyChangeSet(amendmentProposalId);
    expect(appliedAmendment.status).toBe("applied");
    const afterAmendment = await liveState();
    const amendmentVersion = await configuration.getVersion(
      appliedAmendment.applied_version_id!,
    );
    expect(amendmentVersion).toMatchObject({
      id: afterAmendment.head.active_version_id,
      kind: "change",
      parent_version_id: operationalBefore.head.active_version_id,
    });
    expect(amendmentVersion.version_number).toBe(
      afterAmendment.head.head_revision,
    );
    expect(
      (
        await resolvePublicPreorder(
          anonymous,
          business.slug,
          "preorder",
          "bakery_preorder",
        )
      )?.preorder.schedule.days_of_week,
    ).toEqual([6]);
    expectOperationalStateUnchanged(operationalBefore, afterAmendment);

    const executionsBeforeContext = await executionRows();
    const contextualHtml = await renderContextualBuilder(
      owner,
      amendmentVersion.id,
    );
    expect(contextualHtml).toContain(
      `Version ${amendmentVersion.version_number}`,
    );
    expect(contextualHtml).toContain("Undo that.");
    expect(await executionRows()).toEqual(executionsBeforeContext);

    const proposalsBeforeUndo = await proposalRows();
    queueActionClient(owner.client);
    await expect(
      prepareBuilderUndoAction(
        business.slug,
        amendmentVersion.id,
        forgedUndoForm(),
      ),
    ).rejects.toMatchObject({ name: "ActionRedirect" });
    const proposalsAfterUndo = await proposalRows();
    expect(proposalsAfterUndo).toHaveLength(proposalsBeforeUndo.length + 1);
    const rollbackProposal = proposalsAfterUndo.at(-1)!;
    const rollbackProposalId = String(rollbackProposal.id);
    expect(rollbackProposal).toMatchObject({
      kind: "rollback",
      status: "proposed",
      base_version_id: amendmentVersion.id,
      base_head_revision: String(afterAmendment.head.head_revision),
      rollback_target_version_id: amendmentVersion.parent_version_id,
      requested_by: owner.user.id,
    });
    expect(rollbackProposal.title).toBe("Undo latest configuration change");
    expect(JSON.stringify(rollbackProposal)).not.toContain("Forged");
    expect(await liveState()).toEqual(afterAmendment);
    expectOperationalStateUnchanged(operationalBefore, await liveState());
    expect(await executionRows()).toEqual(executionsBeforeContext);

    queueActionClient(owner.client);
    const detailPage = await ConfigurationChangeRoute({
      params: Promise.resolve({
        businessSlug: business.slug,
        changeSetId: rollbackProposalId,
      }),
      searchParams: Promise.resolve({ notice: "rollback_prepared" }),
    });
    const detailHtml = renderToStaticMarkup(detailPage);
    expect(detailHtml).toContain("Undo latest configuration change");
    expect(detailHtml).toContain("Preview");

    const preview = await configuration.loadPreview(rollbackProposalId);
    expect(preview).toMatchObject({
      proposalId: rollbackProposalId,
      kind: "rollback",
      status: "proposed",
    });
    const previewPreorder = await resolveConfigurationPreviewPreorder(
      owner.client,
      {
        businessId: business.id,
        actorId: owner.user.id,
        changeSetId: rollbackProposalId,
        pageKey: "public_preorder",
        preorderKey: "bakery_preorder",
      },
    );
    expect(previewPreorder?.preorder.schedule.days_of_week).toEqual([6, 7]);

    const beforeValidation = await liveState();
    expect(
      (await configuration.validateChangeSet(rollbackProposalId)).status,
    ).toBe("validated");
    expect(await liveState()).toEqual(beforeValidation);
    expectOperationalStateUnchanged(operationalBefore, await liveState());
    expect(
      (
        await resolvePublicPreorder(
          anonymous,
          business.slug,
          "preorder",
          "bakery_preorder",
        )
      )?.preorder.schedule.days_of_week,
    ).toEqual([6]);

    const versionsBeforeRollback = beforeValidation.versionCount ?? 0;
    const headBeforeRollback = beforeValidation.head.head_revision;
    const appliedRollback =
      await configuration.applyChangeSet(rollbackProposalId);
    expect(appliedRollback.status).toBe("applied");
    const rollbackVersion = await configuration.getVersion(
      appliedRollback.applied_version_id!,
    );
    expect(rollbackVersion).toMatchObject({
      kind: "rollback",
      parent_version_id: amendmentVersion.id,
      restored_from_version_id: amendmentVersion.parent_version_id,
    });
    const finalState = await liveState();
    expect(finalState.versionCount).toBe(versionsBeforeRollback + 1);
    expect(finalState.head.head_revision).toBe(headBeforeRollback + 1);
    expect(finalState.head.active_version_id).toBe(rollbackVersion.id);
    expectOperationalStateUnchanged(operationalBefore, finalState);
    expect(
      (
        await resolvePublicPreorder(
          anonymous,
          business.slug,
          "preorder",
          "bakery_preorder",
        )
      )?.preorder.schedule.days_of_week,
    ).toEqual([6, 7]);
    const manual = await loadActiveManualAmendmentSnapshot(configuration);
    expect(
      listPreorderScheduleSetups(manual.snapshot).find(
        ({ key }) => key === "bakery_preorder",
      )?.schedule.days_of_week,
    ).toEqual([6, 7]);
    expect(await executionRows()).toEqual(executionsBeforeContext);
  });

  it("covers all six Phase 9A requests through Builder and the full Changes lifecycle", async () => {
    await enableAi();
    await preparePhase9AcceptanceFixture();

    const proposalRequests = [
      "Make phone optional.",
      "Add an optional Occasion question.",
      "Remove Sunday collection.",
      "Change the cutoff from 48 to 72 hours.",
      "Remove Sunday collection and require 72 hours’ notice.",
    ] as const;
    for (const request of proposalRequests) {
      const deterministic = createDeterministicBuilder(
        preorderReadyPlan(),
        smallDraft(),
        {
          amendmentOutput: (input) =>
            preorderAmendmentDraftForRequest(
              (input as { owner_request: string }).owner_request,
            ),
        },
      );
      const proposalsBefore = await proposalRows();
      const result = await runRealAction(deterministic.service, owner, request);
      expect(result.state).toBe("proposed");
      expect(
        deterministic.calls.map((call) => call.outputContract.name),
      ).toEqual(["builder_plan_v1", "builder_preorder_amendment_v1"]);
      const proposals = await proposalRows();
      expect(proposals).toHaveLength(proposalsBefore.length + 1);
      const proposal = proposals.at(-1)!;
      const operations = configurationOperationsSchema.parse(
        proposal.operations_json,
      );
      expect(
        operations.filter(
          (operation) => operation.op === "set_preorder_experience",
        ),
      ).toHaveLength(1);
      expect(
        new Set(
          operations.map((operation) =>
            operation.op === "set_field"
              ? `field:${operation.object_key}.${operation.key}`
              : `${operation.op}:${operation.key}`,
          ),
        ).size,
      ).toBe(operations.length);
    }

    const beforeProposal = await liveState();
    const versionsBefore = beforeProposal.versionCount ?? 0;
    const headBefore = beforeProposal.head.head_revision;
    const proposalsBefore = await proposalRows();
    const deterministic = createDeterministicBuilder(
      preorderReadyPlan(),
      smallDraft(),
      {
        amendmentOutput: (input) =>
          preorderAmendmentDraftForRequest(
            (input as { owner_request: string }).owner_request,
          ),
      },
    );
    const result = await runRealAction(
      deterministic.service,
      owner,
      "Make phone optional and add an optional Occasion question.",
    );
    expect(result).toMatchObject({ state: "proposed", operation_count: 3 });
    const proposals = await proposalRows();
    expect(proposals).toHaveLength(proposalsBefore.length + 1);
    const proposal = proposals.at(-1)!;
    const operations = configurationOperationsSchema.parse(
      proposal.operations_json,
    );
    expect(operations).toHaveLength(3);
    const beforeSnapshotForParity = configurationSnapshotV1Schema.parse(
      beforeProposal.snapshot,
    );
    const manualOperations = composePreorderAmendmentBatch(
      beforeSnapshotForParity,
      {
        preorderKey: "bakery_preorder",
        amendments: [
          {
            intent: "set_existing_question_requiredness",
            target: "customer",
            fieldKey: "phone",
            required: false,
          },
          {
            intent: "add_preorder_question",
            label: "Occasion",
            helpText: null,
            required: false,
            answerStyle: "short_answer",
          },
        ],
      },
    ).operations;
    expect(operations).toEqual(manualOperations);
    expect(
      operations.filter(
        (operation) => operation.op === "set_preorder_experience",
      ),
    ).toHaveLength(1);
    expect(
      new Set(
        operations.map((operation) =>
          operation.op === "set_field"
            ? `field:${operation.object_key}.${operation.key}`
            : `${operation.op}:${operation.key}`,
        ),
      ).size,
    ).toBe(operations.length);
    const preorderOperation = operations.find(
      (operation) => operation.op === "set_preorder_experience",
    );
    const phoneFieldOperation = operations.find(
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "customer" &&
        operation.key === "phone",
    );
    const occasionFieldOperation = operations.find(
      (operation) =>
        operation.op === "set_field" && operation.object_key === "order",
    );
    expect(preorderOperation).toMatchObject({
      op: "set_preorder_experience",
      key: "bakery_preorder",
      config_json: {
        schedule: {
          days_of_week: [6, 7],
          start_time: "11:00",
          end_time: "16:00",
          slot_interval_minutes: 30,
          slot_capacity: 10,
          cutoff_hours: 48,
          booking_horizon_days: 90,
        },
        field_mappings: expect.any(Object),
      },
    });
    expect(phoneFieldOperation).toMatchObject({
      op: "set_field",
      object_key: "customer",
      key: "phone",
      required: false,
    });
    expect(occasionFieldOperation).toMatchObject({
      op: "set_field",
      object_key: "order",
      label: "Occasion",
      field_type: "short_text",
      required: false,
      is_active: true,
    });
    if (
      !preorderOperation ||
      preorderOperation.op !== "set_preorder_experience"
    ) {
      throw new Error(
        "The combined Builder proposal lacks its preorder operation.",
      );
    }
    expect(preorderOperation.config_json.public_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "customer",
          field: "phone",
          required: false,
          autocomplete: "tel",
        }),
        expect.objectContaining({
          target: "order",
          field:
            occasionFieldOperation && occasionFieldOperation.op === "set_field"
              ? occasionFieldOperation.key
              : "occasion_2",
          label: "Occasion",
          required: false,
          autocomplete: "off",
        }),
      ]),
    );
    const semanticDiff = semanticDiffSchema.parse(proposal.semantic_diff_json);
    expect(semanticDiff.changes.map(({ entity_key }) => entity_key)).toEqual([
      "customer.phone",
      "order.occasion_2",
      "bakery_preorder",
    ]);
    expect(semanticDiff.changes[0]).toMatchObject({
      entity_type: "field",
      change_type: "updated",
      properties: [{ property: "required", before: true, after: false }],
    });
    expect(semanticDiff.changes[1]).toMatchObject({
      entity_type: "field",
      change_type: "created",
    });
    expect(semanticDiff.changes[2]).toMatchObject({
      entity_type: "preorder_experience",
      change_type: "updated",
      properties: [{ property: "public_fields" }],
    });
    expect(
      semanticDiff.changes.some(
        (change) =>
          change.entity_key === "customer.phone" &&
          change.properties.some(
            (property) =>
              property.property === "required" &&
              property.before === true &&
              property.after === false,
          ),
      ),
    ).toBe(true);
    expect(
      semanticDiff.changes.some(
        (change) =>
          change.entity_type === "preorder_experience" &&
          change.properties.some(
            (property) => property.property === "public_fields",
          ),
      ),
    ).toBe(true);
    expect(
      semanticDiff.changes.some((change) =>
        change.entity_key?.includes("occasion_2"),
      ),
    ).toBe(true);
    expect(await liveState()).toEqual(beforeProposal);

    const candidate = await resolveConfigurationPreviewPreorder(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
      changeSetId: String(proposal.id),
      pageKey: "public_preorder",
      preorderKey: "bakery_preorder",
    });
    expect(
      candidate?.preorder.public_fields.find(
        (field) => field.target === "customer" && field.field === "phone",
      ),
    ).toMatchObject({ required: false });
    expect(
      candidate?.preorder.public_fields.find(
        (field) => field.label === "Occasion",
      ),
    ).toMatchObject({ required: false, field_type: "short_text" });

    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const proposalId = String(proposal.id);
    expect((await configuration.validateChangeSet(proposalId)).status).toBe(
      "validated",
    );
    expect(await liveState()).toEqual(beforeProposal);
    const applied = await configuration.applyChangeSet(proposalId);
    expect(applied.status).toBe("applied");
    expect(applied.applied_version_id).toBeTruthy();
    const afterApplication = await liveState();
    expect(afterApplication.versionCount).toBe((versionsBefore ?? 0) + 1);
    expect(afterApplication.head.head_revision).toBe(headBefore + 1);
    expect(afterApplication.recordRows).toEqual(beforeProposal.recordRows);
    expect(afterApplication.relationshipRows).toEqual(
      beforeProposal.relationshipRows,
    );
    expect(afterApplication.recordLocationRows).toEqual(
      beforeProposal.recordLocationRows,
    );
    expect(afterApplication.submissions).toEqual(beforeProposal.submissions);
    expect(afterApplication.slotCounters).toEqual(beforeProposal.slotCounters);
    expect(afterApplication.rateLimits).toEqual(beforeProposal.rateLimits);
    expect(afterApplication.emailStates).toEqual(beforeProposal.emailStates);
    expect(afterApplication.locations).toEqual(beforeProposal.locations);
    const live = await resolvePublicPreorder(
      anonymous,
      business.slug,
      "preorder",
      "bakery_preorder",
    );
    expect(
      live?.preorder.public_fields.find(
        (field) => field.target === "customer" && field.field === "phone",
      ),
    ).toMatchObject({ required: false });
    expect(
      live?.preorder.public_fields.find((field) => field.label === "Occasion"),
    ).toMatchObject({ required: false, field_type: "short_text" });
    const active = await loadActiveManualAmendmentSnapshot(configuration);
    const manualSetup = getPreorderQuestionsSetup(
      active.snapshot,
      "bakery_preorder",
    );
    expect(manualSetup.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "customer",
          fieldKey: "phone",
          required: false,
        }),
        expect.objectContaining({
          target: "order",
          label: "Occasion",
          required: false,
        }),
      ]),
    );
    const appliedSnapshot = configurationSnapshotV1Schema.parse(
      active.snapshot,
    );
    const beforeSnapshot = configurationSnapshotV1Schema.parse(
      beforeProposal.snapshot,
    );
    const appliedPreorder = appliedSnapshot.preorder_experiences.find(
      ({ key }) => key === "bakery_preorder",
    );
    const beforePreorder = beforeSnapshot.preorder_experiences.find(
      ({ key }) => key === "bakery_preorder",
    );
    if (!appliedPreorder || !beforePreorder) {
      throw new Error("The applied preorder is missing.");
    }
    const beforePhoneField = beforeSnapshot.field_definitions.find(
      (field) => field.object_key === "customer" && field.key === "phone",
    );
    const appliedPhoneField = appliedSnapshot.field_definitions.find(
      (field) => field.object_key === "customer" && field.key === "phone",
    );
    const occasionKey =
      occasionFieldOperation && occasionFieldOperation.op === "set_field"
        ? occasionFieldOperation.key
        : "occasion_2";
    const appliedOccasionField = appliedSnapshot.field_definitions.find(
      (field) => field.object_key === "order" && field.key === occasionKey,
    );
    expect(beforePhoneField).toMatchObject({ required: true });
    expect(appliedPhoneField).toMatchObject({ required: false });
    expect(appliedOccasionField).toMatchObject({
      field_type: "short_text",
      required: false,
      is_active: true,
    });
    expect(appliedSnapshot.object_definitions).toEqual(
      beforeSnapshot.object_definitions,
    );
    expect(appliedSnapshot.relationship_definitions).toEqual(
      beforeSnapshot.relationship_definitions,
    );
    expect(appliedSnapshot.pages).toEqual(beforeSnapshot.pages);
    expect(appliedSnapshot.preorder_experience_locations).toEqual(
      beforeSnapshot.preorder_experience_locations,
    );
    expect(appliedPreorder.config_json.schedule).toEqual(
      beforePreorder.config_json.schedule,
    );
    expect(appliedPreorder.config_json.field_mappings).toEqual(
      beforePreorder.config_json.field_mappings,
    );
    const existingPublicFieldKeys =
      beforePreorder.config_json.public_fields.map(
        ({ target, field }) => `${target}:${field}`,
      );
    const appliedExistingPublicFields =
      appliedPreorder.config_json.public_fields.filter(({ target, field }) =>
        existingPublicFieldKeys.includes(`${target}:${field}`),
      );
    expect(
      appliedExistingPublicFields.map(
        ({ target, field }) => `${target}:${field}`,
      ),
    ).toEqual(existingPublicFieldKeys);
    expect(appliedExistingPublicFields).toEqual(
      beforePreorder.config_json.public_fields.map((field) =>
        field.target === "customer" && field.field === "phone"
          ? { ...field, required: false }
          : field,
      ),
    );
    expect(appliedPreorder.is_active).toBe(beforePreorder.is_active);
    expect(appliedSnapshot.preorder_experiences.map(({ key }) => key)).toEqual(
      beforeSnapshot.preorder_experiences.map(({ key }) => key),
    );
  }, 90_000);
});
