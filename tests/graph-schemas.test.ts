import { describe, expect, it } from "vitest";

import {
  createFieldDefinitionSchema,
  createObjectDefinitionSchema,
  createRecordSchema,
  graphFieldTypeSchema,
  relationshipCardinalitySchema,
} from "../src/core/graph/schemas";

describe("graph operation schemas", () => {
  it("recognizes every v0.1 field type", () => {
    const fieldTypes = [
      "short_text",
      "long_text",
      "number",
      "currency",
      "boolean",
      "date",
      "datetime",
      "email",
      "phone",
      "url",
      "select",
      "multi_select",
      "file",
      "status",
    ];

    expect(
      fieldTypes.map((fieldType) => graphFieldTypeSchema.parse(fieldType)),
    ).toEqual(fieldTypes);
  });

  it("accepts only stable machine keys", () => {
    expect(
      createObjectDefinitionSchema.parse({
        key: "catering_enquiry",
        singularLabel: "Catering Enquiry",
        pluralLabel: "Catering Enquiries",
        kind: "custom",
      }).key,
    ).toBe("catering_enquiry");

    expect(() =>
      createObjectDefinitionSchema.parse({
        key: "Catering Enquiry",
        singularLabel: "Catering Enquiry",
        pluralLabel: "Catering Enquiries",
        kind: "custom",
      }),
    ).toThrow();
  });

  it("preserves field settings, defaults, position and archive state", () => {
    expect(
      createFieldDefinitionSchema.parse({
        objectDefinitionId: crypto.randomUUID(),
        key: "status",
        label: "Status",
        fieldType: "status",
        required: true,
        defaultValue: "New",
        settings: { options: ["New", "Confirmed"] },
        position: 5,
        isActive: false,
      }),
    ).toMatchObject({
      defaultValue: "New",
      isActive: false,
      position: 5,
      required: true,
      settings: { options: ["New", "Confirmed"] },
    });
  });

  it("accepts the three relationship cardinalities", () => {
    expect(
      ["one_to_one", "one_to_many", "many_to_many"].map((cardinality) =>
        relationshipCardinalitySchema.parse(cardinality),
      ),
    ).toEqual(["one_to_one", "one_to_many", "many_to_many"]);
  });

  it("rejects non-JSON record values before persistence", () => {
    expect(() =>
      createRecordSchema.parse({
        objectDefinitionId: crypto.randomUUID(),
        data: { invalid: undefined },
      }),
    ).toThrow();
  });
});
