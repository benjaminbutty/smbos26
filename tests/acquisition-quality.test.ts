import { describe, expect, it } from "vitest";

import { composeStarterComposition } from "../src/core/acquisition/composer";
import { enhanceAcquisitionPayload } from "../src/core/acquisition/capabilities";
import {
  AcquisitionCandidateQualityError,
  validateAcquisitionCandidate,
} from "../src/core/acquisition/quality";
import type { ConfigurationOperation } from "../src/core/configuration/schemas";

function jobsPayload() {
  return composeStarterComposition(
    "jobs",
    "I run a small business and need customers, jobs, quotes and tasks together.",
  );
}

function replaceOperation(
  payload: ReturnType<typeof jobsPayload>,
  predicate: (operation: ConfigurationOperation) => boolean,
  replacement: (operation: ConfigurationOperation) => ConfigurationOperation,
) {
  return {
    ...payload,
    operations: payload.operations.map((operation) =>
      predicate(operation) ? replacement(operation) : operation,
    ),
  };
}

describe("generic acquisition candidate quality", () => {
  it("rejects duplicate normalized field labels on one Object", () => {
    const payload = replaceOperation(
      jobsPayload(),
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "customer" &&
        operation.key === "phone",
      (operation) =>
        operation.op === "set_field"
          ? { ...operation, label: " Name " }
          : operation,
    );

    expect(() => validateAcquisitionCandidate(payload)).toThrowError(
      AcquisitionCandidateQualityError,
    );
    expect(() => validateAcquisitionCandidate(payload)).toThrow(
      /duplicate field label/i,
    );
  });

  it("rejects semantically redundant identity fields on one Object", () => {
    const payload = jobsPayload();
    const dogObject = {
      ...payload.operations.find((operation) => operation.op === "set_object")!,
      key: "dog",
      singular_label: "Dog",
      plural_label: "Dogs",
    } satisfies ConfigurationOperation;
    const dogName = {
      op: "set_field",
      object_key: "dog",
      key: "dog_name",
      label: "Dog name",
      field_type: "short_text",
      required: false,
      default_value: null,
      settings_json: {},
      position: 0,
      is_active: true,
    } satisfies ConfigurationOperation;
    const genericName = {
      ...dogName,
      key: "name",
      label: "Name",
      position: 1,
    };
    const withRedundantFields = {
      ...payload,
      operations: [...payload.operations, dogObject, dogName, genericName],
    };

    expect(() => validateAcquisitionCandidate(withRedundantFields)).toThrow(
      /semantically redundant/i,
    );
  });

  it("rejects a scalar field that leaks a related Object's value", () => {
    const payload = jobsPayload();
    const customerName = {
      op: "set_field",
      object_key: "job",
      key: "customer_name",
      label: "Customer name",
      field_type: "short_text",
      required: false,
      default_value: null,
      settings_json: {},
      position: 4,
      is_active: true,
    } satisfies ConfigurationOperation;

    expect(() =>
      validateAcquisitionCandidate({
        ...payload,
        operations: [...payload.operations, customerName],
      }),
    ).toThrow(/cross-object/i);
  });

  it("rejects Forms that leak a Field from another Object", () => {
    const payload = replaceOperation(
      jobsPayload(),
      (operation) =>
        operation.op === "set_form" && operation.key === "customer_create",
      (operation) =>
        operation.op === "set_form"
          ? {
              ...operation,
              config_json: {
                ...operation.config_json,
                fields: [{ field: "title", hidden: false }],
              },
            }
          : operation,
    );

    expect(() => validateAcquisitionCandidate(payload)).toThrow(
      /unknown Field/i,
    );
  });

  it("rejects choice Fields with empty options", () => {
    const payload = replaceOperation(
      jobsPayload(),
      (operation) =>
        operation.op === "set_field" &&
        operation.object_key === "job" &&
        operation.key === "status",
      (operation) =>
        operation.op === "set_field"
          ? { ...operation, settings_json: { options: [] } }
          : operation,
    );

    expect(() => validateAcquisitionCandidate(payload)).toThrow(
      /needs usable options/i,
    );
  });

  it("rejects a scalar duplicate of a generic Connection", () => {
    const payload = {
      ...jobsPayload(),
      operations: [
        ...jobsPayload().operations,
        {
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
        } satisfies ConfigurationOperation,
      ],
    };

    expect(() => validateAcquisitionCandidate(payload)).toThrow(
      /duplicated by a scalar field/i,
    );
  });

  it("accepts the generic Booking capability with valid mappings", () => {
    const payload = composeStarterComposition(
      "appointments",
      "I run a dog grooming business and customers can book services online.",
    );
    const enhanced = enhanceAcquisitionPayload(
      payload,
      {
        onlineBooking: true,
        usesServices: true,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      "I run a dog grooming business and customers can book services online.",
    );

    expect(
      enhanced.operations.some(
        (operation) =>
          operation.op === "set_page" &&
          operation.layout_json.blocks.some(
            (block) => block.type === "booking",
          ),
      ),
    ).toBe(true);
    expect(() => validateAcquisitionCandidate(enhanced)).not.toThrow();
  });
});
