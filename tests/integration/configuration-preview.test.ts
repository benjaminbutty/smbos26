import { execFileSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConfigurationPreviewPage } from "../../src/components/configuration-preview-page";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../../src/core/configuration/definition-source";
import { loadRenderedConfigurationPreview } from "../../src/core/configuration/rendered-preview";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
} from "../../src/core/configuration/service";
import {
  configurationOperationsSchema,
  type ConfigurationOperation,
} from "../../src/core/configuration/schemas";
import { createExperienceService } from "../../src/core/experience/service";
import { createGraphService } from "../../src/core/graph/service";
import { createRecordLocationLinkService } from "../../src/core/graph/location-links";
import {
  publicPreorderCatalogueSchema,
  type PublicPreorderCatalogue,
} from "../../src/core/preorder/schemas";
import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

vi.mock("server-only", () => ({}));

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type ChangeSet = Tables<"configuration_change_sets">;
type Identity = { client: Client; user: User };

const password = "Milestone-5-phase-4b-preview-test!";
const createdUserIds: string[] = [];

let settings: LocalSupabaseSettings;
let sql: Sql;
let admin: Client;
let anonymous: Client;
let serviceRole: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let configuredBusiness: Business;
let lifecycleBusiness: Business;
let configuredService: ConfigurationChangeService;
let adminConfiguredService: ConfigurationChangeService;
let lifecycleService: ConfigurationChangeService;
let configuredVersion1Id: string;
let ordinaryProposal: ChangeSet;
let rollbackProposal: ChangeSet;
let crossBusinessProposal: ChangeSet;
let configuredPreorderKey: string;
let configuredPageKey: string;
let configuredPageSlug: string;

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
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.user) {
    throw signedIn.error ?? new Error(`Could not sign in ${email}.`);
  }
  return { client, user: signedIn.data.user };
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `m5-preview-${label}-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
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
  return requireData(
    await identity.client.rpc("create_business", {
      business_name: name,
      requested_business_type: "test",
      requested_timezone: "Europe/London",
    }),
    `Could not create ${name}`,
  );
}

async function addMembership(
  identity: Identity,
  business: Business,
  role: "admin" | "staff",
): Promise<void> {
  const result = await admin.from("business_memberships").insert({
    business_id: business.id,
    user_id: identity.user.id,
    role,
  });
  if (result.error) {
    throw result.error;
  }
}

async function createLocation(
  business: Business,
  name: string,
): Promise<Tables<"locations">> {
  return requireData(
    await owner.client.rpc("create_location", {
      target_business_id: business.id,
      location_name: name,
      requested_timezone: "Europe/London",
    }),
    `Could not create ${name}`,
  );
}

function operationsFromSnapshot(
  snapshot: ConfigurationSnapshotV1,
  locationIds: Readonly<Record<string, string>>,
): ConfigurationOperation[] {
  const allowedByPreorder = new Map<string, string[]>();
  for (const association of snapshot.preorder_experience_locations) {
    if (!association.is_active) {
      continue;
    }
    const replacement = locationIds[association.location_id];
    if (!replacement) {
      throw new Error("Missing cloned preorder Location.");
    }
    const allowed = allowedByPreorder.get(association.preorder_key) ?? [];
    allowed.push(replacement);
    allowedByPreorder.set(association.preorder_key, allowed);
  }

  return configurationOperationsSchema.parse([
    ...snapshot.object_definitions.map((definition) => ({
      op: "set_object" as const,
      key: definition.key,
      singular_label: definition.singular_label,
      plural_label: definition.plural_label,
      description: definition.description,
      icon: definition.icon,
      is_active: definition.is_active,
    })),
    ...snapshot.field_definitions.map((definition) => ({
      op: "set_field" as const,
      object_key: definition.object_key,
      key: definition.key,
      label: definition.label,
      field_type: definition.field_type,
      required: definition.required,
      default_value: definition.default_value,
      settings_json: definition.settings_json,
      position: definition.position,
      is_active: definition.is_active,
    })),
    ...snapshot.relationship_definitions.map((definition) => ({
      op: "set_relationship" as const,
      key: definition.key,
      source_object_key: definition.source_object_key,
      target_object_key: definition.target_object_key,
      source_label: definition.source_label,
      target_label: definition.target_label,
      cardinality: definition.cardinality,
      is_required: definition.is_required,
      is_active: definition.is_active,
    })),
    ...snapshot.views.map((definition) => ({
      op: "set_view" as const,
      key: definition.key,
      name: definition.name,
      view_type: definition.view_type,
      object_key: definition.object_key,
      config_json: definition.config_json,
      audience: definition.audience,
      is_active: definition.is_active,
    })),
    ...snapshot.forms.map((definition) => ({
      op: "set_form" as const,
      key: definition.key,
      name: definition.name,
      object_key: definition.object_key,
      mode: definition.mode,
      config_json: definition.config_json,
      audience: definition.audience,
      is_active: definition.is_active,
    })),
    ...snapshot.pages.map((definition) => ({
      op: "set_page" as const,
      key: definition.key,
      title: definition.title,
      slug: definition.slug,
      audience: definition.audience,
      layout_json: definition.layout_json,
      status: definition.status,
      is_active: definition.is_active,
    })),
    ...snapshot.preorder_experiences.map((definition) => ({
      op: "set_preorder_experience" as const,
      key: definition.key,
      product_object_key: definition.product_object_key,
      customer_object_key: definition.customer_object_key,
      order_object_key: definition.order_object_key,
      order_item_object_key: definition.order_item_object_key,
      customer_places_order_relationship_key:
        definition.customer_places_order_relationship_key,
      order_contains_item_relationship_key:
        definition.order_contains_item_relationship_key,
      product_appears_in_item_relationship_key:
        definition.product_appears_in_item_relationship_key,
      config_json: definition.config_json,
      allowed_location_ids: allowedByPreorder.get(definition.key) ?? [],
      is_active: definition.is_active,
    })),
  ]);
}

async function installConfiguredBusiness(): Promise<void> {
  const [bedfordSnapshotRow] = await sql<{ snapshot: Json }[]>`
    select private.configuration_snapshot_v1(business.id) as snapshot
    from public.businesses as business
    where business.slug = 'bedford-bakery-demo'
  `;
  if (!bedfordSnapshotRow) {
    throw new Error("Could not load the Bedford configuration template.");
  }
  const snapshot = configurationSnapshotV1Schema.parse(
    bedfordSnapshotRow.snapshot,
  );
  const sourceLocationRows = await sql<{ id: string; name: string }[]>`
    select location.id, location.name
    from public.locations as location
    join public.businesses as business
      on business.id = location.business_id
    where business.slug = 'bedford-bakery-demo'
  `;
  const replacementIds: Record<string, string> = {};
  for (const sourceLocation of sourceLocationRows) {
    const replacement = await createLocation(
      configuredBusiness,
      sourceLocation.name,
    );
    replacementIds[sourceLocation.id] = replacement.id;
  }

  const proposal = await configuredService.proposeChangeSet({
    ...(await configuredService.getProposalCurrentness()),
    title: "Install isolated preview foundation fixture",
    description: "Test-only clone of generic Bedford configuration.",
    operations: operationsFromSnapshot(snapshot, replacementIds),
  });
  await configuredService.validateChangeSet(proposal.id);
  const applied = await configuredService.applyChangeSet(proposal.id);
  expect(applied.status).toBe("applied");

  const productObject = requireData(
    await owner.client
      .from("object_definitions")
      .select("*")
      .eq("business_id", configuredBusiness.id)
      .eq("key", "product")
      .single(),
    "Could not load cloned Product Object",
  );
  const graph = createGraphService(owner.client, {
    businessId: configuredBusiness.id,
  });
  const product = await graph.createRecord({
    objectDefinitionId: productObject.id,
    data: {
      name: "Preview Afternoon Tea",
      description: "Operational product used by preview.",
      price: 30,
      status: "Active",
    },
  });
  const links = createRecordLocationLinkService(owner.client, {
    businessId: configuredBusiness.id,
  });
  for (const locationId of Object.values(replacementIds)) {
    await links.create(product.id, locationId);
  }

  const publicPage = snapshot.pages.find(
    (definition) => definition.audience === "public",
  );
  const preorder = snapshot.preorder_experiences[0];
  if (!publicPage || !preorder) {
    throw new Error("Cloned preview fixture lacks its public Page/preorder.");
  }
  configuredPageKey = publicPage.key;
  configuredPageSlug = publicPage.slug;
  configuredPreorderKey = preorder.key;
}

async function preorderOperation(
  daysOfWeek: number[],
): Promise<ConfigurationOperation> {
  const [head] = await sql<{ snapshot_json: Json }[]>`
    select version.snapshot_json
    from public.configuration_versions as version
    join public.business_configuration_heads as head
      on head.business_id = version.business_id
      and head.active_version_id = version.id
    where head.business_id = ${configuredBusiness.id}::uuid
  `;
  if (!head) {
    throw new Error("Could not load configured preview fixture head.");
  }
  const snapshot = configurationSnapshotV1Schema.parse(head.snapshot_json);
  const preorder = snapshot.preorder_experiences.find(
    (definition) => definition.key === configuredPreorderKey,
  );
  if (!preorder) {
    throw new Error("Could not load configured preorder candidate.");
  }
  const config = structuredClone(preorder.config_json);
  config.schedule.days_of_week = daysOfWeek;
  const allowedLocationIds = snapshot.preorder_experience_locations
    .filter(
      (association) =>
        association.preorder_key === preorder.key && association.is_active,
    )
    .map((association) => association.location_id);

  return {
    op: "set_preorder_experience",
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
    config_json: config,
    allowed_location_ids: allowedLocationIds,
    is_active: true,
  };
}

async function internalViewPageOperation(
  key: string,
  title: string,
): Promise<ConfigurationOperation> {
  const [head] = await sql<{ snapshot_json: Json }[]>`
    select version.snapshot_json
    from public.configuration_versions as version
    join public.business_configuration_heads as head
      on head.business_id = version.business_id
      and head.active_version_id = version.id
    where head.business_id = ${configuredBusiness.id}::uuid
  `;
  if (!head) {
    throw new Error("Could not load configured preview fixture head.");
  }
  const snapshot = configurationSnapshotV1Schema.parse(head.snapshot_json);
  const internalView = snapshot.views.find(
    (view) => view.audience === "internal" && view.is_active,
  );
  if (!internalView) {
    throw new Error("Could not load an internal View for preview assembly.");
  }

  return {
    op: "set_page",
    key,
    title,
    slug: key.replaceAll("_", "-"),
    audience: "internal",
    layout_json: {
      blocks: [{ type: "view", view_key: internalView.key }],
    },
    status: "draft",
    is_active: true,
  };
}

async function capturedState(changeSetId: string): Promise<Json> {
  const [captured] = await sql<{ state: Json }[]>`
    select jsonb_build_object(
      'live_snapshot',
        private.configuration_snapshot_v1(${configuredBusiness.id}::uuid),
      'head',
        (
          select to_jsonb(head)
          from public.business_configuration_heads as head
          where head.business_id = ${configuredBusiness.id}::uuid
        ),
      'version_count',
        (
          select count(*)
          from public.configuration_versions as version
          where version.business_id = ${configuredBusiness.id}::uuid
        ),
      'versions',
        (
          select coalesce(
            jsonb_agg(to_jsonb(version) order by version.version_number),
            '[]'
          )
          from public.configuration_versions as version
          where version.business_id = ${configuredBusiness.id}::uuid
        ),
      'change_set_lifecycle',
        (
          select to_jsonb(change_set) - array[
            'candidate_snapshot_json',
            'operations_json',
            'semantic_diff_json',
            'display_context_json',
            'id_allocations_json'
          ]
          from public.configuration_change_sets as change_set
          where change_set.business_id = ${configuredBusiness.id}::uuid
            and change_set.id = ${changeSetId}::uuid
        ),
      'records',
        (
          select coalesce(jsonb_agg(to_jsonb(record) order by record.id), '[]')
          from public.records as record
          where record.business_id = ${configuredBusiness.id}::uuid
        ),
      'record_relationships',
        (
          select coalesce(
            jsonb_agg(to_jsonb(relationship) order by relationship.id),
            '[]'
          )
          from public.record_relationships as relationship
          where relationship.business_id = ${configuredBusiness.id}::uuid
        ),
      'record_location_links',
        (
          select coalesce(jsonb_agg(to_jsonb(link) order by link.id), '[]')
          from public.record_location_links as link
          where link.business_id = ${configuredBusiness.id}::uuid
        ),
      'preorder_submissions_and_email_state',
        (
          select coalesce(
            jsonb_agg(to_jsonb(submission) order by submission.id),
            '[]'
          )
          from public.preorder_submissions as submission
          where submission.business_id = ${configuredBusiness.id}::uuid
        ),
      'slot_counters',
        (
          select coalesce(jsonb_agg(to_jsonb(counter) order by counter.id), '[]')
          from public.preorder_slot_counters as counter
          where counter.business_id = ${configuredBusiness.id}::uuid
        )
    ) as state
  `;
  if (!captured) {
    throw new Error("Could not capture preview no-write state.");
  }
  return captured.state;
}

async function expectServiceError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConfigurationChangeServiceError);
  expect((error as ConfigurationChangeServiceError).code).toBe(code);
}

async function renderCandidatePage(
  changeSetId: string,
  pageKey: string,
  identity: Identity = owner,
): Promise<{
  html: string;
  rendered: Awaited<ReturnType<typeof loadRenderedConfigurationPreview>>;
}> {
  const rendered = await loadRenderedConfigurationPreview(identity.client, {
    businessId: configuredBusiness.id,
    actorId: identity.user.id,
    changeSetId,
    pageKey,
  });
  return {
    rendered,
    html: renderToStaticMarkup(
      createElement(ConfigurationPreviewPage, {
        businessSlug: configuredBusiness.slug,
        rendered,
      }),
    ),
  };
}

async function loadLiveCatalogue(): Promise<PublicPreorderCatalogue> {
  return publicPreorderCatalogueSchema.parse(
    requireData(
      await anonymous.rpc("resolve_public_preorder", {
        requested_business_slug: configuredBusiness.slug,
        requested_page_slug: configuredPageSlug,
        requested_preorder_key: configuredPreorderKey,
      }),
      "Could not resolve the live preorder",
    ),
  );
}

async function setAuthenticatedTransactionContext(
  transaction: TransactionSql,
  identity: Identity,
): Promise<void> {
  await transaction.unsafe("set local role authenticated");
  await transaction`
    select set_config(
      'request.jwt.claim.sub',
      ${identity.user.id},
      true
    )
  `;
  await transaction`
    select set_config(
      'request.jwt.claim.role',
      'authenticated',
      true
    )
  `;
  await transaction`
    select set_config(
      'request.jwt.claims',
      ${JSON.stringify({
        role: "authenticated",
        sub: identity.user.id,
      })},
      true
    )
  `;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function briefly(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

describe("Milestone 5 Phase 4B.1 authenticated preview foundation", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    sql = postgres(settings.databaseUrl, { max: 1 });
    admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    serviceRole = admin;
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
    configuredBusiness = await createBusiness(
      owner,
      "Preview Foundation Configured",
    );
    lifecycleBusiness = await createBusiness(
      owner,
      "Preview Foundation Lifecycle",
    );
    await Promise.all([
      addMembership(administrator, configuredBusiness, "admin"),
      addMembership(administrator, lifecycleBusiness, "admin"),
      addMembership(staff, configuredBusiness, "staff"),
      addMembership(staff, lifecycleBusiness, "staff"),
    ]);
    configuredService = new ConfigurationChangeService(owner.client, {
      businessId: configuredBusiness.id,
      actorId: owner.user.id,
    });
    adminConfiguredService = new ConfigurationChangeService(
      administrator.client,
      {
        businessId: configuredBusiness.id,
        actorId: administrator.user.id,
      },
    );
    lifecycleService = new ConfigurationChangeService(owner.client, {
      businessId: lifecycleBusiness.id,
      actorId: owner.user.id,
    });

    configuredVersion1Id = (await configuredService.listVersions()).find(
      (version) => version.version_number === 1,
    )!.id;
    await installConfiguredBusiness();
    ordinaryProposal = await configuredService.proposeChangeSet({
      ...(await configuredService.getProposalCurrentness()),
      title: "Preview Saturday-only collection",
      description: "Ordinary preview replay proof.",
      operations: [await preorderOperation([6])],
    });
    rollbackProposal = await configuredService.prepareRollback({
      targetVersionId: configuredVersion1Id,
      title: "Preview configuration rollback",
      description: "Rollback preview replay proof.",
    });

    const lifecycleBaseline = await lifecycleService.proposeChangeSet({
      ...(await lifecycleService.getProposalCurrentness()),
      title: "Install lifecycle preview probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "preview_probe",
          singular_label: "Preview probe",
          plural_label: "Preview probes",
          description: "",
          icon: null,
          is_active: true,
        },
        {
          op: "set_field",
          object_key: "preview_probe",
          key: "name",
          label: "Name",
          field_type: "short_text",
          required: false,
          default_value: null,
          settings_json: {},
          position: 0,
          is_active: true,
        },
      ],
    });
    await lifecycleService.validateChangeSet(lifecycleBaseline.id);
    await lifecycleService.applyChangeSet(lifecycleBaseline.id);
    const graph = createGraphService(owner.client, {
      businessId: lifecycleBusiness.id,
    });
    const probeObject = requireData(
      await owner.client
        .from("object_definitions")
        .select("*")
        .eq("business_id", lifecycleBusiness.id)
        .eq("key", "preview_probe")
        .single(),
      "Could not load lifecycle probe Object",
    );
    await graph.createRecord({
      objectDefinitionId: probeObject.id,
      data: { name: "Existing probe" },
    });
    crossBusinessProposal = await lifecycleService.proposeChangeSet({
      ...(await lifecycleService.getProposalCurrentness()),
      title: "Cross-Business preview probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "preview_probe",
          singular_label: "Preview probe",
          plural_label: "Preview probe records",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    if (admin && configuredBusiness && lifecycleBusiness) {
      await admin
        .from("businesses")
        .delete()
        .in("id", [configuredBusiness.id, lifecycleBusiness.id]);
    }
    if (admin) {
      await Promise.all(
        createdUserIds.map((userId) => admin.auth.admin.deleteUser(userId)),
      );
    }
    await owner?.client.auth.signOut();
    await administrator?.client.auth.signOut();
    await staff?.client.auth.signOut();
    await sql?.end();
  });

  it("replays ordinary and rollback candidates for Owner/Admin and changes no state", async () => {
    const before = await capturedState(ordinaryProposal.id);
    const ownerPreview = await configuredService.loadPreview(
      ordinaryProposal.id,
    );
    const adminPreview = await adminConfiguredService.loadPreview(
      ordinaryProposal.id,
    );
    const rollbackPreview = await configuredService.loadPreview(
      rollbackProposal.id,
    );

    expect(ownerPreview).toMatchObject({
      proposalId: ordinaryProposal.id,
      kind: "change",
      status: "proposed",
      candidateChecksum: ordinaryProposal.candidate_checksum,
    });
    expect(adminPreview.candidateChecksum).toBe(
      ordinaryProposal.candidate_checksum,
    );
    expect(rollbackPreview).toMatchObject({
      proposalId: rollbackProposal.id,
      kind: "rollback",
      status: "proposed",
      candidateChecksum: rollbackProposal.candidate_checksum,
    });
    expect(
      ownerPreview.pages.some((page) => page.key === configuredPageKey),
    ).toBe(true);

    const candidateCatalogue = publicPreorderCatalogueSchema.parse(
      requireData(
        await owner.client.rpc("resolve_configuration_preview_preorder", {
          expected_business_id: configuredBusiness.id,
          expected_actor_id: owner.user.id,
          requested_change_set_id: ordinaryProposal.id,
          requested_page_key: configuredPageKey,
          requested_preorder_key: configuredPreorderKey,
        }),
        "Could not resolve candidate preorder",
      ),
    );
    const liveCatalogue = publicPreorderCatalogueSchema.parse(
      requireData(
        await anonymous.rpc("resolve_public_preorder", {
          requested_business_slug: configuredBusiness.slug,
          requested_page_slug: configuredPageSlug,
          requested_preorder_key: configuredPreorderKey,
        }),
        "Could not resolve live preorder",
      ),
    );
    expect(candidateCatalogue.preorder.schedule.days_of_week).toEqual([6]);
    expect(liveCatalogue.preorder.schedule.days_of_week).toEqual([6, 7]);
    expect(candidateCatalogue.preorder.products).toEqual(
      liveCatalogue.preorder.products,
    );

    const [equivalence] = await sql<{ current: Json; legacy: Json }[]>`
      select
        private.resolve_preorder_catalogue_at(
          ${configuredBusiness.slug},
          ${configuredPageSlug},
          ${configuredPreorderKey},
          '2026-07-29T08:00:00Z'::timestamptz
        ) as current,
        private.resolve_preorder_catalogue_at_m4(
          ${configuredBusiness.slug},
          ${configuredPageSlug},
          ${configuredPreorderKey},
          '2026-07-29T08:00:00Z'::timestamptz
        ) as legacy
    `;
    expect(equivalence?.current).toEqual(equivalence?.legacy);
    expect(await capturedState(ordinaryProposal.id)).toEqual(before);
  }, 30_000);

  it("denies every untrusted preview caller and keeps helpers private", async () => {
    const staffResult = await staff.client.rpc("load_configuration_preview", {
      expected_business_id: configuredBusiness.id,
      expected_actor_id: staff.user.id,
      requested_change_set_id: ordinaryProposal.id,
    });
    expect(staffResult.error?.code).toBe("42501");

    const anonymousResult = await anonymous.rpc("load_configuration_preview", {
      expected_business_id: configuredBusiness.id,
      expected_actor_id: owner.user.id,
      requested_change_set_id: ordinaryProposal.id,
    });
    expect(anonymousResult.error?.code).toBe("42501");

    const serviceRoleResult = await serviceRole.rpc(
      "load_configuration_preview",
      {
        expected_business_id: configuredBusiness.id,
        expected_actor_id: owner.user.id,
        requested_change_set_id: ordinaryProposal.id,
      },
    );
    expect(serviceRoleResult.error?.code).toBe("42501");

    const mismatch = await owner.client.rpc("load_configuration_preview", {
      expected_business_id: configuredBusiness.id,
      expected_actor_id: administrator.user.id,
      requested_change_set_id: ordinaryProposal.id,
    });
    expect(mismatch.error?.message).toContain(
      "configuration_actor_context_mismatch",
    );

    const crossBusiness = await owner.client.rpc("load_configuration_preview", {
      expected_business_id: configuredBusiness.id,
      expected_actor_id: owner.user.id,
      requested_change_set_id: crossBusinessProposal.id,
    });
    expect(crossBusiness.error?.message).toContain(
      "configuration_preview_not_found",
    );

    const suppliedCandidate = await owner.client.rpc(
      "load_configuration_preview",
      {
        expected_business_id: configuredBusiness.id,
        expected_actor_id: owner.user.id,
        requested_change_set_id: ordinaryProposal.id,
        candidate_snapshot_json: {},
      } as never,
    );
    expect(suppliedCandidate.error).not.toBeNull();

    const privatePrivileges = await sql<
      { allowed: boolean; function_name: string; role_name: string }[]
    >`
      select
        role_name,
        function_value.proname as function_name,
        has_function_privilege(
          role_name,
          function_value.oid,
          'EXECUTE'
        ) as allowed
      from unnest(
        array['anon', 'authenticated', 'service_role']
      ) as role_name
      join pg_catalog.pg_proc as function_value on true
      join pg_catalog.pg_namespace as namespace_value
        on namespace_value.oid = function_value.pronamespace
      where namespace_value.nspname = 'private'
        and function_value.proname in (
          'assert_configuration_preview_v1',
          'assemble_preorder_catalogue_v1'
        )
    `;
    expect(privatePrivileges).toHaveLength(6);
    expect(privatePrivileges.every(({ allowed }) => !allowed)).toBe(true);
  });

  it("rejects stale and every closed status without preview lifecycle mutation", async () => {
    const abandoned = await lifecycleService.proposeChangeSet({
      ...(await lifecycleService.getProposalCurrentness()),
      title: "Abandoned preview probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "preview_probe",
          singular_label: "Preview probe",
          plural_label: "Abandoned probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    await lifecycleService.abandonChangeSet(abandoned.id);

    const stale = await lifecycleService.proposeChangeSet({
      ...(await lifecycleService.getProposalCurrentness()),
      title: "Stale preview probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "preview_probe",
          singular_label: "Preview probe",
          plural_label: "Stale probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    const conflict = await lifecycleService.proposeChangeSet({
      ...(await lifecycleService.getProposalCurrentness()),
      title: "Conflicted preview probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "preview_probe",
          singular_label: "Preview probe",
          plural_label: "Conflicted probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    const appliedProposal = await lifecycleService.proposeChangeSet({
      ...(await lifecycleService.getProposalCurrentness()),
      title: "Applied preview probe",
      description: null,
      operations: [
        {
          op: "set_object",
          key: "preview_probe",
          singular_label: "Preview probe",
          plural_label: "Applied probes",
          description: "",
          icon: null,
          is_active: true,
        },
      ],
    });
    await lifecycleService.validateChangeSet(appliedProposal.id);
    await lifecycleService.applyChangeSet(appliedProposal.id);

    await expectServiceError(
      lifecycleService.loadPreview(abandoned.id),
      "configuration_preview_unavailable",
    );
    await expectServiceError(
      lifecycleService.loadPreview(appliedProposal.id),
      "configuration_preview_unavailable",
    );

    const staleBefore = await lifecycleService.getChangeSet(stale.id);
    await expectServiceError(
      lifecycleService.loadPreview(stale.id),
      "configuration_preview_stale",
    );
    expect(await lifecycleService.getChangeSet(stale.id)).toEqual(staleBefore);

    const conflicted = await lifecycleService.validateChangeSet(conflict.id);
    expect(conflicted.status).toBe("conflicted");
    await expectServiceError(
      lifecycleService.loadPreview(conflict.id),
      "configuration_preview_unavailable",
    );

    const rejectedProposal = await lifecycleService.proposeChangeSet({
      ...(await lifecycleService.getProposalCurrentness()),
      title: "Rejected preview probe",
      description: null,
      operations: [
        {
          op: "set_field",
          object_key: "preview_probe",
          key: "required_preview_value",
          label: "Required preview value",
          field_type: "short_text",
          required: true,
          default_value: null,
          settings_json: {},
          position: 1,
          is_active: true,
        },
      ],
    });
    const rejected = await lifecycleService.validateChangeSet(
      rejectedProposal.id,
    );
    expect(rejected.status).toBe("rejected");
    await expectServiceError(
      lifecycleService.loadPreview(rejected.id),
      "configuration_preview_unavailable",
    );
  }, 90_000);

  describe.skipIf(process.env.SMBOS_RENDERED_PREVIEW_TESTS !== "1")(
    "Milestone 5 Phase 4B.2 rendered candidate preview",
    () => {
      it("renders Owner/Admin candidates, Catering Enquiries, ordinary changes and rollback without preview writes or public leakage", async () => {
        const configuredVersion2 = (
          await configuredService.listVersions()
        ).find((version) => version.version_number === 2);
        if (!configuredVersion2) {
          throw new Error("Missing configured Version 2.");
        }

        const ordinaryBefore = await capturedState(ordinaryProposal.id);
        const ownerOrdinary = await renderCandidatePage(
          ordinaryProposal.id,
          configuredPageKey,
        );
        const adminOrdinary = await renderCandidatePage(
          ordinaryProposal.id,
          configuredPageKey,
          administrator,
        );
        expect(ownerOrdinary.html).toContain("Preview — not live");
        expect(ownerOrdinary.html).toContain(
          "Preview Saturday-only collection",
        );
        expect(ownerOrdinary.html).toContain("Change · Proposed");
        expect(ownerOrdinary.html).toContain("Collection days: Saturday");
        expect(ownerOrdinary.html).not.toContain("Saturday, Sunday");
        expect(ownerOrdinary.html).toContain(
          "Explore this preorder — submission is disabled.",
        );
        expect(ownerOrdinary.html).toContain("Disabled in preview");
        expect(ownerOrdinary.html).not.toContain("/api/preorder/");
        expect(adminOrdinary.html).toContain("Preview — not live");
        expect(await capturedState(ordinaryProposal.id)).toEqual(
          ordinaryBefore,
        );

        await expectServiceError(
          loadRenderedConfigurationPreview(staff.client, {
            businessId: configuredBusiness.id,
            actorId: staff.user.id,
            changeSetId: ordinaryProposal.id,
            pageKey: configuredPageKey,
          }),
          "configuration_owner_or_admin_required",
        );
        await expect(
          loadRenderedConfigurationPreview(anonymous, {
            businessId: configuredBusiness.id,
            actorId: owner.user.id,
            changeSetId: ordinaryProposal.id,
            pageKey: configuredPageKey,
          }),
        ).rejects.toBeInstanceOf(ConfigurationChangeServiceError);
        await expectServiceError(
          loadRenderedConfigurationPreview(owner.client, {
            businessId: configuredBusiness.id,
            actorId: administrator.user.id,
            changeSetId: ordinaryProposal.id,
            pageKey: configuredPageKey,
          }),
          "configuration_actor_context_mismatch",
        );
        await expectServiceError(
          loadRenderedConfigurationPreview(owner.client, {
            businessId: configuredBusiness.id,
            actorId: owner.user.id,
            changeSetId: crossBusinessProposal.id,
            pageKey: configuredPageKey,
          }),
          "configuration_preview_not_found",
        );
        await expect(
          loadRenderedConfigurationPreview(owner.client, {
            businessId: configuredBusiness.id,
            actorId: owner.user.id,
            changeSetId: ordinaryProposal.id,
            pageKey: "unknown_candidate_page",
          }),
        ).rejects.toThrow("candidate Page is not available");
        await expect(
          loadRenderedConfigurationPreview(owner.client, {
            businessId: configuredBusiness.id,
            actorId: owner.user.id,
            changeSetId: ordinaryProposal.id,
            pageKey: configuredPageKey,
            candidate_snapshot_json: {},
          } as never),
        ).rejects.toThrow();

        const liveWeekend = await loadLiveCatalogue();
        expect(liveWeekend.preorder.schedule.days_of_week).toEqual([6, 7]);
        const livePageBefore = requireData(
          await anonymous.rpc("resolve_public_page", {
            requested_business_slug: configuredBusiness.slug,
            requested_page_slug: configuredPageSlug,
          }),
          "Could not resolve live public Page",
        );

        const [activeVersion] = await sql<{ snapshot_json: Json }[]>`
          select version.snapshot_json
          from public.configuration_versions as version
          join public.business_configuration_heads as head
            on head.business_id = version.business_id
            and head.active_version_id = version.id
          where head.business_id = ${configuredBusiness.id}::uuid
        `;
        if (!activeVersion) {
          throw new Error("Missing active configuration snapshot.");
        }
        const activeSnapshot = configurationSnapshotV1Schema.parse(
          activeVersion.snapshot_json,
        );
        const publicPage = activeSnapshot.pages.find(
          (page) => page.key === configuredPageKey,
        );
        if (!publicPage) {
          throw new Error("Missing active public Page.");
        }
        const candidateSlug = "candidate-preorder-slug";
        const slugProposal = await configuredService.proposeChangeSet({
          ...(await configuredService.getProposalCurrentness()),
          title: "Preview a customer Page slug change",
          description: null,
          operations: [
            {
              op: "set_page",
              key: publicPage.key,
              title: publicPage.title,
              slug: candidateSlug,
              audience: publicPage.audience,
              layout_json: publicPage.layout_json,
              status: publicPage.status,
              is_active: true,
            },
          ],
        });
        const slugPreview = await renderCandidatePage(
          slugProposal.id,
          configuredPageKey,
        );
        expect(slugPreview.rendered.page.definition.slug).toBe(candidateSlug);
        expect(slugPreview.html).toContain(
          `/changes/${slugProposal.id}/preview/${configuredPageKey}`,
        );
        expect(slugPreview.html).not.toContain(candidateSlug);

        const candidateSlugPublic = await anonymous.rpc("resolve_public_page", {
          requested_business_slug: configuredBusiness.slug,
          requested_page_slug: candidateSlug,
        });
        const candidateKeyPublic = await anonymous.rpc("resolve_public_page", {
          requested_business_slug: configuredBusiness.slug,
          requested_page_slug: configuredPageKey,
        });
        expect(candidateSlugPublic.error).toBeNull();
        expect(candidateSlugPublic.data).toBeNull();
        expect(candidateKeyPublic.error).toBeNull();
        expect(candidateKeyPublic.data).toBeNull();
        expect(
          requireData(
            await anonymous.rpc("resolve_public_page", {
              requested_business_slug: configuredBusiness.slug,
              requested_page_slug: configuredPageSlug,
            }),
            "Live public Page disappeared",
          ),
        ).toEqual(livePageBefore);

        const recordsBeforeCatering = requireData(
          await owner.client
            .from("records")
            .select("*")
            .eq("business_id", configuredBusiness.id),
          "Could not capture Records before Catering preview",
        );
        const cateringProposal = await configuredService.proposeChangeSet({
          ...(await configuredService.getProposalCurrentness()),
          title: "Add Catering Enquiries",
          description: "Rendered extensibility proof.",
          operations: [
            {
              op: "set_object",
              key: "catering_enquiry",
              singular_label: "Catering Enquiry",
              plural_label: "Catering Enquiries",
              description: "A request for catering information.",
              icon: null,
              is_active: true,
            },
            ...[
              ["name", "Name", "short_text", true],
              ["email", "Email", "email", true],
              ["event_date", "Event Date", "date", true],
              ["guest_count", "Guest Count", "number", true],
              ["notes", "Notes", "long_text", false],
            ].map(
              ([key, label, fieldType, required], position) =>
                ({
                  op: "set_field",
                  object_key: "catering_enquiry",
                  key,
                  label,
                  field_type: fieldType,
                  required,
                  default_value: null,
                  settings_json: {},
                  position,
                  is_active: true,
                }) as ConfigurationOperation,
            ),
            {
              op: "set_form",
              key: "catering_enquiry_create",
              name: "New Catering Enquiry",
              object_key: "catering_enquiry",
              mode: "create",
              config_json: {
                fields: [
                  { field: "name" },
                  { field: "email" },
                  { field: "event_date" },
                  { field: "guest_count" },
                  { field: "notes" },
                ],
                submit_label: "Create enquiry",
              },
              audience: "internal",
              is_active: true,
            },
            {
              op: "set_view",
              key: "catering_enquiries",
              name: "Catering Enquiries",
              view_type: "table",
              object_key: "catering_enquiry",
              config_json: {
                fields: ["name", "email", "event_date", "guest_count", "notes"],
                create_form_key: "catering_enquiry_create",
                include_archived: false,
              },
              audience: "internal",
              is_active: true,
            },
            {
              op: "set_page",
              key: "catering_enquiries_page",
              title: "Catering Enquiries",
              slug: "catering-enquiries",
              audience: "internal",
              layout_json: {
                blocks: [
                  { type: "view", view_key: "catering_enquiries" },
                  { type: "form", form_key: "catering_enquiry_create" },
                ],
              },
              status: "draft",
              is_active: true,
            },
          ],
        });
        const cateringBefore = await capturedState(cateringProposal.id);
        const catering = await renderCandidatePage(
          cateringProposal.id,
          "catering_enquiries_page",
        );
        expect(catering.html).toContain("Preview — not live");
        expect(catering.html).toContain("Add Catering Enquiries");
        expect(catering.html).toContain("Catering Enquiries");
        expect(catering.html).toContain(
          `/changes/${cateringProposal.id}/preview/catering_enquiries_page`,
        );
        expect(catering.html).toContain(
          "No catering enquiry information to show yet.",
        );
        expect(catering.html).toContain("Guest Count");
        expect(catering.html).toContain("Event Date");
        expect(catering.html).toContain("Disabled in preview");
        expect(catering.html).toContain("<fieldset");
        expect(catering.html).toContain("disabled");
        expect(catering.html).not.toContain("<form action=");
        expect(catering.html.match(/<a\b/g)?.length).toBe(
          catering.html.match(/<a\b[^>]*\bhref=/g)?.length,
        );
        expect(await capturedState(cateringProposal.id)).toEqual(
          cateringBefore,
        );
        expect(
          requireData(
            await owner.client
              .from("records")
              .select("*")
              .eq("business_id", configuredBusiness.id),
            "Could not capture Records after Catering preview",
          ),
        ).toEqual(recordsBeforeCatering);
        expect(
          requireData(
            await owner.client
              .from("pages")
              .select("*")
              .eq("business_id", configuredBusiness.id)
              .eq("key", "catering_enquiries_page"),
            "Could not inspect live Catering Page",
          ),
        ).toEqual([]);
        const liveNavigation = await createExperienceService(owner.client, {
          businessId: configuredBusiness.id,
        }).listNavigation();
        expect(
          liveNavigation.pages.some(
            (page) => page.key === "catering_enquiries_page",
          ),
        ).toBe(false);

        const validatedOrdinary = await configuredService.validateChangeSet(
          ordinaryProposal.id,
        );
        expect(validatedOrdinary.status).toBe("validated");
        const appliedOrdinary = await configuredService.applyChangeSet(
          ordinaryProposal.id,
        );
        expect(appliedOrdinary.status).toBe("applied");
        expect(
          (await loadLiveCatalogue()).preorder.schedule.days_of_week,
        ).toEqual([6]);

        const rollback = await configuredService.prepareRollback({
          targetVersionId: configuredVersion2.id,
          title: "Restore weekend collection",
          description: "Rendered rollback preview proof.",
        });
        const rollbackBefore = await capturedState(rollback.id);
        const rollbackRendered = await renderCandidatePage(
          rollback.id,
          configuredPageKey,
        );
        expect(rollbackRendered.html).toContain("Rollback · Proposed");
        expect(rollbackRendered.html).toContain("Saturday, Sunday");
        expect(
          (await loadLiveCatalogue()).preorder.schedule.days_of_week,
        ).toEqual([6]);
        expect(await capturedState(rollback.id)).toEqual(rollbackBefore);

        const validatedRollback = await configuredService.validateChangeSet(
          rollback.id,
        );
        expect(validatedRollback.status).toBe("validated");
        const appliedRollback = await configuredService.applyChangeSet(
          rollback.id,
        );
        expect(appliedRollback.status).toBe("applied");
        expect(
          (await loadLiveCatalogue()).preorder.schedule.days_of_week,
        ).toEqual([6, 7]);
      }, 120_000);

      it("discards an internal candidate applied while its View-only Page is assembling", async () => {
        const pageKey = "currentness_application_page";
        const proposal = await configuredService.proposeChangeSet({
          ...(await configuredService.getProposalCurrentness()),
          title: "Apply during rendered preview assembly",
          description: null,
          operations: [
            await internalViewPageOperation(
              pageKey,
              "Currentness application proof",
            ),
          ],
        });
        await configuredService.validateChangeSet(proposal.id);

        const pageLoaded = deferred();
        const resumeAssembly = deferred();
        const rendering = loadRenderedConfigurationPreview(
          owner.client,
          {
            businessId: configuredBusiness.id,
            actorId: owner.user.id,
            changeSetId: proposal.id,
            pageKey,
          },
          {
            afterCandidatePageLoaded: async () => {
              pageLoaded.resolve();
              await resumeAssembly.promise;
            },
          },
        ).then(
          (value) => ({ value, error: null }),
          (error: unknown) => ({ value: null, error }),
        );

        await pageLoaded.promise;
        const applied = await configuredService.applyChangeSet(proposal.id);
        expect(applied.status).toBe("applied");
        resumeAssembly.resolve();

        const result = await rendering;
        expect(result.value).toBeNull();
        expect(result.error).toBeInstanceOf(ConfigurationChangeServiceError);
        expect((result.error as ConfigurationChangeServiceError).code).toBe(
          "configuration_preview_unavailable",
        );
      }, 30_000);

      it("uses the final validated status and leaves an unchanged rendered candidate exactly read-only", async () => {
        const pageKey = "currentness_validation_page";
        const proposal = await configuredService.proposeChangeSet({
          ...(await configuredService.getProposalCurrentness()),
          title: "Validate during rendered preview assembly",
          description: null,
          operations: [
            await internalViewPageOperation(
              pageKey,
              "Currentness validation proof",
            ),
          ],
        });

        const pageLoaded = deferred();
        const resumeAssembly = deferred();
        const rendering = loadRenderedConfigurationPreview(
          owner.client,
          {
            businessId: configuredBusiness.id,
            actorId: owner.user.id,
            changeSetId: proposal.id,
            pageKey,
          },
          {
            afterCandidatePageLoaded: async () => {
              pageLoaded.resolve();
              await resumeAssembly.promise;
            },
          },
        );

        await pageLoaded.promise;
        const validated = await configuredService.validateChangeSet(
          proposal.id,
        );
        expect(validated.status).toBe("validated");
        resumeAssembly.resolve();

        const progressed = await rendering;
        expect(progressed.preview.status).toBe("validated");
        expect(progressed.preview.candidateChecksum).toBe(
          proposal.candidate_checksum,
        );
        expect(progressed.page.definition.key).toBe(pageKey);

        const beforeUnchanged = await capturedState(proposal.id);
        const unchanged = await loadRenderedConfigurationPreview(owner.client, {
          businessId: configuredBusiness.id,
          actorId: owner.user.id,
          changeSetId: proposal.id,
          pageKey,
        });
        expect(unchanged.preview.status).toBe("validated");
        expect(unchanged.page.definition.key).toBe(pageKey);
        expect(await capturedState(proposal.id)).toEqual(beforeUnchanged);
      }, 30_000);

      it("discards a rollback candidate applied while its internal Page is assembling", async () => {
        const target = (await configuredService.listVersions()).find(
          (version) => version.version_number === 2,
        );
        if (!target) {
          throw new Error("Missing configured rollback target Version 2.");
        }
        const rollback = await configuredService.prepareRollback({
          targetVersionId: target.id,
          title: "Apply rollback during rendered preview assembly",
          description: null,
        });
        const initialRollback = await configuredService.loadPreview(
          rollback.id,
        );
        const internalPage = initialRollback.pages.find(
          (page) => page.is_active && page.audience === "internal",
        );
        if (!internalPage) {
          throw new Error("Rollback candidate has no internal Page.");
        }
        await configuredService.validateChangeSet(rollback.id);

        const pageLoaded = deferred();
        const resumeAssembly = deferred();
        const rendering = loadRenderedConfigurationPreview(
          owner.client,
          {
            businessId: configuredBusiness.id,
            actorId: owner.user.id,
            changeSetId: rollback.id,
            pageKey: internalPage.key,
          },
          {
            afterCandidatePageLoaded: async () => {
              pageLoaded.resolve();
              await resumeAssembly.promise;
            },
          },
        ).then(
          (value) => ({ value, error: null }),
          (error: unknown) => ({ value: null, error }),
        );

        await pageLoaded.promise;
        const applied = await configuredService.applyChangeSet(rollback.id);
        expect(applied.status).toBe("applied");
        resumeAssembly.resolve();

        const result = await rendering;
        expect(result.value).toBeNull();
        expect(result.error).toBeInstanceOf(ConfigurationChangeServiceError);
        expect((result.error as ConfigurationChangeServiceError).code).toBe(
          "configuration_preview_unavailable",
        );
      }, 30_000);

      it("serializes each preview assertion RPC with application in both lock orders", async () => {
        const previewFirstProposal = await configuredService.proposeChangeSet({
          ...(await configuredService.getProposalCurrentness()),
          title: "Preview-first lock proof",
          description: null,
          operations: [await preorderOperation([6])],
        });
        await configuredService.validateChangeSet(previewFirstProposal.id);

        const previewConnection = postgres(settings.databaseUrl, { max: 1 });
        const previewReady = deferred();
        const releasePreview = deferred();
        try {
          const previewTransaction = previewConnection.begin(
            async (transaction) => {
              await setAuthenticatedTransactionContext(transaction, owner);
              const [selected] = await transaction<
                { candidate_checksum: string }[]
              >`
                select
                  (
                    public.load_configuration_preview(
                      ${configuredBusiness.id}::uuid,
                      ${owner.user.id}::uuid,
                      ${previewFirstProposal.id}::uuid
                    )
                  ).candidate_checksum
              `;
              previewReady.resolve();
              await releasePreview.promise;
              return selected;
            },
          );
          await previewReady.promise;

          let applicationSettled = false;
          const application = configuredService
            .applyChangeSet(previewFirstProposal.id)
            .finally(() => {
              applicationSettled = true;
            });
          await briefly();
          expect(applicationSettled).toBe(false);
          releasePreview.resolve();

          const [previewResult, applied] = await Promise.all([
            previewTransaction,
            application,
          ]);
          expect(previewResult?.candidate_checksum).toBe(
            previewFirstProposal.candidate_checksum,
          );
          expect(applied.status).toBe("applied");
        } finally {
          releasePreview.resolve();
          await previewConnection.end();
        }

        const applicationFirstProposal =
          await configuredService.proposeChangeSet({
            ...(await configuredService.getProposalCurrentness()),
            title: "Application-first lock proof",
            description: null,
            operations: [await preorderOperation([6, 7])],
          });
        await configuredService.validateChangeSet(applicationFirstProposal.id);

        const applicationConnection = postgres(settings.databaseUrl, {
          max: 1,
        });
        const applicationReady = deferred();
        const releaseApplication = deferred();
        try {
          const applicationTransaction = applicationConnection.begin(
            async (transaction) => {
              await setAuthenticatedTransactionContext(transaction, owner);
              const [selected] = await transaction<{ status: string }[]>`
                select
                  (
                    public.apply_configuration_change(
                      ${configuredBusiness.id}::uuid,
                      ${owner.user.id}::uuid,
                      ${applicationFirstProposal.id}::uuid
                    )
                  ).status
              `;
              applicationReady.resolve();
              await releaseApplication.promise;
              return selected;
            },
          );
          await applicationReady.promise;

          let previewSettled = false;
          const waitingPreview = configuredService
            .loadPreview(applicationFirstProposal.id)
            .then(
              (value) => ({ value, error: null }),
              (error: unknown) => ({ value: null, error }),
            )
            .finally(() => {
              previewSettled = true;
            });
          await briefly();
          expect(previewSettled).toBe(false);
          releaseApplication.resolve();

          const [applicationResult, previewResult] = await Promise.all([
            applicationTransaction,
            waitingPreview,
          ]);
          expect(applicationResult?.status).toBe("applied");
          expect(previewResult.value).toBeNull();
          expect(previewResult.error).toBeInstanceOf(
            ConfigurationChangeServiceError,
          );
          expect(
            (previewResult.error as ConfigurationChangeServiceError).code,
          ).toBe("configuration_preview_unavailable");
        } finally {
          releaseApplication.resolve();
          await applicationConnection.end();
        }
      }, 60_000);
    },
  );
});
