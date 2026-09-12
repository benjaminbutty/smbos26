import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  callPublicRpc,
  submitPublicSiteForm,
  createAdminClient,
  trustedSiteUploadSubjectHash,
} = vi.hoisted(() => ({
  callPublicRpc: vi.fn(),
  submitPublicSiteForm: vi.fn(),
  createAdminClient: vi.fn(() => ({})),
  trustedSiteUploadSubjectHash: vi.fn(async () => "a".repeat(64)),
}));

vi.mock("../src/core/public/rpc", () => ({ callPublicRpc }));
vi.mock("../src/core/public/site-form", () => ({ submitPublicSiteForm }));
vi.mock("../src/db/supabase/admin", () => ({ createAdminClient }));
vi.mock("../src/core/sites/upload-rate-limit", async () => {
  const actual = await vi.importActual<
    typeof import("../src/core/sites/upload-rate-limit")
  >("../src/core/sites/upload-rate-limit");
  return { ...actual, trustedSiteUploadSubjectHash };
});

import { POST } from "../src/app/api/public/sites/[businessSlug]/[pageSlug]/[actionKey]/route";

const releaseToken = `s_${"b".repeat(64)}`;
const actionKey = `o_${"a".repeat(64)}`;
const idempotencyToken = "00000000-0000-4000-8000-000000000001";

function routeContext() {
  return {
    params: Promise.resolve({
      businessSlug: "example-business",
      pageSlug: "request",
      actionKey,
    }),
  };
}

describe("public operational submission route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callPublicRpc.mockResolvedValue({
      data: {
        ok: true,
        idempotent: true,
        confirmation: {
          public_reference: "BK-ABCDEF12",
          start_at: "2026-10-20T10:00:00.000Z",
          timezone: "Europe/London",
        },
      },
      error: null,
    });
  });

  it("dispatches a Booking retry to the receipt-aware submitter without a live resolver", async () => {
    const request = new Request(
      `http://localhost/api/public/sites/example-business/request/${actionKey}?releaseToken=${releaseToken}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_token: idempotencyToken,
          start_at: "2026-10-20T10:00:00.000Z",
          customer: {},
          subject: {},
          booking: {},
          service_record_id: null,
          website: "",
        }),
      },
    );

    const response = await POST(request, routeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      idempotent: true,
      confirmation: { public_reference: "BK-ABCDEF12" },
    });
    expect(callPublicRpc).toHaveBeenCalledTimes(1);
    expect(callPublicRpc).toHaveBeenCalledWith(
      expect.anything(),
      "submit_public_site_booking_v4",
      expect.objectContaining({
        requested_action_key: actionKey,
        requested_release_token: releaseToken,
        requested_idempotency_token: idempotencyToken,
      }),
    );
    expect(callPublicRpc).not.toHaveBeenCalledWith(
      expect.anything(),
      "resolve_public_site_operational_action_v4",
      expect.anything(),
    );
  });

  it("dispatches a preorder retry by its finite submission shape", async () => {
    callPublicRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        idempotent: true,
        email_status: "pending",
        confirmation: {
          public_reference: "PO-ABCDEF12",
          collection_location: "Town hall",
          collection_at: "2026-10-20T10:00:00.000Z",
          timezone: "Europe/London",
          items: [
            {
              name: "Lunch box",
              quantity: 1,
              unit_price: 12,
              line_total: 12,
            },
          ],
          item_summary: "1 × Lunch box",
          total: 12,
          confirmation_email: "visitor@example.test",
        },
      },
      error: null,
    });
    const request = new Request(
      `http://localhost/api/public/sites/example-business/request/${actionKey}?releaseToken=${releaseToken}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_token: idempotencyToken,
          location_id: "00000000-0000-4000-8000-000000000002",
          collection_at: "2026-10-20T10:00:00.000Z",
          items: [
            {
              product_id: "00000000-0000-4000-8000-000000000003",
              quantity: 1,
            },
          ],
          fields: { customer: {}, order: {} },
          website: "",
        }),
      },
    );

    const response = await POST(request, routeContext());

    expect(response.status).toBe(200);
    expect(callPublicRpc).toHaveBeenCalledWith(
      expect.anything(),
      "submit_public_site_preorder_v4",
      expect.objectContaining({
        requested_action_key: actionKey,
        requested_release_token: releaseToken,
        requested_idempotency_token: idempotencyToken,
      }),
    );
    expect(callPublicRpc).not.toHaveBeenCalledWith(
      expect.anything(),
      "resolve_public_site_operational_action_v4",
      expect.anything(),
    );
  });
});
