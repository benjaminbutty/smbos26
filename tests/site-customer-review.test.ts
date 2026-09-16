import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SiteCustomerReview,
  type CustomerResolutionCase,
} from "../src/components/sites/site-customer-review";

function customerCase(
  overrides: Partial<CustomerResolutionCase> = {},
): CustomerResolutionCase {
  return {
    kind: "form",
    receipt_id: "receipt-1",
    public_reference: "ENQ-123",
    match_count: 2,
    candidate_ids: ["customer-1", "customer-2"],
    candidate_profiles: [
      { id: "customer-1", label: "Ada", profile: {} },
      { id: "customer-2", label: "Ada duplicate", profile: {} },
    ],
    submitted_details: {},
    submitted_detail_rows: [],
    original_customer_record_id: "customer-1",
    customer_record_id: "customer-1",
    resolution_state: "matched",
    resolution_revision: 0,
    ...overrides,
  };
}

describe("SiteCustomerReview", () => {
  it("renders frozen labels as separate readable rows without raw receipt JSON", () => {
    const html = renderToStaticMarkup(
      createElement(SiteCustomerReview, {
        cases: [
          customerCase({
            submitted_details: {
              question_9f2e7a1c2b3d4e5f: "Ada",
            },
            submitted_detail_rows: [
              { label: "Name", value: "Ada" },
              { label: "Name", value: "Visitor alias" },
              { label: "Email", value: "ada@example.test" },
              {
                label: "Attachments",
                value: {
                  attachment_ids: [
                    "11111111-1111-4111-8111-111111111111",
                    "22222222-2222-4222-8222-222222222222",
                  ],
                },
              },
            ],
          }),
        ],
        resolveAction: async () => undefined,
      }),
    );

    expect(html.match(/Name:/g)).toHaveLength(2);
    expect(html).toContain("Ada");
    expect(html).toContain("Visitor alias");
    expect(html).toContain("Attachments: 2 files");
    expect(html).not.toContain("question_9f2e7a1c2b3d4e5f");
    expect(html).not.toContain("attachment_ids");
    expect(html).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(html).not.toContain('{"');
  });

  it("uses plain fallback labels for legacy answer keys without censoring values", () => {
    const html = renderToStaticMarkup(
      createElement(SiteCustomerReview, {
        cases: [
          customerCase({
            submitted_details: {
              question_9f2e7a1c2b3d4e5f: "A visitor wrote this exact value",
              "question_11111111-1111-4111-8111-111111111111":
                "A visitor wrote a UUID-keyed value",
              "22222222-2222-4222-8222-222222222222":
                "A visitor wrote a pure UUID-keyed value",
              preferred_date: "2026-10-15",
            },
          }),
        ],
        resolveAction: async () => undefined,
      }),
    );

    expect(html).toContain("Submitted answer 1:");
    expect(html).toContain("Submitted answer 2:");
    expect(html).toContain("Submitted answer 3:");
    expect(html).toContain("Preferred date: 2026-10-15");
    expect(html).toContain("A visitor wrote this exact value");
    expect(html).toContain("A visitor wrote a UUID-keyed value");
    expect(html).toContain("A visitor wrote a pure UUID-keyed value");
    expect(html).not.toContain("question_9f2e7a1c2b3d4e5f");
    expect(html).not.toContain("question_11111111-1111-4111-8111-111111111111");
    expect(html).not.toContain("22222222-2222-4222-8222-222222222222:");
  });
});
