import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  evaluateAcquisitionScenario,
  productionCompositionFailureResult,
} from "../src/ai/evaluation/acquisition/evaluator";
import {
  acquisitionEvaluationScenarios,
  type AcquisitionEvaluationScenario,
  type AcquisitionRelationshipExpectation,
} from "../src/ai/evaluation/acquisition/scenarios";
import type { AcquisitionBuildPayload } from "../src/core/acquisition/schemas";
import type { ConfigurationOperation } from "../src/core/configuration/schemas";

type Concept = { key: string; singular: string; plural: string };
type Relationship = {
  source: string;
  target: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_many";
};

const payload = (
  concepts: Concept[],
  relationships: Relationship[] = [],
  fields: Array<{
    objectKey: string;
    label: string;
    fieldType: "number" | "short_text" | "currency";
  }> = [],
  notIncluded: string[] = [],
): AcquisitionBuildPayload => {
  const operations: ConfigurationOperation[] = [
    ...concepts.map<ConfigurationOperation>(({ key, singular, plural }) => ({
      op: "set_object",
      key,
      singular_label: singular,
      plural_label: plural,
      description: `${plural} for this workspace.`,
      icon: null,
      is_active: true,
    })),
    ...fields.map<ConfigurationOperation>(
      ({ objectKey, label, fieldType }, index) => ({
        op: "set_field",
        object_key: objectKey,
        key: `field_${index + 1}`,
        label,
        field_type: fieldType,
        required: false,
        default_value: null,
        settings_json: {},
        position: index,
        is_active: true,
      }),
    ),
    ...relationships.map<ConfigurationOperation>(
      ({ source, target, cardinality }, index) => ({
        op: "set_relationship",
        key: `relationship_${index + 1}`,
        source_object_key: source,
        target_object_key: target,
        source_label: "Connected records",
        target_label: "Connected record",
        cardinality,
        is_required: false,
        is_active: true,
      }),
    ),
  ];
  return {
    proposal: {
      schema_version: 1,
      source: "tailored",
      category: "other",
      title: "Test workspace",
      understanding: "Keep the work connected in one place.",
      why: "These business areas keep the work organised.",
      concepts: concepts.map(({ plural }) => ({
        name: plural,
        description: `Keep ${plural.toLocaleLowerCase("en")} organised.`,
        tracked_information: ["Name"],
      })),
      connections: relationships.map(() => ({ text: "Keep these connected." })),
      views: [{ name: "Work", description: "See the work." }],
      pages: [{ name: "Overview", description: "Start here." }],
      landing_page_key: "overview",
      first_step: "Add the first record.",
      not_included: notIncluded,
    },
    operations,
  };
};

const scenario = (
  expectation: AcquisitionRelationshipExpectation,
): AcquisitionEvaluationScenario => ({
  id: "policy_test",
  category: "other",
  request: "I need a connected internal workspace.",
  requiredConcepts: [],
  requiredRelationships: [expectation],
});

const customerJob: AcquisitionRelationshipExpectation = {
  code: "customer_to_job_one_to_many",
  sourceConceptAliases: ["customer", "client"],
  targetConceptAliases: ["job", "project"],
  cardinality: "one_to_many",
};

const contactEnquiry: AcquisitionRelationshipExpectation = {
  code: "contact_to_enquiry_one_to_many",
  sourceConceptAliases: ["contact", "client", "prospect"],
  targetConceptAliases: ["enquiry", "lead"],
  cardinality: "one_to_many",
};

const milk = acquisitionEvaluationScenarios.find(
  ({ id }) => id === "milk_round",
);
if (!milk) throw new Error("Milk-round scenario missing.");

describe("acquisition hard-contract and product-quality policy", () => {
  it("keeps a valid but lower-quality milk model out of the hard failure lane", () => {
    const result = evaluateAcquisitionScenario(
      milk,
      payload(
        [
          { key: "customer", singular: "Customer", plural: "Customers" },
          {
            key: "weekly_order",
            singular: "Weekly Order",
            plural: "Weekly Orders",
          },
          {
            key: "milk_product",
            singular: "Milk Product",
            plural: "Milk Products",
          },
        ],
        [],
        [],
        ["WhatsApp integration"],
      ),
    );

    expect(result).toEqual({
      hard_findings: [],
      quality_findings: expect.arrayContaining([
        "required_concepts",
        "line_item_quantity_missing",
        "required_relationship_semantics:customer_to_order_one_to_many",
        "required_relationship_semantics:order_to_item_one_to_many",
        "required_relationship_semantics:product_to_item_one_to_many",
      ]),
      hard_passed: true,
      quality_passed: false,
    });
  });

  it("classifies a reversed Customer-to-Job relationship as quality, not safety", () => {
    const result = evaluateAcquisitionScenario(
      {
        ...acquisitionEvaluationScenarios.find(
          ({ id }) => id === "trades_jobs",
        )!,
        requiredConcepts: [],
        requiredRelationships: [customerJob],
      },
      payload(
        [
          { key: "job", singular: "Job", plural: "Jobs" },
          { key: "customer", singular: "Customer", plural: "Customers" },
        ],
        [{ source: "job", target: "customer", cardinality: "one_to_many" }],
      ),
    );

    expect(result.hard_passed).toBe(true);
    expect(result.quality_passed).toBe(false);
    expect(result.quality_findings).toContain(
      "required_relationship_semantics:customer_to_job_one_to_many",
    );
  });

  it.each([
    ["Location", "location_added"],
    ["Currency", "currency_invented"],
  ] as const)("keeps %s violations hard", (label, finding) => {
    const result = evaluateAcquisitionScenario(
      scenario(customerJob),
      payload(
        [
          { key: "customer", singular: "Customer", plural: "Customers" },
          { key: "job", singular: "Job", plural: "Jobs" },
          ...(label === "Location"
            ? [{ key: "location", singular: "Location", plural: "Locations" }]
            : []),
        ],
        [{ source: "customer", target: "job", cardinality: "one_to_many" }],
        label === "Currency"
          ? [{ objectKey: "job", label: "Value", fieldType: "currency" }]
          : [],
      ),
    );

    expect(result.hard_passed).toBe(false);
    expect(result.hard_findings).toContain(finding);
  });

  it("keeps unsupported-capability truthfulness hard", () => {
    const result = evaluateAcquisitionScenario(
      {
        ...scenario(customerJob),
        requiredUnsupported: ["whatsapp", "integration"],
      },
      payload(
        [
          { key: "customer", singular: "Customer", plural: "Customers" },
          { key: "job", singular: "Job", plural: "Jobs" },
        ],
        [{ source: "customer", target: "job", cardinality: "one_to_many" }],
      ),
    );

    expect(result.hard_passed).toBe(false);
    expect(result.hard_findings).toContain("unsupported_not_disclosed");
  });

  it("keeps production composition failure hard and quality-neutral", () => {
    const result = productionCompositionFailureResult({
      name: "AcquisitionInterpretationError",
      code: "composition_invalid",
    });
    expect(result).toEqual({
      hard_findings: [
        "production_composition_failed:unknown:composition_invalid",
      ],
      quality_findings: [],
      hard_passed: false,
      quality_passed: true,
    });
  });

  it("matches compound concept identities with complete word boundaries", () => {
    expect(
      evaluateAcquisitionScenario(
        scenario(contactEnquiry),
        payload(
          [
            {
              key: "prospective_client",
              singular: "Prospective Client",
              plural: "Prospective Clients",
            },
            { key: "enquiry", singular: "Enquiry", plural: "Enquiries" },
          ],
          [
            {
              source: "prospective_client",
              target: "enquiry",
              cardinality: "one_to_many",
            },
          ],
        ),
      ).quality_passed,
    ).toBe(true);

    expect(
      evaluateAcquisitionScenario(
        scenario({
          code: "order_to_item_one_to_many",
          sourceConceptAliases: ["order"],
          targetConceptAliases: ["item"],
          cardinality: "one_to_many",
        }),
        payload(
          [
            {
              key: "weekly_order",
              singular: "Weekly Order",
              plural: "Weekly Orders",
            },
            {
              key: "order_item",
              singular: "Order Item",
              plural: "Order Items",
            },
          ],
          [
            {
              source: "weekly_order",
              target: "order_item",
              cardinality: "one_to_many",
            },
          ],
        ),
      ).quality_passed,
    ).toBe(true);
  });

  it("does not use arbitrary substring matching and considers all candidates", () => {
    const expectation = {
      code: "order_to_item_one_to_many",
      sourceConceptAliases: ["order"],
      targetConceptAliases: ["item"],
      cardinality: "one_to_many" as const,
    };
    const result = evaluateAcquisitionScenario(
      scenario(expectation),
      payload(
        [
          { key: "border", singular: "Border", plural: "Borders" },
          {
            key: "regular_order",
            singular: "Regular Order",
            plural: "Regular Orders",
          },
          {
            key: "weekly_order",
            singular: "Weekly Order",
            plural: "Weekly Orders",
          },
          { key: "order_item", singular: "Order Item", plural: "Order Items" },
        ],
        [
          {
            source: "weekly_order",
            target: "order_item",
            cardinality: "one_to_many",
          },
        ],
      ),
    );
    expect(result.quality_passed).toBe(true);
  });

  it("keeps one-to-many orientation strict while many-to-many remains symmetric", () => {
    const reversed = evaluateAcquisitionScenario(
      scenario(customerJob),
      payload(
        [
          { key: "customer", singular: "Customer", plural: "Customers" },
          { key: "job", singular: "Job", plural: "Jobs" },
        ],
        [{ source: "job", target: "customer", cardinality: "one_to_many" }],
      ),
    );
    expect(reversed.quality_passed).toBe(false);

    const symmetric = evaluateAcquisitionScenario(
      scenario({
        code: "appointment_to_service_many_to_many",
        sourceConceptAliases: ["appointment"],
        targetConceptAliases: ["service"],
        cardinality: "many_to_many",
      }),
      payload(
        [
          {
            key: "appointment",
            singular: "Appointment",
            plural: "Appointments",
          },
          { key: "service", singular: "Service", plural: "Services" },
        ],
        [
          {
            source: "service",
            target: "appointment",
            cardinality: "many_to_many",
          },
        ],
      ),
    );
    expect(symmetric.quality_passed).toBe(true);
  });
});
