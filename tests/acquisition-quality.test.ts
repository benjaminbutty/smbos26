import { describe, expect, it } from "vitest";

import { composeStarterComposition } from "../src/core/acquisition/composer";
import { enhanceAcquisitionPayload } from "../src/core/acquisition/capabilities";
import { parseViewConfig } from "../src/core/experience/schemas";
import {
  setFormOperationSchema,
  setViewOperationSchema,
} from "../src/core/configuration/schemas";
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

  it("reuses a specific subject identity field during Booking enhancement", () => {
    const payload = composeStarterComposition(
      "appointments",
      "I run a dog grooming business and customers can book services online.",
    );
    const dogObject = {
      op: "set_object",
      key: "dog",
      singular_label: "Dog",
      plural_label: "Dogs",
      description: "The dogs customers bring for grooming.",
      icon: null,
      is_active: true,
    } satisfies ConfigurationOperation;
    const dogName = {
      op: "set_field",
      object_key: "dog",
      key: "dog_name",
      label: "Dog name",
      field_type: "short_text",
      required: true,
      default_value: null,
      settings_json: {},
      position: 0,
      is_active: true,
    } satisfies ConfigurationOperation;
    const dogType = {
      ...dogName,
      key: "type",
      label: "Type",
      required: false,
      position: 1,
    } satisfies ConfigurationOperation;
    const enhanced = enhanceAcquisitionPayload(
      {
        ...payload,
        operations: [...payload.operations, dogObject, dogName, dogType],
      },
      {
        onlineBooking: true,
        usesServices: true,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      "I run a dog grooming business and customers can book services online.",
    );

    const dogFields = enhanced.operations.filter(
      (operation) =>
        operation.op === "set_field" && operation.object_key === "dog",
    );
    expect(dogFields).toHaveLength(2);
    expect(
      dogFields.some(
        (field) => field.op === "set_field" && field.label === "Name",
      ),
    ).toBe(false);
    expect(() => validateAcquisitionCandidate(enhanced)).not.toThrow();
  });

  it("chooses a configured status option when an existing Booking status has no default", () => {
    const payload = composeStarterComposition(
      "appointments",
      "I run an appointment business and customers can book online.",
    );
    const withoutStatusDefault = {
      ...payload,
      operations: payload.operations.map((operation) =>
        operation.op === "set_field" &&
        operation.object_key === "appointment" &&
        operation.key === "status"
          ? { ...operation, default_value: null }
          : operation,
      ),
    };
    const enhanced = enhanceAcquisitionPayload(
      withoutStatusDefault,
      {
        onlineBooking: true,
        usesServices: true,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      "I run an appointment business and customers can book online.",
    );

    expect(() => validateAcquisitionCandidate(enhanced)).not.toThrow();
  });

  it("reuses provider-shaped multi-word Booking fields instead of duplicating required fields", () => {
    const fieldMap: Record<string, string> = {
      date: "appointment_date_time",
      status: "appointment_status",
    };
    const payload = composeStarterComposition(
      "appointments",
      "I run an appointment business and customers can book online.",
    );
    const providerShapedOperations = payload.operations.map((operation) => {
      if (
        operation.op === "set_field" &&
        operation.object_key === "appointment" &&
        operation.key === "date"
      ) {
        return {
          ...operation,
          key: "appointment_date_time",
          label: "Appointment date and time",
          field_type: "datetime" as const,
          required: true,
          default_value: null,
        };
      }
      if (
        operation.op === "set_field" &&
        operation.object_key === "appointment" &&
        operation.key === "status"
      ) {
        return {
          ...operation,
          key: "appointment_status",
          label: "Appointment status",
          default_value: "New",
          settings_json: { options: ["New", "Confirmed", "Complete"] },
        };
      }
      if (
        operation.op === "set_form" &&
        operation.object_key === "appointment"
      ) {
        return setFormOperationSchema.parse({
          ...operation,
          config_json: {
            ...operation.config_json,
            fields: operation.config_json.fields.map((field) => ({
              ...field,
              field: fieldMap[field.field] ?? field.field,
            })),
          },
        });
      }
      if (
        operation.op === "set_view" &&
        operation.object_key === "appointment"
      ) {
        const viewConfig = parseViewConfig(
          operation.view_type,
          operation.config_json,
        );
        if (!("columns" in viewConfig)) return operation;
        return setViewOperationSchema.parse({
          ...operation,
          config_json: {
            ...viewConfig,
            fields: viewConfig.fields.map((field) => fieldMap[field] ?? field),
            title_field:
              fieldMap[viewConfig.title_field] ?? viewConfig.title_field,
            columns: viewConfig.columns.map((column) =>
              column.kind === "field"
                ? {
                    ...column,
                    field_key: fieldMap[column.field_key] ?? column.field_key,
                  }
                : column,
            ),
          },
        });
      }
      return operation;
    });
    const enhanced = enhanceAcquisitionPayload(
      { ...payload, operations: providerShapedOperations },
      {
        onlineBooking: true,
        usesServices: true,
        capacityPerSlot: 1,
        publicEnquiry: null,
      },
      "I run an appointment business and customers can book online.",
    );

    const bookingFields = enhanced.operations.filter(
      (operation) =>
        operation.op === "set_field" && operation.object_key === "appointment",
    );
    expect(
      bookingFields.some(
        (field) => field.op === "set_field" && field.key === "starts_at",
      ),
    ).toBe(false);
    expect(
      bookingFields.some(
        (field) => field.op === "set_field" && field.key === "status",
      ),
    ).toBe(false);

    const bookingPage = enhanced.operations.find(
      (operation) =>
        operation.op === "set_page" &&
        operation.layout_json.blocks.some((block) => block.type === "booking"),
    );
    expect(bookingPage?.op).toBe("set_page");
    if (bookingPage?.op !== "set_page") return;
    const bookingBlock = bookingPage.layout_json.blocks.find(
      (block) => block.type === "booking",
    );
    expect(bookingBlock?.type).toBe("booking");
    if (bookingBlock?.type !== "booking") return;
    expect(bookingBlock.config.field_mappings.booking).toMatchObject({
      start_at: "appointment_date_time",
      status: "appointment_status",
      default_status: "New",
    });
    expect(() => validateAcquisitionCandidate(enhanced)).not.toThrow();
  });
});
