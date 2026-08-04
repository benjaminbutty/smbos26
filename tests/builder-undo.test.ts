import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BuilderUndoUi } from "../src/components/builder-ui";
import {
  BUILDER_INITIAL_STATE,
  BUILDER_UI_CONTEXT_REQUIRED_MESSAGE,
  builderUiStateSchema,
} from "../src/components/builder-ui-state";
import {
  contextRequiredBuilderState,
  createBuilderAction,
  isUncontextualizedUndoPhrase,
} from "../src/app/app/[businessSlug]/builder/action-service";
import {
  BuilderUndoError,
  deriveBuilderUndoContext,
  presentBuilderUndoContext,
} from "../src/core/configuration/builder-undo/service";
import type { Json, Tables } from "../src/db/supabase/database.types";

type Head = Tables<"business_configuration_heads">;
type Version = Tables<"configuration_versions">;
type ChangeSet = Tables<"configuration_change_sets">;

const businessId = "10000000-0000-4000-8000-000000000001";
const otherBusinessId = "10000000-0000-4000-8000-000000000099";
const ownerId = "10000000-0000-4000-8000-000000000002";
const versionIds = [
  "10000000-0000-4000-8000-000000000010",
  "10000000-0000-4000-8000-000000000011",
  "10000000-0000-4000-8000-000000000012",
];
const proposalId = "10000000-0000-4000-8000-000000000020";

const snapshot = {} as Json;

function head(activeVersionId: string, revision: number): Head {
  return {
    business_id: businessId,
    active_version_id: activeVersionId,
    head_revision: revision,
    updated_at: "2026-08-04T09:00:00.000Z",
  };
}

function version(
  versionNumber: number,
  overrides: Partial<Version> = {},
): Version {
  return {
    id: versionIds[versionNumber - 1] ?? versionIds[0]!,
    business_id: businessId,
    version_number: versionNumber,
    kind: versionNumber === 1 ? "baseline" : "change",
    parent_version_id:
      versionNumber === 1 ? null : versionIds[versionNumber - 2]!,
    restored_from_version_id: null,
    source_change_set_id: versionNumber === 1 ? null : proposalId,
    snapshot_checksum: "a".repeat(64),
    snapshot_json: snapshot,
    snapshot_schema_version: 1,
    created_by: versionNumber === 1 ? null : ownerId,
    created_at: "2026-08-04T09:00:00.000Z",
    ...overrides,
  };
}

function sourceChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: proposalId,
    business_id: businessId,
    kind: "change",
    status: "applied",
    title: "Remove Sunday collection",
    description: null,
    base_version_id: versionIds[1]!,
    base_head_revision: 2,
    rollback_target_version_id: null,
    requested_by: ownerId,
    operations_schema_version: 1,
    operations_json: [],
    id_allocations_json: {},
    display_context_json: {},
    candidate_snapshot_json: {},
    candidate_checksum: "a".repeat(64),
    semantic_diff_json: {},
    validation_result_json: {},
    applied_version_id: versionIds[2]!,
    applied_by: ownerId,
    applied_at: "2026-08-04T09:00:00.000Z",
    validated_by: ownerId,
    validated_at: "2026-08-04T09:00:00.000Z",
    closed_by: null,
    closed_at: null,
    created_at: "2026-08-04T09:00:00.000Z",
    updated_at: "2026-08-04T09:00:00.000Z",
    ...overrides,
  };
}

function eligibleContext() {
  const source = version(3);
  return deriveBuilderUndoContext({
    activeHead: head(source.id, source.version_number),
    businessId,
    parentVersion: version(2),
    sourceChangeSet: sourceChangeSet(),
    sourceVersion: source,
  });
}

describe("Milestone 9 Phase 9B deterministic Builder undo", () => {
  it("derives the immediate parent from the active ordinary change", () => {
    const context = eligibleContext();

    expect(context).toMatchObject({
      state: "eligible",
      sourceVersion: { id: versionIds[2], version_number: 3 },
      parentVersion: { id: versionIds[1], version_number: 2 },
      sourceProposalTitle: "Remove Sunday collection",
    });
    expect(presentBuilderUndoContext(context)).toEqual({
      state: "eligible",
      source_proposal_title: "Remove Sunday collection",
      source_version_number: 3,
      previous_version_number: 2,
    });
  });

  it("fails closed for baseline, active rollback, missing parent and history", () => {
    const baseline = version(1);
    expect(
      deriveBuilderUndoContext({
        activeHead: head(baseline.id, 1),
        businessId,
        parentVersion: null,
        sourceChangeSet: null,
        sourceVersion: baseline,
      }).state,
    ).toBe("baseline");

    const activeRollback = version(3, {
      kind: "rollback",
      parent_version_id: versionIds[1]!,
      source_change_set_id: proposalId,
    });
    expect(
      deriveBuilderUndoContext({
        activeHead: head(activeRollback.id, 3),
        businessId,
        parentVersion: null,
        sourceChangeSet: null,
        sourceVersion: activeRollback,
      }).state,
    ).toBe("active_rollback");

    const noParent = version(3, { parent_version_id: null });
    expect(
      deriveBuilderUndoContext({
        activeHead: head(noParent.id, 3),
        businessId,
        parentVersion: null,
        sourceChangeSet: null,
        sourceVersion: noParent,
      }).state,
    ).toBe("baseline");

    const historical = version(2);
    expect(
      deriveBuilderUndoContext({
        activeHead: head(versionIds[2]!, 3),
        businessId,
        parentVersion: null,
        sourceChangeSet: null,
        sourceVersion: historical,
      }).state,
    ).toBe("superseded");
  });

  it("rejects cross-Business, inconsistent-parent and provenance inputs", () => {
    expect(() =>
      deriveBuilderUndoContext({
        activeHead: head(versionIds[2]!, 3),
        businessId,
        parentVersion: version(2),
        sourceChangeSet: sourceChangeSet(),
        sourceVersion: version(3, { business_id: otherBusinessId }),
      }),
    ).toThrowError(new BuilderUndoError("builder_undo_not_found"));

    expect(() =>
      deriveBuilderUndoContext({
        activeHead: head(versionIds[2]!, 3),
        businessId,
        parentVersion: version(3),
        sourceChangeSet: sourceChangeSet(),
        sourceVersion: version(3),
      }),
    ).toThrowError(new BuilderUndoError("builder_undo_invalid"));

    expect(() =>
      deriveBuilderUndoContext({
        activeHead: head(versionIds[2]!, 3),
        businessId,
        parentVersion: version(2),
        sourceChangeSet: sourceChangeSet({
          applied_version_id: versionIds[1]!,
        }),
        sourceVersion: version(3),
      }),
    ).toThrowError(new BuilderUndoError("builder_undo_invalid"));
  });

  it("accepts only the bounded no-context Undo that phrase", () => {
    expect(
      ["Undo that", "Undo that.", "undo that"].every(
        isUncontextualizedUndoPhrase,
      ),
    ).toBe(true);
    expect(isUncontextualizedUndoPhrase("Undo that change")).toBe(false);
    expect(isUncontextualizedUndoPhrase("Undo the phone change")).toBe(false);
    expect(contextRequiredBuilderState()).toEqual({
      state: "context_required",
      message: BUILDER_UI_CONTEXT_REQUIRED_MESSAGE,
    });
    expect(builderUiStateSchema.parse(contextRequiredBuilderState())).toEqual(
      contextRequiredBuilderState(),
    );
  });

  it("intercepts the no-context phrase before Builder orchestration", async () => {
    const run = vi.fn();
    const execute = createBuilderAction({
      createServerClient: vi.fn().mockResolvedValue({}),
      hasCapability: vi.fn().mockReturnValue(true),
      notFound: vi.fn(() => {
        throw new Error("not found");
      }),
      orchestrationService: { run },
      resolveTenant: vi.fn().mockResolvedValue({
        business: { id: businessId },
        membership: { role: "owner" },
        user: { id: ownerId },
      }),
    });
    const form = new FormData();
    form.set("ownerRequest", "undo that");

    await expect(
      execute("bedford-bakery-demo", BUILDER_INITIAL_STATE, form),
    ).resolves.toEqual(contextRequiredBuilderState());
    expect(run).not.toHaveBeenCalled();
  });

  it("renders contextual confirmation without browser-owned rollback fields", () => {
    const html = renderToStaticMarkup(
      createElement(BuilderUndoUi, {
        action: async () => {},
        businessSlug: "bedford-bakery-demo",
        context: presentBuilderUndoContext(eligibleContext()),
      }),
    );

    expect(html).toContain("Undo the latest setup change");
    expect(html).toContain("Version 3");
    expect(html).toContain("Version 2");
    expect(html).toContain("Remove Sunday collection");
    expect(html).toContain("Undo that.");
    expect(html).toContain("Prepare undo proposal");
    expect(html).toContain("Orders, Customers, Products and Locations");
    expect(html).toContain("Nothing changes until this rollback proposal");
    expect(html).not.toContain("targetVersionId");
    expect(html).not.toContain("parentVersionId");
    expect(html).not.toContain(businessId);
    expect(html).not.toContain(versionIds[1]!);
  });

  it("locks the new rollback signature and removes the weaker overload", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260804100000_milestone_9_phase_9b_atomic_rollback_currentness.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "drop function public.prepare_configuration_rollback(",
    );
    expect(migration).toContain("expected_active_source_version_id uuid");
    expect(migration).toContain("expected_head_revision bigint");
    expect(migration).toContain(
      "current_head.active_version_id is distinct from",
    );
    expect(migration).toContain(
      "current_head.head_revision is distinct from expected_head_revision",
    );
    expect(migration).toContain(
      "grant execute on function public.prepare_configuration_rollback(",
    );
  });
});
