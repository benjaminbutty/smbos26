import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRecordUpdateConfirmationTokenService } from "../src/ai/builder/record-update-confirmation-token";
import {
  composeConfirmedGraphRecordUpdate,
  RecordUpdateCompositionError,
} from "../src/core/graph/record-update/composer";
import { parseRecordUpdateSelector } from "../src/core/graph/record-update/selector";
import type {
  RecordUpdateField,
  RecordUpdateReadyState,
} from "../src/core/graph/record-update/schemas";

const objectId = "44444444-4444-4444-8444-444444444444";

const fields: RecordUpdateField[] = [
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
];

const state: RecordUpdateReadyState = {
  schema_version: 1,
  state: "ready",
  business_id: "11111111-1111-4111-8111-111111111111",
  actor_id: "22222222-2222-4222-8222-222222222222",
  base_version_id: "33333333-3333-4333-8333-333333333333",
  head_revision: 3,
  object_definition_id: objectId,
  object_key: "product",
  singular_label: "Product",
  object_schema_digest: "a".repeat(64),
  canonical_selector: {
    schema_version: 1,
    object_definition_id: objectId,
    clauses: [
      {
        field_key: "name",
        field_type: "short_text",
        string_value: "celebration box",
      },
    ],
  },
  selector_digest: "c".repeat(64),
  target_record_id: "55555555-5555-4555-8555-555555555555",
  target_record_digest: "b".repeat(64),
  selector_current_values: [
    {
      field_key: "name",
      field_type: "short_text",
      label: "Name",
      settings_json: {},
      value: "Celebration Box",
    },
  ],
  update_fields: fields,
  current_update_values: [
    { field_key: "name", field_type: "short_text", value: "Celebration Box" },
    { field_key: "price", field_type: "currency", value: 25 },
  ],
  internal_views: [
    {
      key: "products",
      name: "Products",
      view_type: "table",
      object_key: "product",
    },
  ],
};

describe("generic Record update boundary", () => {
  it("canonicalizes selectors and composes only the changed fields", () => {
    const parsedSelector = parseRecordUpdateSelector(
      [
        {
          field_key: "status",
          field_type: "status",
          option_value: " active ",
        },
        {
          field_key: "name",
          field_type: "short_text",
          string_value: " Celebration Box ",
        },
      ],
      fields,
    );
    expect(parsedSelector).toEqual([
      {
        field_key: "name",
        field_type: "short_text",
        string_value: "celebration box",
      },
      {
        field_key: "status",
        field_type: "status",
        option_value: "Active",
      },
    ]);

    const composition = composeConfirmedGraphRecordUpdate(state, {
      object_key: "product",
      selector_clauses: [
        {
          field_key: "name",
          field_type: "short_text",
          string_value: " Celebration Box ",
        },
      ],
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

  it("rejects selector tampering and no-op updates", () => {
    expect(() =>
      composeConfirmedGraphRecordUpdate(state, {
        object_key: "product",
        selector_clauses: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Other Product",
          },
        ],
        field_updates: [
          {
            field_key: "price",
            field_type: "currency",
            number_value: 30,
          },
        ],
      }),
    ).toThrow(RecordUpdateCompositionError);

    expect(() =>
      composeConfirmedGraphRecordUpdate(state, {
        object_key: "product",
        selector_clauses: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Celebration Box",
          },
        ],
        field_updates: [
          {
            field_key: "name",
            field_type: "short_text",
            string_value: "Celebration Box",
          },
          {
            field_key: "price",
            field_type: "currency",
            number_value: 25,
          },
        ],
      }),
    ).toThrow("already has those values");
  });

  it("rejects padded phone selectors and unknown options", () => {
    expect(() =>
      parseRecordUpdateSelector(
        [
          {
            field_key: "phone",
            field_type: "phone",
            string_value: " 020 0000 0000 ",
          },
        ],
        [
          ...fields,
          {
            key: "phone",
            label: "Phone",
            field_type: "phone",
            required: false,
            settings_json: {},
            position: 4,
            is_active: true,
          },
        ],
      ),
    ).toThrow("invalid");
    expect(() =>
      parseRecordUpdateSelector(
        [
          {
            field_key: "status",
            field_type: "status",
            option_value: "Unknown",
          },
        ],
        fields,
      ),
    ).toThrow("configured");
  });

  it("binds the update token to identity, selector, target and patch", () => {
    const service = createRecordUpdateConfirmationTokenService({
      secret: "0123456789abcdef0123456789abcdef",
      now: () => 1_000,
    });
    const composition = composeConfirmedGraphRecordUpdate(state, {
      object_key: "product",
      selector_clauses: state.canonical_selector.clauses,
      field_updates: [
        {
          field_key: "price",
          field_type: "currency",
          number_value: 30,
        },
      ],
    });
    const token = service.sign({
      businessId: state.business_id,
      actorId: state.actor_id,
      baseVersionId: state.base_version_id,
      headRevision: state.head_revision,
      objectDefinitionId: state.object_definition_id,
      objectKey: state.object_key,
      objectSchemaDigest: state.object_schema_digest,
      canonicalSelector: composition.canonical_selector,
      selectorDigest: state.selector_digest,
      targetRecordId: state.target_record_id,
      targetRecordDigest: state.target_record_digest,
      dataPatch: composition.data_patch,
      destinationViewKey: composition.destination_view_key,
    });
    expect(
      service.verify(token, {
        businessId: state.business_id,
        actorId: state.actor_id,
      }),
    ).toMatchObject({
      action: "update_record",
      object_key: "product",
      target_record_id: state.target_record_id,
      data_patch: { price: 30 },
    });
    expect(() =>
      service.verify(token, {
        businessId: state.business_id,
        actorId: "66666666-6666-4666-8666-666666666666",
      }),
    ).toThrow(/no longer valid|confirmation/i);
  });
});
