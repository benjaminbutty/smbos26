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

const actionHarness = vi.hoisted(() => ({
  clients: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/supabase/server", () => ({
  createServerClient: async () => {
    const client = actionHarness.clients.shift();
    if (!client) {
      throw new Error("No authenticated manual-amendment client was queued.");
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

import { preparePreorderScheduleProposalAction } from "../../src/app/app/[businessSlug]/setup/actions";
import {
  composePreorderScheduleAmendment,
  loadActiveManualAmendmentSnapshot,
} from "../../src/core/configuration/manual-amendments/service";
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

const businessSlug = "bedford-bakery-demo";
const preorderKey = "bakery_preorder";
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
let business: Tables<"businesses">;
let configuration: ConfigurationChangeService;
let createdAdminUserId: string | null = null;

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

function scheduleForm(
  baseVersionId: string,
  headRevision: number,
  schedule: {
    days_of_week: number[];
    start_time: string;
    end_time: string;
    slot_interval_minutes: number;
    slot_capacity: number;
    cutoff_hours: number;
    booking_horizon_days: number;
  },
): FormData {
  const form = new FormData();
  form.set("expectedBaseVersionId", baseVersionId);
  form.set("expectedHeadRevision", String(headRevision));
  for (const day of schedule.days_of_week) {
    form.append("daysOfWeek", String(day));
  }
  form.set("startTime", schedule.start_time);
  form.set("endTime", schedule.end_time);
  form.set("slotIntervalMinutes", String(schedule.slot_interval_minutes));
  form.set("slotCapacity", String(schedule.slot_capacity));
  form.set("cutoffHours", String(schedule.cutoff_hours));
  form.set("bookingHorizonDays", String(schedule.booking_horizon_days));
  return form;
}

async function actionRedirect(
  identity: Identity,
  form: FormData,
  slug = businessSlug,
): Promise<string> {
  actionHarness.clients.push(identity.client);
  try {
    await preparePreorderScheduleProposalAction(slug, preorderKey, form);
  } catch (error) {
    if (error instanceof Error && error.name === "ActionRedirect") {
      return error.message;
    }
    throw error;
  }
  throw new Error("Expected the manual amendment action to redirect.");
}

async function countRows(
  table: "configuration_change_sets" | "ai_execution_runs",
) {
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

async function captureNullRejectionState() {
  const rows = await sql<
    {
      ai_execution_runs: Json;
      head: Json;
      projection: Json;
      records: Json;
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
          jsonb_agg(to_jsonb(run_value) order by run_value.id),
          '[]'::jsonb
        )
        from public.ai_execution_runs as run_value
        where run_value.business_id = ${business.id}::uuid
      ) as ai_execution_runs
  `;
  if (!rows[0]) {
    throw new Error("Could not capture NULL-rejection state.");
  }
  return rows[0];
}

async function acceptanceStep<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`Manual acceptance failed while ${label}.`, {
      cause: error,
    });
  }
}

describe("Milestone 6 Phase 2A.1 manual amendment acceptance", () => {
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
    const adminEmail = `m6-manual-admin-${crypto.randomUUID()}@example.test`;
    const createdAdmin = await serviceRole.auth.admin.createUser({
      email: adminEmail,
      password: demoPassword,
      email_confirm: true,
    });
    if (createdAdmin.error || !createdAdmin.data.user) {
      throw createdAdmin.error ?? new Error("Could not create test Admin.");
    }
    createdAdminUserId = createdAdmin.data.user.id;
    requireData(
      await serviceRole
        .from("business_memberships")
        .insert({
          business_id: business.id,
          user_id: createdAdminUserId,
          role: "admin",
        })
        .select("*")
        .single(),
      "Could not create test Admin membership.",
    );
    administrator = await signIn(adminEmail);
    configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
  }, 180_000);

  afterAll(async () => {
    if (createdAdminUserId && serviceRole) {
      await serviceRole.auth.admin.deleteUser(createdAdminUserId);
    }
    if (sql) {
      await sql.end();
    }
  });

  it("exposes only the expected-head ordinary proposal signature", async () => {
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

    const before = await countRows("configuration_change_sets");
    const obsolete = await owner.client.rpc("propose_configuration_change", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_title: "Obsolete signature",
      requested_description: "",
      requested_operations: [],
    } as never);
    expect(obsolete.error).not.toBeNull();
    expect(await countRows("configuration_change_sets")).toBe(before);
  });

  it("fails closed for every NULL expected actor and head value while valid exact inputs still work", async () => {
    const active = await loadActiveManualAmendmentSnapshot(configuration);
    const amendment = composePreorderScheduleAmendment(active.snapshot, {
      intent: "update_preorder_schedule",
      preorderKey,
      schedule: {
        ...active.snapshot.preorder_experiences[0]!.config_json.schedule,
        cutoff_hours: 72,
      },
    });
    const args = {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      expected_base_version_id: active.baseVersionId,
      expected_head_revision: active.headRevision,
      requested_title: amendment.title,
      requested_description: amendment.description,
      requested_operations: [amendment.operation] as Json,
    };
    const proposalsBefore = await countRows("configuration_change_sets");
    const protectedStateBefore = await captureNullRejectionState();

    const nullActor = await owner.client.rpc("propose_configuration_change", {
      ...args,
      expected_actor_id: null,
    } as never);
    expect(nullActor.error?.message).toContain(
      "configuration_actor_context_mismatch",
    );
    expect(await countRows("configuration_change_sets")).toBe(proposalsBefore);
    expect(await captureNullRejectionState()).toEqual(protectedStateBefore);

    const nullVersion = await owner.client.rpc("propose_configuration_change", {
      ...args,
      expected_base_version_id: null,
    } as never);
    expect(nullVersion.error?.message).toContain(
      "configuration_proposal_stale",
    );
    expect(await countRows("configuration_change_sets")).toBe(proposalsBefore);
    expect(await captureNullRejectionState()).toEqual(protectedStateBefore);

    const nullRevision = await owner.client.rpc(
      "propose_configuration_change",
      {
        ...args,
        expected_head_revision: null,
      } as never,
    );
    expect(nullRevision.error?.message).toContain(
      "configuration_proposal_stale",
    );
    expect(await countRows("configuration_change_sets")).toBe(proposalsBefore);
    expect(await captureNullRejectionState()).toEqual(protectedStateBefore);

    const nullVersionAndRevision = await owner.client.rpc(
      "propose_configuration_change",
      {
        ...args,
        expected_base_version_id: null,
        expected_head_revision: null,
      } as never,
    );
    expect(nullVersionAndRevision.error?.message).toContain(
      "configuration_proposal_stale",
    );
    expect(await countRows("configuration_change_sets")).toBe(proposalsBefore);
    expect(await captureNullRejectionState()).toEqual(protectedStateBefore);

    const exactCurrent = await owner.client.rpc(
      "propose_configuration_change",
      args,
    );
    expect(exactCurrent.error).toBeNull();
    expect(exactCurrent.data).toMatchObject({
      base_version_id: active.baseVersionId,
      base_head_revision: active.headRevision,
      business_id: business.id,
      requested_by: owner.user.id,
      status: "proposed",
    });
    expect(await countRows("configuration_change_sets")).toBe(
      proposalsBefore + 1,
    );
    expect(await captureNullRejectionState()).toEqual(protectedStateBefore);
  });

  it("rejects Staff, anonymous, forged actor, version and revision values without writes", async () => {
    const active = await loadActiveManualAmendmentSnapshot(configuration);
    const amendment = composePreorderScheduleAmendment(active.snapshot, {
      intent: "update_preorder_schedule",
      preorderKey,
      schedule: {
        ...active.snapshot.preorder_experiences[0]!.config_json.schedule,
        cutoff_hours: 72,
      },
    });
    const args = {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      expected_base_version_id: active.baseVersionId,
      expected_head_revision: active.headRevision,
      requested_title: amendment.title,
      requested_description: amendment.description,
      requested_operations: [amendment.operation] as Json,
    };
    const before = await countRows("configuration_change_sets");

    const staffAttempt = await staff.client.rpc(
      "propose_configuration_change",
      {
        ...args,
        expected_actor_id: staff.user.id,
      },
    );
    expect(staffAttempt.error?.message).toContain(
      "configuration_owner_or_admin_required",
    );
    const anonymousAttempt = await anonymous.rpc(
      "propose_configuration_change",
      args,
    );
    expect(anonymousAttempt.error).not.toBeNull();
    const forgedActor = await owner.client.rpc("propose_configuration_change", {
      ...args,
      expected_actor_id: administrator.user.id,
    });
    expect(forgedActor.error?.message).toContain(
      "configuration_actor_context_mismatch",
    );
    const wrongVersion = await owner.client.rpc(
      "propose_configuration_change",
      {
        ...args,
        expected_base_version_id: crypto.randomUUID(),
      },
    );
    expect(wrongVersion.error?.message).toContain(
      "configuration_proposal_stale",
    );
    const wrongRevision = await owner.client.rpc(
      "propose_configuration_change",
      {
        ...args,
        expected_head_revision: active.headRevision + 1,
      },
    );
    expect(wrongRevision.error?.message).toContain(
      "configuration_proposal_stale",
    );
    expect(await countRows("configuration_change_sets")).toBe(before);

    const staffForm = scheduleForm(
      active.baseVersionId,
      active.headRevision,
      active.snapshot.preorder_experiences[0]!.config_json.schedule,
    );
    actionHarness.clients.push(staff.client);
    await expect(
      preparePreorderScheduleProposalAction(
        businessSlug,
        preorderKey,
        staffForm,
      ),
    ).rejects.toMatchObject({ name: "ActionNotFound" });

    expect(
      await actionRedirect(
        administrator,
        scheduleForm(
          active.baseVersionId,
          active.headRevision,
          active.snapshot.preorder_experiences[0]!.config_json.schedule,
        ),
      ),
    ).toContain("notice=nothing_changed");
  });

  it("creates only one reviewable proposal, previews it, applies deliberately, and rejects the stale rendered form", async () => {
    const active = await acceptanceStep("loading the active snapshot", () =>
      loadActiveManualAmendmentSnapshot(configuration),
    );
    const preorder = active.snapshot.preorder_experiences.find(
      (candidate) => candidate.key === preorderKey,
    )!;
    expect(active.headRevision).toBe(2);
    expect(preorder.config_json.schedule.days_of_week).toEqual([6, 7]);
    expect(preorder.config_json.schedule.cutoff_hours).toBe(48);

    const recordsBefore = requireData(
      await serviceRole
        .from("records")
        .select("*")
        .eq("business_id", business.id)
        .order("id"),
      "Could not capture Bedford Records.",
    );
    const publicBefore = await acceptanceStep("loading the live preorder", () =>
      resolvePublicPreorder(anonymous, businessSlug, "preorder", preorderKey),
    );
    expect(publicBefore?.preorder.schedule.days_of_week).toEqual([6, 7]);
    expect(publicBefore?.preorder.schedule.cutoff_hours).toBe(48);

    const noOpBefore = await countRows("configuration_change_sets");
    expect(
      await acceptanceStep("submitting a no-op", () =>
        actionRedirect(
          owner,
          scheduleForm(
            active.baseVersionId,
            active.headRevision,
            preorder.config_json.schedule,
          ),
        ),
      ),
    ).toContain("notice=nothing_changed");
    expect(await countRows("configuration_change_sets")).toBe(noOpBefore);

    const changedSchedule = {
      ...preorder.config_json.schedule,
      days_of_week: [6],
      cutoff_hours: 72,
    };
    const form = scheduleForm(
      active.baseVersionId,
      active.headRevision,
      changedSchedule,
    );
    for (const [name, value] of Object.entries({
      business_id: crypto.randomUUID(),
      actor_id: administrator.user.id,
      title: "Forged title",
      description: "Forged description",
      operations_json: '[{"op":"set_object"}]',
      config_json: "{}",
      field_mappings: "{}",
      public_fields: "[]",
      allowed_location_ids: "[]",
      candidate_checksum: "forged",
      status: "applied",
    })) {
      form.set(name, value);
    }
    const proposalCountBefore = await countRows("configuration_change_sets");
    const redirectPath = await acceptanceStep(
      "preparing the manual proposal",
      () => actionRedirect(owner, form),
    );
    expect(redirectPath).toMatch(
      /^\/app\/bedford-bakery-demo\/changes\/[0-9a-f-]+$/,
    );
    const proposalId = redirectPath.split("/").at(-1)!;
    const proposal = await acceptanceStep("loading the proposal", () =>
      configuration.getChangeSet(proposalId),
    );
    expect(await countRows("configuration_change_sets")).toBe(
      proposalCountBefore + 1,
    );
    expect(proposal).toMatchObject({
      business_id: business.id,
      requested_by: owner.user.id,
      title: "Update preorder collection settings",
      status: "proposed",
      validation_result_json: null,
      applied_version_id: null,
      base_version_id: active.baseVersionId,
      base_head_revision: active.headRevision,
    });
    expect(proposal.description).toContain("Remove Sunday collection");
    expect(proposal.description).toContain(
      "Change notice from 48 hours to 72 hours",
    );
    expect(JSON.stringify(proposal.operations_json)).not.toContain(
      "Forged title",
    );
    expect(await configuration.getActiveHead()).toMatchObject({
      active_version_id: active.baseVersionId,
      head_revision: active.headRevision,
    });
    expect(
      (
        await resolvePublicPreorder(
          anonymous,
          businessSlug,
          "preorder",
          preorderKey,
        )
      )?.preorder.schedule,
    ).toEqual(publicBefore?.preorder.schedule);
    expect(await countRows("ai_execution_runs")).toBe(0);

    const preview = await acceptanceStep("loading candidate preview", () =>
      resolveConfigurationPreviewPreorder(owner.client, {
        businessId: business.id,
        actorId: owner.user.id,
        changeSetId: proposal.id,
        pageKey: "public_preorder",
        preorderKey,
      }),
    );
    expect(preview?.preorder.schedule.days_of_week).toEqual([6]);
    expect(preview?.preorder.schedule.cutoff_hours).toBe(72);

    const validated = await acceptanceStep("validating deliberately", () =>
      configuration.validateChangeSet(proposal.id),
    );
    expect(validated.status).toBe("validated");
    const applied = await acceptanceStep("applying deliberately", () =>
      configuration.applyChangeSet(proposal.id),
    );
    expect(applied.status).toBe("applied");
    const currentHead = await configuration.getActiveHead();
    expect(currentHead).toMatchObject({
      head_revision: 3,
      active_version_id: applied.applied_version_id,
    });
    const publicAfter = await resolvePublicPreorder(
      anonymous,
      businessSlug,
      "preorder",
      preorderKey,
    );
    expect(publicAfter?.preorder.schedule.days_of_week).toEqual([6]);
    expect(publicAfter?.preorder.schedule.cutoff_hours).toBe(72);
    expect(
      requireData(
        await serviceRole
          .from("records")
          .select("*")
          .eq("business_id", business.id)
          .order("id"),
        "Could not reload Bedford Records.",
      ),
    ).toEqual(recordsBefore);
    expect(await countRows("ai_execution_runs")).toBe(0);

    const proposalsBeforeStale = await countRows("configuration_change_sets");
    const staleForm = scheduleForm(active.baseVersionId, active.headRevision, {
      ...changedSchedule,
      cutoff_hours: 96,
    });
    expect(
      await acceptanceStep("submitting the stale rendered form", () =>
        actionRedirect(owner, staleForm),
      ),
    ).toContain("notice=stale");
    expect(await countRows("configuration_change_sets")).toBe(
      proposalsBeforeStale,
    );
    const preserved = await loadActiveManualAmendmentSnapshot(configuration);
    expect(
      preserved.snapshot.preorder_experiences.find(
        (candidate) => candidate.key === preorderKey,
      )?.config_json.schedule,
    ).toMatchObject({
      days_of_week: [6],
      cutoff_hours: 72,
    });
  }, 60_000);

  it("allows competing exact-head proposals and preserves existing stale-base conflict behavior", async () => {
    const active = await loadActiveManualAmendmentSnapshot(configuration);
    const currentSchedule = active.snapshot.preorder_experiences.find(
      (candidate) => candidate.key === preorderKey,
    )!.config_json.schedule;
    const ownerAmendment = composePreorderScheduleAmendment(active.snapshot, {
      intent: "update_preorder_schedule",
      preorderKey,
      schedule: { ...currentSchedule, cutoff_hours: 80 },
    });
    const adminAmendment = composePreorderScheduleAmendment(active.snapshot, {
      intent: "update_preorder_schedule",
      preorderKey,
      schedule: { ...currentSchedule, cutoff_hours: 96 },
    });
    const adminConfiguration = new ConfigurationChangeService(
      administrator.client,
      {
        businessId: business.id,
        actorId: administrator.user.id,
      },
    );
    const [ownerProposal, adminProposal] = await Promise.all([
      configuration.proposeChangeSet({
        expectedBaseVersionId: active.baseVersionId,
        expectedHeadRevision: active.headRevision,
        title: ownerAmendment.title,
        description: ownerAmendment.description,
        operations: [ownerAmendment.operation],
      }),
      adminConfiguration.proposeChangeSet({
        expectedBaseVersionId: active.baseVersionId,
        expectedHeadRevision: active.headRevision,
        title: adminAmendment.title,
        description: adminAmendment.description,
        operations: [adminAmendment.operation],
      }),
    ]);
    expect(ownerProposal.base_version_id).toBe(active.baseVersionId);
    expect(adminProposal.base_version_id).toBe(active.baseVersionId);
    expect(adminProposal.requested_by).toBe(administrator.user.id);

    expect(
      (await configuration.validateChangeSet(ownerProposal.id)).status,
    ).toBe("validated");
    expect(
      (await adminConfiguration.validateChangeSet(adminProposal.id)).status,
    ).toBe("validated");
    expect((await configuration.applyChangeSet(ownerProposal.id)).status).toBe(
      "applied",
    );
    expect(
      (await adminConfiguration.applyChangeSet(adminProposal.id)).status,
    ).toBe("conflicted");
    expect(
      (await adminConfiguration.getChangeSet(adminProposal.id)).base_version_id,
    ).toBe(active.baseVersionId);
  });
});
