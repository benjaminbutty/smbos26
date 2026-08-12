import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { AcquisitionExecutionCore } from "../src/ai/acquisition-planning/runtime";
import {
  detectGroundedCurrency,
  interpretAcquisitionRequest,
} from "../src/core/acquisition/interpreter";
import type { AcquisitionCategory } from "../src/core/acquisition/schemas";

const scenarios: ReadonlyArray<
  [string, AcquisitionCategory, string, readonly string[], string?]
> = [
  [
    "dog",
    "appointments",
    "I run a dog grooming business and bookings are hard to organise.",
    ["Customers", "Pets", "Appointments", "Services"],
  ],
  [
    "salon",
    "appointments",
    "I run a hair salon and need clients, bookings and services organised.",
    ["Customers", "Appointments", "Services"],
    "Pets",
  ],
  [
    "milk",
    "delivery",
    "I deliver milk and confirm what each customer wants and how much on WhatsApp.",
    ["Customers", "Products", "Standing Orders", "Order Items", "Deliveries"],
  ],
  [
    "delivery",
    "delivery",
    "I sell produce and need customers, products, orders and deliveries.",
    ["Customers", "Products", "Orders", "Order Items", "Deliveries"],
  ],
  [
    "jobs",
    "jobs",
    "I am a builder and need customers, jobs, quotes and tasks together.",
    ["Customers", "Jobs", "Quotes", "Tasks"],
  ],
  [
    "enquiries",
    "enquiries",
    "I need clients, enquiries and follow-ups from my website form.",
    ["Customers", "Enquiries", "Follow-ups"],
  ],
  [
    "products",
    "products",
    "I need products and stock counts I can update myself.",
    ["Products"],
  ],
  [
    "other",
    "other",
    "I rent party props and need items, customers, bookings and online payments.",
    ["Rental Items", "Customers", "Bookings"],
  ],
];
function execution(names: readonly string[]): AcquisitionExecutionCore {
  return {
    async execute() {
      return {
        output: {
          schema_version: 1,
          state: "ready",
          understanding:
            "You need the work organised in one internal workspace.",
          why: "This keeps the smallest useful set of reusable business areas connected.",
          tables: names.map((plural, index) => ({
            reference: `table_${index + 1}`,
            singular_name: plural.replace(/s$/, ""),
            plural_name: plural,
            purpose: `Keep ${plural.toLocaleLowerCase("en")} organised.`,
            fields: [
              {
                label: index === 3 && /Item/.test(plural) ? "Quantity" : "Name",
                field_type:
                  index === 3 && /Item/.test(plural) ? "number" : "short_text",
                required: true,
                options: null,
                currency: null,
              },
            ],
          })),
          connections: names.slice(1).map((plural, index) => ({
            source_table_reference: `table_${index + 1}`,
            target_table_reference: `table_${index + 2}`,
            source_label: "has",
            target_label: "belongs to",
            cardinality: "one_to_many",
            explanation: `${plural} belong to ${names[index]}.`,
          })),
          primary_table_reference: "table_1",
          unsupported_requirements: [],
        },
        metadata: {
          taskKey: "acquisition_workspace_plan_v1",
          taskVersion: 1,
          purposeLabel: "test",
          providerKey: "test",
          modelKey: "test",
          attempts: 1,
          usage: { inputTokens: 1, outputTokens: 1, complete: true },
        },
        accounting: {
          attemptsStarted: 1,
          inputTokens: 1,
          outputTokens: 1,
          usageReported: true,
          usageComplete: true,
          providerInvocationStarted: true,
          failureBeforeProviderInvocation: false,
        },
      };
    },
  };
}
describe("Phase 5 tailored acquisition composition", () => {
  it.each(scenarios)(
    "passes the %s production composition",
    async (_, category, request, names, absent) => {
      const payload = await interpretAcquisitionRequest(
        category,
        request,
        execution(names),
      );
      expect(payload.proposal.concepts.map(({ name }) => name)).toEqual(names);
      expect(payload.proposal.concepts.map(({ name }) => name)).not.toContain(
        absent,
      );
      expect(payload.proposal.source).toBe("tailored");
      expect(payload.proposal.landing_page_key).toBe("overview");
      expect(payload.operations.some(({ op }) => op === "set_page")).toBe(true);
      expect(JSON.stringify(payload.operations)).not.toContain("location");
      expect(
        payload.operations.some(
          (item) => item.op === "set_field" && item.field_type === "currency",
        ),
      ).toBe(false);
    },
  );
  it("grounds only one explicit currency", () => {
    expect(detectGroundedCurrency("Use GBP and £ prices.")).toBe("GBP");
    expect(detectGroundedCurrency("Use USD.")).toBe("USD");
    expect(detectGroundedCurrency("A salon in London.")).toBeNull();
  });

  it("turns tailored Connections into visible columns on both Tables", async () => {
    const payload = await interpretAcquisitionRequest(
      "delivery",
      "I need customers, orders and order items connected.",
      execution(["Customers", "Orders", "Order Items"]),
    );
    const views = payload.operations.filter(
      (operation) => operation.op === "set_view",
    );
    const relationships = payload.operations.filter(
      (operation) => operation.op === "set_relationship",
    );

    expect(relationships).toHaveLength(2);
    expect(views).toHaveLength(3);
    for (const view of views) {
      const config = view.config_json as {
        columns?: Array<{ kind: string; label?: string }>;
      };
      expect(config.columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "connection" }),
        ]),
      );
    }

    const page = payload.operations.find(
      (operation) => operation.op === "set_page",
    );
    expect(page?.op === "set_page" ? page.layout_json : null).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({ type: "heading", text: "Start here" }),
      ]),
    });
  });
});
