import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { composeInitialPreorderOperations } from "../src/core/configuration/initial-preorder/service";
import { ConfigurationChangeService } from "../src/core/configuration/service";
import {
  configurationOperationsSchema,
  type ConfigurationOperation,
} from "../src/core/configuration/schemas";
import { bookingConfigSchema } from "../src/core/booking/schemas";
import { siteDraftV1Schema, type SiteDraftV1 } from "../src/core/sites/schemas";
import type { Database, Tables } from "../src/db/supabase/database.types";
import {
  getC1LocalSupabaseSettings,
  type C1LocalSupabaseSettings,
} from "./support/c1-local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;
type Location = Tables<"locations">;
type Identity = { client: Client; user: User };
type RpcError = { code?: string; message?: string } | null;
type RpcClient = {
  rpc<T>(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<{ data: T | null; error: RpcError }>;
};
type SiteState = {
  id: string;
  draft_json: Record<string, unknown>;
  draft_revision: number;
  draft_base_version_id: string;
  draft_base_head_revision: number;
};
type SqlSiteState = Omit<
  SiteState,
  "draft_revision" | "draft_base_head_revision"
> & {
  draft_revision: number | string;
  draft_base_head_revision: number | string;
};
type PreparedRelease = {
  id: string;
  status: string;
  projection_schema_version: number;
  projection_json: { schema_version?: unknown };
};
type ActionRow = {
  release_id: string;
  action_key: string;
  release_token: string;
  action_kind: "booking" | "preorder";
  source_page_id: string | null;
  booking_key: string | null;
  preorder_experience_id: string | null;
  action_json: Record<string, unknown>;
  offer_json: Record<string, unknown>;
};
type SubmissionResult = {
  ok: boolean;
  idempotent?: boolean;
  code?: string;
  confirmation?: Record<string, unknown>;
};
type ConfigurationOperations = Parameters<
  ConfigurationChangeService["proposeChangeSet"]
>[0]["operations"];

let settings: C1LocalSupabaseSettings;
let sql: Sql;
let admin: Client;
let anonymous: Client;
let owner: Identity;
let staff: Identity;
let business: Business;
let foreignBusiness: Business;
let location: Location;
let siteId: string;
let productId: string;
let customerObjectId: string;
let appointmentObjectId: string;
let relationshipId: string;
let firstPreorderAction: ActionRow;
let firstBookingAction: ActionRow;
const createdBusinessIds: string[] = [];
const createdUserIds: string[] = [];
const password = "Sites-operational-sql-integration-password!";
const sharedEmail = "shared-visitor@example.test";

function rpc(client: Client): RpcClient {
  return client as unknown as RpcClient;
}

async function callRpc<T>(
  client: Client,
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const result = await rpc(client).rpc<T>(name, parameters);
  if (result.error || result.data === null) {
    throw new Error(`${name} failed: ${result.error?.message ?? "no data"}`);
  }
  return result.data;
}

async function createIdentity(label: string): Promise<Identity> {
  const email = `sites-operational-${label}-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
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
  if (signedIn.error || !signedIn.data.user) {
    throw signedIn.error ?? new Error(`Could not sign in ${label}.`);
  }
  return { client, user: signedIn.data.user };
}

async function createFixtureBusiness(label: string): Promise<Business> {
  const created = await callRpc<Business>(owner.client, "create_business", {
    business_name: `${label} ${crypto.randomUUID()}`,
    requested_business_type: "test",
    requested_timezone: "Europe/London",
  });
  createdBusinessIds.push(created.id);
  return created;
}

function isExpectedFixtureRetentionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  return (
    record.code === "42501" &&
    typeof record.message === "string" &&
    /permission denied for table preorder_experiences\b/i.test(record.message)
  );
}

async function createFixtureLocation(): Promise<Location> {
  const states = await callRpc<
    Array<{
      business_timezone: string;
      location_state_digest: string;
    }>
  >(owner.client, "get_location_creation_state", {
    expected_business_id: business.id,
    expected_actor_id: owner.user.id,
  });
  const state = states[0];
  if (!state) throw new Error("Location creation state was empty.");
  return callRpc<Location>(owner.client, "create_location", {
    expected_business_id: business.id,
    expected_actor_id: owner.user.id,
    expected_business_timezone: state.business_timezone,
    expected_location_state_digest: state.location_state_digest,
    location_name: "Operational collection",
    requested_timezone: "Europe/London",
  });
}

async function readSiteState(): Promise<SiteState> {
  const rows = await sql<SqlSiteState[]>`
    select id, draft_json, draft_revision, draft_base_version_id,
      draft_base_head_revision
    from public.site_states
    where business_id = ${business.id} and id = ${siteId}
  `;
  const state = rows[0];
  if (!state) throw new Error("Operational Site state was not found.");
  return {
    ...state,
    draft_revision: Number(state.draft_revision),
    draft_base_head_revision: Number(state.draft_base_head_revision),
  };
}

function releaseCurrentness(state: SiteState) {
  return {
    expected_draft_revision: state.draft_revision,
    expected_base_version_id: state.draft_base_version_id,
    expected_head_revision: state.draft_base_head_revision,
  };
}

async function applyConfiguration(
  targetBusiness: Business,
  operations: ConfigurationOperations,
  title: string,
): Promise<void> {
  const configuration = new ConfigurationChangeService(owner.client, {
    businessId: targetBusiness.id,
    actorId: owner.user.id,
  });
  const proposal = await configuration.proposeChangeSet({
    ...(await configuration.getProposalCurrentness()),
    title,
    description: "Sites operational SQL integration fixture.",
    operations,
  });
  const validated = await configuration.validateChangeSet(proposal.id);
  expect(validated.status).toBe("validated");
  await configuration.applyChangeSet(proposal.id);
}

function appointmentOperations(): ConfigurationOperation[] {
  return configurationOperationsSchema.parse([
    {
      op: "set_object",
      key: "appointment",
      singular_label: "Appointment",
      plural_label: "Appointments",
      description: "Scheduled customer appointments.",
      icon: null,
      is_active: true,
    },
    {
      op: "set_field",
      object_key: "appointment",
      key: "title",
      label: "Title",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 0,
      is_active: true,
    },
    {
      op: "set_field",
      object_key: "appointment",
      key: "starts_at",
      label: "Starts at",
      field_type: "datetime",
      required: true,
      default_value: null,
      settings_json: {},
      position: 1,
      is_active: true,
    },
    {
      op: "set_field",
      object_key: "appointment",
      key: "status",
      label: "Status",
      field_type: "status",
      required: true,
      default_value: "Booked",
      settings_json: {
        options: ["Booked", "Confirmed", "Complete", "Cancelled"],
      },
      position: 2,
      is_active: true,
    },
    {
      op: "set_field",
      object_key: "appointment",
      key: "notes",
      label: "Notes",
      field_type: "long_text",
      required: false,
      default_value: null,
      settings_json: {},
      position: 3,
      is_active: true,
    },
    {
      op: "set_relationship",
      key: "customer_booking",
      source_object_key: "customer",
      target_object_key: "appointment",
      source_label: "Appointments",
      target_label: "Customer",
      cardinality: "one_to_many",
      is_required: false,
      is_active: true,
    },
    {
      op: "set_form",
      key: "appointment_create",
      name: "Add appointment",
      object_key: "appointment",
      mode: "create",
      config_json: {
        fields: [
          { field: "title", hidden: false },
          { field: "starts_at", hidden: false },
          { field: "status", hidden: false },
          { field: "notes", hidden: false },
        ],
        submit_label: "Add appointment",
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_form",
      key: "appointment_edit",
      name: "Edit appointment",
      object_key: "appointment",
      mode: "edit",
      config_json: {
        fields: [
          { field: "title", hidden: false },
          { field: "starts_at", hidden: false },
          { field: "status", hidden: false },
          { field: "notes", hidden: false },
        ],
        submit_label: "Save appointment",
      },
      audience: "internal",
      is_active: true,
    },
    {
      op: "set_view",
      key: "appointments",
      name: "Appointments",
      view_type: "table",
      object_key: "appointment",
      config_json: {
        fields: ["title", "starts_at", "status", "notes"],
        title_field: "title",
        include_archived: false,
      },
      audience: "internal",
      is_active: true,
    },
  ]);
}

function bookingConfig() {
  return bookingConfigSchema.parse({
    booking_object_key: "appointment",
    customer_object_key: "customer",
    subject_object_key: null,
    service_object_key: null,
    relationships: {
      customer_booking: "customer_booking",
      customer_subject: null,
      subject_booking: null,
      service_booking: null,
    },
    field_mappings: {
      customer: { name: "name", email: "email", phone: null },
      booking: {
        start_at: "starts_at",
        status: "status",
        default_status: "Booked",
        date: null,
        time: null,
      },
      subject: null,
      service: null,
    },
    public_fields: [
      {
        target: "customer",
        field: "name",
        label: "Name",
        required: true,
        autocomplete: "name",
      },
      {
        target: "customer",
        field: "email",
        label: "Email",
        required: true,
        autocomplete: "email",
      },
    ],
    schedule: {
      timezone_source: "business",
      location_id: null,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      first_time: "09:00",
      last_time: "17:00",
      slot_interval_minutes: 60,
      capacity_per_slot: 3,
      minimum_notice_minutes: 0,
      booking_horizon_days: 30,
    },
  });
}

function initialDraft(): SiteDraftV1 {
  return siteDraftV1Schema.parse({
    schema_version: 1,
    branding: { name: "Operational bookings", accent: "ocean" },
    pages: [
      {
        id: crypto.randomUUID(),
        title: "Order ahead",
        slug: "order",
        navigation_label: "Order ahead",
        is_home: true,
        is_in_navigation: true,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "heading",
              id: crypto.randomUUID(),
              text: "Order ahead",
              level: 1,
            },
            {
              type: "preorder",
              id: crypto.randomUUID(),
              preorder_key: "preorder",
            },
          ],
        },
      },
      {
        id: crypto.randomUUID(),
        title: "Book an appointment",
        slug: "book",
        navigation_label: "Book",
        is_home: false,
        is_in_navigation: true,
        is_included: true,
        layout: {
          blocks: [
            {
              type: "heading",
              id: crypto.randomUUID(),
              text: "Book an appointment",
              level: 1,
            },
            {
              type: "booking",
              id: crypto.randomUUID(),
              booking_key: "appointments",
              config: bookingConfig(),
            },
          ],
        },
      },
    ],
  });
}

function movedDraft(state: SiteState): SiteDraftV1 {
  const draft = structuredClone(state.draft_json) as {
    schema_version: number;
    branding: Record<string, unknown>;
    pages: Array<{
      id: string;
      title: string;
      slug: string;
      navigation_label: string;
      is_home: boolean;
      is_in_navigation: boolean;
      is_included: boolean;
      layout: { blocks: Array<Record<string, unknown>> };
    }>;
  };
  const preorderBlock = draft.pages
    .flatMap((page) => page.layout.blocks)
    .find((block) => block.type === "preorder");
  const bookingBlock = draft.pages
    .flatMap((page) => page.layout.blocks)
    .find((block) => block.type === "booking");
  if (!preorderBlock || !bookingBlock) {
    throw new Error(
      "Operational blocks were missing from the published draft.",
    );
  }
  for (const page of draft.pages) {
    page.is_home = false;
    page.layout.blocks = page.layout.blocks.filter(
      (block) => block !== preorderBlock && block !== bookingBlock,
    );
  }
  draft.pages.push(
    {
      id: crypto.randomUUID(),
      title: "Moved order",
      slug: "order-moved",
      navigation_label: "Order moved",
      is_home: true,
      is_in_navigation: true,
      is_included: true,
      layout: {
        blocks: [
          {
            type: "heading",
            id: crypto.randomUUID(),
            text: "Moved order",
            level: 1,
          },
          preorderBlock,
        ],
      },
    },
    {
      id: crypto.randomUUID(),
      title: "Moved booking",
      slug: "book-moved",
      navigation_label: "Book moved",
      is_home: false,
      is_in_navigation: true,
      is_included: true,
      layout: {
        blocks: [
          {
            type: "heading",
            id: crypto.randomUUID(),
            text: "Moved booking",
            level: 1,
          },
          bookingBlock,
        ],
      },
    },
  );
  return siteDraftV1Schema.parse(draft);
}

function draftWithBookingSource(
  state: SiteState,
  stableSourcePageId: string,
): SiteDraftV1 {
  const draft = siteDraftV1Schema.parse(structuredClone(state.draft_json));
  const bookingBlock = draft.pages
    .flatMap((page) => page.layout.blocks)
    .find((block) => block.type === "booking");
  if (!bookingBlock || bookingBlock.type !== "booking") {
    throw new Error("Operational Booking block was missing from the draft.");
  }
  bookingBlock.stable_source_page_id = stableSourcePageId;
  return draft;
}

function futureSlot(hour: number): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + 2);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

function preorderSubmission(
  token: string,
  collectionAt: string,
  name = "Shared Visitor",
) {
  return {
    idempotency_token: token,
    location_id: location.id,
    collection_at: collectionAt,
    items: [{ product_id: productId, quantity: 1 }],
    fields: {
      customer: { name, email: sharedEmail },
      order: {},
    },
    website: "",
  };
}

function bookingSubmission(
  token: string,
  startAt: string,
  name = "Shared Visitor",
) {
  return {
    idempotency_token: token,
    start_at: startAt,
    customer: { name, email: sharedEmail },
    subject: {},
    booking: {},
    service_record_id: null,
    website: "",
  };
}

async function readActions(releaseId: string): Promise<ActionRow[]> {
  return sql<ActionRow[]>`
    select release_id, action_key, release_token, action_kind,
      source_page_id, booking_key, preorder_experience_id,
      action_json, offer_json
    from public.site_release_actions_v4
    where business_id = ${business.id} and release_id = ${releaseId}
    order by action_kind
  `;
}

async function publishCurrentSite(state: SiteState): Promise<PreparedRelease> {
  const currentness = releaseCurrentness(state);
  const prepared = await callRpc<PreparedRelease>(
    owner.client,
    "prepare_site_release_v4",
    {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_site_id: siteId,
      ...currentness,
    },
  );
  expect(prepared).toMatchObject({
    status: "prepared",
    projection_schema_version: 4,
  });
  expect(prepared.projection_json).toMatchObject({ schema_version: 4 });
  return callRpc<PreparedRelease>(owner.client, "publish_site_release_v4", {
    expected_business_id: business.id,
    expected_actor_id: owner.user.id,
    requested_site_id: siteId,
    requested_candidate_id: prepared.id,
    ...currentness,
  });
}

async function submitPreorder(
  action: ActionRow,
  pageSlug: string,
  token: string,
  collectionAt: string,
  name = "Shared Visitor",
): Promise<SubmissionResult> {
  const submission = preorderSubmission(token, collectionAt, name);
  return callRpc<SubmissionResult>(admin, "submit_public_site_preorder_v4", {
    requested_business_slug: business.slug,
    requested_page_slug: pageSlug,
    requested_action_key: action.action_key,
    requested_release_token: action.release_token,
    requested_idempotency_token: token,
    submission,
    requested_request_hash: "a".repeat(64),
  });
}

async function submitBooking(
  action: ActionRow,
  pageSlug: string,
  token: string,
  startAt: string,
  name = "Shared Visitor",
): Promise<SubmissionResult> {
  const submission = bookingSubmission(token, startAt, name);
  return callRpc<SubmissionResult>(admin, "submit_public_site_booking_v4", {
    requested_business_slug: business.slug,
    requested_page_slug: pageSlug,
    requested_action_key: action.action_key,
    requested_release_token: action.release_token,
    requested_idempotency_token: token,
    requested_submission: submission,
    requested_request_hash: "b".repeat(64),
  });
}

async function submissionCounts(): Promise<{
  records: number;
  preorderReceipts: number;
  bookingReceipts: number;
}> {
  const rows = await sql<
    { records: number; preorder_receipts: number; booking_receipts: number }[]
  >`
    select
      (select count(*)::int from public.records where business_id = ${business.id}) as records,
      (select count(*)::int from public.preorder_submissions where business_id = ${business.id}) as preorder_receipts,
      (select count(*)::int from public.booking_submissions where business_id = ${business.id}) as booking_receipts
  `;
  const row = rows[0];
  if (!row) throw new Error("Could not read operational receipt counts.");
  return {
    records: Number(row.records),
    preorderReceipts: Number(row.preorder_receipts),
    bookingReceipts: Number(row.booking_receipts),
  };
}

async function publicationCounts(): Promise<{
  releases: number;
  actions: number;
}> {
  const rows = await sql<{ releases: number; actions: number }[]>`
    select
      (select count(*)::int from public.site_releases
        where business_id = ${business.id}) as releases,
      (select count(*)::int from public.site_release_actions_v4
        where business_id = ${business.id}) as actions
  `;
  const row = rows[0];
  if (!row) throw new Error("Could not read operational publication counts.");
  return { releases: Number(row.releases), actions: Number(row.actions) };
}

async function assertBookingSourceRejections(): Promise<void> {
  const baseline = await readSiteState();
  const baselineSubmissions = await submissionCounts();
  const baselinePublication = await publicationCounts();
  const saveDraft = (state: SiteState, draft: SiteDraftV1) =>
    callRpc<SiteState>(owner.client, "save_site_draft_v2", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_site_id: siteId,
      expected_draft_revision: state.draft_revision,
      requested_draft: draft,
    });
  const expectSourceRejection = async (state: SiteState) => {
    await expect(
      callRpc<PreparedRelease>(owner.client, "prepare_site_release_v4", {
        expected_business_id: business.id,
        expected_actor_id: owner.user.id,
        requested_site_id: siteId,
        ...releaseCurrentness(state),
      }),
    ).rejects.toThrow("site_operational_source_unavailable");
    expect(await submissionCounts()).toEqual(baselineSubmissions);
    expect(await publicationCounts()).toEqual(baselinePublication);
  };

  // The foreign Business UUID is intentionally not a Page UUID in this Site.
  const foreignSourceState = await saveDraft(
    baseline,
    draftWithBookingSource(baseline, foreignBusiness.id),
  );
  await expectSourceRejection(foreignSourceState);

  const baselineDraft = siteDraftV1Schema.parse(
    structuredClone(baseline.draft_json),
  );
  const bookingPage = baselineDraft.pages.find((page) =>
    page.layout.blocks.some((block) => block.type === "booking"),
  );
  const unrelatedPage = baselineDraft.pages.find(
    (page) =>
      page.id !== bookingPage?.id &&
      !page.layout.blocks.some((block) => block.type === "booking"),
  );
  if (!unrelatedPage) {
    throw new Error("Operational fixture lacks an unrelated canonical Page.");
  }
  const canonicalPageRows = await sql<{ canonical_page_id: string | null }[]>`
    select canonical_page_id
    from public.site_page_bindings
    where business_id = ${business.id}
      and site_id = ${siteId}
      and draft_page_id = ${unrelatedPage.id}
  `;
  const canonicalPageId = canonicalPageRows[0]?.canonical_page_id;
  if (!canonicalPageId) {
    throw new Error("Operational fixture lacks the unrelated canonical Page.");
  }
  const mismatchedSourceState = await saveDraft(
    foreignSourceState,
    draftWithBookingSource(foreignSourceState, canonicalPageId),
  );
  await expectSourceRejection(mismatchedSourceState);

  const restored = await saveDraft(mismatchedSourceState, baselineDraft);
  expect(restored.draft_json).toEqual(baseline.draft_json);
}

beforeAll(async () => {
  settings = getC1LocalSupabaseSettings();
  admin = createClient<Database>(settings.apiUrl, settings.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  anonymous = createClient<Database>(settings.apiUrl, settings.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  sql = postgres(settings.databaseUrl, { max: 4 });
  owner = await createIdentity("owner");
  staff = await createIdentity("staff");
  business = await createFixtureBusiness("Sites operational");
  foreignBusiness = await createFixtureBusiness("Sites foreign");

  const memberships = await admin.from("business_memberships").insert({
    business_id: business.id,
    user_id: staff.user.id,
    role: "staff",
  });
  if (memberships.error) throw memberships.error;

  location = await createFixtureLocation();
  const configuration = new ConfigurationChangeService(owner.client, {
    businessId: business.id,
    actorId: owner.user.id,
  });
  const currentness = await configuration.getProposalCurrentness();
  await applyConfiguration(
    business,
    composeInitialPreorderOperations({
      ...currentness,
      locationIds: [location.id],
      schedule: {
        days_of_week: [1, 2, 3, 4, 5, 6, 7],
        start_time: "09:00",
        end_time: "17:00",
        slot_interval_minutes: 60,
        slot_capacity: 2,
        cutoff_hours: 0,
        booking_horizon_days: 30,
      },
    }),
    "Set up operational preorder",
  );
  await applyConfiguration(
    business,
    appointmentOperations(),
    "Set up operational booking",
  );

  const objectRows = await sql<{ id: string; key: string }[]>`
    select id, key
    from public.object_definitions
    where business_id = ${business.id}
      and key in ('product', 'customer', 'appointment')
  `;
  const objectByKey = new Map(objectRows.map((row) => [row.key, row.id]));
  productId = objectByKey.get("product") ?? "";
  customerObjectId = objectByKey.get("customer") ?? "";
  appointmentObjectId = objectByKey.get("appointment") ?? "";
  if (!productId || !customerObjectId || !appointmentObjectId) {
    throw new Error("Operational fixture Objects were not created.");
  }
  const relationshipRows = await sql<{ id: string }[]>`
    select id
    from public.relationship_definitions
    where business_id = ${business.id} and key = 'customer_booking'
  `;
  relationshipId = relationshipRows[0]?.id ?? "";
  if (!relationshipId)
    throw new Error("Operational booking Relationship is missing.");

  const product = await callRpc<{ id: string }>(
    owner.client,
    "create_graph_record",
    {
      expected_business_id: business.id,
      target_object_definition_id: productId,
      requested_data: {
        name: "Operational lunch box",
        description: "Frozen operational offer.",
        price: 12,
        status: "Active",
      },
    },
  );
  productId = product.id;
  await callRpc(owner.client, "create_record_location_link", {
    expected_business_id: business.id,
    target_record_id: product.id,
    target_location_id: location.id,
  });

  const createdState = await callRpc<SiteState>(
    owner.client,
    "create_site_draft_v2",
    {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_draft: initialDraft(),
    },
  );
  siteId = createdState.id;
});

afterAll(async () => {
  let retainProtectedFixture = false;
  try {
    if (sql && createdBusinessIds.length > 0) {
      const protectedRows = await sql<{ protected_fixture: boolean }[]>`
        select exists (
          select 1
          from public.site_release_actions_v4
          where business_id = any(${sql.array(createdBusinessIds, 2950)})
        ) as protected_fixture
      `;
      retainProtectedFixture = Boolean(protectedRows[0]?.protected_fixture);
      if (!retainProtectedFixture) {
        await sql`
          delete from public.site_states
          where business_id = any(${sql.array(createdBusinessIds, 2950)})
        `;
        const deleted = await admin
          .from("businesses")
          .delete()
          .in("id", createdBusinessIds);
        if (deleted.error) {
          if (isExpectedFixtureRetentionError(deleted.error)) {
            retainProtectedFixture = true;
          } else {
            throw deleted.error;
          }
        }
      }
    }
    if (!retainProtectedFixture) {
      for (const userId of createdUserIds) {
        const deleted = await admin.auth.admin.deleteUser(userId);
        if (deleted.error) throw deleted.error;
      }
    }
  } finally {
    if (sql) await sql.end();
  }
});

describe("Sites remaining operational SQL boundaries", () => {
  it("publishes and exercises adopted preorder and Booking actions", async () => {
    const initialState = await readSiteState();
    const firstRelease = await publishCurrentSite(initialState);
    const firstActions = await readActions(firstRelease.id);
    firstPreorderAction = firstActions.find(
      (action) => action.action_kind === "preorder",
    ) as ActionRow;
    firstBookingAction = firstActions.find(
      (action) => action.action_kind === "booking",
    ) as ActionRow;
    expect(firstPreorderAction).toBeDefined();
    expect(firstBookingAction).toBeDefined();
    const bookingSourcePageId = firstBookingAction.source_page_id;
    expect(bookingSourcePageId).toBeTruthy();
    const bookingSourcePages = await sql<{ status: string }[]>`
      select status
      from public.pages
      where business_id = ${business.id}
        and id = ${bookingSourcePageId}
    `;
    expect(bookingSourcePages[0]?.status).toBe("draft");
    expect(firstPreorderAction.offer_json).toMatchObject({
      products: [expect.objectContaining({ price: 12 })],
    });
    await assertBookingSourceRejections();

    const preorderResolved = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_site_operational_action_v4",
      {
        requested_business_slug: business.slug,
        requested_page_slug: "order",
        requested_action_key: firstPreorderAction.action_key,
        requested_release_token: firstPreorderAction.release_token,
      },
    );
    expect(preorderResolved).toMatchObject({
      kind: "preorder",
      action_key: firstPreorderAction.action_key,
      release_token: firstPreorderAction.release_token,
    });
    const bookingResolved = await callRpc<Record<string, unknown>>(
      anonymous,
      "resolve_public_site_operational_action_v4",
      {
        requested_business_slug: business.slug,
        requested_page_slug: "book",
        requested_action_key: firstBookingAction.action_key,
        requested_release_token: firstBookingAction.release_token,
      },
    );
    expect(bookingResolved).toMatchObject({
      kind: "booking",
      action_key: firstBookingAction.action_key,
      release_token: firstBookingAction.release_token,
    });

    const preorderSlot = futureSlot(11);
    const bookingSlot = futureSlot(10);

    const productUpdate = await callRpc<{ data_json: Record<string, unknown> }>(
      owner.client,
      "update_graph_record",
      {
        expected_business_id: business.id,
        target_record_id: productId,
        data_patch: { price: 99 },
      },
    );
    expect(productUpdate.data_json).toMatchObject({ price: 99 });

    const preorderToken = crypto.randomUUID();
    const firstPreorder = await submitPreorder(
      firstPreorderAction,
      "order",
      preorderToken,
      preorderSlot,
    );
    expect(firstPreorder).toMatchObject({
      ok: true,
      idempotent: false,
      confirmation: { total: 12 },
    });
    const firstBookingToken = crypto.randomUUID();
    const firstBooking = await submitBooking(
      firstBookingAction,
      "book",
      firstBookingToken,
      bookingSlot,
    );
    expect(firstBooking).toMatchObject({ ok: true, idempotent: false });

    const customerRows = await sql<{ id: string }[]>`
      select id
      from public.records
      where business_id = ${business.id}
        and object_definition_id = ${customerObjectId}
        and lower(btrim(data_json ->> 'email')) = ${sharedEmail}
    `;
    expect(customerRows).toHaveLength(1);

    const sharedCustomerId = customerRows[0]?.id;
    if (!sharedCustomerId) throw new Error("Shared Customer was not created.");

    const staffWrite = staff.client.rpc("create_contextual_graph_record", {
      expected_business_id: business.id,
      initiating_relationship_key: "customer_booking",
      initiating_direction: "source",
      parent_record_id: sharedCustomerId,
      requested_data: {
        title: "Staff contextual booking",
        starts_at: bookingSlot,
        status: "Booked",
        notes: "Created while the adopted Booking writer is active.",
      },
      requested_connections: [],
    });
    const adoptedWrite = submitBooking(
      firstBookingAction,
      "book",
      crypto.randomUUID(),
      bookingSlot,
      "Shared Visitor",
    );
    const [staffResult, adoptedResult] = await Promise.all([
      staffWrite,
      adoptedWrite,
    ]);
    expect(staffResult.error).toBeNull();
    expect(staffResult.data).toMatchObject({
      business_id: business.id,
      object_definition_id: appointmentObjectId,
    });
    expect(adoptedResult).toMatchObject({ ok: true, idempotent: false });
    if (!staffResult.data) throw new Error("Staff contextual Record missing.");
    const staffEdges = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.record_relationships
      where business_id = ${business.id}
        and relationship_definition_id = ${relationshipId}
        and source_record_id = ${sharedCustomerId}
        and target_record_id = ${staffResult.data.id}
    `;
    expect(staffEdges[0]?.count).toBe(1);

    const movedStateBeforePublish = await readSiteState();
    const moved = await callRpc<SiteState>(owner.client, "save_site_draft_v2", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      requested_site_id: siteId,
      expected_draft_revision: movedStateBeforePublish.draft_revision,
      requested_draft: movedDraft(movedStateBeforePublish),
    });
    expect(moved.draft_revision).toBe(
      movedStateBeforePublish.draft_revision + 1,
    );
    const movedRelease = await publishCurrentSite(await readSiteState());
    const movedActions = await readActions(movedRelease.id);
    const movedPreorderAction = movedActions.find(
      (action) => action.action_kind === "preorder",
    ) as ActionRow;
    const movedBookingAction = movedActions.find(
      (action) => action.action_kind === "booking",
    ) as ActionRow;
    expect(movedPreorderAction.action_key).toBe(firstPreorderAction.action_key);
    expect(movedBookingAction.action_key).toBe(firstBookingAction.action_key);
    expect(movedBookingAction.source_page_id).toBe(
      firstBookingAction.source_page_id,
    );

    const movedRetry = await submitPreorder(
      movedPreorderAction,
      "order-moved",
      preorderToken,
      preorderSlot,
    );
    expect(movedRetry).toMatchObject({
      ok: true,
      idempotent: true,
      confirmation: {
        public_reference: firstPreorder.confirmation?.public_reference,
        total: 12,
      },
    });

    const oldReleaseRetry = await submitPreorder(
      firstPreorderAction,
      "order",
      preorderToken,
      preorderSlot,
    );
    expect(oldReleaseRetry).toMatchObject({
      ok: true,
      idempotent: true,
      confirmation: {
        public_reference: firstPreorder.confirmation?.public_reference,
        total: 12,
      },
    });

    const countsBeforeOldAttempt = await submissionCounts();
    const oldFreshAttempt = await submitPreorder(
      firstPreorderAction,
      "order",
      crypto.randomUUID(),
      preorderSlot,
    );
    expect(oldFreshAttempt).toEqual({
      ok: false,
      code: "action_unavailable",
    });
    expect(await submissionCounts()).toEqual(countsBeforeOldAttempt);

    const changedPayload = await submitPreorder(
      movedPreorderAction,
      "order-moved",
      preorderToken,
      preorderSlot,
      "Changed after the receipt",
    );
    expect(changedPayload).toEqual({
      ok: false,
      code: "idempotency_conflict",
    });
    expect(await submissionCounts()).toEqual(countsBeforeOldAttempt);

    const secondPreorder = await submitPreorder(
      movedPreorderAction,
      "order-moved",
      crypto.randomUUID(),
      preorderSlot,
      "Second shared visitor",
    );
    expect(secondPreorder).toMatchObject({ ok: true, idempotent: false });
    const soldOut = await submitPreorder(
      movedPreorderAction,
      "order-moved",
      crypto.randomUUID(),
      preorderSlot,
      "Third shared visitor",
    );
    expect(soldOut).toEqual({ ok: false, code: "sold_out" });

    const concurrentBooking = await Promise.all([
      submitBooking(
        movedBookingAction,
        "book-moved",
        crypto.randomUUID(),
        bookingSlot,
      ),
      submitBooking(
        movedBookingAction,
        "book-moved",
        crypto.randomUUID(),
        bookingSlot,
      ),
    ]);
    expect(concurrentBooking.filter((result) => result.ok)).toHaveLength(1);
    expect(
      concurrentBooking.filter(
        (result) => result.code === "capacity_unavailable",
      ),
    ).toHaveLength(1);

    const allCustomers = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.records
      where business_id = ${business.id}
        and object_definition_id = ${customerObjectId}
        and lower(btrim(data_json ->> 'email')) = ${sharedEmail}
    `;
    expect(allCustomers[0]?.count).toBe(1);
    const bookingReceipts = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.booking_submissions
      where business_id = ${business.id}
        and booking_key = 'appointments'
    `;
    expect(bookingReceipts[0]?.count).toBe(3);

    const foreignBefore = await sql<{ records: number; receipts: number }[]>`
      select
        (select count(*)::int from public.records
          where business_id = ${foreignBusiness.id}) as records,
        (select count(*)::int from public.booking_submissions
          where business_id = ${foreignBusiness.id}) as receipts
    `;
    const tenantToken = crypto.randomUUID();
    const tenantSubmission = bookingSubmission(tenantToken, bookingSlot);
    const tenantDenied = await callRpc<SubmissionResult>(
      admin,
      "submit_public_site_booking_v4",
      {
        requested_business_slug: foreignBusiness.slug,
        requested_page_slug: "book-moved",
        requested_action_key: movedBookingAction.action_key,
        requested_release_token: movedBookingAction.release_token,
        requested_idempotency_token: tenantToken,
        requested_submission: tenantSubmission,
        requested_request_hash: "c".repeat(64),
      },
    );
    expect(tenantDenied).toEqual({
      ok: false,
      code: "action_unavailable",
    });
    const foreignAfter = await sql<{ records: number; receipts: number }[]>`
      select
        (select count(*)::int from public.records
          where business_id = ${foreignBusiness.id}) as records,
        (select count(*)::int from public.booking_submissions
          where business_id = ${foreignBusiness.id}) as receipts
    `;
    expect(foreignAfter).toEqual(foreignBefore);

    const disabled = await sql`
      update public.preorder_experiences
      set is_active = false
      where business_id = ${business.id}
        and id = ${firstPreorderAction.preorder_experience_id}
    `;
    expect(disabled.count).toBe(1);
    const withdrawn = await rpc(anonymous).rpc<unknown>(
      "resolve_public_site_operational_action_v4",
      {
        requested_business_slug: business.slug,
        requested_page_slug: "order-moved",
        requested_action_key: movedPreorderAction.action_key,
        requested_release_token: movedPreorderAction.release_token,
      },
    );
    expect(withdrawn.error).toBeNull();
    expect(withdrawn.data).toBeNull();
    const withdrawnAttempt = await submitPreorder(
      movedPreorderAction,
      "order-moved",
      crypto.randomUUID(),
      preorderSlot,
    );
    expect(withdrawnAttempt).toEqual({
      ok: false,
      code: "action_unavailable",
    });
  });

  it("keeps v4 service-only submission and member lock boundaries", async () => {
    const [privileges] = await sql<
      {
        booking_anon_execute: boolean;
        booking_authenticated_execute: boolean;
        booking_service_execute: boolean;
        preorder_anon_execute: boolean;
        preorder_authenticated_execute: boolean;
        preorder_service_execute: boolean;
        member_lock_authenticated_execute: boolean;
      }[]
    >`
      select
        has_function_privilege(
          'anon',
          'public.submit_public_site_booking_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as booking_anon_execute,
        has_function_privilege(
          'authenticated',
          'public.submit_public_site_booking_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as booking_authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.submit_public_site_booking_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as booking_service_execute,
        has_function_privilege(
          'anon',
          'public.submit_public_site_preorder_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as preorder_anon_execute,
        has_function_privilege(
          'authenticated',
          'public.submit_public_site_preorder_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as preorder_authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.submit_public_site_preorder_v4(text,text,text,text,uuid,jsonb,text)',
          'execute'
        ) as preorder_service_execute,
        has_function_privilege(
          'authenticated',
          'private.lock_relationship_definitions_for_member_v1(uuid,uuid[])',
          'execute'
        ) as member_lock_authenticated_execute
    `;
    expect(privileges).toEqual({
      booking_anon_execute: false,
      booking_authenticated_execute: false,
      booking_service_execute: true,
      preorder_anon_execute: false,
      preorder_authenticated_execute: false,
      preorder_service_execute: true,
      member_lock_authenticated_execute: true,
    });
  });
});
