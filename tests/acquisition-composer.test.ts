import { describe, expect, it } from "vitest";

import { composeStarterComposition } from "../src/core/acquisition/composer";
import {
  acquisitionBuildPayloadSchema,
  acquisitionProposalSchema,
} from "../src/core/acquisition/schemas";

const request =
  "I run a small local business and need a clear place to keep customers and the work we do for them.";

describe("Phase 5 starter compositions", () => {
  it.each([
    ["appointments", ["customer", "appointment", "service"]],
    ["delivery", ["customer", "product", "order", "order_item", "delivery"]],
    ["jobs", ["customer", "job", "quote", "task"]],
    ["enquiries", ["customer", "enquiry", "follow_up"]],
    ["products", ["product"]],
    ["other", ["customer", "enquiry", "follow_up"]],
  ] as const)(
    "builds the %s composition from existing operations",
    (category, objectKeys) => {
      const result = composeStarterComposition(category, request);
      const parsed = acquisitionBuildPayloadSchema.parse(result);
      const createdObjects = parsed.operations
        .filter((operation) => operation.op === "set_object")
        .map((operation) => operation.key);

      expect(createdObjects).toEqual(objectKeys);
      expect(
        parsed.operations.some((operation) => operation.op === "set_page"),
      ).toBe(true);
      expect(
        parsed.operations.some((operation) => operation.op === "set_view"),
      ).toBe(true);
      expect(
        parsed.operations.some((operation) => operation.op === "set_form"),
      ).toBe(true);
      expect(
        parsed.proposal.concepts.every(
          (concept) => !concept.name.includes("Object"),
        ),
      ).toBe(true);
      const ownerCopy = JSON.stringify({
        understanding: parsed.proposal.understanding,
        concepts: parsed.proposal.concepts,
        connections: parsed.proposal.connections,
        pages: parsed.proposal.pages,
        first_step: parsed.proposal.first_step,
        not_included: parsed.proposal.not_included,
      });
      expect(ownerCopy).not.toMatch(/schema|uuid|field|relationship/i);
      expect(parsed.proposal.source).toBe("fallback");
      expect(parsed.proposal.understanding).toContain(
        "couldn’t tailor this right now",
      );
      expect(parsed.proposal.landing_page_key).toBe("overview");
      expect(
        parsed.operations.filter(
          (operation) =>
            operation.op === "set_field" && operation.field_type === "currency",
        ),
      ).toHaveLength(0);
    },
  );

  it("keeps delivery quantities on Order Items", () => {
    const result = composeStarterComposition("delivery", request);
    const quantity = result.operations.find(
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "order_item" &&
        operation.key === "quantity",
    );

    expect(quantity).toMatchObject({
      field_type: "number",
      required: true,
      default_value: 1,
    });
  });

  it("is deterministic and keeps unsupported capabilities explicit", () => {
    const first = composeStarterComposition("appointments", request);
    const second = composeStarterComposition("appointments", request);

    expect(first).toEqual(second);
    expect(first.proposal.not_included).toContain("Online payments");
    expect(acquisitionProposalSchema.parse(first.proposal).schema_version).toBe(
      1,
    );
  });

  it("keeps the Appointments fallback generic", () => {
    const result = composeStarterComposition(
      "appointments",
      "I run a salon and need to organise appointments and services.",
    );
    const objectKeys = result.operations
      .filter((operation) => operation.op === "set_object")
      .map((operation) => operation.key);

    expect(objectKeys).toEqual(["customer", "appointment", "service"]);
    expect(result.proposal.concepts.map(({ name }) => name)).not.toContain(
      "Pets",
    );
  });

  it("provides a generic safe starting point for something else", () => {
    const result = composeStarterComposition(
      "other",
      "I need to keep customer enquiries and remember what to follow up next.",
    );

    expect(result.proposal.title).toBe("Customer follow-up workspace");
    expect(result.proposal.concepts.map((concept) => concept.name)).toEqual([
      "Customers",
      "Enquiries",
      "Follow-ups",
    ]);
    expect(result.proposal.understanding).toContain("reliable starting point");
    expect(result.proposal.not_included).toContain(
      "A tailored setup for a specific industry",
    );
  });

  it("uses a truthful neutral Overview page and unfiltered view names", () => {
    for (const category of [
      "appointments",
      "delivery",
      "jobs",
      "enquiries",
      "products",
      "other",
    ] as const) {
      const result = composeStarterComposition(category, request);
      expect(result.proposal.pages[0]?.name).toBe("Overview");
      expect(JSON.stringify(result.proposal.views)).not.toMatch(/today/i);
      expect(
        result.operations.find((operation) => operation.op === "set_page"),
      ).toMatchObject({ key: "overview", slug: "overview", title: "Overview" });
    }
  });
});
