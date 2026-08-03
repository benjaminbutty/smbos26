import { execFileSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
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
import { BUILDER_UNSUPPORTED_MESSAGES } from "../../src/ai/builder/contracts";
import { AiExecutionError } from "../../src/ai/errors";
import { BUILDER_INITIAL_STATE } from "../../src/components/builder-ui-state";
import { configurationOperationsSchema } from "../../src/core/configuration/schemas";
import {
  createDeterministicBuilder,
  preorderAmendmentDraft,
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

async function expectNotFound(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toMatchObject({ name: "ActionNotFound" });
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
  return {
    head: head.data,
    versionCount: versions.count,
    recordCount: records.count,
    edgeCount: edges.count,
    locations: locations.data,
    snapshot: snapshot[0]?.snapshot,
  };
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
    for (const kind of ["operational", "mixed"] as const) {
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
          kind === "operational"
            ? BUILDER_UNSUPPORTED_MESSAGES.operational_plan_unavailable
            : BUILDER_UNSUPPORTED_MESSAGES.mixed_plan_unavailable,
      });
      expect(deterministic.calls).toHaveLength(1);
      expect(await executionRows()).toHaveLength(1);
      expect(await proposalRows()).toHaveLength(proposalsBefore.length);
      expect(await liveState()).toEqual(before);
    }
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
});
