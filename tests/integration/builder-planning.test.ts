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

vi.mock("server-only", () => ({}));

import { SupabaseAiAccountingService } from "../../src/ai/accounting/service";
import { createBusinessAiExecutionOrchestrator } from "../../src/ai/business-execution";
import type { StructuredAiProviderRequest } from "../../src/ai/contracts";
import { createAiExecutionService } from "../../src/ai/execution";
import type { BuilderPlanOutput } from "../../src/ai/planning/schemas";
import {
  builderPlanningService,
  createBuilderPlanningService,
} from "../../src/ai/planning/service";
import {
  OPENAI_MODEL_KEY,
  OpenAiResponsesStructuredProvider,
  type OpenAiResponsesClient,
} from "../../src/ai/providers/openai";
import { aiExecutionPolicies, registeredAiTasks } from "../../src/ai/registry";
import { BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY } from "../../src/ai/policies";
import {
  loadAuthoritativeAiBusinessContext,
  type AuthoritativeAiBusinessContext,
} from "../../src/core/configuration/builder-context-source";
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import { createGraphService } from "../../src/core/graph/service";
import type { Database, Tables } from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };

const password = "Milestone-6-planning-test!";
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];
const piiMarker = `PLANNING_OPERATIONAL_PII_${crypto.randomUUID()}`;

let settings: LocalSupabaseSettings;
let database: Sql;
let serviceRole: Client;
let anonymous: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let outsider: Identity;
let business: Tables<"businesses">;
let outsiderBusiness: Tables<"businesses">;

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
  const email = `m6-planning-${label}-${crypto.randomUUID()}@example.test`;
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

function readyOutput(): Extract<BuilderPlanOutput, { state: "ready" }> {
  return {
    schema_version: 1,
    state: "ready",
    understanding: "You want staff to review Orders more clearly.",
    assumptions: [],
    plan: {
      outcome: "Staff can review existing Orders in a clear screen.",
      concepts: [
        {
          reference: "concept_1",
          label: "Order",
          disposition: "existing",
          existing_object_key: "order",
          purpose: "Keep customer order information together.",
        },
      ],
      user_journeys: [
        {
          reference: "journey_1",
          name: "Review an order",
          actor: "Staff member",
          trigger: "A staff member opens Orders.",
          steps: ["Open an Order.", "Review the collection details."],
          outcome: "The Order is ready for preparation.",
        },
      ],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          lane: "configuration",
          category: "configure_view",
          summary: "Configure an owner-reviewed Order screen.",
          dependencies: [],
          affected_concepts: ["concept_1"],
          existing_object_keys: ["order"],
          location_references: [],
          materiality: "medium",
          requires_owner_confirmation: true,
        },
      ],
    },
    unsupported_requirements: [],
  };
}

function locationReadyOutput(
  locationReference: string,
): Extract<BuilderPlanOutput, { state: "ready" }> {
  return {
    schema_version: 1,
    state: "ready",
    understanding: "You want to rename the existing Bedford Location.",
    assumptions: [],
    plan: {
      outcome: "The Bedford Location has the proposed owner-reviewed name.",
      concepts: [],
      user_journeys: [],
      steps: [
        {
          reference: "step_1",
          sequence: 1,
          lane: "operational",
          category: "update_location",
          summary: "Rename the Bedford Location.",
          dependencies: [],
          affected_concepts: [],
          existing_object_keys: [],
          location_references: [locationReference],
          materiality: "medium",
          requires_owner_confirmation: true,
        },
      ],
    },
    unsupported_requirements: [],
  };
}

function clarificationOutput(): Extract<
  BuilderPlanOutput,
  { state: "needs_clarification" }
> {
  return {
    schema_version: 1,
    state: "needs_clarification",
    understanding: "You want a new customer enquiry journey.",
    known_requirements: ["Customers should be able to send an enquiry."],
    assumptions: [],
    questions: [
      {
        reference: "question_1",
        question: "Which details should customers provide?",
        reason: "This determines what the enquiry needs to capture.",
        response_style: "multiple_choice",
        options: ["Event date", "Guest count", "Budget"],
      },
    ],
    unsupported_requirements: [],
  };
}

function planningWithProvider(
  generateStructured: (request: StructuredAiProviderRequest) => Promise<{
    output: unknown;
    usage?: { inputTokens: number; outputTokens: number };
    requestMetadata?: Record<string, string | number | boolean>;
  }>,
) {
  const execution = createAiExecutionService({
    tasks: registeredAiTasks,
    policies: {
      [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]:
        aiExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
    },
    providers: {
      disabled: { key: "disabled", generateStructured },
    },
    sleep: async () => {},
  });
  return createBuilderPlanningService({
    executeTask: (client, context, taskKey, input) =>
      createBusinessAiExecutionOrchestrator({
        accounting: new SupabaseAiAccountingService(client, context),
        execution,
      }).execute(taskKey, input),
  });
}

function planningWithOpenAiClient(client: OpenAiResponsesClient) {
  const execution = createAiExecutionService({
    tasks: registeredAiTasks,
    policies: {
      [BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY]: {
        ...aiExecutionPolicies[BUILDER_PLANNING_TERRA_MEDIUM_POLICY_KEY],
        providerKey: "openai",
        modelKey: OPENAI_MODEL_KEY,
        inputMicrousdPerMillion: 2_500_000,
        outputMicrousdPerMillion: 15_000_000,
      },
    },
    providers: {
      openai: new OpenAiResponsesStructuredProvider({ client }),
    },
    sleep: async () => {},
  });
  return createBuilderPlanningService({
    executeTask: (sessionClient, context, taskKey, input) =>
      createBusinessAiExecutionOrchestrator({
        accounting: new SupabaseAiAccountingService(sessionClient, context),
        execution,
      }).execute(taskKey, input),
  });
}

function openAiResponse(
  output: unknown,
  usage = { inputTokens: 120, outputTokens: 40 },
) {
  return {
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ result: output }),
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
      input_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0,
      },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

async function enablePlanning(): Promise<void> {
  const updated = await owner.client.rpc("update_business_ai_settings", {
    expected_business_id: business.id,
    expected_actor_id: owner.user.id,
    requested_is_enabled: true,
    requested_daily_request_limit: 25,
    requested_daily_input_token_limit: 250_000,
    requested_daily_output_token_limit: 100_000,
    requested_daily_cost_limit_microusd: 5_000_000,
  });
  if (updated.error) {
    throw updated.error;
  }
}

async function executionRows() {
  return database<Record<string, unknown>[]>`
    select *
    from public.ai_execution_runs
    where business_id = ${business.id}::uuid
    order by reserved_at, id
  `;
}

function completePreorderOperation(
  authoritative: AuthoritativeAiBusinessContext,
) {
  const snapshot = authoritative.source.activeConfiguration.snapshot;
  const preorder = snapshot.preorder_experiences.find(
    ({ key }) => key === "bakery_preorder",
  );
  if (!preorder) {
    throw new Error("Missing Bedford preorder.");
  }
  return {
    op: "set_preorder_experience" as const,
    key: preorder.key,
    product_object_key: preorder.product_object_key,
    customer_object_key: preorder.customer_object_key,
    order_object_key: preorder.order_object_key,
    order_item_object_key: preorder.order_item_object_key,
    customer_places_order_relationship_key:
      preorder.customer_places_order_relationship_key,
    order_contains_item_relationship_key:
      preorder.order_contains_item_relationship_key,
    product_appears_in_item_relationship_key:
      preorder.product_appears_in_item_relationship_key,
    config_json: {
      ...preorder.config_json,
      schedule: {
        ...preorder.config_json.schedule,
        slot_capacity: Math.max(
          1,
          preorder.config_json.schedule.slot_capacity - 1,
        ),
      },
    },
    allowed_location_ids: snapshot.preorder_experience_locations
      .filter(
        ({ preorder_key, is_active }) =>
          preorder_key === preorder.key && is_active,
      )
      .map(({ location_id }) => location_id),
    is_active: preorder.is_active,
  };
}

describe("Milestone 6 Phase 3B authenticated builder planning", () => {
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
    database = postgres(settings.databaseUrl, { max: 4 });
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
    [owner, staff, administrator, outsider] = await Promise.all([
      signIn("demo@smbos.local"),
      signIn("staff@smbos.local"),
      createIdentity("admin"),
      createIdentity("outsider"),
    ]);
    business = requireData(
      await owner.client
        .from("businesses")
        .select("*")
        .eq("slug", "bedford-bakery-demo")
        .single(),
      "Could not load Bedford Bakery.",
    );
    outsiderBusiness = requireData(
      await outsider.client.rpc("create_business", {
        business_name: `Planning outsider ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create the outsider Business.",
    );
    createdBusinessIds.push(outsiderBusiness.id);
    const membership = await serviceRole.from("business_memberships").insert({
      business_id: business.id,
      user_id: administrator.user.id,
      role: "admin",
    });
    if (membership.error) {
      throw membership.error;
    }

    const customer = requireData(
      await owner.client
        .from("object_definitions")
        .select("id")
        .eq("business_id", business.id)
        .eq("key", "customer")
        .single(),
      "Could not load Customer.",
    );
    await createGraphService(owner.client, {
      businessId: business.id,
    }).createRecord({
      objectDefinitionId: customer.id,
      data: {
        name: piiMarker,
        email: `${piiMarker.toLowerCase()}@example.test`,
      },
      recordStatus: "active",
    });
  }, 180_000);

  beforeEach(async () => {
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
      for (const businessId of [business?.id, ...createdBusinessIds]) {
        if (businessId) {
          await database`
            delete from public.businesses
            where id = ${businessId}::uuid
          `;
        }
      }
      await database.end();
    }
    if (serviceRole) {
      for (const userId of createdUserIds) {
        await serviceRole.auth.admin.deleteUser(userId);
      }
    }
  });

  it.each([
    ["Owner", () => owner, clarificationOutput()],
    ["Admin", () => administrator, readyOutput()],
  ])(
    "returns a strict result for %s with real accounting",
    async (_label, identity, output) => {
      await enablePlanning();
      const provider = vi.fn().mockResolvedValue({
        output,
        usage: { inputTokens: 120, outputTokens: 40 },
        requestMetadata: { provider_only: "must-not-persist" },
      });

      const result = await planningWithProvider(provider).plan(
        identity().client,
        {
          businessId: business.id,
          ownerRequest: "Plan a safe improvement.",
        },
      );

      expect(result.plan).toEqual(output);
      expect(result.execution).toEqual({
        attempts: 1,
        inputTokens: 120,
        outputTokens: 40,
        usageComplete: true,
      });
      const rows = await executionRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "succeeded",
        task_key: "builder_plan_v1",
        policy_key: "builder_planning_terra_medium_v1",
        actual_input_tokens: "120",
        actual_output_tokens: "40",
      });
    },
  );

  it("executes the injected OpenAI adapter through real reservation and settlement", async () => {
    await enablePlanning();
    const create = vi.fn().mockResolvedValue(openAiResponse(readyOutput()));

    const result = await planningWithOpenAiClient({
      responses: { create },
    }).plan(owner.client, {
      businessId: business.id,
      ownerRequest: "Improve Orders.",
    });

    expect(result.plan).toEqual(readyOutput());
    expect(create).toHaveBeenCalledOnce();
    const [body] = create.mock.calls[0]!;
    expect(body).toMatchObject({
      model: OPENAI_MODEL_KEY,
      store: false,
      max_output_tokens: 4_096,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(body).not.toHaveProperty("tools");
    expect(await executionRows()).toEqual([
      expect.objectContaining({
        status: "succeeded",
        provider_key: "openai",
        model_key: OPENAI_MODEL_KEY,
        reserved_input_tokens: "128000",
        reserved_output_tokens: "8192",
        reserved_cost_microusd: "442880",
        actual_input_tokens: "120",
        actual_output_tokens: "40",
        actual_cost_microusd: "900",
        charged_cost_microusd: "900",
      }),
    ]);
  });

  it.each([
    [
      "refusal",
      {
        ...openAiResponse({}),
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "refusal", refusal: "never persist this text" }],
          },
        ],
      },
      "ai_refused",
    ],
    [
      "max-output incomplete",
      {
        ...openAiResponse({}),
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
      "ai_incomplete",
    ],
    [
      "content-filter incomplete",
      {
        ...openAiResponse({}),
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      },
      "ai_content_filtered",
    ],
  ])(
    "settles OpenAI %s as failed with reported usage",
    async (_label, response, outcomeCode) => {
      await enablePlanning();
      const create = vi.fn().mockResolvedValue(response);

      await expect(
        planningWithOpenAiClient({ responses: { create } }).plan(owner.client, {
          businessId: business.id,
          ownerRequest: "Improve Orders.",
        }),
      ).rejects.toMatchObject({ code: outcomeCode });

      expect(await executionRows()).toEqual([
        expect.objectContaining({
          status: "failed",
          outcome_code: outcomeCode,
          provider_key: "openai",
          actual_input_tokens: "120",
          actual_output_tokens: "40",
          charged_cost_microusd: "900",
        }),
      ]);
      expect(JSON.stringify(await executionRows())).not.toContain(
        "never persist this text",
      );
    },
  );

  it("returns a concept-free Location plan through real accounting without mutation", async () => {
    await enablePlanning();
    const before = requireData(
      await owner.client
        .from("locations")
        .select("*")
        .eq("business_id", business.id)
        .eq("slug", "bedford")
        .single(),
      "Could not load the unchanged Bedford Location.",
    );
    const output = locationReadyOutput(before.id);
    const provider = vi.fn().mockResolvedValue({
      output,
      usage: { inputTokens: 95, outputTokens: 24 },
    });

    const result = await planningWithProvider(provider).plan(owner.client, {
      businessId: business.id,
      ownerRequest: "Rename the Bedford Location.",
    });

    expect(result.plan).toEqual(output);
    expect(result.execution).toEqual({
      attempts: 1,
      inputTokens: 95,
      outputTokens: 24,
      usageComplete: true,
    });
    const after = requireData(
      await owner.client
        .from("locations")
        .select("*")
        .eq("business_id", business.id)
        .eq("id", before.id)
        .single(),
      "Could not verify the unchanged Bedford Location.",
    );
    expect(after).toEqual(before);
    expect(provider).toHaveBeenCalledOnce();
    expect(await executionRows()).toEqual([
      expect.objectContaining({
        status: "succeeded",
        task_key: "builder_plan_v1",
        policy_key: "builder_planning_terra_medium_v1",
        actual_input_tokens: "95",
        actual_output_tokens: "24",
      }),
    ]);
  });

  it("denies Staff, anonymous, and cross-Business callers before provider invocation", async () => {
    await enablePlanning();
    const provider = vi.fn();
    const service = planningWithProvider(provider);

    await expect(
      service.plan(staff.client, {
        businessId: business.id,
        ownerRequest: "Plan this.",
      }),
    ).rejects.toMatchObject({ code: "ai_context_unauthorized" });
    await expect(
      service.plan(anonymous, {
        businessId: business.id,
        ownerRequest: "Plan this.",
      }),
    ).rejects.toMatchObject({ code: "ai_context_unauthorized" });
    await expect(
      service.plan(outsider.client, {
        businessId: business.id,
        ownerRequest: "Plan this.",
      }),
    ).rejects.toMatchObject({ code: "ai_context_not_found" });
    await expect(
      service.plan(owner.client, {
        businessId: outsiderBusiness.id,
        ownerRequest: "Plan this.",
      }),
    ).rejects.toMatchObject({ code: "ai_context_not_found" });
    expect(provider).not.toHaveBeenCalled();
    expect(await executionRows()).toHaveLength(0);
  });

  it("rejects invalid requests and disabled Business AI without provider invocation", async () => {
    const provider = vi.fn();
    const service = planningWithProvider(provider);

    await expect(
      service.plan(owner.client, {
        businessId: business.id,
        ownerRequest: " ",
      }),
    ).rejects.toMatchObject({ code: "ai_plan_request_invalid" });
    await expect(
      service.plan(owner.client, {
        businessId: business.id,
        ownerRequest: "Plan this.",
      }),
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(provider).not.toHaveBeenCalled();
    expect(await executionRows()).toHaveLength(0);
  });

  it("sends exact Phase 3A context without trusted IDs or operational PII", async () => {
    await enablePlanning();
    const authoritative = await loadAuthoritativeAiBusinessContext(
      owner.client,
      { businessId: business.id },
    );
    let providerRequest: StructuredAiProviderRequest | undefined;
    const provider = vi.fn((request: StructuredAiProviderRequest) => {
      providerRequest = request;
      return Promise.resolve({
        output: readyOutput(),
        usage: { inputTokens: 80, outputTokens: 25 },
      });
    });

    await planningWithProvider(provider).plan(owner.client, {
      businessId: business.id,
      ownerRequest: "Improve Orders.",
    });

    const serialized = JSON.stringify(providerRequest?.input);
    expect(serialized).not.toContain(owner.user.id);
    expect(serialized).not.toContain(business.id);
    expect(serialized).not.toContain(authoritative.currentness.baseVersionId);
    expect(serialized).not.toContain(piiMarker);
    expect(serialized).not.toContain(piiMarker.toLowerCase());
    expect(providerRequest?.input).toMatchObject({
      schema_version: 1,
      owner_request: "Improve Orders.",
      business_context: {
        active_configuration: {
          revision: authoritative.currentness.headRevision,
        },
      },
    });
  });

  it("settles a semantically hallucinated Object reference as failed", async () => {
    await enablePlanning();
    const invalid = readyOutput();
    const concept = invalid.plan.concepts[0]!;
    if (concept.disposition !== "existing") {
      throw new Error("Expected an existing concept.");
    }
    concept.existing_object_key = "hallucinated_object";

    await expect(
      planningWithProvider(async () => ({
        output: invalid,
        usage: { inputTokens: 70, outputTokens: 20 },
      })).plan(owner.client, {
        businessId: business.id,
        ownerRequest: "Improve Orders.",
      }),
    ).rejects.toMatchObject({ code: "ai_output_invalid" });

    const rows = await executionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "failed",
      outcome_code: "ai_output_invalid",
      actual_input_tokens: "70",
      actual_output_tokens: "20",
    });
  });

  it("does not persist request, context, plan, output, or provider metadata", async () => {
    await enablePlanning();
    const requestMarker = `OWNER_REQUEST_${crypto.randomUUID()}`;
    const planMarker = `PLAN_OUTPUT_${crypto.randomUUID()}`;
    const providerMarker = `PROVIDER_METADATA_${crypto.randomUUID()}`;
    const output = readyOutput();
    output.understanding = planMarker;

    await planningWithProvider(async () => ({
      output,
      usage: { inputTokens: 60, outputTokens: 18 },
      requestMetadata: { marker: providerMarker },
    })).plan(owner.client, {
      businessId: business.id,
      ownerRequest: requestMarker,
    });

    const rows = await executionRows();
    const serialized = JSON.stringify(rows);
    expect(rows).toHaveLength(1);
    for (const forbidden of [
      requestMarker,
      planMarker,
      providerMarker,
      piiMarker,
      "business_context",
      "owner_request",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("ignores an open M5 proposal and creates no proposal itself", async () => {
    await enablePlanning();
    const beforeContext = await loadAuthoritativeAiBusinessContext(
      owner.client,
      { businessId: business.id },
    );
    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const proposal = await configuration.proposeChangeSet({
      expectedBaseVersionId: beforeContext.currentness.baseVersionId,
      expectedHeadRevision: beforeContext.currentness.headRevision,
      title: "Open proposal ignored by planning",
      description: "Planning must use only the active immutable version.",
      operations: [completePreorderOperation(beforeContext)],
    });
    const proposalCountBefore = await database<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_change_sets
      where business_id = ${business.id}::uuid
    `;

    await planningWithProvider(async () => ({
      output: readyOutput(),
      usage: { inputTokens: 50, outputTokens: 15 },
    })).plan(owner.client, {
      businessId: business.id,
      ownerRequest: "Improve Orders.",
    });

    const proposalCountAfter = await database<{ count: number }[]>`
      select count(*)::integer as count
      from public.configuration_change_sets
      where business_id = ${business.id}::uuid
    `;
    expect(proposalCountAfter).toEqual(proposalCountBefore);
    await configuration.abandonChangeSet(proposal.id);
  });

  it("discards a plan after configuration application while preserving charged usage", async () => {
    await enablePlanning();
    const provider = async () => {
      const authoritative = await loadAuthoritativeAiBusinessContext(
        owner.client,
        { businessId: business.id },
      );
      const configuration = new ConfigurationChangeService(owner.client, {
        businessId: business.id,
        actorId: owner.user.id,
      });
      const proposal = await configuration.proposeChangeSet({
        expectedBaseVersionId: authoritative.currentness.baseVersionId,
        expectedHeadRevision: authoritative.currentness.headRevision,
        title: "Advance configuration during planning",
        description: "Exercise the post-execution stale-plan boundary.",
        operations: [completePreorderOperation(authoritative)],
      });
      await configuration.validateChangeSet(proposal.id);
      await configuration.applyChangeSet(proposal.id);
      return {
        output: readyOutput(),
        usage: { inputTokens: 140, outputTokens: 45 },
      };
    };

    await expect(
      planningWithProvider(provider).plan(owner.client, {
        businessId: business.id,
        ownerRequest: "Improve Orders.",
      }),
    ).rejects.toMatchObject({ code: "ai_plan_context_stale" });

    const rows = await executionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "succeeded",
      charged_input_tokens: "140",
      charged_output_tokens: "45",
    });
  });

  it("discards a plan after a Location change while preserving charged usage", async () => {
    await enablePlanning();
    const location = requireData(
      await owner.client
        .from("locations")
        .select("id,name")
        .eq("business_id", business.id)
        .eq("slug", "bedford")
        .single(),
      "Could not load Bedford Location.",
    );
    const provider = async () => {
      const changed = await owner.client
        .from("locations")
        .update({ name: `${location.name} planning change` })
        .eq("business_id", business.id)
        .eq("id", location.id);
      if (changed.error) {
        throw changed.error;
      }
      return {
        output: readyOutput(),
        usage: { inputTokens: 110, outputTokens: 35 },
      };
    };

    await expect(
      planningWithProvider(provider).plan(owner.client, {
        businessId: business.id,
        ownerRequest: "Improve Orders.",
      }),
    ).rejects.toMatchObject({ code: "ai_plan_context_stale" });
    expect((await executionRows())[0]).toMatchObject({
      status: "succeeded",
      charged_input_tokens: "110",
      charged_output_tokens: "35",
    });
  });

  it("uses the disabled production provider without a network request and settles safely", async () => {
    await enablePlanning();
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!url.startsWith(settings.apiUrl)) {
          return Promise.reject(
            new Error("External fetch must not be called by planning."),
          );
        }
        return originalFetch(input, init);
      });

    await expect(
      builderPlanningService.plan(owner.client, {
        businessId: business.id,
        ownerRequest: "Improve Orders.",
      }),
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(fetchSpy).toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.every(([input]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return url.startsWith(settings.apiUrl);
      }),
    ).toBe(true);
    expect((await executionRows())[0]).toMatchObject({
      status: "failed",
      outcome_code: "ai_disabled",
      provider_key: "disabled",
      actual_input_tokens: null,
      actual_output_tokens: null,
    });
  });
});
