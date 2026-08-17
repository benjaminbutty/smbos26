import { describe, expect, it } from "vitest";

import { composeStarterComposition } from "../src/core/acquisition/composer";
import { validateAcquisitionCandidate } from "../src/core/acquisition/quality";
import { reconcileAcquisitionRefinement } from "../src/core/acquisition/refinement";
import type { ConfigurationOperation } from "../src/core/configuration/schemas";

function currentPayload() {
  return composeStarterComposition(
    "jobs",
    "I run a small business and need customers, jobs, quotes and tasks together.",
  );
}

describe("bounded acquisition refinement", () => {
  it("adds the requested Field and updates only dependent surfaces", () => {
    const current = currentPayload();
    const suggested = {
      ...current,
      operations: current.operations
        .map((operation) => {
          if (
            operation.op === "set_form" &&
            ["customer_create", "customer_edit"].includes(operation.key)
          ) {
            return {
              ...operation,
              config_json: {
                ...operation.config_json,
                fields: [
                  ...operation.config_json.fields,
                  { field: "preferred_contact", hidden: false },
                ],
              },
            };
          }
          if (
            operation.op === "set_view" &&
            operation.key === "customer_view"
          ) {
            const config = operation.config_json as {
              columns: Array<{
                kind: "field" | "connection";
                field_key?: string;
                relationship_key?: string;
                direction?: "source" | "target";
                label?: string;
              }>;
              fields: string[];
            };
            return {
              ...operation,
              config_json: {
                ...config,
                columns: [
                  ...config.columns,
                  { kind: "field", field_key: "preferred_contact" },
                ],
                fields: [...config.fields, "preferred_contact"],
              },
            };
          }
          return operation;
        })
        .concat([
          {
            op: "set_field",
            object_key: "customer",
            key: "preferred_contact",
            label: "Preferred contact",
            field_type: "short_text",
            required: false,
            default_value: null,
            settings_json: {},
            position: 3,
            is_active: true,
          } satisfies ConfigurationOperation,
        ]),
    };

    const result = reconcileAcquisitionRefinement(
      current,
      suggested,
      "Add a preferred contact field for customers.",
    );
    const field = result.operations.find(
      (operation) =>
        operation.op === "set_field" && operation.key === "preferred_contact",
    );

    expect(field).toBeDefined();
    expect(result.proposal.refinement_summary?.added).toContain(
      "Customer: Preferred contact",
    );
    expect(JSON.stringify(result)).not.toContain("Owner refinement:");
    expect(() => validateAcquisitionCandidate(result)).not.toThrow();
  });

  it("revalidates the reconciled candidate before returning", () => {
    const current = currentPayload();
    const invalidField = {
      op: "set_field",
      object_key: "customer",
      key: "job_id",
      label: "Job",
      field_type: "short_text",
      required: false,
      default_value: null,
      settings_json: {},
      position: 3,
      is_active: true,
    } satisfies ConfigurationOperation;

    expect(() =>
      reconcileAcquisitionRefinement(
        current,
        {
          ...current,
          operations: [...current.operations, invalidField],
        },
        "Add a Job field for customers.",
      ),
    ).toThrow(/duplicated by a scalar field/i);
  });

  it("honors an explicit removal while preserving unrelated Objects", () => {
    const current = currentPayload();
    const result = reconcileAcquisitionRefinement(
      current,
      current,
      "Remove the customer phone field.",
    );
    const customerPhone = result.operations.find(
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "customer" &&
        operation.key === "phone",
    );

    expect(customerPhone).toBeUndefined();
    expect(
      result.operations.some(
        (operation) => operation.op === "set_object" && operation.key === "job",
      ),
    ).toBe(true);
    expect(result.proposal.refinement_summary?.removed).toEqual(
      expect.arrayContaining(["Customer: Phone"]),
    );
    expect(() => validateAcquisitionCandidate(result)).not.toThrow();
  });

  it("does not copy an unrelated regenerated workspace into the current candidate", () => {
    const current = currentPayload();
    const unrelated = composeStarterComposition(
      "products",
      "I need products and stock counts I can update myself.",
    );
    const result = reconcileAcquisitionRefinement(
      current,
      unrelated,
      "Add a preferred contact field for customers.",
    );

    expect(
      result.operations.some(
        (operation) =>
          operation.op === "set_object" && operation.key === "product",
      ),
    ).toBe(false);
    expect(
      result.operations.some(
        (operation) => operation.op === "set_object" && operation.key === "job",
      ),
    ).toBe(true);
  });
});
