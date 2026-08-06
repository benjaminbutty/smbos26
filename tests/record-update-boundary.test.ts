import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRecordUpdateConfirmationTokenService } from "../src/ai/builder/record-update-confirmation-token";
import {
  composeConfirmedGraphRecordUpdate,
  RecordUpdateCompositionError,
} from "../src/core/graph/record-update/composer";
import type {
  RecordUpdateField,
  RecordUpdateReadyState,
} from "../src/core/graph/record-update/schemas";

const state: RecordUpdateReadyState = {
  schema_version: 1,
  state: "ready",
  business_id: "11111111-1111-4111-8111-111111111111",
  actor_id: "22222222-2222-4222-8222-222222222222",
  base_version_id: "33333333-3333-4333-8333-333333333333",
  head_revision: 3,
  object_definition_id: "44444444-4444-4444-8444-444444444444",
  object_key: "product",
  singular_label: "Product",
  target_record_id: "55555555-5555-4555-8555-555555555555",
  expected_updated_at: "2026-08-06T10:00:00+00:00",
  selector: {
    field_key: "name",
    field_type: "short_text",
    label: "Name",
    settings_json: {},
    value: "Celebration Box",
  },
  update_fields: [
    {
      key: "name",
      label: "Name",
      field_type: "short_text",
      required: true,
      settings_json: {},
      position: 1,
      is_active: true,
    },
    {
      key: "price",
      label: "Price",
      field_type: "currency",
      required: false,
      settings_json: { currency: "GBP" },
      position: 2,
      is_active: true,
    },
    {
      key: "status",
      label: "Status",
      field_type: "status",
      required: false,
      settings_json: { options: ["Active", "Paused"] },
      position: 3,
      is_active: true,
    },
  ] satisfies RecordUpdateField[],
  current_update_values: [
    { field_key: "name", field_type: "short_text", value: "Celebration Box" },
    { field_key: "price", field_type: "currency", value: 25 },
  ],
  destination_view_key: "products",
};

const intentSelector = {
  field_key: "name",
  field_type: "short_text" as const,
  string_value: "Celebration Box",
};

describe("lean generic Record update boundary", () => {
  it("composes one selector and only the changed values", () => {
    const composition = composeConfirmedGraphRecordUpdate(state, {
      object_key: "product",
      selector: intentSelector,
      field_updates: [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: "Celebration Platter",
        },
        {
          field_key: "price",
          field_type: "currency",
          number_value: 30,
        },
      ],
    });

    expect(composition.selector).toEqual({
      field_key: "name",
      label: "Name",
      formatted_value: "Celebration Box",
    });
    expect(composition.data_patch).toEqual({
      name: "Celebration Platter",
      price: 30,
    });
    expect(composition.destination_view_key).toBe("products");
    expect(composition.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Price",
          formatted_before: "£25.00",
          formatted_after: "£30.00",
        }),
      ]),
    );
  });

  it("rejects selector-field tampering and actual-value no-ops", () => {
    expect(() =>
      composeConfirmedGraphRecordUpdate(state, {
        object_key: "product",
        selector: {
          field_key: "price",
          field_type: "currency",
          number_value: 25,
        },
        field_updates: [
          { field_key: "price", field_type: "currency", number_value: 30 },
        ],
      }),
    ).toThrow(RecordUpdateCompositionError);

    expect(() =>
      composeConfirmedGraphRecordUpdate(state, {
        object_key: "product",
        selector: intentSelector,
        field_updates: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Celebration Box",
          },
          { field_key: "price", field_type: "currency", number_value: 25 },
        ],
      }),
    ).toThrow("already has those values");
  });

  it("validates configured options without normalizing targeting values", () => {
    expect(() =>
      composeConfirmedGraphRecordUpdate(state, {
        object_key: "product",
        selector: intentSelector,
        field_updates: [
          {
            field_key: "status",
            field_type: "status",
            option_value: "Unknown",
          },
        ],
      }),
    ).toThrow("configured");
  });

  it("signs only the server-selected target, currentness and patch", () => {
    const service = createRecordUpdateConfirmationTokenService({
      secret: "0123456789abcdef0123456789abcdef",
      now: () => 1_000,
    });
    const composition = composeConfirmedGraphRecordUpdate(state, {
      object_key: "product",
      selector: intentSelector,
      field_updates: [
        { field_key: "price", field_type: "currency", number_value: 30 },
      ],
    });
    const token = service.sign({
      businessId: state.business_id,
      actorId: state.actor_id,
      baseVersionId: state.base_version_id,
      headRevision: state.head_revision,
      objectDefinitionId: state.object_definition_id,
      objectKey: state.object_key,
      targetRecordId: state.target_record_id,
      expectedRecordCurrentness: { updatedAt: state.expected_updated_at },
      dataPatch: composition.data_patch,
      destinationViewKey: composition.destination_view_key,
    });
    const payload = service.verify(token, {
      businessId: state.business_id,
      actorId: state.actor_id,
    });
    expect(payload).toMatchObject({
      action: "update_record",
      object_key: "product",
      target_record_id: state.target_record_id,
      expected_record_currentness: { updated_at: state.expected_updated_at },
      data_patch: { price: 30 },
    });
    expect(payload).not.toHaveProperty("selector");
    expect(payload).not.toHaveProperty("canonical_selector");
    expect(payload).not.toHaveProperty("target_record_digest");
    expect(() =>
      service.verify(token, {
        businessId: state.business_id,
        actorId: "66666666-6666-4666-8666-666666666666",
      }),
    ).toThrow(/no longer valid|confirmation/i);
  });
});
