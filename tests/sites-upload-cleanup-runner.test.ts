import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupSitePublicUploadGrant: vi.fn(),
}));

vi.mock("../src/core/sites/upload-cleanup", () => ({
  cleanupSitePublicUploadGrant: mocks.cleanupSitePublicUploadGrant,
}));

import {
  parseUploadCleanupArgs,
  runSitePublicUploadCleanup,
} from "../scripts/cleanup-site-public-upload-grants";

const id = (suffix: number): string =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function fakeClient(data: unknown) {
  const rpc = vi.fn(
    async (functionName: string, parameters: Record<string, unknown>) => {
      void functionName;
      void parameters;
      return { data, error: null };
    },
  );
  return { client: { rpc }, rpc };
}

describe("Sites upload cleanup runner", () => {
  it("parses a bounded operator batch", () => {
    expect(parseUploadCleanupArgs([])).toEqual({ limit: 100 });
    expect(parseUploadCleanupArgs(["--limit", "7"])).toEqual({ limit: 7 });
    expect(() => parseUploadCleanupArgs(["--limit", "101"])).toThrow(
      "between 1 and 100",
    );
    expect(() =>
      parseUploadCleanupArgs(["--storage-prefix", "unsafe"]),
    ).toThrow("Unknown maintenance argument");
  });

  it("selects only database candidates and invokes the shared cleanup service", async () => {
    mocks.cleanupSitePublicUploadGrant.mockReset();
    mocks.cleanupSitePublicUploadGrant.mockResolvedValue(undefined);
    const first = id(1);
    const second = id(2);
    const fake = fakeClient([
      { id: first, cleanup_verified_prefix: "attacker/should-be-ignored" },
      { id: second, cleanup_verified_prefix: "another/untrusted/value" },
    ]);

    const result = await runSitePublicUploadCleanup({
      client: fake.client,
      limit: 2,
      cleanupGrant: mocks.cleanupSitePublicUploadGrant,
    });

    expect(result).toEqual({
      selected: 2,
      cleaned: 2,
      failed: 0,
      failures: [],
    });
    expect(fake.rpc).toHaveBeenCalledWith(
      "list_site_public_upload_cleanup_candidates_v1",
      { requested_limit: 2 },
    );
    expect(mocks.cleanupSitePublicUploadGrant.mock.calls).toEqual([
      [fake.client, first],
      [fake.client, second],
    ]);
    expect(
      fake.rpc.mock.calls.some(([functionName]) =>
        String(functionName).includes("release"),
      ),
    ).toBe(false);
  });

  it("continues after a failed grant without releasing its reservation", async () => {
    mocks.cleanupSitePublicUploadGrant.mockReset();
    mocks.cleanupSitePublicUploadGrant
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(undefined);
    const fake = fakeClient([{ id: id(3) }, { id: id(4) }]);

    const result = await runSitePublicUploadCleanup({
      client: fake.client,
      limit: 2,
      cleanupGrant: mocks.cleanupSitePublicUploadGrant,
    });

    expect(result).toEqual({
      selected: 2,
      cleaned: 1,
      failed: 1,
      failures: [{ grantId: id(3), message: "provider unavailable" }],
    });
    expect(mocks.cleanupSitePublicUploadGrant).toHaveBeenCalledTimes(2);
    expect(
      fake.rpc.mock.calls.some(([functionName]) =>
        String(functionName).includes("release"),
      ),
    ).toBe(false);
  });

  it("fails closed on an invalid candidate identity before cleanup", async () => {
    mocks.cleanupSitePublicUploadGrant.mockReset();
    const fake = fakeClient([
      { id: id(5) },
      { id: "not-a-grant-id", cleanup_verified_prefix: "unsafe" },
    ]);

    await expect(
      runSitePublicUploadCleanup({
        client: fake.client,
        limit: 2,
        cleanupGrant: mocks.cleanupSitePublicUploadGrant,
      }),
    ).rejects.toThrow("invalid grant id");
    expect(mocks.cleanupSitePublicUploadGrant).not.toHaveBeenCalled();
  });
});
