import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  decodePageAsset: vi.fn(),
  hasCapability: vi.fn(),
  resolveTenant: vi.fn(),
}));

vi.mock("../src/auth/capabilities", () => ({
  hasCapability: mocks.hasCapability,
}));
vi.mock("../src/auth/authorization", () => ({
  resolveTenant: mocks.resolveTenant,
}));
vi.mock("../src/db/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("../src/db/supabase/server", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("../src/runtime/media/page-assets", () => ({
  PAGE_ASSET_BUCKET: "page-assets",
  PAGE_ASSET_MAX_BYTES: 3 * 1024 * 1024,
  PAGE_ASSET_MAX_PIXELS: 20_000_000,
  assetErrorMessage: (code: string) => code,
  decodePageAsset: mocks.decodePageAsset,
}));

import { GET } from "../src/app/api/app/[businessSlug]/pages/assets/[assetId]/route";
import { POST } from "../src/app/api/app/[businessSlug]/pages/assets/route";

const businessId = "00000000-0000-4000-8000-000000000001";
const assetId = "00000000-0000-4000-8000-000000000002";

function tenant(role: "owner" | "admin" | "staff") {
  return {
    business: { id: businessId },
    membership: { role },
    user: { id: "00000000-0000-4000-8000-000000000003" },
  };
}

function postRequest(file?: File, contentLength = "100") {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request("http://localhost/api/app/bakery/pages/assets", {
    body: form,
    headers: { "content-length": contentLength },
    method: "POST",
  });
}

describe("private Page media route boundary", () => {
  const upload = vi.fn();
  const remove = vi.fn();
  const insert = vi.fn();
  const storage = { from: vi.fn(() => ({ remove, upload })) };
  const admin = { from: vi.fn(() => ({ insert })), storage };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn(),
      storage: { from: vi.fn() },
    });
    mocks.hasCapability.mockReturnValue(true);
    mocks.resolveTenant.mockResolvedValue(tenant("owner"));
    mocks.decodePageAsset.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      height: 24,
      mimeType: "image/png",
      width: 32,
    });
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    insert.mockResolvedValue({ error: null });
  });

  it("rejects anonymous and Staff upload requests before buffering multipart data", async () => {
    mocks.resolveTenant.mockRejectedValueOnce(new Error("signed out"));
    const anonymous = await POST(postRequest(), {
      params: Promise.resolve({ businessSlug: "bakery" }),
    });
    expect(anonymous.status).toBe(401);
    expect(mocks.decodePageAsset).not.toHaveBeenCalled();

    mocks.resolveTenant.mockResolvedValueOnce(tenant("staff"));
    mocks.hasCapability.mockReturnValueOnce(false);
    const staff = await POST(postRequest(), {
      params: Promise.resolve({ businessSlug: "bakery" }),
    });
    expect(staff.status).toBe(403);
    expect(mocks.decodePageAsset).not.toHaveBeenCalled();
  });

  it("checks the request bound and uses the decoded registry write lane", async () => {
    const oversized = await POST(
      postRequest(
        new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
        String(3 * 1024 * 1024 + 64 * 1024 + 1),
      ),
      { params: Promise.resolve({ businessSlug: "bakery" }) },
    );
    expect(oversized.status).toBe(413);
    expect(mocks.decodePageAsset).not.toHaveBeenCalled();

    const response = await POST(
      postRequest(
        new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
      ),
      { params: Promise.resolve({ businessSlug: "bakery" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.decodePageAsset).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png" }),
    );
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${businessId}/[0-9a-f-]+\\.png$`)),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "image/png", upsert: false }),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: businessId,
        byte_size: 3,
        created_by: tenant("owner").user.id,
        mime_type: "image/png",
        width: 32,
        height: 24,
      }),
    );
  });

  it("accepts a valid multipart upload without trusting a client length header", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
    );
    const response = await POST(
      new Request("http://localhost/api/app/bakery/pages/assets", {
        body: form,
        method: "POST",
      }),
      { params: Promise.resolve({ businessSlug: "bakery" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.decodePageAsset).toHaveBeenCalledTimes(1);
  });

  it("bounds a streaming multipart body when Content-Length is unavailable", async () => {
    const oversizedBody = new Uint8Array(3 * 1024 * 1024 + 64 * 1024 + 1);
    const response = await POST(
      new Request("http://localhost/api/app/bakery/pages/assets", {
        body: oversizedBody,
        headers: { "content-type": "application/octet-stream" },
        method: "POST",
      }),
      { params: Promise.resolve({ businessSlug: "bakery" }) },
    );

    expect(response.status).toBe(413);
    expect(mocks.decodePageAsset).not.toHaveBeenCalled();
  });

  it("removes an object when registry registration fails", async () => {
    insert.mockResolvedValueOnce({ error: { message: "registry down" } });
    const response = await POST(
      postRequest(
        new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
      ),
      { params: Promise.resolve({ businessSlug: "bakery" }) },
    );
    expect(response.status).toBe(500);
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(new RegExp(`^${businessId}/[0-9a-f-]+\\.png$`)),
    ]);
  });

  it("does not register an object when Storage rejects the upload", async () => {
    upload.mockResolvedValueOnce({ error: { message: "Storage unavailable" } });
    const response = await POST(
      postRequest(
        new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
      ),
      { params: Promise.resolve({ businessSlug: "bakery" }) },
    );

    expect(response.status).toBe(500);
    expect(insert).not.toHaveBeenCalled();
  });

  it("defensively checks the encoded result before writing metadata", async () => {
    mocks.decodePageAsset.mockResolvedValueOnce({
      bytes: new Uint8Array(3 * 1024 * 1024 + 1),
      height: 24,
      mimeType: "image/png",
      width: 32,
    });
    const oversized = await POST(
      postRequest(
        new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
      ),
      { params: Promise.resolve({ businessSlug: "bakery" }) },
    );
    expect(oversized.status).toBe(413);
    expect(upload).not.toHaveBeenCalled();

    mocks.decodePageAsset.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      height: 20_001,
      mimeType: "image/png",
      width: 20_001,
    });
    const tooManyPixels = await POST(
      postRequest(
        new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
      ),
      { params: Promise.resolve({ businessSlug: "bakery" }) },
    );
    expect(tooManyPixels.status).toBe(413);
    expect(upload).not.toHaveBeenCalled();
  });

  it("serves assets through the member-scoped registry and hides another tenant", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        byte_size: 3,
        mime_type: "image/png",
        storage_key: `${businessId}/${assetId}.png`,
      },
      error: null,
    });
    const eq = vi.fn();
    const query = { eq, maybeSingle, select: vi.fn() };
    query.select.mockReturnValue(query);
    eq.mockReturnValue(query);
    const download = vi.fn().mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      error: null,
    });
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ download })) },
    });

    const served = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ assetId, businessSlug: "bakery" }),
    });
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    expect(download).toHaveBeenCalledWith(`${businessId}/${assetId}.png`);

    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const hidden = await GET(new Request("http://localhost"), {
      params: Promise.resolve({
        assetId: "00000000-0000-4000-8000-000000000099",
        businessSlug: "bakery",
      }),
    });
    expect(hidden.status).toBe(404);
    expect(download).toHaveBeenCalledTimes(1);

    mocks.resolveTenant.mockResolvedValueOnce(tenant("staff"));
    const staffServed = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ assetId, businessSlug: "bakery" }),
    });
    expect(staffServed.status).toBe(200);

    mocks.resolveTenant.mockRejectedValueOnce(new Error("not a member"));
    const wrongTenant = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ assetId, businessSlug: "other-business" }),
    });
    expect(wrongTenant.status).toBe(404);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("returns a generic unavailable response to anonymous asset reads", async () => {
    mocks.resolveTenant.mockRejectedValueOnce(new Error("signed out"));
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ assetId, businessSlug: "bakery" }),
    });
    expect(response.status).toBe(404);
  });

  it("rejects malformed asset identifiers before querying the registry", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({
        assetId: "not-a-uuid",
        businessSlug: "bakery",
      }),
    });

    expect(response.status).toBe(404);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
