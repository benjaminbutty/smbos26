import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  builderConfigurationProposalService,
  createBuilderConfigurationProposalService,
} from "../../src/ai/configuration-proposal/service";
import {
  builderConfigurationProposalRequestSchema,
  type BuilderConfigurationProposalRequest,
} from "../../src/ai/configuration-proposal/contracts";
import { projectAiBusinessModelContext } from "../../src/ai/context/projector";
import {
  loadAuthoritativeAiBusinessContext,
  type AuthoritativeAiBusinessContext,
} from "../../src/core/configuration/builder-context-source";
import type {
  BuilderPlanOutput,
  BuilderReadyPlanStep,
} from "../../src/ai/planning/schemas";
import type {
  BuilderConfigurationDraftOutput,
  BuilderConfigurationDraftTaskInput,
} from "../../src/ai/configuration-drafting/schemas";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../../src/core/configuration/service";
import {
  configurationOperationsSchema,
  type ConfigurationOperation,
} from "../../src/core/configuration/schemas";
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
type Location = Tables<"locations">;
type ChangeSet = Tables<"configuration_change_sets">;
type ConfigurationPlanCategory = Extract<
  BuilderReadyPlanStep,
  { lane: "configuration" }
>["category"];

const password = "Milestone-7-proposal-test-password!";
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];
const ownerRequest =
  "Create a Catering Enquiry with Company name, Event date, Number of guests, Budget and Notes.";

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
let location: Location;

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
  selectedPassword = password,
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
  const email = `m7-proposal-${label}-${crypto.randomUUID()}@example.test`;
  const created = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
  createdUserIds.push(created.data.user.id);
  return signIn(email);
}

async function createBusiness(
  identity: Identity,
  name: string,
): Promise<Business> {
  const created = await identity.client.rpc("create_business", {
    business_name: name,
    requested_business_type: "catering",
    requested_timezone: "Europe/London",
  });
  const createdBusiness = requireData(created, `Could not create ${name}.`);
  createdBusinessIds.push(createdBusiness.id);
  return createdBusiness;
}

function customerOperations(): ConfigurationOperation[] {
  return configurationOperationsSchema.parse([
    {
      op: "set_object",
      key: "customer",
      singular_label: "Customer",
      plural_label: "Customers",
      description: "A person or organisation that contacts the Business.",
      icon: null,
      is_active: true,
    },
    {
      op: "set_field",
      object_key: "customer",
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 0,
      is_active: true,
    },
  ]);
}

async function applyConfiguration(
  identity: Identity,
  operations: ConfigurationOperation[],
  title: string,
): Promise<ChangeSet> {
  const authoritative = await loadAuthoritativeAiBusinessContext(
    identity.client,
    { businessId: business.id },
  );
  const service = new ConfigurationChangeService(
    identity.client,
    authoritative.executionContext,
  );
  const proposal = await service.proposeChangeSet({
    expectedBaseVersionId: authoritative.currentness.baseVersionId,
    expectedHeadRevision: authoritative.currentness.headRevision,
    title,
    description: null,
    operations,
  });
  await service.validateChangeSet(proposal.id);
  return service.applyChangeSet(proposal.id);
}

function step(
  reference: string,
  sequence: number,
  category: ConfigurationPlanCategory,
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
    understanding:
      "The Business wants to collect corporate catering enquiries.",
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
    summary: "Create a Catering Enquiry with five requested fields.",
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
        source_object_reference: {
          source: "existing",
          object_key: "customer",
        },
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

function cateringHandoff(
  authoritative: AuthoritativeAiBusinessContext,
): BuilderConfigurationProposalRequest {
  const modelContext = projectAiBusinessModelContext(
    authoritative.source,
  ).modelContext;
  const taskInput: BuilderConfigurationDraftTaskInput = {
    schema_version: 1,
    owner_request: ownerRequest,
    business_context: modelContext,
    ready_plan: cateringPlan(),
  };
  return builderConfigurationProposalRequestSchema.parse({
    businessId: business.id,
    expectedCurrentness: authoritative.currentness,
    taskInput,
    draft: cateringDraft(),
  });
}

async function context(
  identity: Identity,
): Promise<AuthoritativeAiBusinessContext> {
  return loadAuthoritativeAiBusinessContext(identity.client, {
    businessId: business.id,
  });
}

async function liveSnapshot(): Promise<Json> {
  const [row] = await database<{ snapshot: Json }[]>`
    select private.configuration_snapshot_v1(${business.id}::uuid) as snapshot
  `;
  if (!row) {
    throw new Error("Could not read the live configuration snapshot.");
  }
  return row.snapshot;
}

async function state() {
  const [
    head,
    versions,
    proposals,
    records,
    edges,
    locations,
    executions,
    aiSettings,
  ] = await Promise.all([
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
      .from("configuration_change_sets")
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
    database<{ id: string; status: string }[]>`
        select id, status
        from public.ai_execution_runs
        where business_id = ${business.id}::uuid
        order by id
      `,
    database<Record<string, Json>[]>`
        select *
        from public.business_ai_settings
        where business_id = ${business.id}::uuid
      `,
  ]);
  if (
    head.error ||
    !head.data ||
    versions.error ||
    proposals.error ||
    records.error ||
    edges.error ||
    locations.error
  ) {
    throw new Error("Could not capture Business state.");
  }
  return {
    head: head.data,
    versionCount: versions.count ?? 0,
    proposalCount: proposals.count ?? 0,
    recordCount: records.count ?? 0,
    edgeCount: edges.count ?? 0,
    locations: locations.data,
    executions,
    aiSettings,
    liveSnapshot: await liveSnapshot(),
  };
}

async function addCustomerField(
  identity: Identity,
  key: string,
  label: string,
): Promise<ChangeSet> {
  return applyConfiguration(
    identity,
    [
      {
        op: "set_field",
        object_key: "customer",
        key,
        label,
        field_type: "short_text",
        required: false,
        default_value: null,
        settings_json: {},
        position: key === "email" ? 1 : 2,
        is_active: true,
      },
    ],
    `Competing ${label}`,
  );
}

describe("Milestone 7 Phase 2 authenticated configuration proposal orchestration", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
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
    [owner, administrator, staff, outsider] = await Promise.all([
      createIdentity("owner"),
      createIdentity("admin"),
      createIdentity("staff"),
      createIdentity("outsider"),
    ]);
    business = await createBusiness(
      owner,
      `Proposal Business ${crypto.randomUUID()}`,
    );
    outsiderBusiness = await createBusiness(
      outsider,
      `Outsider Business ${crypto.randomUUID()}`,
    );
    const membership = await serviceRole.from("business_memberships").insert([
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
    location = requireData(
      await owner.client.rpc("create_location", {
        target_business_id: business.id,
        location_name: "Bedford",
        requested_timezone: "Europe/London",
      }),
      "Could not create the test Location.",
    );
    await applyConfiguration(owner, customerOperations(), "Install Customer");
  }, 180_000);

  afterAll(async () => {
    if (database) {
      await database.end();
    }
    if (serviceRole) {
      for (const businessId of createdBusinessIds) {
        await serviceRole.from("businesses").delete().eq("id", businessId);
      }
      for (const userId of createdUserIds) {
        await serviceRole.auth.admin.deleteUser(userId);
      }
    }
  });

  it("creates exactly one proposed Catering Enquiry change through M5", async () => {
    const before = await state();
    const beforeContext = await context(owner);
    const result = await builderConfigurationProposalService.propose(
      owner.client,
      cateringHandoff(beforeContext),
    );

    expect(result).toMatchObject({
      schema_version: 1,
      status: "proposed",
      base_version_id: beforeContext.currentness.baseVersionId,
      base_head_revision: beforeContext.currentness.headRevision,
      operation_count: 10,
    });
    expect(result.proposal_id).toMatch(/^[0-9a-f-]{36}$/);

    const m5 = new ConfigurationChangeService(
      owner.client,
      beforeContext.executionContext,
    );
    const changeSet = await m5.getChangeSet(result.proposal_id);
    const operations = configurationOperationsSchema.parse(
      changeSet.operations_json,
    );
    expect(changeSet).toMatchObject({
      business_id: business.id,
      kind: "change",
      status: "proposed",
      requested_by: owner.user.id,
      title: "Proposed configuration changes",
      description: null,
      base_version_id: beforeContext.currentness.baseVersionId,
      base_head_revision: beforeContext.currentness.headRevision,
      operations_schema_version: 1,
      validated_at: null,
      validated_by: null,
      validation_result_json: null,
      applied_at: null,
      applied_by: null,
      applied_version_id: null,
      closed_at: null,
    });
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

    const cateringObject = operations.find(
      (operation) =>
        operation.op === "set_object" && operation.key === "catering_enquiry",
    );
    expect(cateringObject).toMatchObject({
      singular_label: "Catering Enquiry",
      plural_label: "Catering Enquiries",
    });
    const fields = operations.filter(
      (
        operation,
      ): operation is Extract<ConfigurationOperation, { op: "set_field" }> =>
        operation.op === "set_field" &&
        operation.object_key === "catering_enquiry",
    );
    expect(fields.map(({ label }) => label)).toEqual([
      "Company name",
      "Event date",
      "Number of guests",
      "Budget",
      "Notes",
    ]);
    expect(fields.some(({ key }) => key === "status")).toBe(false);

    const relationship = operations.find(({ op }) => op === "set_relationship");
    expect(relationship).toMatchObject({
      source_object_key: "customer",
      target_object_key: "catering_enquiry",
      source_label: "submits",
      target_label: "Catering Enquiry",
    });
    const page = operations.find(({ op }) => op === "set_page");
    expect(page).toMatchObject({ audience: "public", status: "draft" });
    expect(changeSet.candidate_snapshot_json).toEqual(
      expect.objectContaining({ schema_version: 1 }),
    );
    expect(changeSet.id_allocations_json).not.toEqual({});
    expect(changeSet.semantic_diff_json).toEqual(
      expect.objectContaining({ schema_version: 1 }),
    );

    const after = await state();
    expect(after.head).toEqual(before.head);
    expect(after.versionCount).toBe(before.versionCount);
    expect(after.recordCount).toBe(before.recordCount);
    expect(after.edgeCount).toBe(before.edgeCount);
    expect(after.locations).toEqual(before.locations);
    expect(after.executions).toEqual(before.executions);
    expect(after.aiSettings).toEqual(before.aiSettings);
    expect(after.liveSnapshot).toEqual(before.liveSnapshot);
    expect(after.proposalCount).toBe(before.proposalCount + 1);

    const preview = await m5.loadPreview(result.proposal_id);
    expect(preview.proposalId).toBe(result.proposal_id);
    expect(preview.status).toBe("proposed");
    expect(preview.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: expect.stringMatching(/catering_enquiries/),
        }),
      ]),
    );
    expect(await m5.listChangeSets()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: result.proposal_id }),
      ]),
    );
  }, 120_000);

  it("allows Admin and keeps requested_by bound to the authenticated actor", async () => {
    const administratorContext = await context(administrator);
    const result = await builderConfigurationProposalService.propose(
      administrator.client,
      cateringHandoff(administratorContext),
    );
    const m5 = new ConfigurationChangeService(
      administrator.client,
      administratorContext.executionContext,
    );
    const changeSet = await m5.getChangeSet(result.proposal_id);
    expect(changeSet).toMatchObject({
      status: "proposed",
      requested_by: administrator.user.id,
      business_id: business.id,
    });
  }, 120_000);

  it("denies Staff, outsider, anonymous, service-role and cross-Business callers", async () => {
    const before = await state();
    const validOwnerHandoff = cateringHandoff(await context(owner));
    const calls: Array<() => Promise<unknown>> = [
      () =>
        builderConfigurationProposalService.propose(
          staff.client,
          validOwnerHandoff,
        ),
      () =>
        builderConfigurationProposalService.propose(
          outsider.client,
          validOwnerHandoff,
        ),
      () =>
        builderConfigurationProposalService.propose(
          anonymous,
          validOwnerHandoff,
        ),
      () =>
        builderConfigurationProposalService.propose(
          serviceRole,
          validOwnerHandoff,
        ),
      () =>
        builderConfigurationProposalService.propose(owner.client, {
          ...validOwnerHandoff,
          businessId: outsiderBusiness.id,
        }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(Error);
    }
    const after = await state();
    expect(after.proposalCount).toBe(before.proposalCount);
    expect(after.head).toEqual(before.head);
    expect(after.liveSnapshot).toEqual(before.liveSnapshot);
  }, 120_000);

  it("rejects stale handoffs before compilation and never rebases them", async () => {
    const staleContext = await context(owner);
    const staleHandoff = cateringHandoff(staleContext);
    const before = await state();
    await addCustomerField(owner, "email", "Email");

    await expect(
      builderConfigurationProposalService.propose(owner.client, staleHandoff),
    ).rejects.toMatchObject({
      code: "ai_configuration_proposal_context_stale",
    });
    const after = await state();
    expect(after.proposalCount).toBe(before.proposalCount + 1);
    expect(after.head.head_revision).toBe(before.head.head_revision + 1);
    expect(after.liveSnapshot).not.toEqual(before.liveSnapshot);
  }, 120_000);

  it("rejects model-context drift even when the configuration head is unchanged", async () => {
    const handoff = cateringHandoff(await context(owner));
    const before = await state();
    const changed = await owner.client
      .from("locations")
      .update({ name: "Changed Bedford" })
      .eq("business_id", business.id)
      .eq("id", location.id)
      .select("id")
      .single();
    if (changed.error) {
      throw changed.error;
    }
    let assertionError: unknown;
    try {
      await expect(
        builderConfigurationProposalService.propose(owner.client, handoff),
      ).rejects.toMatchObject({
        code: "ai_configuration_proposal_context_stale",
      });
    } catch (error) {
      assertionError = error;
    }
    const restored = await owner.client
      .from("locations")
      .update({ name: "Bedford" })
      .eq("business_id", business.id)
      .eq("id", location.id);
    if (restored.error) {
      throw restored.error;
    }
    if (assertionError) {
      throw assertionError;
    }
    const after = await state();
    expect(after.head).toEqual(before.head);
    expect(after.proposalCount).toBe(before.proposalCount);
  }, 120_000);

  it("maps the final atomic M5 stale race without retry or rebase", async () => {
    const raceContext = await context(owner);
    const handoff = cateringHandoff(raceContext);
    const before = await state();
    let competed = false;
    const service = createBuilderConfigurationProposalService({
      createProposalAdapter: (client, executionContext) => ({
        proposeChangeSet: async (input) => {
          if (!competed) {
            competed = true;
            await addCustomerField(administrator, "phone", "Phone");
          }
          return new ConfigurationChangeService(
            client,
            executionContext,
          ).proposeChangeSet(input);
        },
      }),
    });

    await expect(service.propose(owner.client, handoff)).rejects.toMatchObject({
      code: "ai_configuration_proposal_context_stale",
    });
    const after = await state();
    expect(competed).toBe(true);
    expect(after.proposalCount).toBe(before.proposalCount + 1);
    expect(after.head.head_revision).toBe(before.head.head_revision + 1);
  }, 120_000);

  it("does not persist request, context, plan, draft summary or provider metadata", async () => {
    const marker = `RAW_HANDOFF_MARKER_${crypto.randomUUID()}`;
    const authoritative = await context(owner);
    const handoff = cateringHandoff(authoritative);
    const before = await state();
    handoff.taskInput.owner_request = marker;
    handoff.draft.summary = `${marker}_draft_summary`;
    handoff.taskInput.ready_plan.understanding = `${marker}_plan`;
    const result = await builderConfigurationProposalService.propose(
      owner.client,
      handoff,
    );
    expect(result.status).toBe("proposed");
    const after = await state();
    expect(after.proposalCount).toBe(before.proposalCount + 1);
    expect(JSON.stringify(after)).not.toContain(marker);
    expect(JSON.stringify(handoff)).toContain(marker);
  }, 120_000);

  it("maps the M5 no-change and failure outcomes to bounded errors", async () => {
    const authoritative = await context(owner);
    const noChange = new ConfigurationChangeServiceError("internal", {
      message: "configuration_proposal_no_changes",
    });
    const noChangeService = createBuilderConfigurationProposalService({
      createProposalAdapter: () => ({
        proposeChangeSet: async () => {
          throw noChange;
        },
      }),
    });
    await expect(
      noChangeService.propose(owner.client, cateringHandoff(authoritative)),
    ).rejects.toMatchObject({
      code: "ai_configuration_proposal_no_changes",
    });

    const failure = new ConfigurationChangeServiceError("internal", {
      message: "configuration_projection_out_of_sync",
    });
    const failedService = createBuilderConfigurationProposalService({
      createProposalAdapter: () => ({
        proposeChangeSet: async () => {
          throw failure;
        },
      }),
    });
    await expect(
      failedService.propose(owner.client, cateringHandoff(authoritative)),
    ).rejects.toMatchObject({
      code: "ai_configuration_proposal_failed",
    });
  }, 120_000);
});
