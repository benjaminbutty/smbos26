import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database, Tables } from "../../src/db/supabase/database.types";

const actionHarness = vi.hoisted(() => ({
  clients: [] as unknown[],
  revalidations: [] as Array<[string, string | undefined]>,
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
vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => {
    actionHarness.revalidations.push([path, type]);
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

import {
  abandonConfigurationChangeAction,
  applyConfigurationChangeAction,
  prepareConfigurationRollbackAction,
  validateConfigurationChangeAction,
} from "../../src/app/app/[businessSlug]/changes/actions";
import { createGraphService } from "../../src/core/graph/service";
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type ChangeSet = Tables<"configuration_change_sets">;
type Identity = { client: Client; user: User };

const password = "Milestone-5-phase-5b-actions!";
const createdUserIds: string[] = [];
const createdBusinessIds: string[] = [];

let settings: LocalSupabaseSettings;
let sql: Sql;
let serviceRole: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let anonymous: Client;

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
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.user) {
    throw result.error ?? new Error(`Could not sign in ${email}.`);
  }
  return { client, user: result.data.user };
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `m5-phase5b-${label}-${crypto.randomUUID()}@example.test`;
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

async function createScenarioBusiness(label: string): Promise<Business> {
  const business = requireData(
    await owner.client.rpc("create_business", {
      business_name: `${label} ${crypto.randomUUID()}`,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    }),
    `Could not create ${label}`,
  );
  createdBusinessIds.push(business.id);
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
  return business;
}

function service(identity: Identity, business: Business) {
  return new ConfigurationChangeService(identity.client, {
    businessId: business.id,
    actorId: identity.user.id,
  });
}

function queueActionClients(...clients: Client[]): void {
  actionHarness.clients = [...clients];
  actionHarness.revalidations = [];
}

async function redirectPath(action: Promise<never>): Promise<string> {
  try {
    await action;
    throw new Error("Expected the Server Action to redirect.");
  } catch (error) {
    if (error instanceof Error && error.name === "ActionRedirect") {
      return error.message;
    }
    throw error;
  }
}

async function navigationOutcome(
  action: Promise<never>,
): Promise<{ name: string; message: string }> {
  try {
    await action;
    throw new Error("Expected the Server Action to end navigation.");
  } catch (error) {
    if (
      error instanceof Error &&
      ["ActionRedirect", "ActionNotFound"].includes(error.name)
    ) {
      return { name: error.name, message: error.message };
    }
    throw error;
  }
}

function objectOperation(key: string, label: string) {
  return {
    op: "set_object" as const,
    key,
    singular_label: label,
    plural_label: `${label}s`,
    description: "",
    icon: null,
    is_active: true,
  };
}

async function proposeObject(
  identity: Identity,
  business: Business,
  key: string,
): Promise<ChangeSet> {
  return service(identity, business).proposeChangeSet({
    title: `Add ${key}`,
    description: null,
    operations: [objectOperation(key, key.replaceAll("_", " "))],
  });
}

async function validateThroughAction(
  identity: Identity,
  business: Business,
  proposal: ChangeSet,
): Promise<ChangeSet> {
  queueActionClients(identity.client);
  const path = await redirectPath(
    validateConfigurationChangeAction(
      business.slug,
      proposal.id,
      new FormData(),
    ),
  );
  expect(path).toMatch(
    new RegExp(`/changes/${proposal.id}\\?notice=validated$`),
  );
  return service(identity, business).getChangeSet(proposal.id);
}

async function applyThroughAction(
  identity: Identity,
  business: Business,
  proposal: ChangeSet,
): Promise<ChangeSet> {
  queueActionClients(identity.client);
  const path = await redirectPath(
    applyConfigurationChangeAction(business.slug, proposal.id, new FormData()),
  );
  expect(path).toMatch(new RegExp(`/changes/${proposal.id}\\?notice=applied$`));
  return service(identity, business).getChangeSet(proposal.id);
}

async function installObject(
  identity: Identity,
  business: Business,
  key: string,
): Promise<ChangeSet> {
  const proposal = await proposeObject(identity, business, key);
  await validateThroughAction(identity, business, proposal);
  return applyThroughAction(identity, business, proposal);
}

const operationalTables = [
  "records",
  "record_relationships",
  "record_location_links",
  "preorder_submissions",
  "preorder_slot_counters",
  "preorder_rate_limits",
] as const;

const lifecycleExcludedTables = [
  ...operationalTables,
  "object_definitions",
  "field_definitions",
  "relationship_definitions",
  "views",
  "forms",
  "pages",
  "preorder_experiences",
  "preorder_experience_locations",
  "configuration_versions",
  "business_configuration_heads",
  "locations",
] as const;

async function captureTables(
  businessId: string,
  tables: readonly string[],
): Promise<Record<string, unknown>> {
  const state: Record<string, unknown> = {};
  for (const tableName of tables) {
    state[tableName] = await sql`
      select to_jsonb(tenant_row) as row
      from ${sql(tableName)} as tenant_row
      where tenant_row.business_id = ${businessId}::uuid
      order by to_jsonb(tenant_row)::text
    `;
  }
  return state;
}

describe("Milestone 5 Phase 5B real Server Action lifecycle", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    sql = postgres(settings.databaseUrl, { max: 4 });
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
    [owner, administrator, staff] = await Promise.all([
      createIdentity("owner"),
      createIdentity("admin"),
      createIdentity("staff"),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (serviceRole && createdBusinessIds.length > 0) {
      await serviceRole
        .from("businesses")
        .delete()
        .in("id", createdBusinessIds);
    }
    if (serviceRole) {
      await Promise.all(
        createdUserIds.map((userId) =>
          serviceRole.auth.admin.deleteUser(userId),
        ),
      );
    }
    await owner?.client.auth.signOut();
    await administrator?.client.auth.signOut();
    await staff?.client.auth.signOut();
    await sql?.end();
  });

  it("runs valid Owner/Admin validation and application exactly once", async () => {
    const business = await createScenarioBusiness("Action valid lifecycle");
    const proposal = await proposeObject(owner, business, "catering_enquiry");
    const beforeValidation = await captureTables(
      business.id,
      lifecycleExcludedTables,
    );

    const validated = await validateThroughAction(owner, business, proposal);
    expect(validated.status).toBe("validated");
    expect(await captureTables(business.id, lifecycleExcludedTables)).toEqual(
      beforeValidation,
    );

    const beforeOperational = await captureTables(
      business.id,
      operationalTables,
    );
    const beforeVersions = await service(owner, business).listVersions();
    const beforeHead = await service(owner, business).getActiveHead();
    const applied = await applyThroughAction(
      administrator,
      business,
      validated,
    );
    const afterVersions = await service(owner, business).listVersions();
    const afterHead = await service(owner, business).getActiveHead();

    expect(applied.status).toBe("applied");
    expect(afterVersions).toHaveLength(beforeVersions.length + 1);
    expect(afterHead.head_revision).toBe(beforeHead.head_revision + 1);
    expect(afterHead.active_version_id).toBe(applied.applied_version_id);
    expect(afterVersions[0]?.snapshot_json).toEqual(
      applied.candidate_snapshot_json,
    );
    expect(await captureTables(business.id, operationalTables)).toEqual(
      beforeOperational,
    );
    expect(actionHarness.revalidations).toContainEqual([
      `/app/${business.slug}`,
      "layout",
    ]);

    queueActionClients(owner.client);
    const retryPath = await redirectPath(
      applyConfigurationChangeAction(
        business.slug,
        proposal.id,
        new FormData(),
      ),
    );
    expect(retryPath).toContain("notice=applied");
    expect(await service(owner, business).listVersions()).toHaveLength(
      afterVersions.length,
    );
  });

  it("allows both Owner and Admin to complete every available action type", async () => {
    for (const [role, identity] of [
      ["owner", owner],
      ["admin", administrator],
    ] as const) {
      const business = await createScenarioBusiness(
        `Action ${role} permission matrix`,
      );
      const firstProposal = await proposeObject(
        identity,
        business,
        `${role}_first`,
      );
      await validateThroughAction(identity, business, firstProposal);
      const appliedV2 = await applyThroughAction(
        identity,
        business,
        firstProposal,
      );
      const v2 = await service(identity, business).getVersion(
        appliedV2.applied_version_id!,
      );

      const abandonedProposal = await proposeObject(
        identity,
        business,
        `${role}_abandoned`,
      );
      queueActionClients(identity.client);
      expect(
        await redirectPath(
          abandonConfigurationChangeAction(
            business.slug,
            abandonedProposal.id,
            new FormData(),
          ),
        ),
      ).toContain("notice=abandoned");

      await installObject(identity, business, `${role}_second`);
      const head = await service(identity, business).getActiveHead();
      const form = new FormData();
      form.set(
        "title",
        `Restore configuration from Version ${v2.version_number}`,
      );
      queueActionClients(identity.client);
      const rollbackPath = await redirectPath(
        prepareConfigurationRollbackAction(
          business.slug,
          v2.id,
          head.active_version_id,
          head.head_revision,
          form,
        ),
      );
      expect(rollbackPath).toContain("notice=rollback_prepared");
      const rollback = (await service(identity, business).listChangeSets())[0]!;
      expect(rollback.kind).toBe("rollback");
      expect(rollback.requested_by).toBe(identity.user.id);
    }
  });

  it("rejects operationally incompatible proposals with owner-safe stored errors and no unintended writes", async () => {
    const business = await createScenarioBusiness("Action invalid lifecycle");
    const setup = await service(owner, business).proposeChangeSet({
      title: "Install compatibility fixture",
      description: null,
      operations: [
        objectOperation("compatibility_probe", "Compatibility probe"),
        {
          op: "set_field",
          object_key: "compatibility_probe",
          key: "value",
          label: "Value",
          field_type: "short_text",
          required: true,
          default_value: null,
          settings_json: {},
          position: 0,
          is_active: true,
        },
      ],
    });
    await validateThroughAction(owner, business, setup);
    await applyThroughAction(owner, business, setup);
    const object = requireData(
      await owner.client
        .from("object_definitions")
        .select("*")
        .eq("business_id", business.id)
        .eq("key", "compatibility_probe")
        .single(),
      "Could not load compatibility Object",
    );
    await createGraphService(owner.client, {
      businessId: business.id,
    }).createRecord({
      objectDefinitionId: object.id,
      data: { value: "not-a-number" },
      recordStatus: "active",
    });

    const proposal = await service(owner, business).proposeChangeSet({
      title: "Make existing values numeric",
      description: null,
      operations: [
        {
          op: "set_field",
          object_key: "compatibility_probe",
          key: "value",
          label: "Value",
          field_type: "number",
          required: true,
          default_value: null,
          settings_json: {},
          position: 0,
          is_active: true,
        },
      ],
    });
    const before = await captureTables(business.id, lifecycleExcludedTables);
    queueActionClients(owner.client);
    const path = await redirectPath(
      validateConfigurationChangeAction(
        business.slug,
        proposal.id,
        new FormData(),
      ),
    );
    const rejected = await service(owner, business).getChangeSet(proposal.id);

    expect(path).toContain("notice=validation_rejected");
    expect(rejected.status).toBe("rejected");
    expect(rejected.validation_result_json).toMatchObject({
      outcome: "invalid",
    });
    expect(JSON.stringify(rejected.validation_result_json)).not.toMatch(
      /sqlstate|public\.|private\.|stack/i,
    );
    expect(await captureTables(business.id, lifecycleExcludedTables)).toEqual(
      before,
    );
  });

  it("abandons proposed work without changing configuration, history, or operational data", async () => {
    const business = await createScenarioBusiness("Action abandonment");
    const proposal = await proposeObject(owner, business, "abandon_probe");
    const before = await captureTables(business.id, lifecycleExcludedTables);
    const forged = new FormData();
    forged.set("businessId", crypto.randomUUID());
    forged.set("actorId", crypto.randomUUID());
    forged.set("status", "applied");
    forged.set("candidate", '{"forged":true}');
    forged.set("operations", "[]");
    forged.set("checksum", "forged");

    queueActionClients(administrator.client);
    const path = await redirectPath(
      abandonConfigurationChangeAction(business.slug, proposal.id, forged),
    );
    const abandoned = await service(owner, business).getChangeSet(proposal.id);
    expect(path).toContain("notice=abandoned");
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.closed_by).toBe(administrator.user.id);
    expect(await captureTables(business.id, lifecycleExcludedTables)).toEqual(
      before,
    );

    queueActionClients(owner.client);
    const repeated = await redirectPath(
      abandonConfigurationChangeAction(
        business.slug,
        proposal.id,
        new FormData(),
      ),
    );
    expect(repeated).toContain("notice=abandoned");
  });

  it("prepares and applies a forward-only rollback while operational state stays untouched", async () => {
    const business = await createScenarioBusiness("Action rollback");
    const v2Change = await installObject(owner, business, "first_item");
    const v2 = await service(owner, business).getVersion(
      v2Change.applied_version_id!,
    );
    await installObject(owner, business, "second_item");
    const currentHead = await service(owner, business).getActiveHead();
    const currentVersion = await service(owner, business).getVersion(
      currentHead.active_version_id,
    );
    const beforeNonProposal = await captureTables(
      business.id,
      lifecycleExcludedTables,
    );
    const beforeProposalCount = (
      await service(owner, business).listChangeSets()
    ).length;
    const form = new FormData();
    form.set(
      "title",
      `Restore configuration from Version ${v2.version_number}`,
    );
    form.set("description", "Forward-only restoration proof.");
    form.set("businessId", crypto.randomUUID());
    form.set("candidate_snapshot_json", "{}");

    queueActionClients(administrator.client);
    const preparedPath = await redirectPath(
      prepareConfigurationRollbackAction(
        business.slug,
        v2.id,
        currentHead.active_version_id,
        currentHead.head_revision,
        form,
      ),
    );
    expect(preparedPath).toContain("notice=rollback_prepared");
    const proposals = await service(owner, business).listChangeSets();
    expect(proposals).toHaveLength(beforeProposalCount + 1);
    const rollbackProposal = proposals[0]!;
    expect(rollbackProposal.kind).toBe("rollback");
    expect(rollbackProposal.status).toBe("proposed");
    expect(rollbackProposal.rollback_target_version_id).toBe(v2.id);
    expect(await captureTables(business.id, lifecycleExcludedTables)).toEqual(
      beforeNonProposal,
    );

    const beforeOperational = await captureTables(
      business.id,
      operationalTables,
    );
    await validateThroughAction(administrator, business, rollbackProposal);
    const applied = await applyThroughAction(owner, business, rollbackProposal);
    const rollbackVersion = await service(owner, business).getVersion(
      applied.applied_version_id!,
    );
    const finalHead = await service(owner, business).getActiveHead();
    expect(rollbackVersion.kind).toBe("rollback");
    expect(rollbackVersion.parent_version_id).toBe(currentVersion.id);
    expect(rollbackVersion.restored_from_version_id).toBe(v2.id);
    expect(finalHead.active_version_id).toBe(rollbackVersion.id);
    expect(await captureTables(business.id, operationalTables)).toEqual(
      beforeOperational,
    );
  });

  it("enforces anonymous, Staff, malformed, and cross-Business forgery boundaries", async () => {
    const business = await createScenarioBusiness("Action security");
    const otherBusiness = await createScenarioBusiness("Action other tenant");
    const proposal = await proposeObject(owner, business, "secure_probe");
    const before = await captureTables(business.id, lifecycleExcludedTables);

    const head = await service(owner, business).getActiveHead();
    const baseline = (await service(owner, business).listVersions())[0]!;
    for (const client of [staff.client, anonymous]) {
      const deniedActions = [
        () =>
          validateConfigurationChangeAction(
            business.slug,
            proposal.id,
            new FormData(),
          ),
        () =>
          applyConfigurationChangeAction(
            business.slug,
            proposal.id,
            new FormData(),
          ),
        () =>
          abandonConfigurationChangeAction(
            business.slug,
            proposal.id,
            new FormData(),
          ),
        () => {
          const form = new FormData();
          form.set("title", "Denied rollback");
          return prepareConfigurationRollbackAction(
            business.slug,
            baseline.id,
            head.active_version_id,
            head.head_revision,
            form,
          );
        },
      ];
      for (const deniedAction of deniedActions) {
        queueActionClients(client);
        const outcome = await navigationOutcome(deniedAction());
        expect(["ActionNotFound", "ActionRedirect"]).toContain(outcome.name);
      }
    }

    queueActionClients(owner.client);
    expect(
      await navigationOutcome(
        validateConfigurationChangeAction(
          otherBusiness.slug,
          proposal.id,
          new FormData(),
        ),
      ),
    ).toMatchObject({ name: "ActionNotFound" });

    queueActionClients(owner.client);
    expect(
      await navigationOutcome(
        validateConfigurationChangeAction(
          business.slug,
          "not-a-uuid",
          new FormData(),
        ),
      ),
    ).toMatchObject({ name: "ActionNotFound" });

    const otherHead = await service(owner, otherBusiness).getActiveHead();
    const rollbackForm = new FormData();
    rollbackForm.set("title", "Forged cross-tenant rollback");
    queueActionClients(owner.client);
    expect(
      await navigationOutcome(
        prepareConfigurationRollbackAction(
          otherBusiness.slug,
          (await service(owner, business).listVersions())[0]!.id,
          otherHead.active_version_id,
          otherHead.head_revision,
          rollbackForm,
        ),
      ),
    ).toMatchObject({ name: "ActionNotFound" });

    expect(await captureTables(business.id, lifecycleExcludedTables)).toEqual(
      before,
    );
  });

  it("linearizes duplicate and competing submissions into legal final states", async () => {
    const duplicateBusiness = await createScenarioBusiness(
      "Action duplicate apply",
    );
    const duplicateProposal = await proposeObject(
      owner,
      duplicateBusiness,
      "duplicate_probe",
    );
    await validateThroughAction(owner, duplicateBusiness, duplicateProposal);
    const versionsBefore = await service(
      owner,
      duplicateBusiness,
    ).listVersions();
    queueActionClients(owner.client, administrator.client);
    const duplicateResults = await Promise.all([
      redirectPath(
        applyConfigurationChangeAction(
          duplicateBusiness.slug,
          duplicateProposal.id,
          new FormData(),
        ),
      ),
      redirectPath(
        applyConfigurationChangeAction(
          duplicateBusiness.slug,
          duplicateProposal.id,
          new FormData(),
        ),
      ),
    ]);
    expect(
      duplicateResults.every((path) => path.includes("notice=applied")),
    ).toBe(true);
    expect(await service(owner, duplicateBusiness).listVersions()).toHaveLength(
      versionsBefore.length + 1,
    );

    const abandonRaceBusiness = await createScenarioBusiness(
      "Action validate abandon race",
    );
    const raceProposal = await proposeObject(
      owner,
      abandonRaceBusiness,
      "race_probe",
    );
    queueActionClients(owner.client, administrator.client);
    await Promise.all([
      navigationOutcome(
        validateConfigurationChangeAction(
          abandonRaceBusiness.slug,
          raceProposal.id,
          new FormData(),
        ),
      ),
      navigationOutcome(
        abandonConfigurationChangeAction(
          abandonRaceBusiness.slug,
          raceProposal.id,
          new FormData(),
        ),
      ),
    ]);
    expect(
      ["validated", "rejected", "conflicted", "abandoned"].includes(
        (
          await service(owner, abandonRaceBusiness).getChangeSet(
            raceProposal.id,
          )
        ).status,
      ),
    ).toBe(true);

    const competitionBusiness = await createScenarioBusiness(
      "Action competing apply",
    );
    const proposalA = await proposeObject(
      owner,
      competitionBusiness,
      "proposal_a",
    );
    const proposalB = await proposeObject(
      owner,
      competitionBusiness,
      "proposal_b",
    );
    await validateThroughAction(owner, competitionBusiness, proposalA);
    await validateThroughAction(administrator, competitionBusiness, proposalB);
    queueActionClients(owner.client, administrator.client);
    await Promise.all([
      navigationOutcome(
        applyConfigurationChangeAction(
          competitionBusiness.slug,
          proposalA.id,
          new FormData(),
        ),
      ),
      navigationOutcome(
        applyConfigurationChangeAction(
          competitionBusiness.slug,
          proposalB.id,
          new FormData(),
        ),
      ),
    ]);
    const finalA = await service(owner, competitionBusiness).getChangeSet(
      proposalA.id,
    );
    const finalB = await service(owner, competitionBusiness).getChangeSet(
      proposalB.id,
    );
    expect([finalA.status, finalB.status].toSorted()).toEqual([
      "applied",
      "conflicted",
    ]);
  });

  it("fails safely when a rendered action or rollback confirmation becomes stale", async () => {
    const business = await createScenarioBusiness("Action stale render");
    const staleProposal = await proposeObject(
      owner,
      business,
      "stale_proposal",
    );
    queueActionClients(administrator.client);
    await redirectPath(
      abandonConfigurationChangeAction(
        business.slug,
        staleProposal.id,
        new FormData(),
      ),
    );
    queueActionClients(owner.client);
    expect(
      await redirectPath(
        validateConfigurationChangeAction(
          business.slug,
          staleProposal.id,
          new FormData(),
        ),
      ),
    ).toContain("notice=state_changed");

    const appliedV2 = await installObject(owner, business, "rollback_target");
    const v2 = await service(owner, business).getVersion(
      appliedV2.applied_version_id!,
    );
    await installObject(owner, business, "head_before_render");
    const renderedHead = await service(owner, business).getActiveHead();
    await installObject(owner, business, "head_after_render");
    const proposalsBefore = (await service(owner, business).listChangeSets())
      .length;
    const form = new FormData();
    form.set(
      "title",
      `Restore configuration from Version ${v2.version_number}`,
    );

    queueActionClients(owner.client);
    const path = await redirectPath(
      prepareConfigurationRollbackAction(
        business.slug,
        v2.id,
        renderedHead.active_version_id,
        renderedHead.head_revision,
        form,
      ),
    );
    expect(path).toContain("notice=state_changed");
    expect(await service(owner, business).listChangeSets()).toHaveLength(
      proposalsBefore,
    );
  });
});
