import { execFileSync } from "node:child_process";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  Database,
  Json,
  Tables,
} from "../../src/db/supabase/database.types";

const routeHarness = vi.hoisted(() => ({
  clients: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/supabase/server", () => ({
  createServerClient: async () => {
    const client = routeHarness.clients.shift();
    if (!client) {
      throw new Error("No authenticated route client was queued.");
    }
    return client;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    const error = new Error("not-found");
    error.name = "RouteNotFound";
    throw error;
  },
  redirect: (path: string) => {
    const error = new Error(path);
    error.name = "ActionRedirect";
    throw error;
  },
}));

import BuilderPage from "../../src/app/app/[businessSlug]/builder/page";
import {
  getLocalSupabaseSettings,
  type LocalSupabaseSettings,
} from "./support/local-supabase";

type Client = SupabaseClient<Database>;
type Identity = { client: Client; user: User };
type Business = Tables<"businesses">;

const password = "Milestone-8-builder-ui-route-test!";
const createdUserIds: string[] = [];

let settings: LocalSupabaseSettings;
let database: Sql;
let serviceRole: Client;
let anonymous: Client;
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
  const email = `m8-builder-ui-route-${label}-${crypto.randomUUID()}@example.test`;
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

function queueRouteClient(client: Client): void {
  routeHarness.clients = [client];
}

async function routeState() {
  const [
    executions,
    proposals,
    head,
    versions,
    records,
    edges,
    locations,
    snapshot,
  ] = await Promise.all([
    database<Record<string, unknown>[]>`
        select *
        from public.ai_execution_runs
        where business_id = ${business.id}::uuid
        order by reserved_at, id
      `,
    database<Record<string, unknown>[]>`
        select *
        from public.configuration_change_sets
        where business_id = ${business.id}::uuid
        order by created_at, id
      `,
    serviceRole
      .from("business_configuration_heads")
      .select("*")
      .eq("business_id", business.id)
      .single(),
    serviceRole
      .from("configuration_versions")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: true }),
    serviceRole
      .from("records")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: true }),
    serviceRole
      .from("record_relationships")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: true }),
    serviceRole
      .from("locations")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: true }),
    database<{ snapshot: Json }[]>`
        select private.configuration_snapshot_v1(${business.id}::uuid) as snapshot
      `,
  ]);
  if (
    head.error ||
    !head.data ||
    versions.error ||
    records.error ||
    edges.error ||
    locations.error
  ) {
    throw new Error("Could not read route integration state.");
  }
  return {
    executions,
    proposals,
    head: head.data,
    versions: versions.data,
    records: records.data,
    edges: edges.data,
    locations: locations.data,
    snapshot: snapshot[0]?.snapshot,
  };
}

async function renderBuilder(identity: { client: Client }): Promise<string> {
  queueRouteClient(identity.client);
  const page = await BuilderPage({
    params: Promise.resolve({ businessSlug: business.slug }),
  });
  return renderToStaticMarkup(page);
}

async function renderContextualBuilder(
  identity: { client: Client },
  sourceVersionId: string,
): Promise<string> {
  queueRouteClient(identity.client);
  const page = await BuilderPage({
    params: Promise.resolve({ businessSlug: business.slug }),
    searchParams: Promise.resolve({ undoVersion: sourceVersionId }),
  });
  return renderToStaticMarkup(page);
}

async function expectNotFound(render: Promise<unknown>): Promise<void> {
  await expect(render).rejects.toMatchObject({ name: "RouteNotFound" });
}

describe("authenticated Builder GET route integration", () => {
  beforeAll(async () => {
    settings = getLocalSupabaseSettings();
    process.env.NEXT_PUBLIC_SUPABASE_URL = settings.apiUrl;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = settings.publishableKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = settings.serviceRoleKey;
    try {
      execFileSync(process.execPath, ["scripts/demo-seed.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      const details =
        error instanceof Error
          ? `${error.message}\n${String((error as { stderr?: unknown }).stderr ?? "")}`
          : String(error);
      if (
        !details.includes(
          "Bedford already has configuration history beyond the expected Version 2.",
        )
      ) {
        throw error;
      }
    }
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
    database = postgres(settings.databaseUrl, { max: 4 });

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

  it("authenticates Owner and renders the real Builder UI without side effects", async () => {
    const before = await routeState();
    const html = await renderBuilder(owner);

    expect(html).toContain("Business Builder");
    expect(html).toContain("What would you like your business to do?");
    expect(html).toContain('name="ownerRequest"');
    expect(await routeState()).toEqual(before);
  });

  it("authenticates Admin and renders the same normal Builder UI", async () => {
    const before = await routeState();
    const html = await renderBuilder(administrator);

    expect(html).toContain("Business Builder");
    expect(html).toContain("Prepare request");
    expect(await routeState()).toEqual(before);
  });

  it("renders contextual undo for the active ordinary change without side effects", async () => {
    const before = await routeState();
    const html = await renderContextualBuilder(
      owner,
      before.head.active_version_id,
    );

    expect(html).toContain("Undo the latest setup change");
    expect(html).toContain("Undo that.");
    expect(html).toContain("Nothing changes until this rollback proposal");
    expect(html).not.toContain('name="ownerRequest"');
    expect(html).not.toContain('name="targetVersionId"');
    expect(await routeState()).toEqual(before);
  });

  it("returns controlled notFound for Staff", async () => {
    const before = await routeState();
    await expectNotFound(renderBuilder(staff));
    expect(await routeState()).toEqual(before);
  });

  it("denies contextual undo to Staff before loading configuration context", async () => {
    const before = await routeState();
    await expectNotFound(
      renderContextualBuilder(staff, before.head.active_version_id),
    );
    expect(await routeState()).toEqual(before);
  });

  it("returns controlled notFound for anonymous users", async () => {
    const before = await routeState();
    await expectNotFound(renderBuilder({ client: anonymous }));
    expect(await routeState()).toEqual(before);
  });

  it("returns controlled notFound for a cross-business non-member", async () => {
    const before = await routeState();
    await expectNotFound(renderBuilder(outsider));
    expect(await routeState()).toEqual(before);
  });
});
