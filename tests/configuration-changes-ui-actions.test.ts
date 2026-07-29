import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AbandonConfigurationConfirmation,
  ApplyConfigurationConfirmation,
  ConfigurationActionNotice,
  PrepareRollbackConfirmation,
  ValidateConfigurationConfirmation,
} from "../src/components/configuration-action-ui";
import {
  ConfigurationChangeDetail,
  ConfigurationVersionDetail,
} from "../src/components/configuration-history-ui";
import { configurationActionNoticeSchema } from "../src/core/configuration/action-notices";
import type {
  ConfigurationValidationResult,
  SemanticDiff,
} from "../src/core/configuration/schemas";
import type { Json, Tables } from "../src/db/supabase/database.types";

vi.mock("server-only", () => ({}));

type ChangeSet = Tables<"configuration_change_sets">;
type Version = Tables<"configuration_versions">;

const businessId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const baseVersionId = "10000000-0000-4000-8000-000000000010";
const checksum = "a".repeat(64);
const now = "2026-07-29T12:00:00.000Z";

const diff: SemanticDiff = {
  schema_version: 1,
  counts: { created: 1, updated: 1, restored: 0, archived: 0 },
  changes: [
    {
      entity_type: "field",
      entity_key: "order.phone",
      change_type: "updated",
      label: "Phone",
      properties: [{ property: "required", before: true, after: false }],
    },
    {
      entity_type: "field",
      entity_key: "order.occasion",
      change_type: "created",
      label: "Occasion",
      properties: [],
    },
  ],
};

const validation: ConfigurationValidationResult = {
  schema_version: 1,
  outcome: "valid",
  base_version_id: baseVersionId,
  base_head_revision: 1,
  candidate_checksum: checksum,
  errors: [],
  warnings: [],
};

function snapshot(): Json {
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
    source_change_set_id: null,
    snapshot_schema_version: 1,
    snapshot_json: snapshot(),
    snapshot_checksum: checksum,
    created_by: versionNumber === 1 ? null : actorId,
    created_at: now,
    ...overrides,
  };
}

function changeSet(
  status: ChangeSet["status"],
  overrides: Partial<ChangeSet> = {},
): ChangeSet {
  const hasValidation = ["validated", "applied", "conflicted"].includes(status);
  const closed = ["rejected", "conflicted", "abandoned"].includes(status);
  return {
    id: "10000000-0000-4000-8000-000000000020",
    business_id: businessId,
    kind: "change",
    status,
    title: "Make phone optional",
    description: "Keep existing Orders unchanged.",
    base_version_id: baseVersionId,
    base_head_revision: 1,
    rollback_target_version_id: null,
    requested_by: actorId,
    operations_schema_version: 1,
    operations_json: [],
    id_allocations_json: {},
    display_context_json: { schema_version: 1, locations: {} },
    candidate_snapshot_json: snapshot(),
    candidate_checksum: checksum,
    semantic_diff_json: diff as unknown as Json,
    validation_result_json: hasValidation
      ? (validation as unknown as Json)
      : null,
    validated_by: hasValidation ? actorId : null,
    validated_at: hasValidation ? now : null,
    applied_version_id: null,
    applied_by: status === "applied" ? actorId : null,
    applied_at: status === "applied" ? now : null,
    closed_by: closed ? actorId : null,
    closed_at: closed ? now : null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function filesRecursively(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? filesRecursively(path) : [path];
  });
}

const noOpAction = async (): Promise<void> => {};

describe("Milestone 5 Phase 5B configuration lifecycle controls", () => {
  it("renders the exact proposal and version action availability matrix", () => {
    const base = version(1);
    const resulting = version(2);
    const proposalHtml = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: null,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: changeSet("proposed"),
        preview: { state: "empty" },
        rollbackTarget: null,
      }),
    );
    const validatedHtml = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: null,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: changeSet("validated"),
        preview: { state: "empty" },
        rollbackTarget: null,
      }),
    );
    const appliedHtml = renderToStaticMarkup(
      createElement(ConfigurationChangeDetail, {
        appliedVersion: resulting,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: changeSet("applied", {
          applied_version_id: resulting.id,
        }),
        preview: { state: "closed" },
        rollbackTarget: null,
      }),
    );

    expect(proposalHtml).toContain("Validate proposal");
    expect(proposalHtml).toContain("Abandon proposal");
    expect(proposalHtml).not.toContain("Apply configuration");
    expect(validatedHtml).toContain("Apply configuration");
    expect(validatedHtml).not.toContain("Abandon proposal");
    expect(appliedHtml).toContain("View resulting Version 2");

    for (const status of ["rejected", "conflicted", "abandoned"] as const) {
      const html = renderToStaticMarkup(
        createElement(ConfigurationChangeDetail, {
          appliedVersion: null,
          baseVersion: base,
          businessSlug: "bedford-bakery",
          changeSet: changeSet(status),
          preview: { state: "closed" },
          rollbackTarget: null,
        }),
      );
      expect(html).toContain("No configuration action is available");
      expect(html).not.toContain("/validate");
      expect(html).not.toContain("/apply");
      expect(html).not.toContain("/abandon");
    }

    const activeVersionHtml = renderToStaticMarkup(
      createElement(ConfigurationVersionDetail, {
        active: true,
        businessSlug: "bedford-bakery",
        diff: null,
        parent: base,
        restoredFrom: null,
        snapshotCounts: [],
        sourceChangeSet: null,
        sourceUnavailable: false,
        version: resulting,
      }),
    );
    const historicalVersionHtml = renderToStaticMarkup(
      createElement(ConfigurationVersionDetail, {
        active: false,
        businessSlug: "bedford-bakery",
        diff: null,
        parent: null,
        restoredFrom: null,
        snapshotCounts: [],
        sourceChangeSet: null,
        sourceUnavailable: false,
        version: base,
      }),
    );
    expect(activeVersionHtml).not.toContain("Prepare rollback");
    expect(historicalVersionHtml).toContain("Prepare rollback");
    expect(historicalVersionHtml).toContain(`/versions/${base.id}/rollback`);
  });

  it("renders deliberate, explanatory and accessible confirmation screens", () => {
    const base = version(1);
    const proposed = changeSet("proposed");
    const validated = changeSet("validated");
    const validateHtml = renderToStaticMarkup(
      createElement(ValidateConfigurationConfirmation, {
        action: noOpAction,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: proposed,
        previewPages: [],
      }),
    );
    const applyHtml = renderToStaticMarkup(
      createElement(ApplyConfigurationConfirmation, {
        action: noOpAction,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: validated,
      }),
    );
    const abandonHtml = renderToStaticMarkup(
      createElement(AbandonConfigurationConfirmation, {
        action: noOpAction,
        baseVersion: base,
        businessSlug: "bedford-bakery",
        changeSet: proposed,
      }),
    );
    const rollbackHtml = renderToStaticMarkup(
      createElement(PrepareRollbackConfirmation, {
        action: noOpAction,
        activeVersion: version(3),
        businessSlug: "bedford-bakery",
        notice: null,
        targetVersion: base,
      }),
    );

    expect(validateHtml).toContain(
      "Validation does not make configuration live",
    );
    expect(validateHtml).toContain("Validation</dt><dd>Not run");
    expect(validateHtml).toContain(checksum.slice(0, 12));
    expect(applyHtml).toContain("one immutable version is created");
    expect(applyHtml).toContain("Operational Records are not rewritten");
    expect(applyHtml).toContain("Phone");
    expect(applyHtml).toContain("Occasion");
    expect(abandonHtml).toContain("Abandonment is final");
    expect(abandonHtml).toContain("Abandon proposal");
    expect(rollbackHtml).toContain("This creates a proposal only");
    expect(rollbackHtml).toContain("history does not rewind");
    expect(rollbackHtml).toContain(
      'value="Restore configuration from Version 1"',
    );
    expect(rollbackHtml).not.toContain('name="business');
    expect(rollbackHtml).not.toContain('name="actor');
    expect(rollbackHtml).not.toContain('name="candidate');
  });

  it("uses only bounded owner-safe notices and ignores arbitrary query text", () => {
    expect(configurationActionNoticeSchema.safeParse("applied").success).toBe(
      true,
    );
    expect(
      configurationActionNoticeSchema.safeParse(
        "SQLSTATE 23505 public.configuration_versions",
      ).success,
    ).toBe(false);
    const html = renderToStaticMarkup(
      createElement(ConfigurationActionNotice, {
        notice: "application_rejected",
      }),
    );
    expect(html).toContain("Nothing from this candidate became live");
    expect(html).not.toMatch(/sqlstate|public\.|stack/i);
  });

  it("keeps lifecycle mutation calls in one server-only action boundary", () => {
    const root = join(process.cwd(), "src/app/app/[businessSlug]/changes");
    const actionPath = join(root, "actions.ts");
    const actionSource = readFileSync(actionPath, "utf8");
    const presentationSources = [
      join(process.cwd(), "src/components/configuration-action-ui.tsx"),
      join(process.cwd(), "src/components/configuration-history-ui.tsx"),
      ...filesRecursively(root).filter((path) => path.endsWith("page.tsx")),
    ].map((path) => readFileSync(path, "utf8"));

    expect(actionSource.startsWith('"use server";')).toBe(true);
    expect(actionSource).toContain(".validateChangeSet(");
    expect(actionSource).toContain(".applyChangeSet(");
    expect(actionSource).toContain(".abandonChangeSet(");
    expect(actionSource).toContain(".prepareRollback(");
    expect(actionSource).toContain("resolveTenant");
    expect(actionSource).toContain('"manage_configuration"');
    expect(actionSource).toContain("tenant.business.id");
    expect(actionSource).toContain("tenant.user.id");
    expect(actionSource).not.toContain("createAdminClient");
    expect(actionSource).not.toContain("service_role");
    expect(actionSource).not.toContain(".from(");
    expect(actionSource).not.toContain(".rpc(");

    for (const forbiddenField of [
      "businessId",
      "actorId",
      "candidate",
      "operations",
      "checksum",
      "allocations",
      "semantic",
      "validation",
      "status",
      "appliedVersion",
    ]) {
      expect(actionSource).not.toContain(`formData.get("${forbiddenField}")`);
    }

    for (const source of presentationSources) {
      expect(source).not.toContain(".validateChangeSet(");
      expect(source).not.toContain(".applyChangeSet(");
      expect(source).not.toContain(".abandonChangeSet(");
      expect(source).not.toContain(".prepareRollback(");
      expect(source).not.toContain(".insert(");
      expect(source).not.toContain(".update(");
      expect(source).not.toContain(".delete(");
      expect(source).not.toContain(".rpc(");
    }
  });

  it("makes every confirmation GET dynamic, no-store, authenticated, and read-only", () => {
    const root = join(process.cwd(), "src/app/app/[businessSlug]/changes");
    const confirmationRoutes = filesRecursively(root).filter(
      (path) =>
        path.endsWith("page.tsx") &&
        /\/(validate|apply|abandon|rollback)\/page\.tsx$/.test(path),
    );
    expect(confirmationRoutes).toHaveLength(4);

    for (const route of confirmationRoutes) {
      const source = readFileSync(route, "utf8");
      expect(source).toContain('dynamic = "force-dynamic"');
      expect(source).toContain('fetchCache = "force-no-store"');
      expect(source).toContain("createServerClient");
      expect(source).toContain("resolveTenant");
      expect(source).toContain('"manage_configuration"');
      expect(source).toContain("notFound()");
      expect(source).not.toContain(".validateChangeSet(");
      expect(source).not.toContain(".applyChangeSet(");
      expect(source).not.toContain(".abandonChangeSet(");
      expect(source).not.toContain(".prepareRollback(");
    }
  });

  it("announces pending state and disables duplicate browser submission", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/pending-submit-button.tsx"),
      "utf8",
    );
    expect(source).toContain('"use client"');
    expect(source).toContain("useFormStatus");
    expect(source).toContain("disabled={pending}");
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
  });
});
