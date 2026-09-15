import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const baselineSha =
  process.env.SMBOS_UPGRADE_BASELINE_SHA ??
  "65779f40491df9d399cb206fcd4f7fce64813204";
const expectedMigrationCount = 21;
const demoBusinessSlugs = ["bedford-bakery-demo", "lenni-connections-demo"];
const publicBusinessSlug = "bedford-bakery-demo";
const publicPageSlug = "preorder";
const preorderKey = "bakery_preorder";
const storageBucket = "page-assets";
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
let currentPhase = "validate";
let targetValidated = false;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required rehearsal environment: ${name}`);
  }
  return value;
}

function parseEnvironmentOutput(output) {
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim()))
      .flatMap((match) => (match?.[1] ? [[match[1], match[2] ?? ""]] : [])),
  );
}

function supabaseExecutable() {
  return join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.exe" : "supabase",
  );
}

function isLoopback(hostname) {
  return new Set(["127.0.0.1", "localhost", "::1"]).has(hostname);
}

function validateTarget() {
  const workdir = requiredEnvironment("SMBOS_UPGRADE_WORKDIR");
  const runnerTemp = requiredEnvironment("RUNNER_TEMP");
  const projectId = requiredEnvironment("SMBOS_UPGRADE_PROJECT_ID");
  const apiPort = requiredEnvironment("SMBOS_UPGRADE_API_PORT");
  const databasePort = requiredEnvironment("SMBOS_UPGRADE_DB_PORT");
  const shadowPort = requiredEnvironment("SMBOS_UPGRADE_SHADOW_PORT");
  if (!isAbsolute(workdir) || !isAbsolute(runnerTemp)) {
    throw new Error("The populated-upgrade target paths must be absolute.");
  }
  const expectedWorkdir = resolve(join(runnerTemp, projectId));
  if (resolve(workdir) !== expectedWorkdir) {
    throw new Error(
      "The rehearsal target is outside its runner-owned workdir.",
    );
  }
  if (!/^smbos-sites-upgrade-[A-Za-z0-9-]+$/.test(projectId)) {
    throw new Error(
      "The rehearsal target does not use its CI project ID prefix.",
    );
  }
  if (!existsSync(join(workdir, "supabase", "config.toml"))) {
    throw new Error("The runner-owned rehearsal config is missing.");
  }
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  if (!config.includes(`project_id = "${projectId}"`)) {
    throw new Error("The rehearsal config does not match its project ID.");
  }
  for (const [name, value] of [
    ["SMBOS_UPGRADE_API_PORT", apiPort],
    ["SMBOS_UPGRADE_DB_PORT", databasePort],
    ["SMBOS_UPGRADE_SHADOW_PORT", shadowPort],
  ]) {
    if (!/^\d{2,5}$/.test(value) || Number(value) < 1024) {
      throw new Error(`${name} is not a valid isolated port.`);
    }
  }
  return {
    apiPort,
    databasePort,
    projectId,
    shadowPort,
    workdir,
  };
}

function loadTargetSettings(target) {
  const values = parseEnvironmentOutput(
    execFileSync(
      supabaseExecutable(),
      ["status", "--workdir", target.workdir, "-o", "env"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const apiUrl = values.API_URL;
  const databaseUrl = values.DB_URL;
  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  if (!apiUrl || !databaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error(
      "The isolated rehearsal target did not report credentials.",
    );
  }
  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  if (
    api.protocol !== "http:" ||
    !isLoopback(api.hostname) ||
    api.port !== target.apiPort ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !isLoopback(database.hostname) ||
    database.port !== target.databasePort
  ) {
    throw new Error(
      "The rehearsal target reported unexpected non-isolated URLs.",
    );
  }
  return { apiUrl, databaseUrl, publishableKey, serviceRoleKey };
}

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function digestBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireData(result, message) {
  if (result.error || result.data === null) {
    throw new Error(message);
  }
  return result.data;
}

function migrationList() {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      `${baselineSha}...HEAD`,
      "--",
      "supabase/migrations",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return output
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path.endsWith(".sql"));
}

function migrationVersions(revision) {
  const output = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", revision, "supabase/migrations"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return output
    .split("\n")
    .map((path) => path.split("/").at(-1)?.split("_")[0])
    .filter(Boolean)
    .sort();
}

async function createReceipt(admin, publicClient) {
  const catalogueResult = await publicClient.rpc("resolve_public_preorder", {
    requested_business_slug: publicBusinessSlug,
    requested_page_slug: publicPageSlug,
    requested_preorder_key: preorderKey,
  });
  const catalogue = requireData(
    catalogueResult,
    "Could not resolve the seeded public preorder catalogue.",
  );
  const location = catalogue.preorder?.locations?.find((candidate) =>
    candidate.slots?.some((slot) => slot.available),
  );
  const slot = location?.slots?.find((candidate) => candidate.available);
  const product = catalogue.preorder?.products?.find((candidate) =>
    candidate.location_ids?.includes(location.id),
  );
  if (!location || !slot || !product) {
    throw new Error(
      "The seeded public preorder has no usable receipt fixture.",
    );
  }
  const idempotencyToken = randomUUID();
  const submission = {
    idempotency_token: idempotencyToken,
    location_id: location.id,
    collection_at: slot.collection_at,
    items: [{ product_id: product.id, quantity: 1 }],
    fields: {
      customer: {
        name: "C5 Upgrade Rehearsal",
        email: "c5-upgrade-rehearsal@example.test",
        phone: "01234 567890",
      },
      order: {
        dietary_requirements: "No nuts",
        occasion: "Upgrade rehearsal",
      },
    },
    website: "",
  };
  const result = await admin.rpc("submit_public_preorder", {
    requested_business_slug: publicBusinessSlug,
    requested_page_slug: publicPageSlug,
    requested_preorder_key: preorderKey,
    requested_request_hash: digestBytes(randomUUID()),
    submission,
  });
  const receipt = requireData(
    result,
    "Could not create the seeded preorder receipt.",
  );
  if (receipt.ok !== true) {
    throw new Error("The seeded preorder receipt was rejected.");
  }
  return { idempotencyToken };
}

async function createManagedAsset(admin, sql, businessId) {
  const [owner] = await sql`
    select user_id
    from public.business_memberships
    where business_id = ${businessId}::uuid
      and role = 'owner'
    order by created_at, user_id
    limit 1
  `;
  if (!owner?.user_id) {
    throw new Error("The seeded Business has no owner for the media fixture.");
  }
  const storageKey = `${businessId}/${randomUUID()}.png`;
  const asset = requireData(
    await admin
      .from("media_assets")
      .insert({
        business_id: businessId,
        byte_size: onePixelPng.byteLength,
        created_by: owner.user_id,
        height: 1,
        mime_type: "image/png",
        storage_key: storageKey,
        width: 1,
      })
      .select("id")
      .single(),
    "Could not register the managed media fixture.",
  );
  const upload = await admin.storage
    .from(storageBucket)
    .upload(storageKey, onePixelPng, {
      contentType: "image/png",
      upsert: false,
    });
  if (upload.error) {
    throw new Error("Could not upload the managed media fixture bytes.");
  }
  const downloaded = await admin.storage
    .from(storageBucket)
    .download(storageKey);
  if (downloaded.error || !downloaded.data) {
    throw new Error("Could not verify the managed media fixture bytes.");
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (bytes.byteLength !== onePixelPng.byteLength) {
    throw new Error("The managed media fixture byte count changed.");
  }
  return {
    assetId: asset.id,
    digest: digestBytes(bytes),
    storageKey,
  };
}

async function captureSnapshot({
  admin,
  businessIds,
  publicClient,
  sql,
  storageAsset,
}) {
  const ids = sql.array(businessIds, 2950);
  const tables = {
    businesses: await sql`
      select id, slug, name, business_type, timezone, settings_json
      from public.businesses
      where id = any(${ids})
      order by id
    `,
    locations: await sql`
      select id, business_id, name, slug, timezone, is_active,
        address_json, opening_hours_json, settings_json
      from public.locations
      where business_id = any(${ids})
      order by business_id, id
    `,
    business_configuration_heads: await sql`
      select business_id, active_version_id, head_revision
      from public.business_configuration_heads
      where business_id = any(${ids})
      order by business_id
    `,
    configuration_versions: await sql`
      select id, business_id, version_number, kind, parent_version_id,
        restored_from_version_id, source_change_set_id, created_by,
        snapshot_checksum, snapshot_schema_version, snapshot_json
      from public.configuration_versions
      where business_id = any(${ids})
      order by business_id, version_number
    `,
    configuration_change_sets: await sql`
      select id, business_id, kind, status, title, description,
        base_head_revision, base_version_id, applied_version_id,
        requested_by, applied_by, candidate_checksum,
        operations_schema_version, operations_json, candidate_snapshot_json,
        semantic_diff_json
      from public.configuration_change_sets
      where business_id = any(${ids})
      order by business_id, id
    `,
    object_definitions: await sql`
      select id, business_id, key, kind, singular_label, plural_label,
        description, icon, semantic_type, is_active
      from public.object_definitions
      where business_id = any(${ids})
      order by business_id, id
    `,
    field_definitions: await sql`
      select id, business_id, object_definition_id, key, label, field_type,
        required, default_value, settings_json, position, is_active
      from public.field_definitions
      where business_id = any(${ids})
      order by business_id, id
    `,
    relationship_definitions: await sql`
      select id, business_id, key, source_object_definition_id,
        target_object_definition_id, source_label, target_label, cardinality,
        is_required, is_active
      from public.relationship_definitions
      where business_id = any(${ids})
      order by business_id, id
    `,
    views: await sql`
      select id, business_id, key, name, view_type, object_definition_id,
        config_json, audience, is_active
      from public.views
      where business_id = any(${ids})
      order by business_id, id
    `,
    forms: await sql`
      select id, business_id, key, name, mode, object_definition_id,
        config_json, audience, is_active
      from public.forms
      where business_id = any(${ids})
      order by business_id, id
    `,
    pages: await sql`
      select id, business_id, key, title, slug, audience, status,
        layout_json, is_active
      from public.pages
      where business_id = any(${ids})
      order by business_id, id
    `,
    preorder_experiences: await sql`
      select id, business_id, key, product_object_definition_id,
        customer_object_definition_id, order_object_definition_id,
        order_item_object_definition_id,
        customer_places_order_relationship_definition_id,
        order_contains_item_relationship_definition_id,
        product_appears_in_item_relationship_definition_id, config_json,
        is_active
      from public.preorder_experiences
      where business_id = any(${ids})
      order by business_id, id
    `,
    preorder_experience_locations: await sql`
      select id, business_id, preorder_experience_id, location_id, is_active
      from public.preorder_experience_locations
      where business_id = any(${ids})
      order by business_id, id
    `,
    records: await sql`
      select id, business_id, object_definition_id, record_status,
        created_by, data_json
      from public.records
      where business_id = any(${ids})
      order by business_id, id
    `,
    record_location_links: await sql`
      select id, business_id, record_id, location_id
      from public.record_location_links
      where business_id = any(${ids})
      order by business_id, id
    `,
    record_relationships: await sql`
      select id, business_id, relationship_definition_id,
        source_record_id, target_record_id
      from public.record_relationships
      where business_id = any(${ids})
      order by business_id, id
    `,
    media_assets: await sql`
      select id, business_id, storage_key, mime_type, byte_size, width,
        height, created_by
      from public.media_assets
      where business_id = any(${ids})
      order by business_id, id
    `,
    preorder_submissions: await sql`
      select id, business_id, preorder_experience_id, idempotency_token,
        public_reference, order_record_id, confirmation_json, email_status,
        email_error, email_attempted_at
      from public.preorder_submissions
      where business_id = any(${ids})
      order by business_id, id
    `,
    public_form_submissions: await sql`
      select id, business_id, page_id, form_id, idempotency_token,
        record_id, public_reference
      from public.public_form_submissions
      where business_id = any(${ids})
      order by business_id, id
    `,
  };
  const publicPage = requireData(
    await publicClient.rpc("resolve_public_page", {
      requested_business_slug: publicBusinessSlug,
      requested_page_slug: publicPageSlug,
    }),
    "Could not resolve the legacy public address.",
  );
  if (!publicPage?.business?.slug || !publicPage?.page?.slug) {
    throw new Error("The legacy public address did not resolve.");
  }
  const downloaded = await admin.storage
    .from(storageBucket)
    .download(storageAsset.storageKey);
  if (downloaded.error || !downloaded.data) {
    throw new Error("Could not re-read the managed media fixture bytes.");
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  const storageDigest = digestBytes(bytes);
  if (bytes.byteLength !== onePixelPng.byteLength) {
    throw new Error("The managed media fixture byte count is not stable.");
  }
  return {
    rowCounts: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.length]),
    ),
    tableDigests: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, digest(rows)]),
    ),
    publicAddress: {
      businessSlug: publicPage.business.slug,
      pageKey: publicPage.page.key,
      pageSlug: publicPage.page.slug,
      pageTitle: publicPage.page.title,
    },
    storageDigest,
  };
}

function assertPreserved(before, after) {
  if (JSON.stringify(before.rowCounts) !== JSON.stringify(after.rowCounts)) {
    throw new Error("Populated upgrade changed preserved row counts.");
  }
  if (
    JSON.stringify(before.tableDigests) !== JSON.stringify(after.tableDigests)
  ) {
    throw new Error("Populated upgrade changed preserved row payloads.");
  }
  if (
    JSON.stringify(before.publicAddress) !== JSON.stringify(after.publicAddress)
  ) {
    throw new Error("Populated upgrade changed the legacy public address.");
  }
  if (before.storageDigest !== after.storageDigest) {
    throw new Error("Populated upgrade changed the managed media bytes.");
  }
}

async function readMigrationLedger(sql) {
  const rows = await sql`
    select version
    from supabase_migrations.schema_migrations
    order by version
  `;
  return rows.map((row) => String(row.version)).sort();
}

function assertMigrationLedger(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `The ${label} migration ledger did not match its source tree.`,
    );
  }
}

function assertRepresentativeFixture(snapshot) {
  const minimums = {
    business_configuration_heads: 2,
    configuration_change_sets: 2,
    configuration_versions: 4,
    pages: 2,
    records: 1,
    record_relationships: 1,
    media_assets: 1,
    preorder_submissions: 1,
  };
  for (const [table, minimum] of Object.entries(minimums)) {
    if ((snapshot.rowCounts[table] ?? 0) < minimum) {
      throw new Error(`The populated rehearsal fixture is missing ${table}.`);
    }
  }
}

async function assertLegacyReceiptDefaults(sql, businessId, idempotencyToken) {
  const [receipt] = await sql`
    select source_page_id, stable_source_key, action_key, release_id,
      release_token, canonical_submission, frozen_action_json,
      customer_match_identity, customer_match_count,
      customer_candidate_ids, original_customer_record_id,
      customer_record_id, customer_resolution_state,
      customer_resolution_revision, customer_resolution_actor_id,
      customer_resolution_at
    from public.preorder_submissions
    where business_id = ${businessId}::uuid
      and idempotency_token = ${idempotencyToken}::uuid
  `;
  if (!receipt) {
    throw new Error(
      "The seeded receipt disappeared during the forward upgrade.",
    );
  }
  const nullableFields = [
    "source_page_id",
    "stable_source_key",
    "action_key",
    "release_id",
    "release_token",
    "canonical_submission",
    "frozen_action_json",
    "customer_match_identity",
    "customer_match_count",
    "customer_candidate_ids",
    "original_customer_record_id",
    "customer_record_id",
    "customer_resolution_state",
    "customer_resolution_actor_id",
    "customer_resolution_at",
  ];
  if (
    nullableFields.some((field) => receipt[field] !== null) ||
    Number(receipt.customer_resolution_revision) !== 0
  ) {
    throw new Error(
      "Legacy receipt metadata did not retain its nullable defaults.",
    );
  }
}

function writeEvidence(path, evidence) {
  if (!isAbsolute(path)) {
    throw new Error("SMBOS_UPGRADE_EVIDENCE_PATH must be absolute.");
  }
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function main() {
  const evidencePath = requiredEnvironment("SMBOS_UPGRADE_EVIDENCE_PATH");
  const target = validateTarget();
  targetValidated = true;
  const migrationPaths = migrationList();
  if (migrationPaths.length !== expectedMigrationCount) {
    throw new Error(
      "The candidate migration delta is not the reviewed 21 files.",
    );
  }
  const candidateMigrations = resolve(
    join(process.cwd(), "supabase", "migrations"),
  );
  if (!existsSync(candidateMigrations)) {
    throw new Error("The candidate migration directory is missing.");
  }
  const settings = loadTargetSettings(target);
  const admin = createClient(settings.apiUrl, settings.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const publicClient = createClient(settings.apiUrl, settings.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const sql = postgres(settings.databaseUrl, { max: 1 });
  currentPhase = "connect";
  try {
    const baselineMigrations = migrationVersions(baselineSha);
    const candidateMigrationVersions = migrationVersions("HEAD");
    if (
      baselineMigrations.length + migrationPaths.length !==
      candidateMigrationVersions.length
    ) {
      throw new Error(
        "The candidate migration tree did not contain the reviewed additive delta.",
      );
    }
    const businessRows = await sql`
      select id, slug
      from public.businesses
      where slug = any(${sql.array(demoBusinessSlugs, 1009)})
      order by slug
    `;
    if (businessRows.length !== demoBusinessSlugs.length) {
      throw new Error(
        "The populated rehearsal seed did not create both Businesses.",
      );
    }
    const businessIds = businessRows.map((row) => row.id);
    const primaryBusinessId = businessRows.find(
      (row) => row.slug === publicBusinessSlug,
    )?.id;
    if (!primaryBusinessId) {
      throw new Error(
        "The populated rehearsal seed is missing its public Business.",
      );
    }

    currentPhase = "ledger-before";
    assertMigrationLedger(
      "baseline",
      await readMigrationLedger(sql),
      baselineMigrations,
    );
    currentPhase = "receipt";
    const receipt = await createReceipt(admin, publicClient);
    currentPhase = "media";
    const storageAsset = await createManagedAsset(
      admin,
      sql,
      primaryBusinessId,
    );
    currentPhase = "snapshot-before";
    const before = await captureSnapshot({
      admin,
      businessIds,
      publicClient,
      sql,
      storageAsset,
    });
    assertRepresentativeFixture(before);

    currentPhase = "apply-forward-migrations";
    const targetMigrations = join(target.workdir, "supabase", "migrations");
    rmSync(targetMigrations, { force: true, recursive: true });
    cpSync(candidateMigrations, targetMigrations, { recursive: true });
    execFileSync(
      supabaseExecutable(),
      ["db", "push", "--local", "--yes", "--workdir", target.workdir],
      {
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    currentPhase = "ledger-after";
    assertMigrationLedger(
      "candidate",
      await readMigrationLedger(sql),
      candidateMigrationVersions,
    );
    await assertLegacyReceiptDefaults(
      sql,
      primaryBusinessId,
      receipt.idempotencyToken,
    );
    currentPhase = "snapshot-after";
    const after = await captureSnapshot({
      admin,
      businessIds,
      publicClient,
      sql,
      storageAsset,
    });
    currentPhase = "compare";
    assertPreserved(before, after);

    const candidateSha =
      process.env.SMBOS_UPGRADE_CANDIDATE_SHA ??
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    writeEvidence(evidencePath, {
      schema_version: 1,
      status: "passed",
      baseline_sha: baselineSha,
      candidate_sha: candidateSha,
      migration_count: migrationPaths.length,
      migration_names_digest: digest(migrationPaths),
      ledger: {
        baseline_count: baselineMigrations.length,
        baseline_digest: digest(baselineMigrations),
        candidate_count: candidateMigrationVersions.length,
        candidate_digest: digest(candidateMigrationVersions),
      },
      target: {
        project_id: target.projectId,
        api_port: Number(target.apiPort),
        database_port: Number(target.databasePort),
        shadow_port: Number(target.shadowPort),
        validated_runner_owned: true,
      },
      receipt: {
        table: "preorder_submissions",
        seeded: true,
        idempotency_token_digest: digest(receipt.idempotencyToken),
        legacy_metadata_defaults_verified: true,
      },
      storage: {
        mode: "bytes",
        byte_count: onePixelPng.byteLength,
        object_digest: after.storageDigest,
      },
      before: {
        row_counts: before.rowCounts,
        table_digests: before.tableDigests,
        public_address: before.publicAddress,
      },
      after: {
        row_counts: after.rowCounts,
        table_digests: after.tableDigests,
        public_address: after.publicAddress,
      },
      preserved: true,
    });
  } finally {
    await sql.end();
  }
  console.log(`Sites populated upgrade rehearsal passed phase=${currentPhase}`);
}

const evidencePath = process.env.SMBOS_UPGRADE_EVIDENCE_PATH;
try {
  await main();
} catch (error) {
  const rawCategory =
    error && typeof error === "object" && "code" in error
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  const failureCategory =
    typeof rawCategory === "string" && /^[A-Za-z0-9_.:-]+$/.test(rawCategory)
      ? rawCategory
      : "unknown";
  if (evidencePath) {
    try {
      writeEvidence(evidencePath, {
        schema_version: 1,
        status: "failed",
        failure_phase: currentPhase,
        failure_category: failureCategory,
        baseline_sha: baselineSha,
        candidate_sha: process.env.SMBOS_UPGRADE_CANDIDATE_SHA ?? "unknown",
        target_project_id: process.env.SMBOS_UPGRADE_PROJECT_ID ?? "unknown",
        target_validated_runner_owned: targetValidated,
      });
    } catch {
      // Preserve the original failure without writing secrets or private rows.
    }
  }
  console.error(
    `Sites populated upgrade rehearsal failed phase=${currentPhase} category=${failureCategory}`,
  );
  process.exitCode = 1;
}
