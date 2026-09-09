import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConfigurationChangeService } from "../src/core/configuration/service";
import {
  applyDirectTableAction,
  loadDirectTableConfiguration,
} from "../src/core/configuration/direct-tables/service";
import { createGraphService } from "../src/core/graph/service";
import {
  createSiteDraft,
  prepareSiteRelease,
  publishSiteRelease,
  saveSiteDraft,
} from "../src/core/sites/service";
import { siteDraftV1Schema } from "../src/core/sites/schemas";
import type { Database, Tables } from "../src/db/supabase/database.types";
import {
  getC1LocalSupabaseSettings,
  type C1LocalSupabaseSettings,
} from "./support/c1-local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;

type Identity = { client: Client; email: string; user: User };
type C1RpcClient = {
  rpc<T>(
    name: string,
    argumentsValue: Record<string, string | number | null | object>,
  ): Promise<{ data: T | null; error: { message?: string } | null }>;
};

type SiteState = {
  active_release_id: string | null;
  active_release_revision: number;
  draft_base_head_revision: number;
  draft_base_version_id: string;
  draft_revision: number;
  id: string;
};

type SiteStateQueryClient = {
  from(table: "site_states"): {
    select(columns: "*"): {
      eq(
        column: "business_id",
        value: string,
      ): {
        single(): Promise<{ data: SiteState | null; error: unknown | null }>;
      };
    };
  };
};

type SiteReadClient = {
  from(table: "site_states" | "site_releases"): {
    select(columns: string): {
      eq(
        column: "business_id",
        value: string,
      ): Promise<{ data: Array<{ id: string }> | null; error: unknown | null }>;
    };
  };
};

const createdBusinessIds: string[] = [];
const createdUserIds: string[] = [];
const password = "Sites-C1-integration-password!";

let settings: C1LocalSupabaseSettings;
let admin: Client;
let anonymous: Client;
let fixtureSql: Sql;
let owner: Identity;
let otherOwner: Identity;
let administrator: Identity;
let staff: Identity;
let business: Business;
let otherBusiness: Business;
let recordId: string;
let recordTwoId: string;
let otherRecordId: string;
let siteId: string;

function c1Rpc(client: Client): C1RpcClient {
  return client as unknown as C1RpcClient;
}

function siteReads(client: Client): SiteReadClient {
  return client as unknown as SiteReadClient;
}

function siteDraft(
  recordIds: [string, string],
  options: {
    accent?: string;
    logoAssetId?: string;
    publicFieldKeys?: string[];
    title?: string;
  } = {},
) {
  return siteDraftV1Schema.parse({
    schema_version: 1,
    branding: {
      name: "C1 records",
      accent: options.accent ?? "forest",
      ...(options.logoAssetId ? { logo_asset_id: options.logoAssetId } : {}),
    },
    pages: [
      {
        id: "00000000-0000-4000-8000-000000000101",
        title: options.title ?? "Home",
        slug: "about",
        navigation_label: "Home",
        is_home: true,
        is_in_navigation: true,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "collection",
              id: "00000000-0000-4000-8000-000000000102",
              object_key: "product",
              selection: { schema_version: 1, record_ids: [recordIds[0]] },
              public_field_keys: options.publicFieldKeys ?? ["name", "price"],
              presentation: "cards",
            },
            {
              type: "collection",
              id: "00000000-0000-4000-8000-000000000103",
              object_key: "product",
              selection: { schema_version: 1, record_ids: [recordIds[1]] },
              public_field_keys: options.publicFieldKeys ?? ["name", "price"],
              presentation: "rows",
            },
          ],
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000111",
        title: "Excluded page",
        slug: "excluded",
        navigation_label: "Excluded",
        is_home: false,
        is_in_navigation: false,
        is_included: false,
        layout: {
          blocks: [
            {
              type: "heading",
              id: "00000000-0000-4000-8000-000000000112",
              text: "Must stay private",
              level: 2,
            },
          ],
        },
      },
    ],
  });
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `sites-c1-${label}-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw created.error;
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
  if (signedIn.error) throw signedIn.error;
  return { client, email, user: created.data.user };
}

async function createAdditionalSession(identity: Identity): Promise<Client> {
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
    email: identity.email,
    password,
  });
  if (signedIn.error) throw signedIn.error;
  return client;
}

async function createBusiness(
  identity: Identity,
  name: string,
): Promise<Business> {
  const result = await identity.client.rpc("create_business", {
    business_name: name,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  if (result.error || !result.data) throw result.error;
  createdBusinessIds.push(result.data.id);
  return result.data;
}

async function currentSiteState() {
  const database = admin as unknown as SiteStateQueryClient;
  const result = await database
    .from("site_states")
    .select("*")
    .eq("business_id", business.id)
    .single();
  if (result.error || !result.data) throw result.error;
  return result.data;
}

async function versionCount(): Promise<number> {
  const result = await admin
    .from("configuration_versions")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id);
  if (result.error || result.count === null) throw result.error;
  return result.count;
}

function siteContext(identity: Identity = owner) {
  return { businessId: business.id, actorId: identity.user.id };
}

function siteCurrentness(state: SiteState) {
  return {
    expectedDraftRevision: state.draft_revision,
    expectedBaseVersionId: state.draft_base_version_id,
    expectedHeadRevision: state.draft_base_head_revision,
  };
}

async function saveCurrentDraft(
  draft: ReturnType<typeof siteDraft>,
  identity: Identity = owner,
) {
  const state = await currentSiteState();
  return saveSiteDraft(identity.client, siteContext(identity), {
    siteId,
    expectedDraftRevision: state.draft_revision,
    draft,
  });
}

async function prepareCurrentRelease(identity: Identity = owner) {
  const state = await currentSiteState();
  return prepareSiteRelease(identity.client, siteContext(identity), {
    siteId,
    ...siteCurrentness(state),
  });
}

async function publishCurrentRelease(
  candidateId: string,
  identity: Identity = owner,
) {
  const state = await currentSiteState();
  return publishSiteRelease(identity.client, siteContext(identity), {
    siteId,
    candidateId,
    ...siteCurrentness(state),
  });
}

async function createMediaAsset(
  targetBusiness: Business = business,
  createdBy: Identity = owner,
) {
  const result = await admin
    .from("media_assets")
    .insert({
      business_id: targetBusiness.id,
      storage_key: `${targetBusiness.id}/${crypto.randomUUID()}.png`,
      mime_type: "image/png",
      byte_size: 128,
      width: 16,
      height: 16,
      created_by: createdBy.user.id,
    })
    .select()
    .single();
  if (result.error || !result.data) throw result.error;
  return result.data;
}

async function cleanupClaim(assetId: string): Promise<string | null> {
  const result = await c1Rpc(admin).rpc<string | null>(
    "claim_site_media_asset_for_cleanup",
    { expected_business_id: business.id, requested_asset_id: assetId },
  );
  if (result.error) throw result.error;
  return result.data;
}

async function applyConfigurationOperations(
  operations: Parameters<
    ConfigurationChangeService["proposeChangeSet"]
  >[0]["operations"],
  title: string,
) {
  const configuration = new ConfigurationChangeService(
    owner.client,
    siteContext(),
  );
  const proposal = await configuration.proposeChangeSet({
    ...(await configuration.getProposalCurrentness()),
    title,
    description: "Sites C1 integration fixture.",
    operations,
  });
  const validated = await configuration.validateChangeSet(proposal.id);
  if (validated.status !== "validated") {
    throw new Error(`Configuration fixture was rejected: ${validated.id}`);
  }
  return configuration.applyChangeSet(proposal.id);
}

async function siteReferenceCount(
  table: string,
  assetId: string,
): Promise<number> {
  const rows = await fixtureSql.unsafe(
    `select count(*)::integer as count from public.${table} where business_id = $1 and asset_id = $2`,
    [business.id, assetId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function waitForPreparationToHoldHead(lockProbe: Sql): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await lockProbe.unsafe(
        "select 1 from public.business_configuration_heads where business_id = $1 for update nowait",
        [business.id],
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if ((error as { code?: string }).code === "55P03") return;
      }
      throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Preparation did not reach its configuration-head lock.");
}

async function prepareThroughAuthenticatedDatabaseConnection(
  state: SiteState,
): Promise<string> {
  const connection = postgres(settings.databaseUrl, { max: 1 });
  try {
    return await connection.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction.unsafe(
        "select set_config('request.jwt.claim.sub', $1, true)",
        [owner.user.id],
      );
      await transaction.unsafe(
        "select set_config('request.jwt.claim.role', 'authenticated', true)",
      );
      await transaction.unsafe(
        "select set_config('request.jwt.claims', $1, true)",
        [JSON.stringify({ role: "authenticated", sub: owner.user.id })],
      );
      const release = await transaction.unsafe<{ id: string }[]>(
        "select (public.prepare_site_release($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, $6::bigint)).id as id",
        [
          business.id,
          owner.user.id,
          siteId,
          state.draft_revision,
          state.draft_base_version_id,
          state.draft_base_head_revision,
        ],
      );
      const releaseId = release[0]?.id;
      if (!releaseId)
        throw new Error("Preparation did not return a candidate.");
      return releaseId;
    });
  } finally {
    await connection.end();
  }
}

describe("Lenni Sites C1 database foundation", () => {
  beforeAll(async () => {
    settings = getC1LocalSupabaseSettings();
    fixtureSql = postgres(settings.databaseUrl, { max: 1 });
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
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
    [owner, otherOwner, administrator, staff] = await Promise.all([
      createIdentity("owner"),
      createIdentity("other-owner"),
      createIdentity("administrator"),
      createIdentity("staff"),
    ]);
    business = await createBusiness(owner, `Sites C1 ${crypto.randomUUID()}`);
    otherBusiness = await createBusiness(
      otherOwner,
      `Other Sites C1 ${crypto.randomUUID()}`,
    );

    const memberships = await admin.from("business_memberships").insert([
      {
        business_id: business.id,
        user_id: administrator.user.id,
        role: "admin",
      },
      { business_id: business.id, user_id: staff.user.id, role: "staff" },
    ]);
    if (memberships.error) throw memberships.error;

    const configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
    const proposal = await configuration.proposeChangeSet({
      ...(await configuration.getProposalCurrentness()),
      title: "Add products for Sites C1",
      description: "Integration fixture.",
      operations: [
        {
          op: "set_object",
          key: "product",
          singular_label: "Product",
          plural_label: "Products",
          description: "A Site collection fixture.",
          icon: null,
          is_active: true,
        },
        {
          op: "set_field",
          object_key: "product",
          key: "name",
          label: "Name",
          field_type: "short_text",
          required: true,
          default_value: null,
          settings_json: {},
          position: 0,
          is_active: true,
        },
        {
          op: "set_field",
          object_key: "product",
          key: "price",
          label: "Price",
          field_type: "number",
          required: false,
          default_value: null,
          settings_json: {},
          position: 1,
          is_active: true,
        },
        {
          op: "set_field",
          object_key: "product",
          key: "internal_note",
          label: "Internal note",
          field_type: "long_text",
          required: false,
          default_value: null,
          settings_json: {},
          position: 2,
          is_active: true,
        },
      ],
    });
    await configuration.validateChangeSet(proposal.id);
    await configuration.applyChangeSet(proposal.id);
    const product = await admin
      .from("object_definitions")
      .select("id")
      .eq("business_id", business.id)
      .eq("key", "product")
      .single();
    if (product.error || !product.data) throw product.error;
    const record = await createGraphService(owner.client, {
      businessId: business.id,
    }).createRecord({
      objectDefinitionId: product.data.id,
      data: { name: "Frozen name", price: 10, internal_note: "Do not publish" },
      recordStatus: "active",
    });
    recordId = record.id;
    const secondRecord = await createGraphService(owner.client, {
      businessId: business.id,
    }).createRecord({
      objectDefinitionId: product.data.id,
      data: { name: "Second frozen name", price: 12, internal_note: "Private" },
      recordStatus: "active",
    });
    recordTwoId = secondRecord.id;

    const otherConfiguration = new ConfigurationChangeService(
      otherOwner.client,
      {
        businessId: otherBusiness.id,
        actorId: otherOwner.user.id,
      },
    );
    const otherProposal = await otherConfiguration.proposeChangeSet({
      ...(await otherConfiguration.getProposalCurrentness()),
      title: "Add isolated product",
      description: "Sites C1 cross-tenant fixture.",
      operations: [
        {
          op: "set_object",
          key: "product",
          singular_label: "Product",
          plural_label: "Products",
          description: "Isolated fixture.",
          icon: null,
          is_active: true,
        },
        {
          op: "set_field",
          object_key: "product",
          key: "foreign_only",
          label: "Foreign only",
          field_type: "short_text",
          required: false,
          default_value: null,
          settings_json: {},
          position: 0,
          is_active: true,
        },
      ],
    });
    await otherConfiguration.validateChangeSet(otherProposal.id);
    await otherConfiguration.applyChangeSet(otherProposal.id);
    const otherProduct = await admin
      .from("object_definitions")
      .select("id")
      .eq("business_id", otherBusiness.id)
      .eq("key", "product")
      .single();
    if (otherProduct.error || !otherProduct.data) throw otherProduct.error;
    const otherRecord = await createGraphService(otherOwner.client, {
      businessId: otherBusiness.id,
    }).createRecord({
      objectDefinitionId: otherProduct.data.id,
      data: { foreign_only: "not ours" },
      recordStatus: "active",
    });
    otherRecordId = otherRecord.id;

    const state = await createSiteDraft(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      { draft: siteDraft([record.id, secondRecord.id]) },
    );
    siteId = state.id;
  });

  afterAll(async () => {
    if (createdBusinessIds.length > 0) {
      await admin.from("businesses").delete().in("id", createdBusinessIds);
    }
    for (const userId of createdUserIds)
      await admin.auth.admin.deleteUser(userId);
    await fixtureSql.end();
  });

  it("rejects raw null currentness inputs and cross-tenant candidate IDs", async () => {
    const raw = await c1Rpc(owner.client).rpc("prepare_site_release", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_site_id: siteId,
      expected_draft_revision: null,
      expected_base_version_id: null,
      expected_head_revision: null,
    });
    expect(raw.error?.message).toContain("site_request_invalid");

    const state = await currentSiteState();
    const prepared = await prepareSiteRelease(
      owner.client,
      { businessId: business.id, actorId: owner.user.id },
      {
        siteId,
        expectedDraftRevision: state.draft_revision,
        expectedBaseVersionId: state.draft_base_version_id,
        expectedHeadRevision: state.draft_base_head_revision,
      },
    );
    const attack = await c1Rpc(otherOwner.client).rpc("publish_site_release", {
      expected_business_id: otherBusiness.id,
      expected_actor_id: otherOwner.user.id,
      requested_site_id: siteId,
      requested_candidate_id: prepared.id,
      expected_draft_revision: state.draft_revision,
      expected_base_version_id: state.draft_base_version_id,
      expected_head_revision: state.draft_base_head_revision,
    });
    expect(attack.error?.message).toContain("site_release_not_found");
  });

  it("rejects malformed raw draft JSON at the SQL boundary without changing the saved revision", async () => {
    const [before] = await fixtureSql.unsafe<
      Array<{ draft_json: unknown; draft_revision: number }>
    >(
      "select draft_json, draft_revision from public.site_states where business_id = $1",
      [business.id],
    );
    if (!before) throw new Error("Expected the fixture Site state.");
    const valid = siteDraft([recordId, recordTwoId]);
    const variants: Array<{ name: string; draft: object }> = [
      {
        name: "unknown root key",
        draft: (() => {
          const draft = structuredClone(valid) as Record<string, unknown>;
          draft.unexpected = true;
          return draft;
        })(),
      },
      {
        name: "missing required branding",
        draft: (() => {
          const draft = structuredClone(valid) as Record<string, unknown>;
          delete draft.branding;
          return draft;
        })(),
      },
      {
        name: "explicit JSON null",
        draft: (() => {
          const draft = structuredClone(valid) as {
            pages: Array<Record<string, unknown>>;
          };
          draft.pages[0]!.title = null;
          return draft;
        })(),
      },
      {
        name: "numeric text in a reused heading atom",
        draft: (() => {
          const draft = structuredClone(valid) as {
            pages: Array<{
              layout: { blocks: unknown[] };
            }>;
          };
          draft.pages[0]!.layout.blocks.unshift({
            type: "heading",
            id: "00000000-0000-4000-8000-000000000120",
            text: 42,
            level: 2,
          });
          return draft;
        })(),
      },
    ];
    for (const variant of variants) {
      const result = await c1Rpc(owner.client).rpc("save_site_draft", {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        expected_draft_revision: before.draft_revision,
        requested_draft: variant.draft,
      });
      expect(result.error?.message, variant.name).toContain(
        "site_draft_invalid",
      );
    }
    const [after] = await fixtureSql.unsafe<
      Array<{ draft_json: unknown; draft_revision: number }>
    >(
      "select draft_json, draft_revision from public.site_states where business_id = $1",
      [business.id],
    );
    expect(after).toEqual(before);
  });

  it("freezes approved fields, omits excluded Pages, and makes concurrent source-only publication a release CAS", async () => {
    const initial = await prepareCurrentRelease();
    expect(initial.configuration_change_set_id).not.toBeNull();
    await publishCurrentRelease(initial.id);

    const state = await currentSiteState();
    const versionsBeforeSourceOnly = await versionCount();
    const candidateA = await prepareCurrentRelease();
    expect(candidateA.configuration_change_set_id).toBeNull();
    const projection = candidateA.projection_json as {
      pages: Array<{
        slug: string;
        layout: {
          blocks: Array<{ records?: Array<{ id: string; values: object }> }>;
        };
      }>;
    };
    expect(projection.pages).toHaveLength(1);
    expect(projection.pages[0]?.slug).toBe("about");
    expect(projection.pages[0]?.layout.blocks).toMatchObject([
      {
        records: [{ id: recordId, values: { name: "Frozen name", price: 10 } }],
      },
      {
        records: [
          {
            id: recordTwoId,
            values: { name: "Second frozen name", price: 12 },
          },
        ],
      },
    ]);
    expect(JSON.stringify(candidateA.projection_json)).not.toContain(
      "internal_note",
    );

    await createGraphService(owner.client, {
      businessId: business.id,
    }).updateRecord({
      recordId,
      dataPatch: { price: 20 },
    });
    await createGraphService(owner.client, {
      businessId: business.id,
    }).updateRecord({
      recordId: recordTwoId,
      dataPatch: { price: 30 },
    });
    const candidateB = await prepareCurrentRelease();
    expect(candidateB.id).not.toBe(candidateA.id);
    const concurrentOwnerClient = await createAdditionalSession(owner);
    const concurrentResults = await Promise.allSettled([
      publishCurrentRelease(candidateA.id),
      publishSiteRelease(concurrentOwnerClient, siteContext(), {
        siteId,
        candidateId: candidateB.id,
        ...siteCurrentness(state),
      }),
    ]);
    const successful = concurrentResults.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = concurrentResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "site_release_stale" });
    expect(await versionCount()).toBe(versionsBeforeSourceOnly);

    const candidateC = await prepareCurrentRelease();
    await publishCurrentRelease(candidateC.id);
    const publishedResult = successful[0];
    if (!publishedResult || publishedResult.status !== "fulfilled")
      throw new Error("Expected one published candidate.");
    const publishedCandidate = publishedResult.value;
    const replay = await publishCurrentRelease(publishedCandidate.id);
    expect(replay.id).toBe(publishedCandidate.id);
    expect((await currentSiteState()).active_release_id).toBe(candidateC.id);
  });

  it("uses draft revision CAS and preserves Site RLS across anonymous, Staff, Admin, and tenant boundaries", async () => {
    const state = await currentSiteState();
    const competingSession = await createAdditionalSession(owner);
    const competing = await Promise.allSettled([
      saveSiteDraft(owner.client, siteContext(), {
        siteId,
        expectedDraftRevision: state.draft_revision,
        draft: siteDraft([recordId, recordTwoId], { accent: "clay" }),
      }),
      saveSiteDraft(competingSession, siteContext(), {
        siteId,
        expectedDraftRevision: state.draft_revision,
        draft: siteDraft([recordId, recordTwoId], { accent: "ocean" }),
      }),
    ]);
    expect(
      competing.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      competing.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      competing.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "site_draft_stale" } });

    const staffState = await currentSiteState();
    await expect(
      saveSiteDraft(staff.client, siteContext(staff), {
        siteId,
        expectedDraftRevision: staffState.draft_revision,
        draft: siteDraft([recordId, recordTwoId]),
      }),
    ).rejects.toMatchObject({ code: "configuration_owner_or_admin_required" });

    const adminState = await currentSiteState();
    const adminSaved = await saveSiteDraft(
      administrator.client,
      siteContext(administrator),
      {
        siteId,
        expectedDraftRevision: adminState.draft_revision,
        draft: siteDraft([recordId, recordTwoId], { accent: "plum" }),
      },
    );
    expect(adminSaved.draft_revision).toBe(adminState.draft_revision + 1);

    const anonymousCreate = await c1Rpc(anonymous).rpc("create_site_draft", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_draft: siteDraft([recordId, recordTwoId]),
    });
    expect(anonymousCreate.error).not.toBeNull();
    const [
      anonymousStates,
      anonymousReleases,
      staffStates,
      staffReleases,
      adminReleases,
      crossTenantReleases,
    ] = await Promise.all([
      siteReads(anonymous)
        .from("site_states")
        .select("id")
        .eq("business_id", business.id),
      siteReads(anonymous)
        .from("site_releases")
        .select("id")
        .eq("business_id", business.id),
      siteReads(otherOwner.client)
        .from("site_releases")
        .select("id")
        .eq("business_id", business.id),
      siteReads(staff.client)
        .from("site_states")
        .select("id")
        .eq("business_id", business.id),
      siteReads(staff.client)
        .from("site_releases")
        .select("id")
        .eq("business_id", business.id),
      siteReads(administrator.client)
        .from("site_releases")
        .select("id")
        .eq("business_id", business.id),
    ]);
    expect(anonymousStates.error).not.toBeNull();
    expect(anonymousStates.data).toBeNull();
    expect(anonymousReleases.error).not.toBeNull();
    expect(anonymousReleases.data).toBeNull();
    expect(staffStates.error).toBeNull();
    expect(staffStates.data).toHaveLength(1);
    expect(staffReleases.error).toBeNull();
    expect(staffReleases.data).toEqual([]);
    expect(adminReleases.error).toBeNull();
    expect(adminReleases.data?.length).toBeGreaterThan(0);
    expect(crossTenantReleases.error).toBeNull();
    expect(crossTenantReleases.data).toEqual([]);

    await saveCurrentDraft(siteDraft([otherRecordId, recordTwoId]));
    await expect(prepareCurrentRelease()).rejects.toMatchObject({
      code: "site_collection_invalid",
    });
    await saveCurrentDraft(
      siteDraft([recordId, recordTwoId], { publicFieldKeys: ["foreign_only"] }),
    );
    await expect(prepareCurrentRelease()).rejects.toMatchObject({
      code: "site_collection_invalid",
    });
    const otherAsset = await createMediaAsset(otherBusiness, otherOwner);
    await expect(
      saveCurrentDraft(
        siteDraft([recordId, recordTwoId], { logoAssetId: otherAsset.id }),
      ),
    ).rejects.toMatchObject({ code: "site_asset_unavailable" });
    await saveCurrentDraft(siteDraft([recordId, recordTwoId]));
  });

  it("locks every selected Record before projecting two collections and keeps the persisted candidate frozen", async () => {
    const state = await currentSiteState();
    const holder = postgres(settings.databaseUrl, { max: 1 });
    const lockProbe = postgres(settings.databaseUrl, { max: 1 });
    let releaseSourceUpdate: () => void = () => {};
    const sourceUpdateAllowed = new Promise<void>((resolve) => {
      releaseSourceUpdate = resolve;
    });
    let sourcesLocked: () => void = () => {};
    const sourcesAreLocked = new Promise<void>((resolve) => {
      sourcesLocked = resolve;
    });
    let holdingTransaction: Promise<void> | undefined;
    let preparing: Promise<string> | undefined;

    try {
      holdingTransaction = holder.begin(async (transaction) => {
        await transaction.unsafe(
          "select id from public.records where id = any($1::uuid[]) order by id for update",
          [[recordId, recordTwoId]],
        );
        sourcesLocked();
        await sourceUpdateAllowed;
        await transaction.unsafe(
          "update public.records set data_json = data_json || jsonb_build_object('price', $2::numeric) where id = $1::uuid",
          [recordId, 41],
        );
        await transaction.unsafe(
          "update public.records set data_json = data_json || jsonb_build_object('price', $2::numeric) where id = $1::uuid",
          [recordTwoId, 42],
        );
      });
      await sourcesAreLocked;

      preparing = prepareThroughAuthenticatedDatabaseConnection(state);
      await waitForPreparationToHoldHead(lockProbe);
      releaseSourceUpdate();
      await holdingTransaction;
      const candidateId = await preparing;

      const [prepared] = await fixtureSql.unsafe<
        { projection_json: unknown }[]
      >(
        "select projection_json from public.site_releases where business_id = $1 and id = $2",
        [business.id, candidateId],
      );
      expect(prepared?.projection_json).toMatchObject({
        pages: [
          {
            layout: {
              blocks: [
                { records: [{ id: recordId, values: { price: 41 } }] },
                { records: [{ id: recordTwoId, values: { price: 42 } }] },
              ],
            },
          },
        ],
      });

      await createGraphService(owner.client, {
        businessId: business.id,
      }).updateRecord({
        recordId,
        dataPatch: { price: 91 },
      });
      await createGraphService(owner.client, {
        businessId: business.id,
      }).updateRecord({
        recordId: recordTwoId,
        dataPatch: { price: 92 },
      });
      const [reread] = await fixtureSql.unsafe<{ projection_json: unknown }[]>(
        "select projection_json from public.site_releases where business_id = $1 and id = $2",
        [business.id, candidateId],
      );
      expect(reread?.projection_json).toEqual(prepared?.projection_json);
    } finally {
      releaseSourceUpdate();
      await Promise.allSettled(
        [holdingTransaction, preparing].filter(
          (operation): operation is Promise<void> | Promise<string> =>
            operation !== undefined,
        ),
      );
      await Promise.all([
        holder.end({ timeout: 5 }),
        lockProbe.end({ timeout: 5 }),
      ]);
    }
  });

  it("rolls back genuine configuration application when private release-pointer selection fails", async () => {
    await saveCurrentDraft(
      siteDraft([recordId, recordTwoId], { title: "Rollback fixture title" }),
    );
    const candidate = await prepareCurrentRelease();
    expect(candidate.configuration_change_set_id).not.toBeNull();
    const [before] = await fixtureSql.unsafe<
      Array<{
        active_version_id: string;
        active_release_id: string | null;
        head_revision: number;
        version_count: number;
      }>
    >(
      `select
        head.active_version_id,
        head.head_revision,
        state.active_release_id,
        (select count(*)::integer from public.configuration_versions where business_id = head.business_id) as version_count
      from public.business_configuration_heads as head
      join public.site_states as state on state.business_id = head.business_id
      where head.business_id = $1`,
      [business.id],
    );
    if (!before) throw new Error("Expected the Site configuration head.");

    try {
      await fixtureSql.unsafe(`
        create function private.c1_fixture_reject_pointer_selection()
        returns trigger
        language plpgsql
        set search_path = ''
        as $$
        begin
          if new.active_release_id is distinct from old.active_release_id then
            raise exception 'c1_fixture_release_pointer_failure';
          end if;
          return new;
        end;
        $$;
      `);
      await fixtureSql.unsafe(`
        create trigger c1_fixture_reject_pointer_selection
        before update on public.site_states
        for each row when (new.business_id = '${business.id}'::uuid)
        execute function private.c1_fixture_reject_pointer_selection();
      `);
      await expect(publishCurrentRelease(candidate.id)).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: expect.stringContaining(
            "c1_fixture_release_pointer_failure",
          ),
        }),
      });
    } finally {
      await fixtureSql.unsafe(
        "drop trigger if exists c1_fixture_reject_pointer_selection on public.site_states",
      );
      await fixtureSql.unsafe(
        "drop function if exists private.c1_fixture_reject_pointer_selection()",
      );
    }

    const [after] = await fixtureSql.unsafe<
      Array<{
        active_version_id: string;
        active_release_id: string | null;
        head_revision: number;
        version_count: number;
        status: string;
      }>
    >(
      `select
        head.active_version_id,
        head.head_revision,
        state.active_release_id,
        release.status,
        (select count(*)::integer from public.configuration_versions where business_id = head.business_id) as version_count
      from public.business_configuration_heads as head
      join public.site_states as state on state.business_id = head.business_id
      join public.site_releases as release on release.id = $2::uuid
      where head.business_id = $1`,
      [business.id, candidate.id],
    );
    expect(after).toMatchObject({
      active_version_id: before.active_version_id,
      active_release_id: before.active_release_id,
      head_revision: before.head_revision,
      status: "prepared",
      version_count: before.version_count,
    });
  });

  it("retains draft, release, and historical Page media while rejecting claimed attachments and preserving the claim/attach race", async () => {
    const draftAsset = await createMediaAsset();
    await saveCurrentDraft(
      siteDraft([recordId, recordTwoId], { logoAssetId: draftAsset.id }),
    );
    expect(
      await siteReferenceCount("site_draft_asset_references", draftAsset.id),
    ).toBe(1);
    expect(await cleanupClaim(draftAsset.id)).toBeNull();

    const releaseWithAsset = await prepareCurrentRelease();
    expect(
      await siteReferenceCount("site_release_asset_references", draftAsset.id),
    ).toBe(1);
    await saveCurrentDraft(siteDraft([recordId, recordTwoId]));
    expect(
      await siteReferenceCount("site_draft_asset_references", draftAsset.id),
    ).toBe(0);
    expect(await cleanupClaim(draftAsset.id)).toBeNull();

    const claimedAsset = await createMediaAsset();
    const claimToken = await cleanupClaim(claimedAsset.id);
    expect(claimToken).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      saveCurrentDraft(
        siteDraft([recordId, recordTwoId], { logoAssetId: claimedAsset.id }),
      ),
    ).rejects.toMatchObject({ code: "site_asset_unavailable" });

    const configuration = new ConfigurationChangeService(
      owner.client,
      siteContext(),
    );
    const claimedPageProposal = await configuration.proposeChangeSet({
      ...(await configuration.getProposalCurrentness()),
      title: "Reject claimed Page gallery asset",
      description: "C1 canonical Page asset boundary fixture.",
      operations: [
        {
          op: "set_page",
          key: `claimed_asset_${crypto.randomUUID().replaceAll("-", "")}`,
          title: "Claimed asset Page",
          slug: `claimed-asset-${crypto.randomUUID().slice(0, 8)}`,
          audience: "public",
          layout_json: {
            blocks: [
              {
                type: "gallery",
                id: crypto.randomUUID(),
                images: [{ asset_id: claimedAsset.id, alt: "Claimed" }],
              },
            ],
          },
          status: "draft",
          is_active: true,
        },
      ],
    });
    const claimedPageValidation = await configuration.validateChangeSet(
      claimedPageProposal.id,
    );
    expect(claimedPageValidation.status).toBe("rejected");
    expect(claimedPageValidation.validation_result_json).toMatchObject({
      outcome: "invalid",
    });

    const raceAsset = await createMediaAsset();
    const stateBeforeRace = await currentSiteState();
    const race = await Promise.allSettled([
      cleanupClaim(raceAsset.id),
      saveSiteDraft(owner.client, siteContext(), {
        siteId,
        expectedDraftRevision: stateBeforeRace.draft_revision,
        draft: siteDraft([recordId, recordTwoId], {
          logoAssetId: raceAsset.id,
        }),
      }),
    ]);
    const raceClaim = race[0];
    const raceSave = race[1];
    if (raceClaim?.status !== "fulfilled" || !raceSave) {
      throw new Error("The cleanup claim request failed unexpectedly.");
    }
    const [raceAssetRow] = await fixtureSql.unsafe<
      Array<{ cleanup_claim_token: string | null }>
    >(
      "select cleanup_claim_token from public.media_assets where business_id = $1 and id = $2",
      [business.id, raceAsset.id],
    );
    const raceReferences = await siteReferenceCount(
      "site_draft_asset_references",
      raceAsset.id,
    );
    if (raceClaim.value) {
      expect(raceSave).toMatchObject({ status: "rejected" });
      expect(raceReferences).toBe(0);
      expect(raceAssetRow?.cleanup_claim_token).toBe(raceClaim.value);
    } else {
      expect(raceSave).toMatchObject({ status: "fulfilled" });
      expect(raceReferences).toBe(1);
      expect(raceAssetRow?.cleanup_claim_token).toBeNull();
    }

    const historicalAsset = await createMediaAsset();
    const historicalKey = `historical_asset_${crypto.randomUUID().replaceAll("-", "")}`;
    const historicalSlug = `historical-asset-${crypto.randomUUID().slice(0, 8)}`;
    await applyConfigurationOperations(
      [
        {
          op: "set_page",
          key: historicalKey,
          title: "Historical asset Page",
          slug: historicalSlug,
          audience: "internal",
          layout_json: {
            blocks: [
              {
                type: "image",
                id: crypto.randomUUID(),
                asset_id: historicalAsset.id,
                alt: "Historical",
              },
            ],
          },
          status: "draft",
          is_active: true,
        },
      ],
      "Add historical Page asset",
    );
    await applyConfigurationOperations(
      [
        {
          op: "set_page",
          key: historicalKey,
          title: "Historical asset Page",
          slug: historicalSlug,
          audience: "internal",
          layout_json: { blocks: [] },
          status: "draft",
          is_active: true,
        },
      ],
      "Remove current historical Page asset",
    );
    expect(await cleanupClaim(historicalAsset.id)).toBeNull();
    expect(releaseWithAsset.status).toBe("prepared");
  });

  it("keeps public route ownership separate from canonical backing slugs and preserves Direct Table readers", async () => {
    await applyConfigurationOperations(
      [
        {
          op: "set_page",
          key: `internal_about_${crypto.randomUUID().replaceAll("-", "")}`,
          title: "Internal about",
          slug: "about",
          audience: "internal",
          layout_json: { blocks: [] },
          status: "draft",
          is_active: true,
        },
      ],
      "Create internal about alongside Site route",
    );
    const pages = await fixtureSql.unsafe<
      Array<{ audience: string; key: string; slug: string }>
    >(
      `select page.audience::text, page.key, page.slug
      from public.pages as page
      where page.business_id = $1 and (page.slug = 'about' or page.key like 's%_p%')
      order by page.key`,
      [business.id],
    );
    expect(pages).toContainEqual(
      expect.objectContaining({ audience: "internal", slug: "about" }),
    );
    expect(
      pages.some((page) => page.audience === "public" && page.slug === "about"),
    ).toBe(false);

    const directTable = await loadDirectTableConfiguration(
      owner.client,
      siteContext(),
    );
    expect(
      directTable.snapshot.pages.some((page) => page.audience === "public"),
    ).toBe(true);
    const applied = await applyDirectTableAction(owner.client, siteContext(), {
      currentness: directTable.currentness,
      intent: { action: "create_table", title: "C1 compatibility table" },
    });
    expect(applied.changeSet.status).toBe("applied");
  });
});
