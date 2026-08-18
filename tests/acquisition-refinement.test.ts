import { describe, expect, it, vi } from "vitest";

import { composeStarterComposition } from "../src/core/acquisition/composer";
import {
  AcquisitionCandidateQualityError,
  validateAcquisitionCandidate,
} from "../src/core/acquisition/quality";
import { reconcileAcquisitionRefinement } from "../src/core/acquisition/refinement";
import {
  classifyAcquisitionRefinementDiagnostic,
  emitAcquisitionRefinementDiagnostic,
} from "../src/core/acquisition/refinement-diagnostics";
import type { ConfigurationOperation } from "../src/core/configuration/schemas";

function currentPayload() {
  return composeStarterComposition(
    "jobs",
    "I run a small business and need customers, jobs, quotes and tasks together.",
  );
}

describe("bounded acquisition refinement", () => {
  it("classifies deterministic quality failures without retaining their detail", () => {
    const markers = [
      "owner-request-marker",
      "raw-provider-output-marker",
      "candidate-json-marker",
      "pii-marker@example.test",
      "credential-marker",
    ];
    const diagnostic = classifyAcquisitionRefinementDiagnostic(
      new AcquisitionCandidateQualityError(
        "duplicate_relationship",
        markers.join(" "),
      ),
      "reconciliation",
    );

    expect(diagnostic).toEqual({
      stage: "reconciliation",
      code: "quality_duplicate_relationship",
    });
    expect(JSON.stringify(diagnostic)).not.toContain(markers.join(" "));
  });

  it("emits only the allow-listed diagnostic stage and code", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      emitAcquisitionRefinementDiagnostic(
        new Error(
          "owner-request-marker raw-provider-output-marker candidate-json-marker pii@example.test credential-marker",
        ),
        "reconciliation",
      );
      emitAcquisitionRefinementDiagnostic(
        new AcquisitionCandidateQualityError(
          "relationship_scalar_duplication",
          "arbitrary error body",
        ),
        "reconciliation",
      );

      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith(
        JSON.stringify({
          event: "acquisition_refinement_diagnostic",
          stage: "reconciliation",
          code: "quality_relationship_scalar_duplication",
        }),
      );
      expect(JSON.stringify(info.mock.calls)).not.toMatch(
        /owner-request-marker|raw-provider-output-marker|candidate-json-marker|pii@example\.test|credential-marker|arbitrary error body/,
      );
    } finally {
      info.mockRestore();
    }
  });

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

  it("keeps retained Forms valid when a regenerated candidate re-keys Forms around a new required Field", () => {
    const current = currentPayload();
    const suggested = {
      ...current,
      operations: current.operations
        .map((operation) => {
          if (operation.op === "set_form" && operation.object_key === "job") {
            return {
              ...operation,
              key: `regenerated_${operation.key}`,
              config_json: {
                ...operation.config_json,
                fields: [
                  ...operation.config_json.fields,
                  { field: "priority", hidden: false },
                ],
              },
            } satisfies ConfigurationOperation;
          }
          if (
            operation.op === "set_view" &&
            operation.key === "job_view" &&
            operation.view_type === "table"
          ) {
            const config = operation.config_json as {
              fields: string[];
              columns: Array<{
                kind: "field" | "connection";
                field_key?: string;
                relationship_key?: string;
                direction?: "source" | "target";
                label?: string;
              }>;
              create_form_key: string | null;
              edit_form_key: string | null;
            };
            return {
              ...operation,
              config_json: {
                ...config,
                fields: [...config.fields, "priority"],
                columns: [
                  ...config.columns,
                  { kind: "field", field_key: "priority" },
                ],
                create_form_key: "regenerated_job_create",
                edit_form_key: "regenerated_job_edit",
              },
            } satisfies ConfigurationOperation;
          }
          return operation;
        })
        .concat([
          {
            op: "set_field",
            object_key: "job",
            key: "priority",
            label: "Priority",
            field_type: "short_text",
            required: true,
            default_value: null,
            settings_json: {},
            position: 4,
            is_active: true,
          } satisfies ConfigurationOperation,
        ]),
    };

    expect(() => validateAcquisitionCandidate(suggested)).not.toThrow();

    const result = reconcileAcquisitionRefinement(
      current,
      suggested,
      "Also add a priority to each job.",
    );

    const retainedJobForms = result.operations.filter(
      (
        operation,
      ): operation is Extract<ConfigurationOperation, { op: "set_form" }> =>
        operation.op === "set_form" &&
        operation.object_key === "job" &&
        ["job_create", "job_edit"].includes(operation.key),
    );
    expect(retainedJobForms).toHaveLength(2);
    expect(
      retainedJobForms.every((form) =>
        form.config_json.fields.some((entry) => entry.field === "priority"),
      ),
    ).toBe(true);
    expect(() => validateAcquisitionCandidate(result)).not.toThrow();
  });

  it("adds a bounded Connection between existing concepts for the repair-job request", () => {
    const current = currentPayload();
    const repairJob: ConfigurationOperation = {
      op: "set_object",
      key: "repair_job",
      singular_label: "Repair job",
      plural_label: "Repair jobs",
      description: "The repair work customers ask the business to complete.",
      icon: null,
      is_active: true,
    };
    const currentWithRepairJobs = {
      ...current,
      operations: [...current.operations, repairJob],
      proposal: {
        ...current.proposal,
        concepts: [
          ...current.proposal.concepts,
          {
            name: "Repair jobs",
            description: repairJob.description,
            tracked_information: [],
          },
        ],
      },
    };
    const suggested = {
      ...currentWithRepairJobs,
      operations: [
        ...currentWithRepairJobs.operations,
        {
          op: "set_relationship",
          key: "customer_has_repair_job",
          source_object_key: "customer",
          target_object_key: "repair_job",
          source_label: "has repair jobs",
          target_label: "customer",
          cardinality: "one_to_many",
          is_required: false,
          is_active: true,
        } satisfies ConfigurationOperation,
      ],
      proposal: {
        ...currentWithRepairJobs.proposal,
        connections: [
          ...currentWithRepairJobs.proposal.connections,
          { text: "Customers link directly to repair jobs." },
        ],
      },
    };

    const result = reconcileAcquisitionRefinement(
      currentWithRepairJobs,
      suggested,
      "Customers should also be linked directly to repair jobs.",
    );

    expect(
      result.operations.some(
        (operation) =>
          operation.op === "set_relationship" &&
          operation.key === "customer_has_repair_job",
      ),
    ).toBe(true);
    expect(result.proposal.refinement_summary?.added).toContain(
      "Customer ↔ Repair job",
    );
    expect(
      result.operations.filter((operation) => operation.op === "set_object"),
    ).toHaveLength(5);
    expect(() => validateAcquisitionCandidate(result)).not.toThrow();
  });

  it("includes a re-keyed Object required by a selected Connection", () => {
    const current = currentPayload();
    const suggested = {
      ...current,
      operations: [
        ...current.operations,
        {
          op: "set_object",
          key: "work_item",
          singular_label: "Work item",
          plural_label: "Work items",
          description: "A unit of work connected to a customer.",
          icon: null,
          is_active: true,
        } satisfies ConfigurationOperation,
        {
          op: "set_relationship",
          key: "customer_has_repair_job",
          source_object_key: "customer",
          target_object_key: "work_item",
          source_label: "has work items",
          target_label: "customer",
          cardinality: "one_to_many",
          is_required: false,
          is_active: true,
        } satisfies ConfigurationOperation,
      ],
    };

    expect(() => validateAcquisitionCandidate(suggested)).not.toThrow();

    const result = reconcileAcquisitionRefinement(
      current,
      suggested,
      "Customers should also be linked directly to repair jobs.",
    );

    expect(
      result.operations.some(
        (operation) =>
          operation.op === "set_object" && operation.key === "work_item",
      ),
    ).toBe(true);
    expect(
      result.operations.some(
        (operation) =>
          operation.op === "set_relationship" &&
          operation.key === "customer_has_repair_job",
      ),
    ).toBe(true);
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
