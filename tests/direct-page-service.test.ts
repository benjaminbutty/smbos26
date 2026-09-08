import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const state = {
    activeHead: null as unknown,
    committedVersion: null as unknown,
    baseVersion: null as unknown,
    rpc: vi.fn(),
    versionIds: [] as string[],
  };

  class FakeConfigurationChangeService {
    async getActiveHead(): Promise<unknown> {
      return state.activeHead;
    }

    async getVersion(versionId: string): Promise<unknown> {
      state.versionIds.push(versionId);
      return versionId === baseVersionId
        ? state.baseVersion
        : state.committedVersion;
    }
  }

  class FakeConfigurationChangeServiceError extends Error {
    readonly code = "fake_configuration_error";
  }

  return {
    FakeConfigurationChangeService,
    FakeConfigurationChangeServiceError,
    state,
  };
});

vi.mock("../src/core/configuration/service", () => ({
  ConfigurationChangeService: mocks.FakeConfigurationChangeService,
  ConfigurationChangeServiceError: mocks.FakeConfigurationChangeServiceError,
}));

vi.mock("../src/core/configuration/direct-pages/composer", () => ({
  DirectPageComposerError: class extends Error {},
  composeDirectPageAction: vi.fn(() => ({
    actionKind: "save_page_layout",
    description: "Save the Page",
    operations: [],
    pageKey: "workspace",
    pageSlug: "workspace",
    title: "Save the Page",
  })),
}));

import { applyDirectPageAction } from "../src/core/configuration/direct-pages/service";

const businessId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const baseVersionId = "00000000-0000-4000-8000-000000000003";
const committedVersionId = "00000000-0000-4000-8000-000000000004";

const baseSnapshot = {
  schema_version: 1 as const,
  object_definitions: [],
  field_definitions: [],
  relationship_definitions: [],
  views: [],
  forms: [],
  pages: [],
  preorder_experiences: [],
  preorder_experience_locations: [],
};

const committedSnapshot = {
  ...baseSnapshot,
  pages: [
    {
      id: "00000000-0000-4000-8000-000000000005",
      key: "workspace",
      title: "Committed Page",
      slug: "workspace",
      audience: "internal" as const,
      layout_json: { blocks: [] },
      status: "draft" as const,
      is_active: true,
    },
  ],
};

describe("direct Page acknowledgement", () => {
  it("returns the immutable Version committed by the action", async () => {
    mocks.state.activeHead = {
      active_version_id: baseVersionId,
      business_id: businessId,
      head_revision: 7,
    };
    mocks.state.baseVersion = {
      business_id: businessId,
      id: baseVersionId,
      snapshot_json: baseSnapshot,
      snapshot_checksum: "a".repeat(64),
      snapshot_schema_version: 1,
    };
    mocks.state.committedVersion = {
      business_id: businessId,
      id: committedVersionId,
      snapshot_json: committedSnapshot,
      snapshot_checksum: "b".repeat(64),
      snapshot_schema_version: 1,
    };
    mocks.state.versionIds.length = 0;
    mocks.state.rpc.mockResolvedValueOnce({
      data: {
        applied_version_id: committedVersionId,
        base_head_revision: 7,
        business_id: businessId,
        requested_by: actorId,
        status: "applied",
      },
      error: null,
    });

    const result = await applyDirectPageAction(
      { rpc: mocks.state.rpc } as never,
      { actorId, businessId },
      {
        currentness: {
          expectedBaseVersionId: baseVersionId,
          expectedHeadRevision: 7,
        },
        intent: {
          action: "save_page_layout",
          layout: { blocks: [] },
          pageKey: "workspace",
        },
      },
    );

    expect(mocks.state.versionIds).toEqual([baseVersionId, committedVersionId]);
    expect(result.snapshot.pages[0]?.title).toBe("Committed Page");
    expect(result.currentness).toEqual({
      expectedBaseVersionId: committedVersionId,
      expectedHeadRevision: 8,
    });
  });
});
