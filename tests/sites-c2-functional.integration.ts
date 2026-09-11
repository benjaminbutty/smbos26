import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConfigurationChangeService } from "../src/core/configuration/service";
import { createGraphService } from "../src/core/graph/service";
import {
  attachSiteRecordMedia,
  createSiteDraft,
  prepareSiteReleaseV2,
  publishSiteReleaseV2,
  reenableSiteField,
  reenableSiteMedia,
  reenableSiteObject,
  reenableSiteRecord,
  stageSiteAdoption,
  unpublishSite,
  withdrawSiteField,
  withdrawSiteMedia,
  withdrawSiteObject,
  withdrawSiteRecord,
} from "../src/core/sites/service";
import {
  siteDraftV1Schema,
  sitePublicProjectionSchema,
} from "../src/core/sites/schemas";
import type { Database, Tables } from "../src/db/supabase/database.types";
import {
  getC1LocalSupabaseSettings,
  type C1LocalSupabaseSettings,
} from "./support/c1-local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type Identity = { client: Client; email: string; user: User };

type RpcClient = {
  rpc<T>(
    name: string,
    parameters: Record<string, string | number | null | object>,
  ): Promise<{
    data: T | null;
    error: { code?: string; message?: string } | null;
  }>;
};

type SiteState = {
  id: string;
  business_id: string;
  draft_json: unknown;
  draft_revision: number;
  draft_base_version_id: string;
  draft_base_head_revision: number;
  active_release_id: string | null;
  active_release_revision: number;
  migration_state: "new" | "legacy_pending" | "adopted";
  legacy_source_checksum: string | null;
  legacy_source_page_count: number | null;
};

const password = "Sites-C2-integration-password!";
const createdBusinessIds: string[] = [];
const createdUserIds: string[] = [];

let settings: C1LocalSupabaseSettings;
let admin: Client;
let anonymous: Client;
let owner: Identity;
let fixtureSql: Sql;
let raceSql: Sql;
let catalogueBusiness: Business;
let adoptionBusiness: Business;
let catalogueSiteId: string;
let objectDefinitionId: string;
let priceFieldId: string;
let photoFieldId: string;
let firstRecordId: string;
let secondRecordId: string;
let siteImageAssetId: string;
let galleryAssetId: string;

function rpc(client: Client): RpcClient {
  return client as unknown as RpcClient;
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `sites-c2-${label}-${crypto.randomUUID()}@example.test`;
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

async function createBusiness(name: string): Promise<Business> {
  const result = await owner.client.rpc("create_business", {
    business_name: name,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  if (result.error || !result.data) throw result.error;
  createdBusinessIds.push(result.data.id);
  return result.data;
}

async function applyConfiguration(
  business: Business,
  identity: Identity,
  operations: Parameters<
    ConfigurationChangeService["proposeChangeSet"]
  >[0]["operations"],
  title: string,
): Promise<void> {
  const configuration = new ConfigurationChangeService(identity.client, {
    businessId: business.id,
    actorId: identity.user.id,
  });
  const proposal = await configuration.proposeChangeSet({
    ...(await configuration.getProposalCurrentness()),
    title,
    description: "Sites C2 integration fixture.",
    operations,
  });
  const validated = await configuration.validateChangeSet(proposal.id);
  if (validated.status !== "validated") {
    throw new Error(`Configuration fixture was rejected: ${proposal.id}`);
  }
  await configuration.applyChangeSet(proposal.id);
}

async function createAsset(): Promise<string> {
  const id = crypto.randomUUID();
  const result = await admin
    .from("media_assets")
    .insert({
      id,
      business_id: catalogueBusiness.id,
      storage_key: `${catalogueBusiness.id}/${id}.png`,
      mime_type: "image/png",
      byte_size: 128,
      width: 1,
      height: 1,
      created_by: owner.user.id,
    })
    .select("id")
    .single();
  if (result.error || !result.data) throw result.error;
  return result.data.id;
}

async function siteState(
  business: Business = catalogueBusiness,
): Promise<SiteState> {
  const reader = owner.client as unknown as {
    from(table: "site_states"): {
      select(columns: "*"): {
        eq(
          column: "business_id",
          value: string,
        ): {
          single(): Promise<{ data: unknown; error: unknown | null }>;
        };
      };
    };
  };
  const result = await reader
    .from("site_states")
    .select("*")
    .eq("business_id", business.id)
    .single();
  if (result.error || !result.data) throw result.error;
  return result.data as unknown as SiteState;
}

function context(business: Business = catalogueBusiness) {
  return { businessId: business.id, actorId: owner.user.id };
}

function currentness(state: SiteState) {
  return {
    expectedDraftRevision: state.draft_revision,
    expectedBaseVersionId: state.draft_base_version_id,
    expectedHeadRevision: state.draft_base_head_revision,
  };
}

function catalogueDraft() {
  const homeId = crypto.randomUUID();
  const detailId = crypto.randomUUID();
  const collectionId = crypto.randomUUID();
  const numericCollectionId = crypto.randomUUID();
  return siteDraftV1Schema.parse({
    schema_version: 1,
    branding: { name: "C2 Catalogue", accent: "forest" },
    pages: [
      {
        id: homeId,
        title: "Home",
        slug: "home",
        navigation_label: "Home",
        is_home: true,
        is_in_navigation: true,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "heading",
              id: crypto.randomUUID(),
              text: "The C2 catalogue",
              level: 1,
            },
            {
              type: "text",
              id: crypto.randomUUID(),
              text: "Browse the latest catalogue items.",
            },
            {
              type: "section",
              id: crypto.randomUUID(),
              width: "wide",
              columns: [
                {
                  blocks: [
                    {
                      type: "heading",
                      id: crypto.randomUUID(),
                      text: "Curated",
                      level: 2,
                    },
                  ],
                },
                {
                  blocks: [
                    {
                      type: "text",
                      id: crypto.randomUUID(),
                      text: "Selected for this Site.",
                    },
                  ],
                },
              ],
            },
            {
              type: "image",
              id: crypto.randomUUID(),
              asset_id: siteImageAssetId,
              alt: "Catalogue cover",
              draft_state: "complete",
            },
            {
              type: "gallery",
              id: crypto.randomUUID(),
              images: [
                {
                  asset_id: galleryAssetId,
                  alt: "Catalogue detail",
                  draft_state: "complete",
                },
              ],
              presentation: "grid",
              draft_state: "complete",
            },
            {
              type: "collection",
              id: collectionId,
              object_key: "catalogue_item",
              selection: {
                schema_version: 1,
                record_ids: [firstRecordId, secondRecordId],
              },
              public_field_keys: ["name", "price", "photo"],
              presentation: "cards",
              detail_page_id: detailId,
              filter: {
                schema_version: 1,
                filters: [
                  { field_key: "price", operator: "greater_than", value: 0 },
                ],
                filter_match: "all",
                sorts: [{ field_key: "name", direction: "ascending" }],
              },
            },
            {
              type: "collection",
              id: numericCollectionId,
              object_key: "catalogue_item",
              selection: {
                schema_version: 1,
                record_ids: [firstRecordId, secondRecordId],
              },
              public_field_keys: ["name", "price"],
              presentation: "table",
              filter: {
                schema_version: 1,
                filters: [
                  { field_key: "price", operator: "greater_than", value: 2 },
                ],
                filter_match: "all",
                sorts: [{ field_key: "price", direction: "descending" }],
              },
            },
          ],
        },
      },
      {
        id: detailId,
        title: "Item details",
        slug: "details",
        navigation_label: "Details",
        is_home: false,
        is_in_navigation: true,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "heading",
              id: crypto.randomUUID(),
              text: "Item details",
              level: 1,
            },
            {
              type: "record_detail",
              id: crypto.randomUUID(),
              collection_block_id: collectionId,
              public_field_keys: ["name", "price", "photo"],
            },
          ],
        },
      },
    ],
  });
}

async function callRpc<T>(
  client: Client,
  name: string,
  parameters: Record<string, string | number | null | object>,
): Promise<T> {
  const result = await rpc(client).rpc<T>(name, parameters);
  if (result.error || result.data === null) {
    throw new Error(`${name} failed: ${result.error?.message ?? "no data"}`);
  }
  return result.data;
}

async function callNullableRpc<T>(
  client: Client,
  name: string,
  parameters: Record<string, string | number | null | object>,
): Promise<T | null> {
  const result = await rpc(client).rpc<T>(name, parameters);
  if (result.error) {
    throw new Error(`${name} failed: ${result.error.message}`);
  }
  return result.data;
}

describe("Lenni Sites C2 functional milestone", () => {
  beforeAll(async () => {
    settings = getC1LocalSupabaseSettings();
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
    fixtureSql = postgres(settings.databaseUrl, { max: 1 });
    raceSql = postgres(settings.databaseUrl, { max: 1 });
    owner = await createIdentity("owner");
    catalogueBusiness = await createBusiness(
      `Sites C2 catalogue ${crypto.randomUUID()}`,
    );
    adoptionBusiness = await createBusiness(
      `Sites C2 adoption ${crypto.randomUUID()}`,
    );

    await applyConfiguration(
      catalogueBusiness,
      owner,
      [
        {
          op: "set_object",
          key: "catalogue_item",
          singular_label: "Catalogue item",
          plural_label: "Catalogue items",
          description: "A customer-facing catalogue item.",
          icon: null,
          is_active: true,
        },
        {
          op: "set_field",
          object_key: "catalogue_item",
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
          object_key: "catalogue_item",
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
          object_key: "catalogue_item",
          key: "photo",
          label: "Photo",
          field_type: "file",
          required: false,
          default_value: null,
          settings_json: {},
          position: 2,
          is_active: true,
        },
      ],
      "Create C2 catalogue type",
    );
    const object = await owner.client
      .from("object_definitions")
      .select("id")
      .eq("business_id", catalogueBusiness.id)
      .eq("key", "catalogue_item")
      .single();
    if (object.error || !object.data) throw object.error;
    objectDefinitionId = object.data.id;
    const fields = await owner.client
      .from("field_definitions")
      .select("id,key")
      .eq("business_id", catalogueBusiness.id)
      .eq("object_definition_id", objectDefinitionId);
    if (fields.error || !fields.data) throw fields.error;
    priceFieldId = fields.data.find((field) => field.key === "price")!.id;
    photoFieldId = fields.data.find((field) => field.key === "photo")!.id;
    const graph = createGraphService(owner.client, {
      businessId: catalogueBusiness.id,
    });
    firstRecordId = (
      await graph.createRecord({
        objectDefinitionId,
        data: { name: "Alpha item", price: 2 },
        recordStatus: "active",
      })
    ).id;
    secondRecordId = (
      await graph.createRecord({
        objectDefinitionId,
        data: { name: "Beta item", price: 10 },
        recordStatus: "active",
      })
    ).id;
    siteImageAssetId = await createAsset();
    galleryAssetId = await createAsset();
    const state = await createSiteDraft(owner.client, context(), {
      draft: catalogueDraft(),
    });
    catalogueSiteId = state.id;
    await attachSiteRecordMedia(owner.client, context(), {
      siteId: catalogueSiteId,
      recordId: firstRecordId,
      objectDefinitionId,
      fieldDefinitionId: photoFieldId,
      assetId: siteImageAssetId,
      expectedRecordRevision: 1,
      expectedAttachmentRevision: 0,
    });
    await attachSiteRecordMedia(owner.client, context(), {
      siteId: catalogueSiteId,
      recordId: secondRecordId,
      objectDefinitionId,
      fieldDefinitionId: photoFieldId,
      assetId: galleryAssetId,
      expectedRecordRevision: 1,
      expectedAttachmentRevision: 0,
    });
    const canonicalFileRows = await fixtureSql.unsafe<
      Array<{
        id: string;
        record_revision: number;
        data_json: Record<string, unknown>;
      }>
    >(
      `select id, record_revision, data_json
       from public.records
       where business_id = $1 and id = any($2::uuid[])
       order by id`,
      [catalogueBusiness.id, [firstRecordId, secondRecordId]],
    );
    expect(canonicalFileRows).toHaveLength(2);
    expect(Number(canonicalFileRows[0]?.record_revision)).toBe(2);
    expect(Number(canonicalFileRows[1]?.record_revision)).toBe(2);
    expect(canonicalFileRows[0]?.data_json.photo).toMatchObject({
      asset_id: expect.any(String),
    });
    expect(canonicalFileRows[1]?.data_json.photo).toMatchObject({
      asset_id: expect.any(String),
    });
    const directManagedFileWrite = await owner.client
      .from("records")
      .update({
        data_json: {
          name: "Alpha item",
          price: 2,
          photo: { asset_id: galleryAssetId },
        },
      })
      .eq("business_id", catalogueBusiness.id)
      .eq("id", firstRecordId);
    expect(directManagedFileWrite.error?.message).toContain(
      "site_record_file_write_boundary_required",
    );
    const cleanupAttempt = await rpc(admin).rpc(
      "claim_site_media_asset_for_cleanup",
      {
        expected_business_id: catalogueBusiness.id,
        requested_asset_id: siteImageAssetId,
      },
    );
    expect(cleanupAttempt.error).toBeNull();
    expect(cleanupAttempt.data).toBeNull();

    await applyConfiguration(
      adoptionBusiness,
      owner,
      [
        {
          op: "set_page",
          key: "legacy_home",
          title: "Legacy Home",
          slug: "legacy-home",
          audience: "public",
          layout_json: {
            blocks: [
              {
                type: "heading",
                id: crypto.randomUUID(),
                text: "Legacy welcome",
                level: 1,
              },
              {
                type: "text",
                id: crypto.randomUUID(),
                text: "Legacy text retained for review.",
              },
            ],
          },
          status: "published",
          is_active: true,
        },
      ],
      "Create legacy public Page",
    );
  });

  afterAll(async () => {
    try {
      if (admin && createdBusinessIds.length > 0) {
        await fixtureSql.unsafe(
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
      if (fixtureSql) await fixtureSql.end();
      if (raceSql) await raceSql.end();
    }
  });

  it("publishes the exact Site projection and applies finite availability epochs", async () => {
    const prepared = await prepareSiteReleaseV2(owner.client, context(), {
      siteId: catalogueSiteId,
      ...(await currentnessForSite()),
    });
    const projection = sitePublicProjectionSchema.parse(
      prepared.projection_json,
    );
    expect(projection.pages).toHaveLength(2);
    expect(projection.pages.find((page) => page.is_home)?.slug).toBe("home");
    const homeBlocks = projection.pages.find((page) => page.is_home)!.layout
      .blocks;
    const collections = homeBlocks.filter(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "collection",
    ) as Array<{
      presentation?: string;
      records?: Array<{ public_id: string; values: Record<string, unknown> }>;
    }>;
    expect(collections).toHaveLength(2);
    const collection = collections.find(
      (block) => block.presentation === "cards",
    )!;
    const numericCollection = collections.find(
      (block) => block.presentation === "table",
    )!;
    expect(collection.records).toHaveLength(2);
    expect(collection.records?.[0]?.public_id).toMatch(/^r_[a-f0-9]{64}$/);
    expect(collection.records?.[0]?.values).toMatchObject({
      name: expect.any(String),
      price: expect.any(Number),
      photo: expect.stringMatching(/^m_[a-f0-9]{64}$/),
    });
    expect(numericCollection.records).toHaveLength(1);
    expect(numericCollection.records?.[0]?.values).toMatchObject({
      name: "Beta item",
      price: 10,
    });
    expect(JSON.stringify(projection)).not.toContain(objectDefinitionId);
    expect(JSON.stringify(projection)).not.toContain(siteImageAssetId);

    const published = await publishSiteReleaseV2(owner.client, context(), {
      siteId: catalogueSiteId,
      candidateId: prepared.id,
      ...(await currentnessForSite()),
    });
    expect(published.status).toBe("published");
    let state = await siteState();
    expect(state.migration_state).toBe("adopted");
    const releaseCollectionReferences = await fixtureSql.unsafe<
      Array<{ collection_block_id: string; public_key: string }>
    >(
      `select collection_block_id, public_key
       from public.site_release_collection_references
       where business_id = $1 and release_id = $2
       order by collection_block_id, field_definition_id`,
      [catalogueBusiness.id, published.id],
    );
    expect(releaseCollectionReferences).toHaveLength(5);
    expect(
      new Set(releaseCollectionReferences.map((row) => row.collection_block_id))
        .size,
    ).toBe(2);
    expect(
      releaseCollectionReferences.every(
        (row) =>
          row.public_key.startsWith("b_") && row.public_key.length === 66,
      ),
    ).toBe(true);
    const initialObjectAvailability = await fixtureSql.unsafe(
      `select status, availability_revision, available_from_release_revision
       from public.site_public_object_availability
       where business_id = $1 and site_id = $2 and object_definition_id = $3`,
      [catalogueBusiness.id, catalogueSiteId, objectDefinitionId],
    );
    expect(initialObjectAvailability).toHaveLength(0);
    const resolved = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_page",
      {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "home",
      },
    );
    expect(resolved).toMatchObject({ site: { schema_version: 2 } });
    const resolvedProjection = JSON.stringify(resolved);
    expect(resolvedProjection).not.toContain(objectDefinitionId);
    expect(resolvedProjection).not.toContain(siteImageAssetId);
    const resolvedCollection = (
      (
        (resolved.page as Record<string, unknown>).layout as Record<
          string,
          unknown
        >
      ).blocks as Array<Record<string, unknown>>
    ).find((block) => block.type === "collection");
    expect(resolvedCollection, JSON.stringify(resolved)).toBeDefined();
    const resolvedRecords = resolvedCollection?.records;
    expect(resolvedRecords, JSON.stringify(resolved)).toBeDefined();
    const token = (resolvedRecords as Array<Record<string, unknown>>)[0]
      ?.public_id as string;
    expect(token).toMatch(/^r_[a-f0-9]{64}$/);
    const detail = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_site_record",
      {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "details",
        requested_record_token: token,
      },
    );
    expect(detail).toMatchObject({ record: { public_id: token } });

    const firstWithdrawal = await withdrawSiteRecord(owner.client, context(), {
      siteId: catalogueSiteId,
      targetId: firstRecordId,
      expectedActiveReleaseRevision: state.active_release_revision,
      expectedAvailabilityRevision: 0,
    });
    expect(firstWithdrawal.status).toBe("withdrawn");
    state = await siteState();
    const hidden = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_page",
      {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "home",
      },
    );
    const hiddenCollection = (
      (
        (hidden.page as Record<string, unknown>).layout as Record<
          string,
          unknown
        >
      ).blocks as Array<Record<string, unknown>>
    ).find((block) => block.type === "collection");
    expect(hiddenCollection?.records).toHaveLength(1);
    await expect(
      callNullableRpc(anonymous, "resolve_public_site_record", {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "details",
        requested_record_token: token,
      }),
    ).resolves.toBeNull();

    const reenabledRecord = await reenableSiteRecord(owner.client, context(), {
      siteId: catalogueSiteId,
      targetId: firstRecordId,
      expectedActiveReleaseRevision: state.active_release_revision,
      expectedAvailabilityRevision: firstWithdrawal.availability_revision,
    });
    expect(reenabledRecord.status).toBe("available");
    const oldReleaseView = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_page",
      {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "home",
      },
    );
    const oldCollection = (
      (
        (oldReleaseView.page as Record<string, unknown>).layout as Record<
          string,
          unknown
        >
      ).blocks as Array<Record<string, unknown>>
    ).find((block) => block.type === "collection");
    expect(oldCollection?.records).toHaveLength(1);

    const restoredCandidate = await prepareSiteReleaseV2(
      owner.client,
      context(),
      { siteId: catalogueSiteId, ...(await currentnessForSite()) },
    );
    await publishSiteReleaseV2(owner.client, context(), {
      siteId: catalogueSiteId,
      candidateId: restoredCandidate.id,
      ...(await currentnessForSite()),
    });
    state = await siteState();
    const restored = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_page",
      {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "home",
      },
    );
    const restoredCollection = (
      (
        (restored.page as Record<string, unknown>).layout as Record<
          string,
          unknown
        >
      ).blocks as Array<Record<string, unknown>>
    ).find((block) => block.type === "collection");
    expect(restoredCollection?.records).toHaveLength(2);

    const fieldWithdrawal = await withdrawSiteField(owner.client, context(), {
      siteId: catalogueSiteId,
      targetId: priceFieldId,
      expectedActiveReleaseRevision: state.active_release_revision,
      expectedAvailabilityRevision: 0,
    });
    expect(fieldWithdrawal.status).toBe("withdrawn");
    state = await siteState();
    const fieldHidden = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_page",
      {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "home",
      },
    );
    expect(JSON.stringify(fieldHidden)).not.toContain('"price"');
    const fieldRestored = await reenableSiteField(owner.client, context(), {
      siteId: catalogueSiteId,
      targetId: priceFieldId,
      expectedActiveReleaseRevision: state.active_release_revision,
      expectedAvailabilityRevision: fieldWithdrawal.availability_revision,
    });
    expect(fieldRestored.status).toBe("available");
    const fieldCandidate = await prepareSiteReleaseV2(owner.client, context(), {
      siteId: catalogueSiteId,
      ...(await currentnessForSite()),
    });
    await publishSiteReleaseV2(owner.client, context(), {
      siteId: catalogueSiteId,
      candidateId: fieldCandidate.id,
      ...(await currentnessForSite()),
    });
    state = await siteState();

    const objectWithdrawal = await withdrawSiteObject(owner.client, context(), {
      siteId: catalogueSiteId,
      targetId: objectDefinitionId,
      expectedActiveReleaseRevision: state.active_release_revision,
      expectedAvailabilityRevision: 0,
    });
    expect(objectWithdrawal.status).toBe("withdrawn");
    state = await siteState();
    const objectHidden = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_page",
      {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "home",
      },
    );
    const objectHiddenBlocks = (
      (objectHidden.page as Record<string, unknown>).layout as Record<
        string,
        unknown
      >
    ).blocks as Array<Record<string, unknown>>;
    expect(
      objectHiddenBlocks.some((block) => block.type === "collection"),
    ).toBe(false);
    const objectRestored = await reenableSiteObject(owner.client, context(), {
      siteId: catalogueSiteId,
      targetId: objectDefinitionId,
      expectedActiveReleaseRevision: state.active_release_revision,
      expectedAvailabilityRevision: objectWithdrawal.availability_revision,
    });
    expect(objectRestored.status).toBe("available");

    const mediaWithdrawal = await withdrawSiteMedia(owner.client, context(), {
      siteId: catalogueSiteId,
      targetId: siteImageAssetId,
      expectedActiveReleaseRevision: state.active_release_revision,
      expectedAvailabilityRevision: 0,
    });
    expect(mediaWithdrawal.status).toBe("withdrawn");
    const mediaRestored = await reenableSiteMedia(owner.client, context(), {
      siteId: catalogueSiteId,
      targetId: siteImageAssetId,
      expectedActiveReleaseRevision: state.active_release_revision,
      expectedAvailabilityRevision: mediaWithdrawal.availability_revision,
    });
    expect(mediaRestored.status).toBe("available");
    const mediaToken = `m_${"0".repeat(64)}`;
    const anonymousMedia = await rpc(anonymous).rpc(
      "resolve_public_site_media",
      {
        requested_business_slug: catalogueBusiness.slug,
        requested_media_token: mediaToken,
      },
    );
    expect(anonymousMedia.error).toBeTruthy();
    const unpublished = await unpublishSite(owner.client, context(), {
      siteId: catalogueSiteId,
      expectedActiveReleaseRevision: (await siteState())
        .active_release_revision,
    });
    expect(unpublished.active_release_id).toBeNull();
    await expect(
      callNullableRpc(anonymous, "resolve_public_page", {
        requested_business_slug: catalogueBusiness.slug,
        requested_page_slug: "home",
      }),
    ).resolves.toBeNull();
  });

  it("serializes Record media attachment with cleanup claims", async () => {
    const cleanupWonAssetId = await createAsset();
    const cleanupClaimToken = crypto.randomUUID();
    let blockedAttachment: Promise<unknown> | undefined;
    await raceSql.begin(async (transaction) => {
      await transaction`
        select id
        from public.media_assets
        where business_id = ${catalogueBusiness.id}
          and id = ${cleanupWonAssetId}
        for update
      `;
      blockedAttachment = attachSiteRecordMedia(owner.client, context(), {
        siteId: catalogueSiteId,
        recordId: secondRecordId,
        objectDefinitionId,
        fieldDefinitionId: photoFieldId,
        assetId: cleanupWonAssetId,
        expectedRecordRevision: 2,
        expectedAttachmentRevision: 1,
      });
      await transaction`
        update public.media_assets
        set cleanup_claim_token = ${cleanupClaimToken},
            cleanup_claimed_at = timezone('utc', now())
        where business_id = ${catalogueBusiness.id}
          and id = ${cleanupWonAssetId}
      `;
    });
    expect(blockedAttachment).toBeDefined();
    await expect(blockedAttachment!).rejects.toMatchObject({
      code: "site_asset_unavailable",
    });
    const released = await rpc(admin).rpc("release_site_media_cleanup_claim", {
      expected_business_id: catalogueBusiness.id,
      requested_asset_id: cleanupWonAssetId,
      requested_claim_token: cleanupClaimToken,
    });
    expect(released.error).toBeNull();

    const attachmentWonAssetId = await createAsset();
    let waitingAttachment: Promise<unknown> | undefined;
    await raceSql.begin(async (transaction) => {
      await transaction`
        select id
        from public.media_assets
        where business_id = ${catalogueBusiness.id}
          and id = ${attachmentWonAssetId}
        for update
      `;
      waitingAttachment = attachSiteRecordMedia(owner.client, context(), {
        siteId: catalogueSiteId,
        recordId: secondRecordId,
        objectDefinitionId,
        fieldDefinitionId: photoFieldId,
        assetId: attachmentWonAssetId,
        expectedRecordRevision: 2,
        expectedAttachmentRevision: 1,
      });
    });
    expect(waitingAttachment).toBeDefined();
    const attached = (await waitingAttachment!) as { asset_id: string };
    expect(attached.asset_id).toBe(attachmentWonAssetId);
    const cleanupAfterAttachment = await rpc(admin).rpc(
      "claim_site_media_asset_for_cleanup",
      {
        expected_business_id: catalogueBusiness.id,
        requested_asset_id: attachmentWonAssetId,
      },
    );
    expect(cleanupAfterAttachment.error).toBeNull();
    expect(cleanupAfterAttachment.data).toBeNull();
  });

  it("keeps old releases unavailable across operational source transitions", async () => {
    const initialState = await siteState();

    const objectBeforeConfiguration = await fixtureSql.unsafe<
      Array<{ status: string; availability_revision: number }>
    >(
      `select status, availability_revision
       from public.site_public_object_availability
       where business_id = $1 and site_id = $2 and object_definition_id = $3`,
      [catalogueBusiness.id, catalogueSiteId, objectDefinitionId],
    );
    expect(objectBeforeConfiguration[0]?.status).toBe("available");
    const objectRevisionBeforeConfiguration = Number(
      objectBeforeConfiguration[0]?.availability_revision,
    );

    const fieldBeforeConfiguration = await fixtureSql.unsafe<
      Array<{ status: string; availability_revision: number }>
    >(
      `select status, availability_revision
       from public.site_public_field_availability
       where business_id = $1 and site_id = $2 and field_definition_id = $3`,
      [catalogueBusiness.id, catalogueSiteId, priceFieldId],
    );
    expect(fieldBeforeConfiguration[0]?.status).toBe("available");
    const fieldRevisionBeforeConfiguration = Number(
      fieldBeforeConfiguration[0]?.availability_revision,
    );

    const archivedRecord = await admin
      .from("records")
      .update({ record_status: "archived" })
      .eq("business_id", catalogueBusiness.id)
      .eq("id", secondRecordId)
      .select("record_status")
      .single();
    expect(archivedRecord.error).toBeNull();
    expect(archivedRecord.data?.record_status).toBe("archived");
    const recordAfterArchive = await fixtureSql.unsafe<
      Array<{
        status: string;
        availability_revision: number;
        available_from_release_revision: number;
      }>
    >(
      `select status, availability_revision, available_from_release_revision
       from public.site_public_record_availability
       where business_id = $1 and site_id = $2 and record_id = $3`,
      [catalogueBusiness.id, catalogueSiteId, secondRecordId],
    );
    expect(recordAfterArchive[0]?.status).toBe("withdrawn");
    expect(Number(recordAfterArchive[0]?.availability_revision)).toBe(1);
    expect(Number(recordAfterArchive[0]?.available_from_release_revision)).toBe(
      0,
    );

    const reactivatedRecord = await admin
      .from("records")
      .update({ record_status: "active" })
      .eq("business_id", catalogueBusiness.id)
      .eq("id", secondRecordId)
      .select("record_status")
      .single();
    expect(reactivatedRecord.error).toBeNull();
    expect(reactivatedRecord.data?.record_status).toBe("active");
    const recordAfterReactivation = await fixtureSql.unsafe<
      Array<{
        status: string;
        availability_revision: number;
        available_from_release_revision: number;
      }>
    >(
      `select status, availability_revision, available_from_release_revision
       from public.site_public_record_availability
       where business_id = $1 and site_id = $2 and record_id = $3`,
      [catalogueBusiness.id, catalogueSiteId, secondRecordId],
    );
    expect(recordAfterReactivation[0]?.status).toBe("withdrawn");
    expect(Number(recordAfterReactivation[0]?.availability_revision)).toBe(2);
    expect(
      Number(recordAfterReactivation[0]?.available_from_release_revision),
    ).toBeGreaterThan(initialState.active_release_revision);

    await applyConfiguration(
      catalogueBusiness,
      owner,
      [
        {
          op: "set_object",
          key: "catalogue_item",
          singular_label: "Catalogue item",
          plural_label: "Catalogue items",
          description: "A customer-facing catalogue item.",
          icon: null,
          is_active: false,
        },
      ],
      "Withdraw catalogue object",
    );
    const archivedObject = await owner.client
      .from("object_definitions")
      .select("is_active")
      .eq("business_id", catalogueBusiness.id)
      .eq("id", objectDefinitionId)
      .single();
    expect(archivedObject.error).toBeNull();
    expect(archivedObject.data?.is_active).toBe(false);
    await applyConfiguration(
      catalogueBusiness,
      owner,
      [
        {
          op: "set_object",
          key: "catalogue_item",
          singular_label: "Catalogue item",
          plural_label: "Catalogue items",
          description: "A customer-facing catalogue item.",
          icon: null,
          is_active: true,
        },
      ],
      "Restore catalogue object",
    );
    const reactivatedObject = await owner.client
      .from("object_definitions")
      .select("is_active")
      .eq("business_id", catalogueBusiness.id)
      .eq("id", objectDefinitionId)
      .single();
    expect(reactivatedObject.error).toBeNull();
    expect(reactivatedObject.data?.is_active).toBe(true);
    const objectAfterReactivation = await fixtureSql.unsafe<
      Array<{
        status: string;
        availability_revision: number;
        available_from_release_revision: number;
      }>
    >(
      `select status, availability_revision, available_from_release_revision
       from public.site_public_object_availability
       where business_id = $1 and site_id = $2 and object_definition_id = $3`,
      [catalogueBusiness.id, catalogueSiteId, objectDefinitionId],
    );
    expect(objectAfterReactivation[0]?.status).toBe("withdrawn");
    expect(Number(objectAfterReactivation[0]?.availability_revision)).toBe(
      objectRevisionBeforeConfiguration + 2,
    );
    expect(
      Number(objectAfterReactivation[0]?.available_from_release_revision),
    ).toBeGreaterThan(initialState.active_release_revision);

    await applyConfiguration(
      catalogueBusiness,
      owner,
      [
        {
          op: "set_field",
          object_key: "catalogue_item",
          key: "price",
          label: "Price",
          field_type: "number",
          required: false,
          default_value: null,
          settings_json: {},
          position: 1,
          is_active: false,
        },
      ],
      "Withdraw catalogue price field",
    );
    const archivedField = await owner.client
      .from("field_definitions")
      .select("is_active")
      .eq("business_id", catalogueBusiness.id)
      .eq("id", priceFieldId)
      .single();
    expect(archivedField.error).toBeNull();
    expect(archivedField.data?.is_active).toBe(false);
    await applyConfiguration(
      catalogueBusiness,
      owner,
      [
        {
          op: "set_field",
          object_key: "catalogue_item",
          key: "price",
          label: "Price",
          field_type: "number",
          required: false,
          default_value: null,
          settings_json: {},
          position: 1,
          is_active: true,
        },
      ],
      "Restore catalogue price field",
    );
    const reactivatedField = await owner.client
      .from("field_definitions")
      .select("is_active")
      .eq("business_id", catalogueBusiness.id)
      .eq("id", priceFieldId)
      .single();
    expect(reactivatedField.error).toBeNull();
    expect(reactivatedField.data?.is_active).toBe(true);
    const fieldAfterReactivation = await fixtureSql.unsafe<
      Array<{
        status: string;
        availability_revision: number;
        available_from_release_revision: number;
      }>
    >(
      `select status, availability_revision, available_from_release_revision
       from public.site_public_field_availability
       where business_id = $1 and site_id = $2 and field_definition_id = $3`,
      [catalogueBusiness.id, catalogueSiteId, priceFieldId],
    );
    expect(fieldAfterReactivation[0]?.status).toBe("withdrawn");
    expect(Number(fieldAfterReactivation[0]?.availability_revision)).toBe(
      fieldRevisionBeforeConfiguration + 2,
    );
    expect(
      Number(fieldAfterReactivation[0]?.available_from_release_revision),
    ).toBeGreaterThan(initialState.active_release_revision);
  });

  it("stages whole-Business legacy Pages and retires old public actions after adoption", async () => {
    const initial = await createSiteDraft(
      owner.client,
      context(adoptionBusiness),
      {
        draft: siteDraftV1Schema.parse({
          schema_version: 1,
          branding: { name: "Adopted Site", accent: "clay" },
          pages: [
            {
              id: crypto.randomUUID(),
              title: "Temporary Home",
              slug: "temporary-home",
              navigation_label: "Home",
              is_home: true,
              is_in_navigation: true,
              is_included: true,
              layout: { blocks: [] },
            },
          ],
        }),
      },
    );
    expect(initial.migration_state).toBe("legacy_pending");
    expect(initial.legacy_source_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(initial.legacy_source_page_count).toBe(1);
    for (const invalidCas of [
      { expected_draft_revision: null },
      { expected_base_version_id: null },
      { expected_head_revision: null },
    ]) {
      const rejected = await rpc(owner.client).rpc("stage_site_adoption", {
        expected_business_id: adoptionBusiness.id,
        expected_actor_id: owner.user.id,
        requested_site_id: initial.id,
        expected_draft_revision: initial.draft_revision,
        expected_base_version_id: initial.draft_base_version_id,
        expected_head_revision: initial.draft_base_head_revision,
        ...invalidCas,
      });
      expect(rejected.data).toBeNull();
      expect(rejected.error?.message).toContain("site_request_invalid");
    }
    const staged = await stageSiteAdoption(
      owner.client,
      context(adoptionBusiness),
      {
        siteId: initial.id,
        expectedDraftRevision: initial.draft_revision,
        expectedBaseVersionId: initial.draft_base_version_id,
        expectedHeadRevision: initial.draft_base_head_revision,
      },
    );
    expect(staged.migration_state).toBe("legacy_pending");
    expect(staged.draft_json.pages[0]?.slug).toBe("legacy-home");
    const bindingRows = await fixtureSql.unsafe<
      Array<{
        legacy_source_page_id: string | null;
        canonical_page_key: string;
      }>
    >(
      `select legacy_source_page_id, canonical_page_key
       from public.site_page_bindings where business_id = $1 and site_id = $2`,
      [adoptionBusiness.id, initial.id],
    );
    expect(bindingRows).toHaveLength(1);
    expect(bindingRows[0]?.legacy_source_page_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(bindingRows[0]?.canonical_page_key).toMatch(
      /^s[0-9a-f]+_p[0-9a-f]+$/,
    );
    const adoptionSourceCheck = await fixtureSql.unsafe<
      Array<{
        state_checksum: string;
        current_checksum: string;
        unchanged: boolean;
        binding_checksum: string;
        page_checksum: string;
      }>
    >(
      `select
         state.legacy_source_checksum as state_checksum,
         private.site_legacy_source_fingerprint_v2($1) as current_checksum,
         private.site_legacy_source_is_unchanged_v2(
           $1, $2, state.legacy_source_checksum
         ) as unchanged,
         binding.legacy_source_checksum as binding_checksum,
         encode(extensions.digest(
           convert_to(to_jsonb(page_value)::text, 'UTF8'), 'sha256'
         ), 'hex') as page_checksum
       from public.site_states as state
       join public.site_page_bindings as binding
         on binding.business_id = state.business_id
         and binding.site_id = state.id
         and binding.legacy_source_page_id is not null
       join public.pages as page_value
         on page_value.business_id = binding.business_id
         and page_value.id = binding.legacy_source_page_id
       where state.business_id = $1 and state.id = $2`,
      [adoptionBusiness.id, initial.id],
    );
    expect(adoptionSourceCheck).toHaveLength(1);
    expect(adoptionSourceCheck[0]).toMatchObject({
      unchanged: true,
      state_checksum: adoptionSourceCheck[0]?.current_checksum,
      binding_checksum: adoptionSourceCheck[0]?.page_checksum,
    });

    const candidate = await prepareSiteReleaseV2(
      owner.client,
      context(adoptionBusiness),
      {
        siteId: initial.id,
        ...(await currentnessForSite(adoptionBusiness)),
      },
    );
    await publishSiteReleaseV2(owner.client, context(adoptionBusiness), {
      siteId: initial.id,
      candidateId: candidate.id,
      ...(await currentnessForSite(adoptionBusiness)),
    });
    expect((await siteState(adoptionBusiness)).migration_state).toBe("adopted");
    const resolved = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_page",
      {
        requested_business_slug: adoptionBusiness.slug,
        requested_page_slug: "legacy-home",
      },
    );
    expect(resolved).toMatchObject({ site: { schema_version: 2 } });
    const preorderArguments = {
      requested_business_slug: adoptionBusiness.slug,
      requested_page_slug: "legacy-home",
      requested_preorder_key: "legacy",
      submission: {},
      requested_request_hash: "hash",
    };
    for (const client of [anonymous, owner.client]) {
      const rejected = await rpc(client).rpc<Record<string, unknown>>(
        "submit_public_preorder",
        preorderArguments,
      );
      expect(rejected.data).toBeNull();
      expect(rejected.error?.code).toBe("42501");
    }
    const trustedPreorder = await rpc(admin).rpc<Record<string, unknown>>(
      "submit_public_preorder",
      preorderArguments,
    );
    expect(trustedPreorder.error).toBeNull();
    expect(trustedPreorder.data).toMatchObject({
      ok: false,
      code: "legacy_public_actions_retired",
    });
    for (const name of [
      "submit_public_create_form",
      "submit_public_booking",
    ] as const) {
      const argumentsValue = {
        requested_business_slug: adoptionBusiness.slug,
        requested_page_slug: "legacy-home",
        [name === "submit_public_booking"
          ? "requested_booking_key"
          : "requested_form_key"]: "legacy",
        ...(name === "submit_public_booking"
          ? {
              requested_idempotency_token: crypto.randomUUID(),
              requested_submission: {},
            }
          : {
              requested_idempotency_token: crypto.randomUUID(),
              requested_data: {},
            }),
        requested_request_hash: "hash",
      };
      const retired = await rpc(anonymous).rpc<Record<string, unknown>>(
        name,
        argumentsValue,
      );
      expect(retired.error).toBeNull();
      expect(retired.data).toMatchObject({
        ok: false,
        code: "legacy_public_actions_retired",
      });
    }
    const unpublished = await unpublishSite(
      owner.client,
      context(adoptionBusiness),
      {
        siteId: initial.id,
        expectedActiveReleaseRevision: (await siteState(adoptionBusiness))
          .active_release_revision,
      },
    );
    expect(unpublished.active_release_id).toBeNull();
    await expect(
      callNullableRpc(anonymous, "resolve_public_page", {
        requested_business_slug: adoptionBusiness.slug,
        requested_page_slug: "legacy-home",
      }),
    ).resolves.toBeNull();
  });
});

async function currentnessForSite(business: Business = catalogueBusiness) {
  const state = await siteState(business);
  return currentness(state);
}
