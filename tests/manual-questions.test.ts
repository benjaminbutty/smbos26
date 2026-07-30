import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConfigurationSnapshotV1 } from "../src/core/configuration/definition-source";
import {
  addPreorderQuestionIntentSchema,
  manualNewPreorderQuestionFormSchema,
  updatePreorderQuestionIntentSchema,
} from "../src/core/configuration/manual-amendments/schemas";
import {
  composeNewPreorderQuestionAmendment,
  composePreorderQuestionAmendment,
  derivePreorderQuestionFieldKey,
  getPreorderQuestionsSetup,
  ManualAmendmentError,
} from "../src/core/configuration/manual-amendments/service";
import {
  configurationOperationsSchema,
  setFieldOperationSchema,
  setPreorderExperienceOperationSchema,
} from "../src/core/configuration/schemas";
import { graphKeySchema } from "../src/core/graph/schemas";

const ids = {
  preorder: "00000000-0000-4000-8000-000000000001",
  location: "00000000-0000-4000-8000-000000000002",
  product: "00000000-0000-4000-8000-000000000010",
  customer: "00000000-0000-4000-8000-000000000011",
  order: "00000000-0000-4000-8000-000000000012",
  orderItem: "00000000-0000-4000-8000-000000000013",
};

function object(
  id: string,
  key: string,
  singularLabel: string,
): ConfigurationSnapshotV1["object_definitions"][number] {
  return {
    id,
    key,
    singular_label: singularLabel,
    plural_label: `${singularLabel}s`,
    description: "",
    kind: "template",
    semantic_type: key,
    icon: null,
    is_active: true,
  };
}

function field(
  objectId: string,
  objectKey: string,
  key: string,
  label: string,
  fieldType: ConfigurationSnapshotV1["field_definitions"][number]["field_type"],
  required: boolean,
  position: number,
  options: {
    active?: boolean;
    defaultValue?: ConfigurationSnapshotV1["field_definitions"][number]["default_value"];
    settings?: ConfigurationSnapshotV1["field_definitions"][number]["settings_json"];
  } = {},
): ConfigurationSnapshotV1["field_definitions"][number] {
  return {
    id: crypto.randomUUID(),
    object_definition_id: objectId,
    object_key: objectKey,
    key,
    label,
    field_type: fieldType,
    required,
    default_value: options.defaultValue ?? null,
    settings_json: options.settings ?? {},
    position,
    is_active: options.active ?? true,
  };
}

const baseConfig = {
  schedule: {
    days_of_week: [6, 7],
    start_time: "09:00",
    end_time: "15:00",
    slot_interval_minutes: 30,
    slot_capacity: 10,
    cutoff_hours: 48,
    booking_horizon_days: 30,
  },
  field_mappings: {
    product: {
      name: "name",
      description: "description",
      price: "price",
      image: "image",
      status: "status",
      active_status_value: "Active",
    },
    customer: { name: "name", email: "email", phone: "phone" },
    order: {
      public_reference: "public_reference",
      status: "status",
      new_status_value: "New",
      collection_at: "collection_at",
      collection_local_display: "collection_local_display",
      collection_timezone: "collection_timezone",
      collection_location_name: "collection_location_name",
      customer_name: "customer_name",
      customer_email: "customer_email",
      customer_phone: "customer_phone",
      item_summary: "item_summary",
      total: "total",
    },
    order_item: {
      product_name: "product_name",
      quantity: "quantity",
      unit_price: "unit_price",
      line_total: "line_total",
    },
  },
  public_fields: [
    {
      target: "customer" as const,
      field: "name",
      label: "Name",
      required: true,
      autocomplete: "name" as const,
    },
    {
      target: "customer" as const,
      field: "email",
      label: "Email",
      required: true,
      autocomplete: "email" as const,
    },
    {
      target: "customer" as const,
      field: "phone",
      label: "Phone",
      required: true,
      help_text: "We will only call about your order.",
      autocomplete: "tel" as const,
    },
    {
      target: "order" as const,
      field: "dietary_requirements",
      label: "Dietary requirements",
      required: false,
      help_text: "Tell us about dietary needs.",
      autocomplete: "off" as const,
    },
  ],
};

function snapshot(): ConfigurationSnapshotV1 {
  return {
    schema_version: 1,
    object_definitions: [
      object(ids.product, "product", "Product"),
      object(ids.customer, "customer", "Customer"),
      object(ids.order, "order", "Order"),
      object(ids.orderItem, "order_item", "Order item"),
    ],
    field_definitions: [
      field(ids.customer, "customer", "name", "Name", "short_text", true, 0),
      field(ids.customer, "customer", "email", "Email", "email", true, 1),
      field(ids.customer, "customer", "phone", "Telephone", "phone", true, 2, {
        defaultValue: null,
        settings: { format: "national" },
      }),
      field(
        ids.order,
        "order",
        "dietary_requirements",
        "Dietary Requirements",
        "long_text",
        false,
        9,
      ),
      field(
        ids.order,
        "order",
        "occasion",
        "Occasion",
        "short_text",
        false,
        10,
      ),
      field(
        ids.order,
        "order",
        "gift_message",
        "Former Gift Message",
        "long_text",
        false,
        20,
        { active: false },
      ),
    ],
    relationship_definitions: [],
    views: [],
    forms: [],
    pages: [
      {
        id: "00000000-0000-4000-8000-000000000030",
        key: "public_preorder",
        title: "Bedford Bakery preorder",
        slug: "preorder",
        audience: "public",
        layout_json: {
          blocks: [{ type: "preorder", preorder_key: "bakery_preorder" }],
        },
        status: "published",
        is_active: true,
      },
    ],
    preorder_experiences: [
      {
        id: ids.preorder,
        key: "bakery_preorder",
        product_object_definition_id: ids.product,
        product_object_key: "product",
        customer_object_definition_id: ids.customer,
        customer_object_key: "customer",
        order_object_definition_id: ids.order,
        order_object_key: "order",
        order_item_object_definition_id: ids.orderItem,
        order_item_object_key: "order_item",
        customer_places_order_relationship_definition_id:
          "00000000-0000-4000-8000-000000000040",
        customer_places_order_relationship_key: "customer_places_order",
        order_contains_item_relationship_definition_id:
          "00000000-0000-4000-8000-000000000041",
        order_contains_item_relationship_key: "order_contains_order_item",
        product_appears_in_item_relationship_definition_id:
          "00000000-0000-4000-8000-000000000042",
        product_appears_in_item_relationship_key:
          "product_appears_in_order_item",
        config_json: structuredClone(baseConfig),
        is_active: true,
      },
    ],
    preorder_experience_locations: [
      {
        id: "00000000-0000-4000-8000-000000000050",
        preorder_experience_id: ids.preorder,
        preorder_key: "bakery_preorder",
        location_id: ids.location,
        is_active: true,
      },
    ],
  };
}

function updateIntent(
  changes: Partial<{
    target: "customer" | "order";
    fieldKey: string;
    label: string;
    helpText: string | null;
    required: boolean;
  }> = {},
): Parameters<typeof composePreorderQuestionAmendment>[1] {
  return {
    intent: "update_preorder_question",
    preorderKey: "bakery_preorder",
    target: "customer",
    fieldKey: "phone",
    label: "Phone",
    helpText: "We will only call about your order.",
    required: true,
    ...changes,
  };
}

function addIntent(
  changes: Partial<{
    label: string;
    helpText: string | null;
    required: boolean;
    answerStyle: "short_answer" | "long_answer";
  }> = {},
): Parameters<typeof composeNewPreorderQuestionAmendment>[1] {
  return {
    intent: "add_preorder_question",
    preorderKey: "bakery_preorder",
    label: "Delivery note",
    helpText: null,
    required: false,
    answerStyle: "short_answer",
    ...changes,
  };
}

describe("deterministic preorder question amendments", () => {
  it("changes wording only on the public question and preserves the generic Field", () => {
    const active = snapshot();
    const composed = composePreorderQuestionAmendment(
      active,
      updateIntent({ label: "Best contact number" }),
    );
    expect(composed.operations).toHaveLength(1);
    const preorder = composed.operations[0]!;
    expect(preorder.op).toBe("set_preorder_experience");
    if (preorder.op !== "set_preorder_experience") {
      throw new Error("Expected a preorder operation.");
    }
    expect(preorder.config_json.public_fields[2]?.label).toBe(
      "Best contact number",
    );
    expect(
      active.field_definitions.find((candidate) => candidate.key === "phone"),
    ).toMatchObject({
      label: "Telephone",
      field_type: "phone",
      required: true,
      settings_json: { format: "national" },
      position: 2,
      is_active: true,
    });
  });

  it("adds, changes and removes help text while preserving autocomplete", () => {
    const noHelp = snapshot();
    delete noHelp.preorder_experiences[0]!.config_json.public_fields[2]!
      .help_text;
    const added = composePreorderQuestionAmendment(
      noHelp,
      updateIntent({ helpText: "Include an area code." }),
    );
    const changed = composePreorderQuestionAmendment(
      snapshot(),
      updateIntent({ helpText: "Include an area code." }),
    );
    const removed = composePreorderQuestionAmendment(
      snapshot(),
      updateIntent({ helpText: "   " }),
    );
    for (const [composed, expected] of [
      [added, "Include an area code."],
      [changed, "Include an area code."],
      [removed, undefined],
    ] as const) {
      const operation = composed.operations.at(-1)!;
      expect(operation.op).toBe("set_preorder_experience");
      if (operation.op === "set_preorder_experience") {
        expect(operation.config_json.public_fields[2]?.help_text).toBe(
          expected,
        );
        expect(operation.config_json.public_fields[2]?.autocomplete).toBe(
          "tel",
        );
      }
    }
  });

  it("preserves every other question and its exact order", () => {
    const active = snapshot();
    const composed = composePreorderQuestionAmendment(
      active,
      updateIntent({ label: "Contact phone" }),
    );
    const operation = composed.operations.at(-1)!;
    expect(operation.op).toBe("set_preorder_experience");
    if (operation.op === "set_preorder_experience") {
      expect(
        operation.config_json.public_fields.map((item) => item.field),
      ).toEqual(baseConfig.public_fields.map((item) => item.field));
      expect(operation.config_json.public_fields[0]).toEqual(
        baseConfig.public_fields[0],
      );
      expect(operation.config_json.public_fields[1]).toEqual(
        baseConfig.public_fields[1],
      );
      expect(operation.config_json.public_fields[3]).toEqual(
        baseConfig.public_fields[3],
      );
    }
  });

  it("preserves schedule, mappings, graph identities, Locations and activation", () => {
    const active = snapshot();
    const composed = composePreorderQuestionAmendment(
      active,
      updateIntent({ label: "Contact phone" }),
    );
    const operation = composed.operations.at(-1)!;
    expect(operation).toMatchObject({
      op: "set_preorder_experience",
      key: "bakery_preorder",
      product_object_key: "product",
      customer_object_key: "customer",
      order_object_key: "order",
      order_item_object_key: "order_item",
      customer_places_order_relationship_key: "customer_places_order",
      order_contains_item_relationship_key: "order_contains_order_item",
      product_appears_in_item_relationship_key: "product_appears_in_order_item",
      allowed_location_ids: [ids.location],
      is_active: true,
    });
    if (operation.op === "set_preorder_experience") {
      expect(operation.config_json.schedule).toEqual(baseConfig.schedule);
      expect(operation.config_json.field_mappings).toEqual(
        baseConfig.field_mappings,
      );
    }
  });

  it("making a globally required question optional emits both complete operations", () => {
    const composed = composePreorderQuestionAmendment(
      snapshot(),
      updateIntent({ required: false }),
    );
    expect(composed.operations).toHaveLength(2);
    expect(setFieldOperationSchema.parse(composed.operations[0])).toMatchObject(
      {
        op: "set_field",
        object_key: "customer",
        key: "phone",
        label: "Telephone",
        field_type: "phone",
        required: false,
        default_value: null,
        settings_json: { format: "national" },
        position: 2,
        is_active: true,
      },
    );
    const preorder = setPreorderExperienceOperationSchema.parse(
      composed.operations[1],
    );
    expect(preorder.config_json.public_fields[2]?.required).toBe(false);
  });

  it("still relaxes a globally required Field when the public question is already optional", () => {
    const active = snapshot();
    active.preorder_experiences[0]!.config_json.public_fields[2]!.required = false;
    const composed = composePreorderQuestionAmendment(
      active,
      updateIntent({ required: false }),
    );
    expect(composed.noOp).toBe(false);
    expect(composed.description).toBe("Make Phone optional");
    expect(composed.operations.map((operation) => operation.op)).toEqual([
      "set_field",
      "set_preorder_experience",
    ]);
  });

  it("making a globally optional question required never tightens the generic Field", () => {
    const active = snapshot();
    active.field_definitions.find(
      (candidate) => candidate.key === "phone",
    )!.required = false;
    active.preorder_experiences[0]!.config_json.public_fields[2]!.required = false;
    const composed = composePreorderQuestionAmendment(
      active,
      updateIntent({ required: true }),
    );
    expect(composed.operations).toHaveLength(1);
    expect(composed.operations[0]?.op).toBe("set_preorder_experience");
  });

  it("label and help changes do not emit an unnecessary Field operation", () => {
    const composed = composePreorderQuestionAmendment(
      snapshot(),
      updateIntent({
        label: "Contact number",
        helpText: "Only for collection updates.",
      }),
    );
    expect(composed.operations.map((operation) => operation.op)).toEqual([
      "set_preorder_experience",
    ]);
  });

  it("treats identical edits and equivalent empty help as semantic no-ops", () => {
    const identical = composePreorderQuestionAmendment(
      snapshot(),
      updateIntent(),
    );
    expect(identical.noOp).toBe(true);
    expect(identical.description).toBe("");

    const noHelp = snapshot();
    delete noHelp.preorder_experiences[0]!.config_json.public_fields[1]!
      .help_text;
    const equivalent = composePreorderQuestionAmendment(noHelp, {
      ...updateIntent({
        fieldKey: "email",
        label: "Email",
        helpText: "  ",
      }),
    });
    expect(equivalent.noOp).toBe(true);
  });

  it("fails safely for missing, archived, non-public and ambiguous questions", () => {
    expect(() =>
      composePreorderQuestionAmendment(
        snapshot(),
        updateIntent({ fieldKey: "missing" }),
      ),
    ).toThrowError(ManualAmendmentError);

    const archived = snapshot();
    archived.field_definitions.find(
      (candidate) => candidate.key === "phone",
    )!.is_active = false;
    expect(() =>
      composePreorderQuestionAmendment(archived, updateIntent()),
    ).toThrowError("no longer available");

    expect(() =>
      composePreorderQuestionAmendment(
        snapshot(),
        updateIntent({
          target: "order",
          fieldKey: "occasion",
          label: "Occasion",
          helpText: null,
          required: false,
        }),
      ),
    ).toThrowError("no longer available");

    const ambiguous = snapshot();
    ambiguous.field_definitions.push(
      structuredClone(
        ambiguous.field_definitions.find(
          (candidate) => candidate.key === "phone",
        )!,
      ),
    );
    expect(() =>
      composePreorderQuestionAmendment(ambiguous, updateIntent()),
    ).toThrowError("could not be identified safely");
  });

  it("fails safely for missing, archived or inconsistent preorder identities", () => {
    const missing = snapshot();
    expect(() =>
      composePreorderQuestionAmendment(missing, {
        ...updateIntent(),
        preorderKey: "missing",
      }),
    ).toThrowError("no longer available");

    const archived = snapshot();
    archived.preorder_experiences[0]!.is_active = false;
    expect(() =>
      composePreorderQuestionAmendment(archived, updateIntent()),
    ).toThrowError("no longer available");

    const inconsistent = snapshot();
    inconsistent.field_definitions.find(
      (candidate) => candidate.key === "phone",
    )!.object_definition_id = ids.order;
    expect(() =>
      composePreorderQuestionAmendment(inconsistent, updateIntent()),
    ).toThrowError("could not be identified safely");
  });

  it("passes every existing-question operation through the strict schemas", () => {
    const composed = composePreorderQuestionAmendment(
      snapshot(),
      updateIntent({ label: "Contact number", required: false }),
    );
    expect(configurationOperationsSchema.parse(composed.operations)).toEqual(
      composed.operations,
    );
  });

  it("creates exactly one optional short_text Field and one appended public question", () => {
    const active = snapshot();
    const composed = composeNewPreorderQuestionAmendment(active, addIntent());
    expect(composed.operations).toHaveLength(2);
    expect(composed.operations[0]).toMatchObject({
      op: "set_field",
      object_key: "order",
      key: "delivery_note",
      label: "Delivery note",
      field_type: "short_text",
      required: false,
      default_value: null,
      settings_json: {},
      is_active: true,
    });
    expect(composed.operations[1].config_json.public_fields.at(-1)).toEqual({
      target: "order",
      field: "delivery_note",
      label: "Delivery note",
      required: false,
      autocomplete: "off",
    });
  });

  it("maps long answers to long_text while global requiredness stays false", () => {
    const composed = composeNewPreorderQuestionAmendment(
      snapshot(),
      addIntent({
        label: "Packing instructions",
        answerStyle: "long_answer",
        required: true,
        helpText: "Tell us how to pack this order.",
      }),
    );
    expect(composed.operations[0]).toMatchObject({
      field_type: "long_text",
      required: false,
    });
    expect(
      composed.operations[1].config_json.public_fields.at(-1),
    ).toMatchObject({
      target: "order",
      label: "Packing instructions",
      required: true,
      help_text: "Tell us how to pack this order.",
    });
  });

  it("derives graph-safe bounded keys without accepting a browser key", () => {
    const composed = composeNewPreorderQuestionAmendment(
      snapshot(),
      addIntent({ label: "  21st Birthday — Message!  " }),
    );
    expect(composed.fieldKey).toBe("question_21st_birthday_message");
    expect(graphKeySchema.parse(composed.fieldKey)).toBe(composed.fieldKey);
    expect(composed.fieldKey.length).toBeLessThanOrEqual(80);
    expect(
      addPreorderQuestionIntentSchema.safeParse({
        ...addIntent(),
        fieldKey: "forged",
        target: "customer",
        objectKey: "customer",
      }).success,
    ).toBe(false);
    expect(
      manualNewPreorderQuestionFormSchema.safeParse({
        expectedBaseVersionId: crypto.randomUUID(),
        expectedHeadRevision: 2,
        label: "Gift message",
        helpText: null,
        answerStyle: "long_answer",
        required: false,
        fieldKey: "forged",
      }).success,
    ).toBe(false);
  });

  it("suffixes collisions deterministically, including archived Field keys", () => {
    expect(
      derivePreorderQuestionFieldKey("Gift message", [
        "gift_message",
        "gift_message_2",
      ]),
    ).toBe("gift_message_3");
    expect(
      composeNewPreorderQuestionAmendment(
        snapshot(),
        addIntent({ label: "Gift message" }),
      ).fieldKey,
    ).toBe("gift_message_2");
  });

  it("places a new Field deterministically after the highest active or archived position", () => {
    const composed = composeNewPreorderQuestionAmendment(
      snapshot(),
      addIntent(),
    );
    expect(composed.operations[0].position).toBe(21);
  });

  it("rejects duplicate active public labels case-insensitively after normalization", () => {
    expect(() =>
      composeNewPreorderQuestionAmendment(
        snapshot(),
        addIntent({ label: "  DIETARY   REQUIREMENTS  " }),
      ),
    ).toThrowError("already exists");
  });

  it("appends without changing existing order or any non-question preorder property", () => {
    const active = snapshot();
    const before = active.preorder_experiences[0]!;
    const composed = composeNewPreorderQuestionAmendment(active, addIntent());
    const preorder = composed.operations[1];
    expect(preorder.config_json.public_fields.slice(0, -1)).toEqual(
      before.config_json.public_fields,
    );
    expect(preorder.config_json.schedule).toEqual(before.config_json.schedule);
    expect(preorder.config_json.field_mappings).toEqual(
      before.config_json.field_mappings,
    );
    expect(preorder.allowed_location_ids).toEqual([ids.location]);
    expect(preorder).toMatchObject({
      product_object_key: before.product_object_key,
      customer_object_key: before.customer_object_key,
      order_object_key: before.order_object_key,
      order_item_object_key: before.order_item_object_key,
      customer_places_order_relationship_key:
        before.customer_places_order_relationship_key,
      order_contains_item_relationship_key:
        before.order_contains_item_relationship_key,
      product_appears_in_item_relationship_key:
        before.product_appears_in_item_relationship_key,
      is_active: before.is_active,
    });
  });

  it("builds owner-readable metadata without keys, IDs, JSON or operation grammar", () => {
    const existing = composePreorderQuestionAmendment(
      snapshot(),
      updateIntent({
        label: "Best phone number",
        helpText: null,
        required: false,
      }),
    );
    expect(existing.description).toContain(
      "Change question wording from Phone to Best phone number",
    );
    expect(existing.description).toContain("Make Best phone number optional");
    expect(existing.description).toContain(
      "Remove help text from Best phone number",
    );
    const added = composeNewPreorderQuestionAmendment(
      snapshot(),
      addIntent({ label: "Gift message", answerStyle: "long_answer" }),
    );
    expect(added.description).toBe("Add optional question Gift message");
    for (const description of [existing.description, added.description]) {
      expect(description).not.toMatch(
        /set_field|set_preorder|object_key|fieldKey|config_json|[{}[\]]|00000000|gift_message/i,
      );
    }
  });

  it("lists owner-facing questions without exposing their keys as labels", () => {
    const setup = getPreorderQuestionsSetup(snapshot(), "bakery_preorder");
    expect(setup.label).toBe("Bedford Bakery preorder");
    expect(setup.questions.map((question) => question.label)).toEqual([
      "Name",
      "Email",
      "Phone",
      "Dietary requirements",
    ]);
  });

  it("keeps intents and source boundaries narrow, deterministic and non-AI", () => {
    expect(
      updatePreorderQuestionIntentSchema.safeParse({
        ...updateIntent(),
        operations: [{ op: "set_object" }],
        publicFields: [],
        objectKey: "order",
        businessId: crypto.randomUUID(),
      }).success,
    ).toBe(false);

    const sourceFiles = [
      "../src/core/configuration/manual-amendments/service.ts",
      "../src/app/app/[businessSlug]/setup/actions.ts",
      "../src/app/app/[businessSlug]/setup/preorder/[preorderKey]/questions/page.tsx",
      "../src/app/app/[businessSlug]/setup/preorder/[preorderKey]/questions/new/page.tsx",
      "../src/app/app/[businessSlug]/setup/preorder/[preorderKey]/questions/[target]/[fieldKey]/page.tsx",
    ];
    const source = sourceFiles
      .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /\.(?:insert|update|upsert|delete)\(|service[_-]?role|createAdminClient|src\/ai|from ["'][^"']*\/ai\//i,
    );
    expect(source).not.toMatch(
      /\.from\(\s*["'](?:object_definitions|field_definitions|relationship_definitions|views|forms|pages|preorder_experiences|preorder_experience_locations)["']\s*\)/,
    );
    expect(source).not.toMatch(
      /\.validateChangeSet\(|\.applyChangeSet\(|ai_execution_runs|fetch\(|provider/i,
    );
    expect(source).not.toMatch(/name=["'](?:fieldKey|objectKey)["']/);
    expect(source).not.toMatch(/raw JSON|JSON editor/i);
  });
});
