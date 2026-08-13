import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AcquisitionExecutionCore } from "../src/ai/acquisition-planning/runtime";
import {
  deriveAcquisitionConnectionLabels,
  type AcquisitionRelationshipCardinality,
} from "../src/core/acquisition/connection-labels";
import { interpretAcquisitionRequest } from "../src/core/acquisition/interpreter";

interface TestTable {
  reference: `table_${number}`;
  singular_name: string;
  plural_name: string;
}

interface TestConnection {
  source_table_reference: `table_${number}`;
  target_table_reference: `table_${number}`;
  source_label: string;
  target_label: string;
  cardinality: AcquisitionRelationshipCardinality;
  explanation: string;
}

function executionForPlan(
  tables: readonly TestTable[],
  connections: readonly TestConnection[],
): AcquisitionExecutionCore {
  return {
    async execute() {
      return {
        output: {
          schema_version: 1,
          state: "ready",
          understanding: "The business information should stay connected.",
          why: "These reusable areas keep the work understandable.",
          tables: tables.map((table) => ({
            ...table,
            purpose: `Keep ${table.plural_name.toLocaleLowerCase("en")} organised.`,
            fields: [
              {
                label: "Name",
                field_type: "short_text" as const,
                required: true,
                options: null,
                currency: null,
              },
            ],
          })),
          connections,
          primary_table_reference: tables[0]!.reference,
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

const cases = [
  {
    name: "one_to_one",
    source: { singular: "Enquiry", plural: "Enquiries" },
    target: { singular: "Event", plural: "Events" },
    cardinality: "one_to_one" as const,
  },
  {
    name: "one_to_many",
    source: { singular: "Customer", plural: "Customers" },
    target: { singular: "Job", plural: "Jobs" },
    cardinality: "one_to_many" as const,
  },
  {
    name: "another one_to_many",
    source: { singular: "Enquiry", plural: "Enquiries" },
    target: { singular: "Follow-up", plural: "Follow-ups" },
    cardinality: "one_to_many" as const,
  },
  {
    name: "many_to_many",
    source: { singular: "Appointment", plural: "Appointments" },
    target: { singular: "Service", plural: "Services" },
    cardinality: "many_to_many" as const,
  },
] as const;

describe("deterministic acquisition Connection labels", () => {
  it.each(cases)(
    "derives $name labels from concept names and cardinality",
    (testCase) => {
      expect(
        deriveAcquisitionConnectionLabels({
          source: testCase.source,
          target: testCase.target,
          cardinality: testCase.cardinality,
        }),
      ).toEqual({
        source:
          testCase.cardinality === "one_to_one"
            ? testCase.target.singular
            : testCase.target.plural,
        target:
          testCase.cardinality === "many_to_many"
            ? testCase.source.plural
            : testCase.source.singular,
      });
    },
  );

  it.each(cases)(
    "persists $name labels on the Relationship and both Connection columns",
    async (testCase) => {
      const payload = await interpretAcquisitionRequest(
        "other",
        "I need one connected place to manage this work.",
        executionForPlan(
          [
            {
              reference: "table_1",
              singular_name: testCase.source.singular,
              plural_name: testCase.source.plural,
            },
            {
              reference: "table_2",
              singular_name: testCase.target.singular,
              plural_name: testCase.target.plural,
            },
          ],
          [
            {
              source_table_reference: "table_1",
              target_table_reference: "table_2",
              source_label: "model wording on source",
              target_label: "model wording on target",
              cardinality: testCase.cardinality,
              explanation: "The model explanation remains intact.",
            },
          ],
        ),
      );
      const relationship = payload.operations.find(
        (operation) => operation.op === "set_relationship",
      );
      const views = payload.operations.filter(
        (operation) => operation.op === "set_view",
      );

      expect(relationship).toMatchObject({
        source_object_key: testCase.source.singular
          .toLocaleLowerCase("en")
          .replaceAll(/[^a-z0-9]+/g, "_"),
        target_object_key: testCase.target.singular
          .toLocaleLowerCase("en")
          .replaceAll(/[^a-z0-9]+/g, "_"),
        cardinality: testCase.cardinality,
        source_label:
          testCase.cardinality === "one_to_one"
            ? testCase.target.singular
            : testCase.target.plural,
        target_label:
          testCase.cardinality === "many_to_many"
            ? testCase.source.plural
            : testCase.source.singular,
      });
      expect(
        payload.operations.filter(
          (operation) => operation.op === "set_relationship",
        ),
      ).toHaveLength(1);
      expect(
        payload.operations.filter((operation) => operation.op === "set_object"),
      ).toHaveLength(2);
      expect(payload.proposal.connections).toEqual([
        { text: "The model explanation remains intact." },
      ]);
      expect(JSON.stringify(payload.operations)).not.toMatch(/location/i);

      if (!relationship || relationship.op !== "set_relationship") return;
      for (const [objectKey, label] of [
        [relationship.source_object_key, relationship.source_label],
        [relationship.target_object_key, relationship.target_label],
      ] as const) {
        const view = views.find(
          (operation) =>
            operation.op === "set_view" && operation.object_key === objectKey,
        );
        expect(view?.op === "set_view" ? view.config_json : null).toEqual(
          expect.objectContaining({
            columns: expect.arrayContaining([
              expect.objectContaining({
                kind: "connection",
                relationship_key: relationship.key,
                label,
              }),
            ]),
          }),
        );
      }
    },
  );

  it("ignores bad model labels while preserving orientation and cardinality", async () => {
    const payload = await interpretAcquisitionRequest(
      "jobs",
      "I need customers and jobs connected.",
      executionForPlan(
        [
          {
            reference: "table_1",
            singular_name: "Customer",
            plural_name: "Customers",
          },
          { reference: "table_2", singular_name: "Job", plural_name: "Jobs" },
        ],
        [
          {
            source_table_reference: "table_1",
            target_table_reference: "table_2",
            source_label: "Jobs",
            target_label: "Job",
            cardinality: "one_to_many",
            explanation: "One Customer can have several Jobs.",
          },
        ],
      ),
    );
    const relationship = payload.operations.find(
      (operation) => operation.op === "set_relationship",
    );

    expect(relationship).toMatchObject({
      source_object_key: "customer",
      target_object_key: "job",
      cardinality: "one_to_many",
      source_label: "Jobs",
      target_label: "Customer",
    });
    expect(payload.proposal.connections).toEqual([
      { text: "One Customer can have several Jobs." },
    ]);
  });
});
