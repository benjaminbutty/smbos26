import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composeConfirmedGraphRecordData,
  composeRecordCreationPresentation,
} from "../src/core/graph/record-creation/composer";
import { createRecordConfirmationTokenService } from "../src/ai/builder/record-confirmation-token";

const state = {
  schema_version: 1 as const,
  business_id: "11111111-1111-4111-8111-111111111111",
  actor_id: "22222222-2222-4222-8222-222222222222",
  base_version_id: "33333333-3333-4333-8333-333333333333",
  head_revision: 1,
  object_definition_id: "44444444-4444-4444-8444-444444444444",
  object_key: "product",
  singular_label: "Product",
  plural_label: "Products",
  is_active: true,
  eligibility: { eligible: true, reason_codes: [] },
  object_schema_digest: "a".repeat(64),
  record_state_digest: "b".repeat(64),
  fields: [
    {
      key: "name",
      label: "Name",
      field_type: "short_text" as const,
      required: true,
      default_value: null,
      settings_json: {},
      position: 1,
      is_active: true,
    },
    {
      key: "price",
      label: "Price",
      field_type: "currency" as const,
      required: false,
      default_value: null,
      settings_json: { currency: "GBP" },
      position: 2,
      is_active: true,
    },
    {
      key: "status",
      label: "Status",
      field_type: "status" as const,
      required: true,
      default_value: "Active",
      settings_json: { options: ["Active", "Paused"] },
      position: 3,
      is_active: true,
    },
  ],
  internal_views: [
    {
      key: "products",
      name: "Products",
      view_type: "table" as const,
      object_key: "product",
    },
  ],
};

const fieldValues = [
  {
    field_key: "name",
    field_type: "short_text" as const,
    string_value: "Afternoon Tea Box",
  },
  { field_key: "price", field_type: "currency" as const, number_value: 30 },
];

describe("generic Record creation confirmation boundary", () => {
  it("canonicalizes explicit values, shows defaults, and omits defaults from data", () => {
    const composition = composeRecordCreationPresentation(state, fieldValues);
    expect(composition.requested_data).toEqual({
      name: "Afternoon Tea Box",
      price: 30,
    });
    expect(composition.default_fields).toMatchObject([
      { label: "Status", formatted_value: "Active", source: "default" },
    ]);
    expect(composition.explicit_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Price",
          formatted_value: "£30.00",
          source: "explicit",
        }),
      ]),
    );
    expect(
      composeConfirmedGraphRecordData(state, fieldValues).requestedData,
    ).toEqual(composition.requested_data);
  });

  it("binds the bounded token to the actor, currentness and typed values", () => {
    const service = createRecordConfirmationTokenService({
      secret: "0123456789abcdef0123456789abcdef",
      now: () => 1_000,
    });
    const token = service.sign({
      businessId: state.business_id,
      actorId: state.actor_id,
      baseVersionId: state.base_version_id,
      headRevision: state.head_revision,
      objectKey: state.object_key,
      objectSchemaDigest: state.object_schema_digest,
      recordStateDigest: state.record_state_digest,
      fieldValues,
    });
    expect(
      service.verify(token, {
        businessId: state.business_id,
        actorId: state.actor_id,
      }),
    ).toMatchObject({
      action: "create_record",
      object_key: "product",
      head_revision: 1,
    });
    expect(() =>
      service.verify(token, {
        businessId: state.business_id,
        actorId: state.business_id,
      }),
    ).toThrow(/no longer valid|confirmation/i);
  });
});
