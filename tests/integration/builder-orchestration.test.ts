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

import type { StructuredAiProviderRequest } from "../../src/ai/contracts";
import { createBuilderAiRuntime } from "../../src/ai/builder/runtime";
import { createBuilderOrchestrationService } from "../../src/ai/builder/service";
import { BuilderConfigurationProposalError } from "../../src/ai/configuration-proposal/errors";
import type {
  BuilderPlanOutput,
  BuilderReadyPlanStep,
} from "../../src/ai/planning/schemas";
import type { BuilderConfigurationDraftOutput } from "../../src/ai/configuration-drafting/schemas";
import { configurationOperationsSchema } from "../../src/core/configuration/schemas";
import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };
type Business = Tables<"businesses">;

const password = "Milestone-8-builder-orchestration-test!";
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];
const ownerRequest =
  "Create a Catering Enquiry and retain raw request marker BUILDER_RAW_REQUEST_MARKER.";

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
  const email = `m8-builder-${label}-${crypto.randomUUID()}@example.test`;
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

function step(
  reference: string,
  sequence: number,
  category: Extract<
    BuilderReadyPlanStep,
    { lane: "configuration" }
  >["category"],
  affectedConcepts: string[],
  existingObjectKeys: string[] = [],
): BuilderReadyPlanStep {
  return {
    reference,
    sequence,
    summary: `Configure ${category.replaceAll("_", " ")}.`,
    dependencies: [],
    affected_concepts: affectedConcepts,
    existing_object_keys: existingObjectKeys,
    location_references: [],
    materiality: "low",
    requires_owner_confirmation: true,
    lane: "configuration",
    category,
  };
}

function cateringPlan(): Extract<BuilderPlanOutput, { state: "ready" }> {
  return {
    schema_version: 1,
    state: "ready",
    understanding: "Plan prose marker BUILDER_PLAN_TRANSIENT_MARKER.",
    assumptions: [],
    plan: {
      outcome: "The Business can review Catering Enquiries.",
      concepts: [
        {
          reference: "concept_1",
          label: "Customer",
          disposition: "existing",
          existing_object_key: "customer",
          purpose: "Connect the enquiry to the person submitting it.",
        },
        {
          reference: "concept_2",
          label: "Catering Enquiry",
          disposition: "new",
          purpose: "Capture a corporate catering request.",
        },
      ],
      user_journeys: [],
      steps: [
        step("step_1", 1, "define_object", ["concept_2"]),
        step("step_2", 2, "define_field", ["concept_2"]),
        step("step_3", 3, "define_field", ["concept_2"]),
        step("step_4", 4, "define_field", ["concept_2"]),
        step("step_5", 5, "define_field", ["concept_2"]),
        step("step_6", 6, "define_field", ["concept_2"]),
        step(
          "step_7",
          7,
          "define_relationship",
          ["concept_1", "concept_2"],
          ["customer"],
        ),
        step("step_8", 8, "configure_form", ["concept_2"]),
        step("step_9", 9, "configure_view", ["concept_2"]),
        step("step_10", 10, "configure_page", ["concept_2"]),
      ],
    },
    unsupported_requirements: [],
  };
}

function cateringDraft(): BuilderConfigurationDraftOutput {
  const field = (
    reference: string,
    sourceStep: string,
    label: string,
    fieldType: "short_text" | "date" | "number" | "currency" | "long_text",
    required: boolean,
    settings: null | { currency: string } = null,
  ) => ({
    reference,
    source_step_references: [sourceStep],
    object_reference: {
      source: "draft" as const,
      object_reference: "draft_object_1",
    },
    label,
    required,
    field_type: fieldType,
    settings,
  });
  return {
    schema_version: 1,
    summary: "Draft summary marker BUILDER_SUMMARY_ALLOWED_MARKER.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_2",
        source_step_references: ["step_1"],
        singular_label: "Catering Enquiry",
        plural_label: "Catering Enquiries",
        description: "A corporate catering enquiry.",
      },
    ],
    fields: [
      field("draft_field_1", "step_2", "Company name", "short_text", true),
      field("draft_field_2", "step_3", "Event date", "date", true),
      field("draft_field_3", "step_4", "Number of guests", "number", true),
      field("draft_field_4", "step_5", "Budget", "currency", false, {
        currency: "GBP",
      }),
      field("draft_field_5", "step_6", "Notes", "long_text", false),
    ],
    relationships: [
      {
        reference: "draft_relationship_1",
        source_step_references: ["step_7"],
        source_object_reference: { source: "existing", object_key: "customer" },
        target_object_reference: {
          source: "draft",
          object_reference: "draft_object_1",
        },
        source_label: "submits",
        target_label: "Catering Enquiry",
        cardinality: "one_to_many",
        is_required: false,
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_8"],
        name: "Catering Enquiry form",
        object_reference: {
          source: "draft",
          object_reference: "draft_object_1",
        },
        mode: "create",
        audience: "public",
        fields: [
          "Company name",
          "Event date",
          "Number of guests",
          "Budget",
          "Notes",
        ].map((_, index) => ({
          field_reference: {
            source: "draft" as const,
            field_reference: `draft_field_${index + 1}`,
          },
          label: null,
          help_text: null,
        })),
        submit_label: "Send enquiry",
      },
    ],
    views: [
      {
        reference: "draft_view_1",
        source_step_references: ["step_9"],
        name: "Catering Enquiries",
        audience: "internal",
        object_reference: {
          source: "draft",
          object_reference: "draft_object_1",
        },
        view_type: "table",
        configuration: {
          fields: [1, 2, 3, 4, 5].map((index) => ({
            source: "draft" as const,
            field_reference: `draft_field_${index}`,
          })),
          title_field: null,
          create_form_reference: null,
          edit_form_reference: null,
        },
      },
    ],
    pages: [
      {
        reference: "draft_page_1",
        source_step_references: ["step_10"],
        title: "Catering Enquiries",
        audience: "public",
        blocks: [
          {
            type: "form" as const,
            form_reference: {
              source: "draft" as const,
              form_reference: "draft_form_1",
            },
          },
        ],
      },
    ],
  };
}

function clarificationOutput(): Extract<
  BuilderPlanOutput,
  { state: "needs_clarification" }
> {
  return {
    schema_version: 1,
    state: "needs_clarification",
    understanding: "A bounded clarification is needed.",
    known_requirements: ["The owner wants a new enquiry experience."],
    assumptions: [],
    questions: [
      {
        reference: "question_1",
        question: "Which details should customers provide?",
        reason: "This determines the form fields.",
        response_style: "multiple_choice",
        options: ["Event details", "Contact details"],
      },
    ],
    unsupported_requirements: [],
  };
}

function createDeterministicBuilder(
  planningOutput: BuilderPlanOutput,
  draftOutput: BuilderConfigurationDraftOutput,
) {
  const generateStructured = vi.fn(
    async (request: StructuredAiProviderRequest) => ({
      output:
        request.outputContract.name === "builder_plan_v1"
          ? planningOutput
          : draftOutput,
      usage: { inputTokens: 120, outputTokens: 40 },
      requestMetadata: { provider_transient_marker: "BUILDER_PROVIDER_MARKER" },
    }),
  );
  const provider = {
    key: "openai",
    generateStructured,
  };
  const runtime = createBuilderAiRuntime(
    { AI_PROVIDER: "openai", OPENAI_API_KEY: "test-only" },
    { createOpenAiProvider: () => provider },
  );
  return {
    service: createBuilderOrchestrationService({
      createRuntime: () => runtime,
    }),
    provider,
    generateStructured,
  };
}

async function enableAi(
  options: {
    requestLimit?: number;
    inputLimit?: number;
    outputLimit?: number;
    costLimitMicrousd?: number;
  } = {},
): Promise<void> {
  const updated = await owner.client.rpc("update_business_ai_settings", {
    expected_business_id: business.id,
    expected_actor_id: owner.user.id,
    requested_is_enabled: true,
    requested_daily_request_limit: options.requestLimit ?? 25,
    requested_daily_input_token_limit: options.inputLimit ?? 1_000_000,
    requested_daily_output_token_limit: options.outputLimit ?? 1_000_000,
    requested_daily_cost_limit_microusd:
      options.costLimitMicrousd ?? 100_000_000,
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

describe("Milestone 8 Phase 8B authenticated Builder orchestration", () => {
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
        business_name: `Builder outsider ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create outsider Business.",
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

  it("enforces authentication, membership, role and tenant boundaries", async () => {
    const cases = [
      ["anonymous", () => anonymous, business.id, "ai_context_unauthorized"],
      [
        "non-member",
        () => outsider.client,
        business.id,
        "ai_context_not_found",
      ],
      ["staff", () => staff.client, business.id, "ai_context_unauthorized"],
    ] as const;
    const providerBuilder = createDeterministicBuilder(
      clarificationOutput(),
      cateringDraft(),
    );

    await expect(
      providerBuilder.service.run(cases[0][1](), {
        businessId: cases[0][2],
        ownerRequest: "Clarify this request.",
      }),
    ).rejects.toMatchObject({ code: cases[0][3] });
    await expect(
      providerBuilder.service.run(cases[1][1](), {
        businessId: cases[1][2],
        ownerRequest: "Clarify this request.",
      }),
    ).rejects.toMatchObject({ code: cases[1][3] });
    await expect(
      providerBuilder.service.run(cases[2][1](), {
        businessId: cases[2][2],
        ownerRequest: "Clarify this request.",
      }),
    ).rejects.toMatchObject({ code: cases[2][3] });

    await expect(
      providerBuilder.service.run(outsider.client, {
        businessId: business.id,
        ownerRequest: "Clarify this request.",
      }),
    ).rejects.toMatchObject({ code: "ai_context_not_found" });

    await enableAi();
    expect(providerBuilder.generateStructured).not.toHaveBeenCalled();

    const ownerResult = await createDeterministicBuilder(
      clarificationOutput(),
      cateringDraft(),
    ).service.run(owner.client, {
      businessId: business.id,
      ownerRequest: "Clarify this request.",
    });
    expect(ownerResult.state).toBe("needs_clarification");

    await database`
      delete from public.ai_execution_runs
      where business_id = ${business.id}::uuid
    `;
    const adminResult = await createDeterministicBuilder(
      clarificationOutput(),
      cateringDraft(),
    ).service.run(administrator.client, {
      businessId: business.id,
      ownerRequest: "Clarify this request.",
    });
    expect(adminResult.state).toBe("needs_clarification");
  });

  it("keeps disabled AI from invoking the provider", async () => {
    const deterministic = createDeterministicBuilder(
      clarificationOutput(),
      cateringDraft(),
    );
    await expect(
      deterministic.service.run(owner.client, {
        businessId: business.id,
        ownerRequest: "Clarify this request.",
      }),
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(deterministic.generateStructured).not.toHaveBeenCalled();
    expect(await executionRows()).toHaveLength(0);
  });

  it("charges one settled planning execution for clarification only", async () => {
    await enableAi();
    const proposalsBefore = await proposalRows();
    const deterministic = createDeterministicBuilder(
      clarificationOutput(),
      cateringDraft(),
    );
    const result = await deterministic.service.run(owner.client, {
      businessId: business.id,
      ownerRequest:
        "Clarify this request with BUILDER_CLARIFICATION_RAW_MARKER.",
    });
    expect(result.state).toBe("needs_clarification");
    const rows = await executionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "succeeded",
      task_key: "builder_plan_v1",
      policy_key: "builder_planning_terra_medium_v1",
      provider_key: "openai",
      model_key: "gpt-5.6-terra",
    });
    expect(JSON.stringify(rows)).not.toContain(
      "BUILDER_CLARIFICATION_RAW_MARKER",
    );
    expect(
      rows.some((row) => row.task_key === "builder_configuration_draft_v1"),
    ).toBe(false);
    expect(await proposalRows()).toHaveLength(proposalsBefore.length);
  });

  it("creates one ordinary ten-operation Catering Enquiry proposal", async () => {
    await enableAi();
    const proposalsBefore = await proposalRows();
    const before = await liveState();
    const deterministic = createDeterministicBuilder(
      cateringPlan(),
      cateringDraft(),
    );
    const result = await deterministic.service.run(owner.client, {
      businessId: business.id,
      ownerRequest,
    });
    expect(result).toMatchObject({ state: "proposed", status: "proposed" });
    const rows = await executionRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_key: "builder_plan_v1",
          policy_key: "builder_planning_terra_medium_v1",
          model_key: "gpt-5.6-terra",
          status: "succeeded",
        }),
        expect.objectContaining({
          task_key: "builder_configuration_draft_v1",
          policy_key: "builder_configuration_drafting_terra_medium_v1",
          model_key: "gpt-5.6-terra",
          status: "succeeded",
        }),
      ]),
    );
    expect(deterministic.generateStructured).toHaveBeenCalledTimes(2);
    for (const call of deterministic.generateStructured.mock.calls) {
      expect(call[0].modelKey).toBe("gpt-5.6-terra");
    }

    const proposals = await proposalRows();
    expect(proposals).toHaveLength(proposalsBefore.length + 1);
    const proposal = proposals.at(-1)!;
    expect(proposal).toMatchObject({
      kind: "change",
      status: "proposed",
      description: null,
      validated_at: null,
      applied_at: null,
    });
    const operations = configurationOperationsSchema.parse(
      proposal.operations_json,
    );
    expect(operations).toHaveLength(10);
    expect(operations.filter(({ op }) => op === "set_object")).toHaveLength(1);
    expect(operations.filter(({ op }) => op === "set_field")).toHaveLength(5);
    expect(
      operations.filter(({ op }) => op === "set_relationship"),
    ).toHaveLength(1);
    expect(operations.filter(({ op }) => op === "set_form")).toHaveLength(1);
    expect(operations.filter(({ op }) => op === "set_view")).toHaveLength(1);
    expect(operations.filter(({ op }) => op === "set_page")).toHaveLength(1);
    expect(operations.some(({ op }) => op === "set_preorder_experience")).toBe(
      false,
    );
    expect(
      operations
        .filter(({ op }) => op === "set_field")
        .some((field) => field.key === "status"),
    ).toBe(false);
    const page = operations.find(({ op }) => op === "set_page");
    expect(page).toMatchObject({ status: "draft", audience: "public" });
    const after = await liveState();
    expect(after.head).toEqual(before.head);
    expect(after.versionCount).toBe(before.versionCount);
    expect(after.recordCount).toBe(before.recordCount);
    expect(after.edgeCount).toBe(before.edgeCount);
    expect(after.locations).toEqual(before.locations);
    expect(after.snapshot).toEqual(before.snapshot);
    const durable = JSON.stringify({ rows, proposal });
    expect(durable).not.toContain("BUILDER_RAW_REQUEST_MARKER");
    expect(durable).not.toContain("BUILDER_PLAN_TRANSIENT_MARKER");
    expect(durable).not.toContain("BUILDER_PROVIDER_MARKER");
    expect(durable).not.toContain("BUILDER_SUMMARY_ALLOWED_MARKER");
    expect(JSON.stringify(result)).toContain("BUILDER_SUMMARY_ALLOWED_MARKER");
  });

  it("settles planning before a remaining-budget drafting rejection", async () => {
    await enableAi({ requestLimit: 1 });
    const proposalsBefore = await proposalRows();
    const deterministic = createDeterministicBuilder(
      cateringPlan(),
      cateringDraft(),
    );
    await expect(
      deterministic.service.run(owner.client, {
        businessId: business.id,
        ownerRequest: "Prepare this request.",
      }),
    ).rejects.toMatchObject({ code: "ai_budget_exceeded" });
    const rows = await executionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_key: "builder_plan_v1",
      status: "succeeded",
    });
    expect(await proposalRows()).toHaveLength(proposalsBefore.length);
  });

  it("does not retry an injected final proposal conflict", async () => {
    await enableAi();
    const deterministic = createDeterministicBuilder(
      cateringPlan(),
      cateringDraft(),
    );
    const proposalService = {
      propose: vi
        .fn()
        .mockRejectedValue(
          new BuilderConfigurationProposalError(
            "ai_configuration_proposal_context_stale",
          ),
        ),
    };
    const service = createBuilderOrchestrationService({
      createRuntime: () =>
        createBuilderAiRuntime(
          { AI_PROVIDER: "openai", OPENAI_API_KEY: "test-only" },
          { createOpenAiProvider: () => deterministic.provider },
        ),
      proposalService,
    });
    const before = await proposalRows();
    await expect(
      service.run(owner.client, {
        businessId: business.id,
        ownerRequest: "Prepare the final conflict request.",
      }),
    ).rejects.toMatchObject({
      code: "ai_configuration_proposal_context_stale",
    });
    expect(proposalService.propose).toHaveBeenCalledOnce();
    expect(await proposalRows()).toHaveLength(before.length);
  });
});
