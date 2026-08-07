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
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("../../src/db/supabase/server", () => ({
  createServerClient: async () => {
    const client = actionHarness.clients.shift();
    if (!client) {
      throw new Error("No authenticated Phase 13A client was queued.");
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

import { prepareInitialPreorderProposalAction } from "../../src/app/app/[businessSlug]/setup/actions";
import {
  composePreorderAmendmentBatch,
  composePreorderScheduleAmendment,
} from "../../src/core/configuration/manual-amendments/service";
import { ConfigurationChangeService } from "../../src/core/configuration/service";
import { configurationSnapshotV1Schema } from "../../src/core/configuration/definition-source";
import { createExperienceService } from "../../src/core/experience/service";
import { loadRenderedConfigurationPreview } from "../../src/core/configuration/rendered-preview";
import { resolvePublicPage } from "../../src/core/experience/service";
import { resolvePublicPreorder } from "../../src/core/preorder/service";
import { saveExperienceForm } from "../../src/runtime/forms/actions";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };
type Business = Tables<"businesses">;
type Location = Tables<"locations">;

const password = "Milestone-13A-initial-preorder!";

let settings: LocalSupabaseSettings;
let sql: Sql;
let serviceRole: Client;
let anonymous: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let business: Business;
let location: Location;
let configuration: ConfigurationChangeService;
const createdUserIds: string[] = [];

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
  const email = `phase13a-${label}-${crypto.randomUUID()}@example.test`;
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

async function createLocation(name: string): Promise<Location> {
  const state = requireData(
    await owner.client.rpc("get_location_creation_state", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
    }),
    "Could not load Location creation state.",
  )[0];
  if (!state) {
    throw new Error("Location creation state was empty.");
  }
  return requireData(
    await owner.client.rpc("create_location", {
      expected_business_id: business.id,
      expected_actor_id: owner.user.id,
      expected_business_timezone: state.business_timezone,
      expected_location_state_digest: state.location_state_digest,
      location_name: name,
      requested_timezone: "Europe/London",
    }),
    `Could not create ${name}.`,
  );
}

async function liveSnapshot(): Promise<Json> {
  const rows = await sql<{ snapshot: Json }[]>`
    select private.configuration_snapshot_v1(${business.id}::uuid) as snapshot
  `;
  if (!rows[0]) {
    throw new Error("Could not read the live configuration snapshot.");
  }
  return rows[0].snapshot;
}

async function rowCount(table: "records" | "configuration_change_sets") {
  const rows = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from public.${sql(table)}
    where business_id = ${business.id}::uuid
  `;
  return rows[0]?.count ?? -1;
}

function starterForm(
  baseVersionId: string,
  headRevision: number,
  locationId: string,
): FormData {
  const form = new FormData();
  form.set("expectedBaseVersionId", baseVersionId);
  form.set("expectedHeadRevision", String(headRevision));
  form.append("locationIds", locationId);
  form.append("daysOfWeek", "2");
  form.append("daysOfWeek", "5");
  form.set("startTime", "09:00");
  form.set("endTime", "15:00");
  form.set("slotIntervalMinutes", "45");
  form.set("slotCapacity", "12");
  form.set("cutoffHours", "36");
  form.set("bookingHorizonDays", "60");
  return form;
}

async function actionRedirect(client: Client, form: FormData): Promise<string> {
  actionHarness.clients.push(client);
  try {
    await prepareInitialPreorderProposalAction(business.slug, form);
  } catch (error) {
    if (error instanceof Error && error.name === "ActionRedirect") {
      return error.message;
    }
    throw error;
  }
  throw new Error("Expected the initial preorder action to redirect.");
}

async function productCreateActionRedirect(
  formData: FormData,
): Promise<string> {
  actionHarness.clients.push(owner.client);
  try {
    await saveExperienceForm(
      business.slug,
      "product_create",
      null,
      `/app/${business.slug}/workspace/products`,
      `/app/${business.slug}/workspace/products/new`,
      formData,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ActionRedirect") {
      return error.message;
    }
    throw error;
  }
  throw new Error("Expected the Product create action to redirect.");
}

describe("Milestone 13 Phase 13A owner-triggered initial preorder", () => {
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
    business = requireData(
      await owner.client.rpc("create_business", {
        business_name: `Phase 13A ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create the Phase 13A Business.",
    );
    const memberships = await serviceRole.from("business_memberships").insert([
      {
        business_id: business.id,
        user_id: administrator.user.id,
        role: "admin",
      },
      { business_id: business.id, user_id: staff.user.id, role: "staff" },
    ]);
    if (memberships.error) {
      throw memberships.error;
    }
    location = await createLocation("Collection location");
    configuration = new ConfigurationChangeService(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
    });
  }, 120_000);

  afterAll(async () => {
    if (business && serviceRole) {
      await serviceRole.from("businesses").delete().eq("id", business.id);
    }
    if (serviceRole) {
      await Promise.all(
        createdUserIds.map((userId) =>
          serviceRole.auth.admin.deleteUser(userId),
        ),
      );
    }
    await sql?.end();
  });

  it("runs the starter lifecycle, preserves the draft page, and lets the owner add a Product", async () => {
    const currentness = await configuration.getProposalCurrentness();
    const beforeProposal = await liveSnapshot();
    expect(
      configurationSnapshotV1Schema.parse(beforeProposal).object_definitions,
    ).toHaveLength(0);
    expect(await rowCount("records")).toBe(0);

    const redirectPath = await actionRedirect(
      owner.client,
      starterForm(
        currentness.expectedBaseVersionId,
        currentness.expectedHeadRevision,
        location.id,
      ),
    );
    const changeSetId = redirectPath.split("/").at(-1);
    expect(changeSetId).toMatch(/^[0-9a-f-]{36}$/);
    const proposal = await configuration.getChangeSet(changeSetId!);
    expect(proposal).toMatchObject({
      kind: "change",
      status: "proposed",
      title: "Set up preorders",
      base_version_id: currentness.expectedBaseVersionId,
      base_head_revision: currentness.expectedHeadRevision,
    });
    const semanticDiff = proposal.semantic_diff_json as {
      counts?: { created?: number };
    } | null;
    expect(semanticDiff?.counts?.created ?? 0).toBeGreaterThan(0);
    expect(await liveSnapshot()).toEqual(beforeProposal);
    expect(await rowCount("records")).toBe(0);

    const preview = await configuration.loadPreview(proposal.id);
    expect(preview.pages.map((page) => [page.key, page.status])).toContainEqual(
      ["public_preorder", "draft"],
    );
    const rendered = await loadRenderedConfigurationPreview(owner.client, {
      businessId: business.id,
      actorId: owner.user.id,
      changeSetId: proposal.id,
      pageKey: "public_preorder",
    });
    expect(rendered.page.definition.status).toBe("draft");
    expect(
      rendered.preorders.preorder?.catalogue.preorder.schedule,
    ).toMatchObject({
      days_of_week: [2, 5],
      start_time: "09:00",
      end_time: "15:00",
      slot_interval_minutes: 45,
      slot_capacity: 12,
      cutoff_hours: 36,
      booking_horizon_days: 60,
    });

    const validated = await configuration.validateChangeSet(proposal.id);
    expect(validated.status).toBe("validated");
    expect(await liveSnapshot()).toEqual(beforeProposal);
    expect(await rowCount("records")).toBe(0);

    const applied = await configuration.applyChangeSet(proposal.id);
    expect(applied.status).toBe("applied");
    const versions = await configuration.listVersions();
    expect(versions).toHaveLength(2);
    const appliedVersion = versions.find(
      (version) => version.version_number === 2,
    );
    expect(appliedVersion?.source_change_set_id).toBe(proposal.id);
    expect((await configuration.getActiveHead()).head_revision).toBe(2);
    expect(await rowCount("records")).toBe(0);

    const installed = configurationSnapshotV1Schema.parse(await liveSnapshot());
    expect(
      installed.object_definitions.map((object) => object.key).sort(),
    ).toEqual(["customer", "order", "order_item", "product"]);
    expect(
      installed.preorder_experiences.map((preorder) => preorder.key),
    ).toEqual(["preorder"]);
    expect(
      installed.pages.find((page) => page.key === "public_preorder")?.status,
    ).toBe("draft");
    expect(
      installed.preorder_experience_locations.map((item) => item.location_id),
    ).toEqual([location.id]);

    const staleAttempt = await actionRedirect(
      owner.client,
      starterForm(
        currentness.expectedBaseVersionId,
        currentness.expectedHeadRevision,
        location.id,
      ),
    );
    expect(staleAttempt).toBe(`/app/${business.slug}/setup?notice=stale`);

    const experience = createExperienceService(owner.client, {
      businessId: business.id,
    });
    const products = await experience.loadView("products");
    const orders = await experience.loadView("orders");
    const productCreate = await experience.loadForm("product_create");
    expect(products.object.key).toBe("product");
    expect(productCreate.definition.mode).toBe("create");
    expect(orders.object.key).toBe("order");
    expect(
      (await experience.listNavigation()).views.map((view) => view.key),
    ).toEqual(expect.arrayContaining(["products", "orders"]));

    expect(
      await resolvePublicPage(anonymous, business.slug, "preorder"),
    ).toBeNull();
    expect(
      await resolvePublicPreorder(
        anonymous,
        business.slug,
        "preorder",
        "preorder",
      ),
    ).toBeNull();

    const amendment = composePreorderScheduleAmendment(installed, {
      intent: "update_preorder_schedule",
      preorderKey: "preorder",
      schedule: {
        ...installed.preorder_experiences[0]!.config_json.schedule,
        slot_capacity: 14,
      },
    });
    expect(amendment.operation.op).toBe("set_preorder_experience");
    const builderAmendment = composePreorderAmendmentBatch(installed, {
      preorderKey: "preorder",
      amendments: [{ intent: "set_slot_capacity", slotCapacity: 15 }],
    });
    expect(builderAmendment.operations).toHaveLength(1);

    const productObject = installed.object_definitions.find(
      (object) => object.key === "product",
    );
    if (!productObject) {
      throw new Error("Installed Product Object was missing.");
    }
    const productFormData = new FormData();
    productFormData.set("name", "Test product");
    productFormData.set(
      "description",
      "Created after applying the generic Product setup.",
    );
    productFormData.set("price", "12");
    productFormData.set("status", "Active");
    const productRedirect = await productCreateActionRedirect(productFormData);
    expect(productRedirect).toBe(
      `/app/${business.slug}/workspace/products?message=Added+successfully.`,
    );
    const createdProducts = await owner.client
      .from("records")
      .select("*")
      .eq("business_id", business.id)
      .eq("object_definition_id", productObject.id);
    expect(createdProducts.error).toBeNull();
    expect(createdProducts.data).toHaveLength(1);
    expect(createdProducts.data?.[0]?.data_json).toMatchObject({
      name: "Test product",
      price: 12,
      status: "Active",
    });
    expect(await rowCount("records")).toBe(1);
  });

  it("keeps Staff and anonymous preparation outside the configuration boundary and rejects a second starter", async () => {
    const currentness = await configuration.getProposalCurrentness();
    const form = starterForm(
      currentness.expectedBaseVersionId,
      currentness.expectedHeadRevision,
      location.id,
    );

    const invalidForm = starterForm(
      currentness.expectedBaseVersionId,
      currentness.expectedHeadRevision,
      location.id,
    );
    invalidForm.delete("locationIds");
    expect(await actionRedirect(owner.client, invalidForm)).toBe(
      `/app/${business.slug}/setup?notice=input_invalid`,
    );

    actionHarness.clients.push(staff.client);
    await expect(
      prepareInitialPreorderProposalAction(business.slug, form),
    ).rejects.toMatchObject({ name: "ActionNotFound" });

    actionHarness.clients.push(anonymous);
    await expect(
      prepareInitialPreorderProposalAction(business.slug, form),
    ).rejects.toMatchObject({ name: "ActionRedirect" });

    const secondAttempt = await actionRedirect(owner.client, form);
    expect(secondAttempt).toBe(
      `/app/${business.slug}/setup?notice=already_installed`,
    );
    expect(await rowCount("configuration_change_sets")).toBe(1);
  });
});
