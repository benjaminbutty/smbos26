import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { hasCapability } from "../src/auth/capabilities";
import {
  ConfigurationChangeDetail,
  ConfigurationChangesOverview,
  ConfigurationVersionDetail,
} from "../src/components/configuration-history-ui";
import type {
  ConfigurationValidationResult,
  SemanticDiff,
} from "../src/core/configuration/schemas";
import {
  isControlledConfigurationReadError,
  summarizeConfigurationSnapshot,
} from "../src/core/configuration/service";
import type { Json, Tables } from "../src/db/supabase/database.types";

vi.mock("server-only", () => ({}));

type ChangeSet = Tables<"configuration_change_sets">;
type Version = Tables<"configuration_versions">;

const businessId = "10000000-0000-4000-8000-000000000001";
const ownerId = "10000000-0000-4000-8000-000000000002";
const baseVersionId = "10000000-0000-4000-8000-000000000010";
const checksum = "a".repeat(64);
const now = "2026-07-29T12:00:00.000Z";

const diff: SemanticDiff = {
  schema_version: 1,
  counts: { created: 1, updated: 1, restored: 1, archived: 1 },
  changes: [
    {
      entity_type: "page",
      entity_key: "public_preorder",
      change_type: "updated",
      label: '<img src=x onerror="alert(1)">',
      properties: [
        {
          property: "status",
          before: "published",
          after: "<script>alert(1)</script>",
        },
        {
          property: "schedule.days_of_week",
          before: [6, 7],
          after: [6],
        },
        {
          property: "settings_json",
          before: { options: ["Active", "Paused"] },
          after: { options: ["Active", "Paused", "Retired"] },
        },
      ],
    },
    {
      entity_type: "object",
      entity_key: "enquiry",
      change_type: "created",
      label: "Catering Enquiry",
      properties: [],
    },
    {
      entity_type: "form",
      entity_key: "old_form",
      change_type: "archived",
      label: "Old form",
      properties: [],
    },
    {
      entity_type: "view",
      entity_key: "orders",
      change_type: "restored",
      label: "Orders",
      properties: [],
    },
  ],
};

const validResult: ConfigurationValidationResult = {
  schema_version: 1,
  outcome: "valid",
  base_version_id: baseVersionId,
  base_head_revision: 1,
  candidate_checksum: checksum,
  errors: [],
  warnings: [
    {
      code: "existing_records_hidden",
      message: "Some existing information will not appear in this preview.",
    },
  ],
};

function changeSet(
  status: ChangeSet["status"],
  overrides: Partial<ChangeSet> = {},
): ChangeSet {
  const closed = ["rejected", "conflicted", "abandoned"].includes(status);
  const validated = ["validated", "applied", "conflicted"].includes(status);
  return {
    id: crypto.randomUUID(),
    business_id: businessId,
    kind: "change",
    status,
    title: `${status} proposal`,
    description: `Description for ${status}`,
    base_version_id: baseVersionId,
    base_head_revision: 1,
    rollback_target_version_id: null,
    requested_by: ownerId,
    operations_schema_version: 1,
    operations_json: [],
    id_allocations_json: {},
    display_context_json: { schema_version: 1, locations: {} },
    candidate_snapshot_json: {},
    candidate_checksum: checksum,
    semantic_diff_json: diff as unknown as Json,
    validation_result_json:
      status === "proposed" || status === "abandoned"
        ? null
        : (validResult as unknown as Json),
    validated_by: validated ? ownerId : null,
    validated_at: validated ? now : null,
    applied_version_id: null,
    applied_by: status === "applied" ? ownerId : null,
    applied_at: status === "applied" ? now : null,
    closed_by: closed ? ownerId : null,
    closed_at: closed ? now : null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function version(
  versionNumber: number,
  overrides: Partial<Version> = {},
): Version {
  return {
    id:
      versionNumber === 1
        ? baseVersionId
        : `10000000-0000-4000-8000-${String(versionNumber).padStart(12, "0")}`,
    business_id: businessId,
    version_number: versionNumber,
    kind: versionNumber === 1 ? "baseline" : "change",
    parent_version_id: versionNumber === 1 ? null : baseVersionId,
    restored_from_version_id: null,
    source_change_set_id: versionNumber === 1 ? null : crypto.randomUUID(),
    snapshot_schema_version: 1,
    snapshot_json: emptySnapshot(),
    snapshot_checksum: checksum,
    created_by: versionNumber === 1 ? null : ownerId,
    created_at: `2026-07-29T1${versionNumber}:00:00.000Z`,
    ...overrides,
  };
}

function emptySnapshot(): Json {
  return {
    schema_version: 1,
    object_definitions: [],
    field_definitions: [],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [],
    preorder_experiences: [],
    preorder_experience_locations: [],
  };
}

function filesRecursively(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesRecursively(path) : [path];
  });
}

describe("read-only configuration Changes interface", () => {
  it("groups open proposals before every completed lifecycle status and sorts newest first", () => {
    const statuses: ChangeSet["status"][] = [
      "proposed",
      "validated",
      "applied",
      "rejected",
      "conflicted",
      "abandoned",
    ];
    const proposals = statuses.map((status, index) =>
      changeSet(status, {
        created_at: `2026-07-${String(20 + index).padStart(2, "0")}T12:00:00.000Z`,
      }),
    );
    const baseline = version(1);
    const html = renderToStaticMarkup(
      createElement(ConfigurationChangesOverview, {
        activeVersionId: baseline.id,
        businessSlug: "bedford-bakery",
        changeSets: proposals,
        versions: [baseline],
      }),
    );

    expect(html).toContain("Needs attention");
    expect(html).toContain("Completed");
    expect(html).toContain("Proposed — awaiting validation");
    expect(html).toContain("Validated — ready to apply");
    expect(html).toContain("Applied");
    expect(html).toContain("Rejected — incompatible");
    expect(html).toContain("Conflicted — configuration moved on");
    expect(html).toContain("Abandoned");
    expect(html.indexOf("validated proposal")).toBeLessThan(
      html.indexOf("proposed proposal"),
    );
    expect(html.indexOf("abandoned proposal")).toBeLessThan(
      html.indexOf("applied proposal"),
    );
    expect(html.indexOf("proposed proposal")).toBeLessThan(
      html.indexOf("abandoned proposal"),
    );
  });

  it("renders owner-safe validation, all semantic groups, values, and escaped output", () => {
    const proposal = changeSet("validated", {
      title: "<script>proposal title</script>",
      description: '<img src=x onerror="description()">',
    });
    const base = version(1);
    const html = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: null,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: proposal,
        preview: { state: "empty" },
        rollbackTarget: null,
      }),
    );

    expect(html).toContain("Validated successfully");
    expect(html).toContain("existing_records_hidden");
    expect(html).toContain("Some existing information will not appear");
    expect(html).toContain("Created (1)");
    expect(html).toContain("Updated (1)");
    expect(html).toContain("Restored (1)");
    expect(html).toContain("Archived (1)");
    expect(html).toContain("Saturday, Sunday");
    expect(html).toContain("Published");
    expect(html).toContain("Retired");
    expect(html).toContain("&lt;script&gt;proposal title&lt;/script&gt;");
    expect(html).toContain(
      "&lt;img src=x onerror=&quot;description()&quot;&gt;",
    );
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("presents invalid and not-run validation results without internal diagnostics", () => {
    const invalid: ConfigurationValidationResult = {
      ...validResult,
      outcome: "invalid",
      errors: [
        {
          code: "field_value_incompatible",
          message: "Existing information is not compatible with this field.",
        },
      ],
    };
    const rejected = changeSet("rejected", {
      validation_result_json: invalid as unknown as Json,
      validated_at: now,
    });
    const base = version(1);
    const rejectedHtml = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: null,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: rejected,
        preview: { state: "closed" },
        rollbackTarget: null,
      }),
    );
    const proposedHtml = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: null,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: changeSet("proposed"),
        preview: { state: "stale" },
        rollbackTarget: null,
      }),
    );

    expect(rejectedHtml).toContain(
      "Rejected because current operational data is incompatible",
    );
    expect(rejectedHtml).toContain("field_value_incompatible");
    expect(rejectedHtml).not.toMatch(
      /postgres|public\.|select \*|stack trace/i,
    );
    expect(proposedHtml).toContain("Validation has not run");
    expect(proposedHtml).toContain(
      "Preview unavailable — the active configuration has moved on",
    );
  });

  it("offers stable-key authenticated preview links only for available open proposals", () => {
    const proposal = changeSet("proposed");
    const base = version(1);
    const page: Tables<"pages"> = {
      id: crypto.randomUUID(),
      business_id: businessId,
      key: "public_preorder",
      title: "Customer preorder",
      slug: "candidate-slug-must-not-route",
      audience: "public",
      layout_json: { blocks: [] },
      status: "published",
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    const available = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: null,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: proposal,
        preview: { state: "available", pages: [page] },
        rollbackTarget: null,
      }),
    );
    const closed = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: version(2),
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: changeSet("applied"),
        preview: { state: "closed" },
        rollbackTarget: null,
      }),
    );

    expect(available).toContain("Public Page");
    expect(available).toContain(
      `/changes/${proposal.id}/preview/public_preorder`,
    );
    expect(available).not.toContain("candidate-slug-must-not-route");
    expect(closed).not.toContain("/preview/");
    expect(closed).toContain(
      "Preview is available only while a proposal is proposed or validated.",
    );
  });

  it("shows the forward version chain, rollback provenance, baseline explanation, and snapshot counts", () => {
    const v1 = version(1);
    const source = changeSet("applied", {
      title: "Restore weekend collection",
    });
    const v2 = version(2, { parent_version_id: v1.id });
    const v3 = version(3, {
      parent_version_id: v2.id,
      kind: "rollback",
      restored_from_version_id: v1.id,
      source_change_set_id: source.id,
    });
    const overview = renderToStaticMarkup(
      createElement(ConfigurationChangesOverview, {
        activeVersionId: v3.id,
        businessSlug: "bedford-bakery",
        changeSets: [],
        versions: [v3, v2, v1],
      }),
    );
    const baseline = renderToStaticMarkup(
      createElement(ConfigurationVersionDetail, {
        active: false,
        businessSlug: "bedford-bakery",
        diff: null,
        parent: null,
        restoredFrom: null,
        snapshotCounts: summarizeConfigurationSnapshot(v1.snapshot_json),
        sourceChangeSet: null,
        sourceUnavailable: false,
        version: v1,
      }),
    );
    const rollback = renderToStaticMarkup(
      createElement(ConfigurationVersionDetail, {
        active: true,
        businessSlug: "bedford-bakery",
        diff,
        parent: v2,
        restoredFrom: v1,
        snapshotCounts: summarizeConfigurationSnapshot(v3.snapshot_json),
        sourceChangeSet: source,
        sourceUnavailable: false,
        version: v3,
      }),
    );

    expect(overview.indexOf("Version 3")).toBeLessThan(
      overview.indexOf("Version 2"),
    );
    expect(overview.indexOf("Version 2")).toBeLessThan(
      overview.indexOf("Version 1"),
    );
    expect(overview).toContain("Rollback restoring Version 1");
    expect(baseline).toContain(
      "Empty configuration created with the Business.",
    );
    expect(baseline).toContain("0 active");
    expect(rollback).toContain("History continued forward from its parent.");
    expect(rollback).toContain("Restore weekend collection");
    expect(rollback).not.toMatch(/delete|rewind/i);
  });

  it("keeps shell visibility and all routes at the authenticated Owner/Admin boundary", () => {
    expect(hasCapability("owner", "manage_configuration")).toBe(true);
    expect(hasCapability("admin", "manage_configuration")).toBe(true);
    expect(hasCapability("staff", "manage_configuration")).toBe(false);

    const layout = readFileSync(
      join(process.cwd(), "src/app/app/[businessSlug]/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain('"manage_configuration"');
    expect(layout).toContain(">Changes</Link>");

    const routeRoot = join(process.cwd(), "src/app/app/[businessSlug]/changes");
    for (const route of filesRecursively(routeRoot).filter(
      (path) => path.endsWith("page.tsx") && !path.includes("/preview/"),
    )) {
      const source = readFileSync(route, "utf8");
      expect(source).toContain('dynamic = "force-dynamic"');
      expect(source).toContain('fetchCache = "force-no-store"');
      expect(source).toContain("createServerClient");
      expect(source).toContain("resolveTenant");
      expect(source).toContain('"manage_configuration"');
      expect(source).toContain("notFound()");
      expect(source).not.toContain("createAdminClient");
      expect(source).not.toContain("service_role");
      expect(source).not.toContain("searchParams");
      expect(source).not.toContain("FormData");
      expect(source).not.toContain("candidate_snapshot_json");
    }
    expect(
      isControlledConfigurationReadError(
        z.uuid().safeParse("malformed-id").error,
      ),
    ).toBe(true);
  });

  it("contains no lifecycle/configuration mutations in Phase 5A sources", () => {
    const routeRoot = join(process.cwd(), "src/app/app/[businessSlug]/changes");
    const sources = [
      ...filesRecursively(routeRoot).filter(
        (path) => !path.includes("/preview/"),
      ),
      join(process.cwd(), "src/components/configuration-history-ui.tsx"),
    ].map((path) => readFileSync(path, "utf8"));
    const forbidden = [
      ".proposeChangeSet(",
      ".prepareRollback(",
      ".validateChangeSet(",
      ".applyChangeSet(",
      ".abandonChangeSet(",
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      '"use server"',
      "server action",
      "createAdminClient",
      "service_role",
    ];

    for (const source of sources) {
      for (const token of forbidden) {
        expect(source).not.toContain(token);
      }
    }
    expect(sources.join("\n").match(/\.loadPreview\(/g)).toHaveLength(1);
  });
});
