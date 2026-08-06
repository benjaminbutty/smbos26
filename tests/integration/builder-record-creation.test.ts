import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
      throw new Error("No authenticated action client was queued.");
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

import {
  createBuilderAction,
  initialBuilderUiState,
} from "../../src/app/app/[businessSlug]/builder/action-service";
import { BUILDER_RECORD_UPDATE_MESSAGES } from "../../src/ai/builder/contracts";
import { createRecordUpdateConfirmationTokenService } from "../../src/ai/builder/record-update-confirmation-token";
import { RecordUpdateServiceError } from "../../src/core/graph/record-update/service";
import {
  recordUpdateTargetStateSchema,
  type RecordUpdateReadyState,
} from "../../src/core/graph/record-update/schemas";
import { BuilderResultPanel } from "../../src/components/builder-ui";
import { createExperienceService } from "../../src/core/experience/service";
import { createConfigurationFixtures } from "./support/configuration-fixtures";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Business = Tables<"businesses">;

const password = "M12-builder-record-e2e-password!";
const confirmationSecret =
  "m12-builder-record-confirmation-secret-for-tests-0123456789";

let settings: LocalSupabaseSettings;
let database: Sql;
let serviceRole: Client;
let owner: Client;
let ownerUser: User;
let business: Business;
let product: Tables<"object_definitions">;
let fixtures: ReturnType<typeof createConfigurationFixtures>;
let originalConfirmationSecret: string | undefined;

function requireData<T>(
  result: { data: T; error: { message: string } | null },
  message: string,
): NonNullable<T> {
  if (result.error || result.data === null) {
    throw new Error(`${message}: ${result.error?.message ?? "No data"}`);
  }
  return result.data as NonNullable<T>;
}

function queueActionClient(client: Client): void {
  actionHarness.clients = [client];
}

function requestForm(request: string): FormData {
  const form = new FormData();
  form.set("ownerRequest", request);
  return form;
}

function confirmationForm(token: string): FormData {
  const form = new FormData();
  form.set("confirmationKind", "create_record");
  form.set("confirmationToken", token);
  return form;
}

async function recordRows(): Promise<Tables<"records">[]> {
  return requireData(
    await owner
      .from("records")
      .select("*")
      .eq("business_id", business.id)
      .eq("object_definition_id", product.id)
      .order("created_at", { ascending: true }),
    "Could not read Product Records.",
  );
}

async function currentState() {
  const { data, error } = await owner.rpc(
    "get_confirmed_graph_record_creation_state",
    {
      expected_business_id: business.id,
      expected_actor_id: ownerUser.id,
      target_object_key: "product",
    },
  );
  if (error || !data?.[0]) {
    throw error ?? new Error("Could not read the Product creation state.");
  }
  return data[0];
}

async function currentUpdateState(
  selectorValue: string,
): Promise<RecordUpdateReadyState> {
  const result = await owner.rpc("get_confirmed_graph_record_update_state", {
    expected_business_id: business.id,
    expected_actor_id: ownerUser.id,
    target_object_key: "product",
    requested_selector: {
      field_key: "name",
      field_type: "short_text",
      string_value: selectorValue,
    },
    requested_update_field_keys: ["price"],
  });
  if (result.error || result.data === null) {
    throw result.error ?? new Error("Could not read the Product update state.");
  }
  const state = recordUpdateTargetStateSchema.parse(result.data);
  if (state.state !== "ready") {
    throw new Error(`Expected ready update state, received ${state.state}.`);
  }
  return state;
}

async function createProductRecord(
  name: string,
  price: number,
): Promise<Tables<"records">> {
  return requireData(
    await owner.rpc("create_graph_record", {
      expected_business_id: business.id,
      target_object_definition_id: product.id,
      requested_data: { name, price, status: "Active" },
      requested_record_status: "active",
    }),
    "Could not create the Product update fixture.",
  );
}

function recordUpdateConfirmationResult(state: RecordUpdateReadyState) {
  return {
    schema_version: 1 as const,
    state: "record_update_confirmation" as const,
    object_label: state.singular_label,
    selector_presentation: {
      field_key: state.selector.field_key,
      label: state.selector.label,
      formatted_value: String(state.selector.value),
    },
    change_rows: [
      {
        field_key: "price",
        label: "Price",
        field_type: "currency" as const,
        formatted_before: "£30.00",
        formatted_after: "£35.00",
        new_value: 35 as Json,
      },
    ],
    base_version_id: state.base_version_id,
    head_revision: state.head_revision,
    object_definition_id: state.object_definition_id,
    object_key: state.object_key,
    target_record_id: state.target_record_id,
    expected_updated_at: state.expected_updated_at,
    data_patch: { price: 35 },
    destination_view_key: state.destination_view_key,
  };
}

function recordConfirmationResult(
  state: Awaited<ReturnType<typeof currentState>>,
) {
  return {
    schema_version: 1 as const,
    state: "record_confirmation" as const,
    intent_schema_version: 1 as const,
    object_key: "product",
    object_label: "Product",
    explicit_fields: [
      {
        field_key: "name",
        label: "Name",
        field_type: "short_text" as const,
        value: "Afternoon Tea Box" as Json,
        formatted_value: "Afternoon Tea Box",
        source: "explicit" as const,
      },
      {
        field_key: "price",
        label: "Price",
        field_type: "currency" as const,
        value: 30 as Json,
        formatted_value: "£30.00",
        source: "explicit" as const,
      },
    ],
    default_fields: [
      {
        field_key: "status",
        label: "Status",
        field_type: "status" as const,
        value: "Active" as Json,
        formatted_value: "Active",
        source: "default" as const,
      },
    ],
    field_values: [
      {
        field_key: "name",
        field_type: "short_text" as const,
        string_value: "Afternoon Tea Box",
      },
      { field_key: "price", field_type: "currency" as const, number_value: 30 },
    ],
    base_version_id: state.base_version_id,
    head_revision: state.head_revision,
    object_schema_digest: state.object_schema_digest,
    record_state_digest: state.record_state_digest,
  };
}

describe("Builder generic Record creation end-to-end boundary", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    database = postgres(settings.databaseUrl, { max: 2 });
    fixtures = createConfigurationFixtures(database);
    originalConfirmationSecret =
      process.env.BUILDER_OPERATIONAL_CONFIRMATION_SECRET;
    process.env.BUILDER_OPERATIONAL_CONFIRMATION_SECRET = confirmationSecret;

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
    const email = `m12-builder-record-${crypto.randomUUID()}@example.test`;
    const created = await serviceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw (
        created.error ?? new Error("Could not create the Builder test user.")
      );
    }
    ownerUser = created.data.user;
    owner = createClient<Database>(settings.apiUrl, settings.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const signedIn = await owner.auth.signInWithPassword({ email, password });
    if (signedIn.error) {
      throw signedIn.error;
    }
    business = requireData(
      await owner.rpc("create_business", {
        business_name: `M12 Builder Record ${crypto.randomUUID()}`,
        requested_business_type: "test",
        requested_timezone: "Europe/London",
      }),
      "Could not create the Builder test Business.",
    );

    const [createdProduct] = await fixtures.insert("object_definitions", {
      business_id: business.id,
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "Products",
      kind: "template",
      semantic_type: "product",
    });
    if (!createdProduct) {
      throw new Error("Could not create the Product fixture.");
    }
    product = createdProduct;
    await fixtures.insert("field_definitions", [
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        position: 1,
      },
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "description",
        label: "Description",
        field_type: "long_text",
        required: false,
        default_value: null,
        settings_json: {},
        position: 2,
      },
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "price",
        label: "Price",
        field_type: "currency",
        required: true,
        default_value: null,
        settings_json: { currency: "GBP" },
        position: 3,
      },
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "status",
        label: "Status",
        field_type: "status",
        required: true,
        default_value: "Active",
        settings_json: { options: ["Active", "Inactive"] },
        position: 4,
      },
      {
        business_id: business.id,
        object_definition_id: product.id,
        key: "image",
        label: "Image",
        field_type: "file",
        required: false,
        default_value: null,
        settings_json: {},
        position: 5,
      },
    ]);
    await fixtures.insert("views", {
      business_id: business.id,
      key: "products",
      name: "Products",
      view_type: "table",
      object_definition_id: product.id,
      config_json: { fields: ["name", "price", "status"] },
      audience: "internal",
    });
  }, 180_000);

  afterAll(async () => {
    if (ownerUser && serviceRole) {
      await serviceRole.auth.admin.deleteUser(ownerUser.id);
    }
    if (database) {
      await database.end();
    }
    if (originalConfirmationSecret === undefined) {
      delete process.env.BUILDER_OPERATIONAL_CONFIRMATION_SECRET;
    } else {
      process.env.BUILDER_OPERATIONAL_CONFIRMATION_SECRET =
        originalConfirmationSecret;
    }
  });

  it("prepares a confirmation, writes once on explicit POST, and exposes the Record through the existing View", async () => {
    const before = await recordRows();
    const orchestrationRun = vi.fn(async () =>
      recordConfirmationResult(await currentState()),
    );
    const action = createBuilderAction({
      orchestrationService: { run: orchestrationRun },
    });

    queueActionClient(owner);
    const prepared = await action(
      business.slug,
      initialBuilderUiState(),
      requestForm(
        "Add an active Product called Afternoon Tea Box with the description Afternoon tea for two, priced at £30.",
      ),
    );
    expect(prepared.state).toBe("record_confirmation");
    if (prepared.state !== "record_confirmation") {
      throw new Error("Expected Record confirmation state.");
    }
    expect(orchestrationRun).toHaveBeenCalledTimes(1);
    expect(await recordRows()).toEqual(before);

    const html = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: business.slug,
        state: prepared,
      }),
    );
    expect(html).toContain("Add Product");
    expect(html).toContain("Afternoon Tea Box");
    expect(html).toContain("£30.00");
    expect(html).toContain("Active");
    expect(html).toContain("Confirm and create");
    expect(html).not.toContain("field_key");

    queueActionClient(owner);
    const created = await action(
      business.slug,
      prepared,
      confirmationForm(prepared.confirmation_token),
    );
    expect(created).toMatchObject({
      state: "record_created",
      object_label: "Product",
      message: "Product was added.",
    });
    if (created.state !== "record_created" || !created.destination_path) {
      throw new Error("Expected generated Product destination.");
    }

    const rows = await recordRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      business_id: business.id,
      object_definition_id: product.id,
      created_by: ownerUser.id,
      record_status: "active",
      data_json: {
        name: "Afternoon Tea Box",
        price: 30,
        status: "Active",
      },
    });
    expect(created.destination_path).toBe(
      `/app/${business.slug}/workspace/products/${rows[0]!.id}`,
    );

    const view = await createExperienceService(owner, {
      businessId: business.id,
    }).loadView("products");
    expect(view.definition.key).toBe("products");
    expect(view.object.id).toBe(product.id);
    expect(view.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: rows[0]!.id })]),
    );

    queueActionClient(owner);
    const replay = await action(
      business.slug,
      created,
      confirmationForm(prepared.confirmation_token),
    );
    expect(replay).toMatchObject({
      state: "unavailable",
      reason: "stale",
    });
    expect(orchestrationRun).toHaveBeenCalledTimes(1);
    expect(await recordRows()).toHaveLength(1);
  });

  it("passes the Record-update token through the real action boundary without mutating during preparation", async () => {
    const target = await createProductRecord("Builder Update Target", 30);
    const updateState = await currentUpdateState("Builder Update Target");
    const orchestrationRun = vi.fn(async () =>
      recordUpdateConfirmationResult(updateState),
    );
    const tokenService = createRecordUpdateConfirmationTokenService({
      secret: confirmationSecret,
      now: () => 1_000,
    });
    const action = createBuilderAction({
      orchestrationService: { run: orchestrationRun },
      createRecordUpdateConfirmationTokenService: () => tokenService,
    });
    const before = await recordRows();

    queueActionClient(owner);
    const prepared = await action(
      business.slug,
      initialBuilderUiState(),
      requestForm("Change the Builder Update Target price to £35."),
    );

    expect(prepared.state).toBe("record_update_confirmation");
    if (prepared.state !== "record_update_confirmation") {
      throw new Error("Expected Record-update confirmation state.");
    }
    expect(orchestrationRun).toHaveBeenCalledTimes(1);
    expect(prepared.confirmation_token).toBeTruthy();
    const payload = tokenService.verify(prepared.confirmation_token, {
      businessId: business.id,
      actorId: ownerUser.id,
    });
    expect(payload).toMatchObject({
      object_key: "product",
      target_record_id: target.id,
      expected_record_currentness: {
        updated_at: updateState.expected_updated_at,
      },
      data_patch: { price: 35 },
    });
    expect(await recordRows()).toEqual(before);

    const html = renderToStaticMarkup(
      createElement(BuilderResultPanel, {
        businessSlug: business.slug,
        state: prepared,
      }),
    );
    expect(html).toContain("Confirm and update");
    expect(html).toContain("£30.00");
    expect(html).toContain("£35.00");
  });

  it("uses one-selector ambiguity guidance for orchestration and service errors", async () => {
    const before = await recordRows();
    const ambiguousResult = {
      schema_version: 1 as const,
      state: "record_update_ambiguous" as const,
      object_label: "Product",
      message: BUILDER_RECORD_UPDATE_MESSAGES.ambiguous,
    };
    const orchestrationAction = createBuilderAction({
      orchestrationService: {
        run: vi.fn(async () => ambiguousResult),
      },
    });

    queueActionClient(owner);
    const orchestrationState = await orchestrationAction(
      business.slug,
      initialBuilderUiState(),
      requestForm("Change the Product price."),
    );
    expect(orchestrationState).toMatchObject({
      state: "record_update_ambiguous",
      object_label: "Product",
      message: BUILDER_RECORD_UPDATE_MESSAGES.ambiguous,
    });
    expect(JSON.stringify(orchestrationState)).not.toMatch(
      /another (exact )?(current )?(detail|selector|clause)/i,
    );
    expect(orchestrationState).not.toHaveProperty("candidate_records");

    const fallbackAction = createBuilderAction({
      orchestrationService: {
        run: vi
          .fn()
          .mockRejectedValue(
            new RecordUpdateServiceError("record_update_selector_ambiguous"),
          ),
      },
    });
    queueActionClient(owner);
    const fallbackState = await fallbackAction(
      business.slug,
      initialBuilderUiState(),
      requestForm("Change the Product price."),
    );
    expect(fallbackState).toMatchObject({
      state: "record_update_ambiguous",
      object_label: "Record",
      message: BUILDER_RECORD_UPDATE_MESSAGES.ambiguous,
    });
    expect(JSON.stringify(fallbackState)).not.toMatch(
      /another (exact )?(current )?(detail|selector|clause)/i,
    );
    expect(await recordRows()).toEqual(before);
  });
});
