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

import type { Database, Tables } from "../../src/db/supabase/database.types";

const actionHarness = vi.hoisted(() => ({
  clients: [] as unknown[],
  run: vi.fn(),
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
vi.mock("../../src/ai/builder/service", () => ({
  builderOrchestrationService: {
    run: actionHarness.run,
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

import { runBuilderAction } from "../../src/app/app/[businessSlug]/builder/actions";
import { AiExecutionError } from "../../src/ai/errors";
import { BUILDER_INITIAL_STATE } from "../../src/components/builder-ui-state";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };
type Business = Tables<"businesses">;

const password = "Milestone-8-builder-ui-action-test!";
const createdUserIds: string[] = [];

let settings: LocalSupabaseSettings;
let database: Sql;
let serviceRole: Client;
let owner: Identity;
let administrator: Identity;
let staff: Identity;
let outsider: Identity;
let business: Business;

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
  const email = `m8-builder-ui-${label}-${crypto.randomUUID()}@example.test`;
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

function queueActionClient(client: Client): void {
  actionHarness.clients = [client];
}

function formWithRequest(request: string): FormData {
  const form = new FormData();
  form.set("ownerRequest", request);
  return form;
}

async function expectNotFound(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toMatchObject({ name: "ActionNotFound" });
}

const proposedResult = {
  schema_version: 1 as const,
  state: "proposed" as const,
  proposal_id: "10000000-0000-4000-8000-000000000011",
  status: "proposed" as const,
  base_version_id: "10000000-0000-4000-8000-000000000012",
  base_head_revision: 7,
  operation_count: 2,
  summary: "A bounded Builder proposal is ready for review.",
};

describe("Milestone 8 Phase 8C authenticated Builder action boundary", () => {
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
    database = postgres(settings.databaseUrl, { max: 2 });

    owner = await signIn("demo@smbos.local");
    staff = await signIn("staff@smbos.local");
    administrator = await createIdentity("admin");
    outsider = await createIdentity("outsider");

    business = requireData(
      await owner.client
        .from("businesses")
        .select("*")
        .eq("slug", "bedford-bakery-demo")
        .single(),
      "Could not load Bedford Bakery.",
    );
    const membership = await serviceRole.from("business_memberships").insert({
      business_id: business.id,
      user_id: administrator.user.id,
      role: "admin",
    });
    if (membership.error) {
      throw membership.error;
    }
  }, 180_000);

  beforeEach(() => {
    actionHarness.clients = [];
    actionHarness.run.mockReset();
  });

  afterAll(async () => {
    if (database) {
      await database`
        delete from public.business_memberships
        where user_id in ${database(createdUserIds)}
      `;
      await database.end();
    }
    if (serviceRole) {
      for (const userId of createdUserIds) {
        await serviceRole.auth.admin.deleteUser(userId);
      }
    }
  });

  it("resolves tenant membership server-side and calls orchestration once", async () => {
    actionHarness.run.mockResolvedValueOnce(proposedResult);
    queueActionClient(owner.client);
    const form = formWithRequest("  Create a catering enquiry form.  ");
    form.set("businessId", "forged-business-id");
    form.set("actorId", "forged-actor-id");

    const result = await runBuilderAction(
      business.slug,
      BUILDER_INITIAL_STATE,
      form,
    );

    expect(result).toEqual({
      state: "proposed",
      proposal_id: proposedResult.proposal_id,
      summary: proposedResult.summary,
      operation_count: proposedResult.operation_count,
    });
    expect(actionHarness.run).toHaveBeenCalledTimes(1);
    expect(actionHarness.run).toHaveBeenCalledWith(owner.client, {
      businessId: business.id,
      ownerRequest: "Create a catering enquiry form.",
    });
  });

  it("rejects invalid input before opening the authenticated tenant boundary", async () => {
    const result = await runBuilderAction(
      business.slug,
      BUILDER_INITIAL_STATE,
      formWithRequest(" "),
    );

    expect(result).toEqual({
      state: "input_invalid",
      message:
        "Describe what you would like SMBOS to build in 4,000 characters or fewer.",
    });
    expect(actionHarness.run).not.toHaveBeenCalled();
    expect(actionHarness.clients).toHaveLength(0);
  });

  it("allows an admin and hides the action from staff and non-members", async () => {
    actionHarness.run.mockResolvedValue(proposedResult);
    queueActionClient(administrator.client);
    await expect(
      runBuilderAction(
        business.slug,
        BUILDER_INITIAL_STATE,
        formWithRequest("Create an enquiry form."),
      ),
    ).resolves.toMatchObject({ state: "proposed" });

    queueActionClient(staff.client);
    await expectNotFound(
      runBuilderAction(
        business.slug,
        BUILDER_INITIAL_STATE,
        formWithRequest("Create an enquiry form."),
      ),
    );

    queueActionClient(outsider.client);
    await expectNotFound(
      runBuilderAction(
        business.slug,
        BUILDER_INITIAL_STATE,
        formWithRequest("Create an enquiry form."),
      ),
    );
    expect(actionHarness.run).toHaveBeenCalledTimes(1);
  });

  it("maps established safe failures and rethrows unexpected failures", async () => {
    actionHarness.run.mockRejectedValueOnce(
      new AiExecutionError("ai_disabled"),
    );
    queueActionClient(owner.client);
    await expect(
      runBuilderAction(
        business.slug,
        BUILDER_INITIAL_STATE,
        formWithRequest("Create an enquiry form."),
      ),
    ).resolves.toEqual({
      state: "unavailable",
      reason: "ai_disabled",
      message: "Builder is not enabled for this Business.",
    });

    const unexpected = new Error("unexpected action failure");
    actionHarness.run.mockRejectedValueOnce(unexpected);
    queueActionClient(owner.client);
    await expect(
      runBuilderAction(
        business.slug,
        BUILDER_INITIAL_STATE,
        formWithRequest("Create an enquiry form."),
      ),
    ).rejects.toBe(unexpected);
  });

  it("ends invalid route slugs without calling Supabase or orchestration", async () => {
    queueActionClient(owner.client);
    await expectNotFound(
      runBuilderAction(
        "../other-business",
        BUILDER_INITIAL_STATE,
        formWithRequest("Create an enquiry form."),
      ),
    );
    expect(actionHarness.run).not.toHaveBeenCalled();
    expect(actionHarness.clients).toHaveLength(1);
  });
});
