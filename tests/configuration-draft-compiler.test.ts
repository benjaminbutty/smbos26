import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../src/core/configuration/definition-source";
import {
  configurationDraftCompilerInputSchema,
  configurationDraftCompilerOutputSchema,
} from "../src/core/configuration/draft-compiler/contracts";
import { compileConfigurationDraft } from "../src/core/configuration/draft-compiler/compiler";
import {
  ConfigurationDraftCompilerError,
  configurationDraftCompilerErrorCodes,
} from "../src/core/configuration/draft-compiler/errors";
import {
  createGraphKeyAllocator,
  createPageSlugAllocator,
  normaliseGraphKeyBase,
  normalisePageSlugBase,
} from "../src/core/configuration/draft-compiler/key-allocation";
import {
  builderConfigurationDraftOutputSchema,
  builderConfigurationDraftTaskInputBaseSchema,
  type BuilderConfigurationDraftOutput,
} from "../src/ai/configuration-drafting/schemas";
import { configurationOperationsSchema } from "../src/core/configuration/schemas";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function id(number: number): string {
  return `00000000-0000-4000-8000-${number.toString().padStart(12, "0")}`;
}

const platformCapabilities = {
  registry_version: 1 as const,
  field_types: [
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
  ],
  relationship_cardinalities: ["one_to_one", "one_to_many", "many_to_many"],
  view_types: ["table", "list", "cards", "detail"],
  form_modes: ["create", "edit"],
  page_block_types: ["heading", "text", "view", "form", "divider"],
  configuration_operation_names: [
    "set_object",
    "set_field",
    "set_relationship",
    "set_view",
    "set_form",
    "set_page",
    "set_preorder_experience",
  ],
  reusable_capabilities: [
    "generic_graph",
    "generic_records",
    "generic_record_connections",
    "configured_views_forms_pages",
    "published_public_pages",
    "trusted_public_preorder",
    "immutable_configuration_versions",
    "configuration_candidate_preview",
    "manual_preorder_schedule_amendments",
    "manual_preorder_question_amendments",
    "record_to_location_connections",
  ],
  unavailable: {
    workflows: true as const,
    rules: true as const,
    arbitrary_code: true as const,
  },
  change_lanes: [
    {
      name: "configuration" as const,
      supports: [
        "objects",
        "fields",
        "relationships",
        "views",
        "forms",
        "pages",
        "preorder_experiences",
      ],
      mechanism: "proposal_preview_validation_deliberate_application" as const,
    },
    {
      name: "operational" as const,
      supports: ["records", "locations", "record_to_location_connections"],
      mechanism: "narrow_deterministic_services" as const,
    },
  ],
};

function context() {
  return {
    schema_version: 1 as const,
    business: {
      name: "Example Business",
      business_type: "catering" as const,
      timezone: "Europe/London",
    },
    access: {
      role: "owner" as const,
      capabilities: ["manage_configuration" as const],
    },
    active_configuration: { version_number: 2, revision: 4 },
    locations: [],
    objects: [
      {
        key: "customer",
        singular_label: "Customer",
        plural_label: "Customers",
        description: "A customer who contacts the business.",
        kind: "custom" as const,
        semantic_type: "customer",
        icon: null,
        is_active: true,
        fields: [
          {
            key: "name",
            label: "Name",
            field_type: "short_text" as const,
            required: true,
            position: 0,
            is_active: true,
            has_default: false,
            settings: {},
          },
          {
            key: "old_note",
            label: "Old note",
            field_type: "long_text" as const,
            required: false,
            position: 1,
            is_active: false,
            has_default: false,
            settings: {},
          },
        ],
      },
      {
        key: "archived_customer",
        singular_label: "Archived customer",
        plural_label: "Archived customers",
        description: "An archived context Object.",
        kind: "custom" as const,
        semantic_type: null,
        icon: null,
        is_active: false,
        fields: [
          {
            key: "old_name",
            label: "Old name",
            field_type: "short_text" as const,
            required: false,
            position: 0,
            is_active: true,
            has_default: false,
            settings: {},
          },
        ],
      },
    ],
    relationships: [],
    views: [
      {
        key: "customer_table",
        name: "Customers",
        view_type: "table" as const,
        object_key: "customer",
        audience: "internal" as const,
        is_active: true,
        configuration: { fields: ["name"], include_archived: false },
      },
      {
        key: "archived_view",
        name: "Archived customers",
        view_type: "table" as const,
        object_key: "customer",
        audience: "internal" as const,
        is_active: false,
        configuration: { fields: ["name"], include_archived: false },
      },
    ],
    forms: [
      {
        key: "customer_create",
        name: "Create customer",
        object_key: "customer",
        mode: "create" as const,
        audience: "internal" as const,
        is_active: true,
        fields: [{ field: "name", hidden: false, has_default: false }],
      },
      {
        key: "archived_form",
        name: "Archived customer form",
        object_key: "customer",
        mode: "create" as const,
        audience: "internal" as const,
        is_active: false,
        fields: [{ field: "name", hidden: false, has_default: false }],
      },
    ],
    pages: [],
    preorder_experiences: [],
    platform_capabilities: platformCapabilities,
  };
}

function readyPlan() {
  const categories = [
    "define_object",
    "define_field",
    "define_relationship",
    "configure_view",
    "configure_form",
    "configure_page",
  ] as const;
  return {
    schema_version: 1 as const,
    state: "ready" as const,
    understanding:
      "Create a generic Catering Enquiry configuration for owner review.",
    assumptions: [],
    plan: {
      outcome: "The business can review a proposed Catering Enquiry design.",
      concepts: [
        {
          reference: "concept_1",
          label: "Catering Enquiry",
          disposition: "new" as const,
          purpose: "Capture a customer's catering request.",
        },
        {
          reference: "concept_2",
          label: "Customer",
          disposition: "existing" as const,
          existing_object_key: "customer",
          purpose: "Connect an enquiry to the existing customer concept.",
        },
      ],
      user_journeys: [],
      steps: categories.map((category, index) => ({
        reference: `step_${index + 1}`,
        sequence: index + 1,
        lane: "configuration" as const,
        category,
        summary: `Prepare bounded ${category} intent.`,
        dependencies: index === 0 ? [] : ["step_1"],
        affected_concepts:
          category === "define_relationship"
            ? ["concept_1", "concept_2"]
            : ["concept_1"],
        existing_object_keys:
          category === "define_relationship" ? ["customer"] : [],
        location_references: [],
        materiality: "medium" as const,
        requires_owner_confirmation: true as const,
      })),
    },
    unsupported_requirements: [],
  };
}

function draft(): BuilderConfigurationDraftOutput {
  const objectReference = {
    source: "draft" as const,
    object_reference: "draft_object_1",
  };
  const fieldReference = (field_reference: string) => ({
    source: "draft" as const,
    field_reference,
  });
  return builderConfigurationDraftOutputSchema.parse({
    schema_version: 1,
    summary: "A bounded Catering Enquiry design.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_1",
        source_step_references: ["step_1"],
        singular_label: "Catering Enquiry",
        plural_label: "Catering Enquiries",
        description: "A request for a business catering service.",
      },
    ],
    fields: [
      {
        reference: "draft_field_5",
        source_step_references: ["step_2"],
        object_reference: objectReference,
        label: "Notes",
        field_type: "long_text",
        required: false,
        settings: null,
      },
      {
        reference: "draft_field_4",
        source_step_references: ["step_2"],
        object_reference: objectReference,
        label: "Budget",
        field_type: "currency",
        required: false,
        settings: { currency: "GBP" },
      },
      {
        reference: "draft_field_3",
        source_step_references: ["step_2"],
        object_reference: objectReference,
        label: "Number of guests",
        field_type: "number",
        required: true,
        settings: null,
      },
      {
        reference: "draft_field_2",
        source_step_references: ["step_2"],
        object_reference: objectReference,
        label: "Event date",
        field_type: "date",
        required: true,
        settings: null,
      },
      {
        reference: "draft_field_1",
        source_step_references: ["step_2"],
        object_reference: objectReference,
        label: "Company name",
        field_type: "short_text",
        required: true,
        settings: null,
      },
    ],
    relationships: [
      {
        reference: "draft_relationship_1",
        source_step_references: ["step_3"],
        source_object_reference: {
          source: "existing",
          object_key: "customer",
        },
        target_object_reference: objectReference,
        source_label: "submits",
        target_label: "customer",
        cardinality: "one_to_many",
        is_required: false,
      },
    ],
    views: [
      {
        reference: "draft_view_1",
        source_step_references: ["step_4"],
        name: "Catering Enquiries",
        audience: "internal",
        object_reference: objectReference,
        view_type: "table",
        configuration: {
          fields: [
            fieldReference("draft_field_1"),
            fieldReference("draft_field_2"),
            fieldReference("draft_field_3"),
            fieldReference("draft_field_4"),
            fieldReference("draft_field_5"),
          ],
          title_field: null,
          create_form_reference: null,
          edit_form_reference: null,
        },
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_5"],
        name: "Catering Enquiry",
        object_reference: objectReference,
        mode: "create",
        audience: "public",
        fields: [
          "draft_field_1",
          "draft_field_2",
          "draft_field_3",
          "draft_field_4",
          "draft_field_5",
        ].map((field_reference) => ({
          field_reference: fieldReference(field_reference),
          label: null,
          help_text: null,
        })),
        submit_label: "Send enquiry",
      },
    ],
    pages: [
      {
        reference: "draft_page_1",
        source_step_references: ["step_6"],
        title: "Catering Enquiry",
        audience: "public",
        blocks: [
          { type: "heading", text: "Tell us about your event", level: 1 },
          {
            type: "form",
            form_reference: {
              source: "draft",
              form_reference: "draft_form_1",
            },
          },
        ],
      },
    ],
  });
}

function snapshot(): ConfigurationSnapshotV1 {
  return configurationSnapshotV1Schema.parse({
    schema_version: 1,
    object_definitions: [
      {
        id: id(1),
        key: "customer",
        singular_label: "Customer",
        plural_label: "Customers",
        description: "A customer who contacts the business.",
        kind: "custom",
        semantic_type: "customer",
        icon: null,
        is_active: true,
      },
      {
        id: id(2),
        key: "archived_customer",
        singular_label: "Archived customer",
        plural_label: "Archived customers",
        description: "An archived customer object.",
        kind: "custom",
        semantic_type: null,
        icon: null,
        is_active: false,
      },
    ],
    field_definitions: [
      {
        id: id(3),
        object_definition_id: id(1),
        object_key: "customer",
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        position: 0,
        is_active: true,
      },
      {
        id: id(4),
        object_definition_id: id(1),
        object_key: "customer",
        key: "old_note",
        label: "Old note",
        field_type: "long_text",
        required: false,
        default_value: null,
        settings_json: {},
        position: 1,
        is_active: false,
      },
      {
        id: id(5),
        object_definition_id: id(2),
        object_key: "archived_customer",
        key: "old_name",
        label: "Old name",
        field_type: "short_text",
        required: false,
        default_value: null,
        settings_json: {},
        position: 0,
        is_active: true,
      },
    ],
    relationship_definitions: [
      {
        id: id(6),
        key: "archived_relationship",
        source_object_definition_id: id(2),
        source_object_key: "archived_customer",
        target_object_definition_id: id(2),
        target_object_key: "archived_customer",
        source_label: "old",
        target_label: "old",
        cardinality: "one_to_one",
        is_required: false,
        is_active: false,
      },
    ],
    views: [
      {
        id: id(7),
        key: "customer_table",
        name: "Customers",
        view_type: "table",
        object_definition_id: id(1),
        object_key: "customer",
        config_json: { fields: ["name"], include_archived: false },
        audience: "internal",
        is_active: true,
      },
      {
        id: id(8),
        key: "archived_view",
        name: "Archived customers",
        view_type: "table",
        object_definition_id: id(1),
        object_key: "customer",
        config_json: { fields: ["name"], include_archived: false },
        audience: "internal",
        is_active: false,
      },
    ],
    forms: [
      {
        id: id(9),
        key: "customer_create",
        name: "Create customer",
        object_definition_id: id(1),
        object_key: "customer",
        mode: "create",
        config_json: { fields: [{ field: "name", hidden: false }] },
        audience: "internal",
        is_active: true,
      },
      {
        id: id(10),
        key: "archived_form",
        name: "Archived customer form",
        object_definition_id: id(1),
        object_key: "customer",
        mode: "create",
        config_json: { fields: [{ field: "name", hidden: false }] },
        audience: "internal",
        is_active: false,
      },
    ],
    pages: [
      {
        id: id(11),
        key: "home",
        title: "Home",
        slug: "home",
        audience: "internal",
        layout_json: { blocks: [{ type: "heading", text: "Home" }] },
        status: "draft",
        is_active: true,
      },
      {
        id: id(12),
        key: "archived_page",
        title: "Archived page",
        slug: "old-page",
        audience: "internal",
        layout_json: { blocks: [{ type: "heading", text: "Old" }] },
        status: "draft",
        is_active: false,
      },
    ],
    preorder_experiences: [],
    preorder_experience_locations: [],
  });
}

function compilerInput() {
  return {
    taskInput: builderConfigurationDraftTaskInputBaseSchema.parse({
      schema_version: 1,
      owner_request:
        "Create a Catering Enquiry with Company name, Event date, Number of guests, Budget and Notes.",
      business_context: context(),
      ready_plan: readyPlan(),
    }),
    draft: draft(),
    snapshot: snapshot(),
  };
}

function compilerError(action: () => unknown): ConfigurationDraftCompilerError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationDraftCompilerError);
    return error as ConfigurationDraftCompilerError;
  }
  throw new Error("Expected compiler error.");
}

describe("deterministic configuration draft compiler contract", () => {
  it("accepts the strict input and returns only schema version plus operations", () => {
    const input = compilerInput();
    expect(configurationDraftCompilerInputSchema.parse(input)).toEqual(input);
    const output = compileConfigurationDraft(input);
    expect(configurationDraftCompilerOutputSchema.parse(output)).toEqual(
      output,
    );
    expect(Object.keys(output)).toEqual(["schema_version", "operations"]);
  });

  it("rejects unknown or missing envelope properties safely", () => {
    const input = compilerInput();
    expect(() =>
      configurationDraftCompilerInputSchema.parse({
        ...input,
        actorId: id(99),
      }),
    ).toThrow();
    const error = compilerError(() =>
      compileConfigurationDraft({ ...input, actorId: id(99) }),
    );
    expect(error.code).toBe("configuration_draft_compile_input_invalid");
    expect(() =>
      compileConfigurationDraft({
        taskInput: input.taskInput,
        draft: input.draft,
      }),
    ).toThrow(ConfigurationDraftCompilerError);
    expect(JSON.stringify(error)).not.toContain("actorId");
    expect(JSON.stringify(error)).not.toContain(id(99));
  });

  it("revalidates the Phase 1A input and draft and parses the snapshot separately", () => {
    const input = compilerInput();
    const invalidDraft = structuredClone(input.draft) as Record<
      string,
      unknown
    >;
    invalidDraft.unexpected = true;
    expect(
      compilerError(() =>
        compileConfigurationDraft({ ...input, draft: invalidDraft }),
      ).code,
    ).toBe("configuration_draft_compile_input_invalid");

    const invalidSnapshot = structuredClone(input.snapshot) as Record<
      string,
      unknown
    >;
    invalidSnapshot.schema_version = 2;
    expect(
      compilerError(() =>
        compileConfigurationDraft({ ...input, snapshot: invalidSnapshot }),
      ).code,
    ).toBe("configuration_draft_compile_snapshot_invalid");
  });

  it("is synchronous, deterministic and does not mutate inputs", () => {
    const input = compilerInput();
    const before = structuredClone(input);
    const first = compileConfigurationDraft(input);
    const second = compileConfigurationDraft(input);
    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(compileConfigurationDraft.constructor.name).toBe("Function");
  });
});

describe("Corporate Catering compilation", () => {
  it("compiles the exact ten-operation generic fixture", () => {
    const output = compileConfigurationDraft(compilerInput());
    expect(output.operations).toHaveLength(10);
    expect(output.operations.map(({ op }) => op)).toEqual([
      "set_object",
      "set_field",
      "set_field",
      "set_field",
      "set_field",
      "set_field",
      "set_relationship",
      "set_form",
      "set_view",
      "set_page",
    ]);
    const parsed = configurationOperationsSchema.parse(output.operations);
    expect(parsed).toEqual(output.operations);

    const [object, ...rest] = output.operations;
    expect(object).toMatchObject({
      op: "set_object",
      key: "catering_enquiry",
      icon: null,
      is_active: true,
    });
    const fields = rest.filter((operation) => operation.op === "set_field");
    expect(fields.map((field) => field.key)).toEqual([
      "budget",
      "company_name",
      "event_date",
      "notes",
      "number_of_guests",
    ]);
    expect(fields.map((field) => field.position)).toEqual([0, 1, 2, 3, 4]);
    expect(fields.find((field) => field.key === "budget")).toMatchObject({
      field_type: "currency",
      settings_json: { currency: "GBP" },
      default_value: null,
    });
    expect(fields.some((field) => field.key === "status")).toBe(false);

    const relationship = output.operations.find(
      (operation) => operation.op === "set_relationship",
    );
    expect(relationship).toMatchObject({
      key: "customer_submits_catering_enquiry",
      source_object_key: "customer",
      target_object_key: "catering_enquiry",
      source_label: "submits",
      target_label: "customer",
      cardinality: "one_to_many",
      is_required: false,
      is_active: true,
    });

    const form = output.operations.find(
      (operation) => operation.op === "set_form",
    );
    expect(form).toMatchObject({
      key: "catering_enquiry_create_public",
      object_key: "catering_enquiry",
      audience: "public",
      mode: "create",
      is_active: true,
    });
    if (form?.op === "set_form") {
      expect(form.config_json.fields.map(({ field }) => field)).toEqual([
        "company_name",
        "event_date",
        "number_of_guests",
        "budget",
        "notes",
      ]);
      expect(
        form.config_json.fields.every(({ hidden }) => hidden === false),
      ).toBe(true);
      expect(form.config_json.submit_label).toBe("Send enquiry");
    }

    const view = output.operations.find(
      (operation) => operation.op === "set_view",
    );
    expect(view).toMatchObject({
      key: "catering_enquiry_table",
      object_key: "catering_enquiry",
      view_type: "table",
    });
    if (view?.op === "set_view") {
      expect(view.config_json.fields).toEqual([
        "company_name",
        "event_date",
        "number_of_guests",
        "budget",
        "notes",
      ]);
      expect(view.config_json.include_archived).toBe(false);
    }

    const page = output.operations.find(
      (operation) => operation.op === "set_page",
    );
    expect(page).toMatchObject({
      key: "catering_enquiry",
      slug: "catering-enquiry",
      status: "draft",
      audience: "public",
      is_active: true,
    });
    if (page?.op === "set_page") {
      expect(page.layout_json.blocks).toEqual([
        { type: "heading", text: "Tell us about your event", level: 1 },
        { type: "form", form_key: "catering_enquiry_create_public" },
      ]);
    }
  });

  it("is byte-identical when top-level draft collections are reversed", () => {
    const input = compilerInput();
    const reversed = structuredClone(input);
    reversed.draft.objects.reverse();
    reversed.draft.fields.reverse();
    reversed.draft.relationships.reverse();
    reversed.draft.views.reverse();
    reversed.draft.forms.reverse();
    reversed.draft.pages.reverse();
    expect(JSON.stringify(compileConfigurationDraft(reversed))).toBe(
      JSON.stringify(compileConfigurationDraft(input)),
    );
  });
});

describe("key, slug and position allocation", () => {
  it("normalises ASCII, diacritics, ampersands, punctuation and fallbacks", () => {
    expect(normaliseGraphKeyBase("Éclair & Tea / Box", "object")).toBe(
      "eclair_and_tea_box",
    );
    expect(normaliseGraphKeyBase("42 boxes", "field")).toBe("field_42_boxes");
    expect(normaliseGraphKeyBase("東京", "field")).toBe("field");
    expect(normalisePageSlugBase("Éclair & Tea / Box")).toBe(
      "eclair-and-tea-box",
    );
    expect(normalisePageSlugBase("東京")).toBe("page");
  });

  it("allocates deterministic suffixes, reserves archived identities and fails finitely", () => {
    const keyAllocator = createGraphKeyAllocator([
      "thing",
      "thing_2",
      "thing_3",
    ]);
    expect(keyAllocator.allocate("Thing", "object")).toBe("thing_4");
    const slugAllocator = createPageSlugAllocator([
      "thing",
      "thing-2",
      "thing-3",
    ]);
    expect(slugAllocator.allocate("Thing")).toBe("thing-4");

    const exhaustedKeys = [
      "value",
      ...Array.from({ length: 999 }, (_, index) => `value_${index + 2}`),
    ];
    const error = compilerError(() =>
      createGraphKeyAllocator(exhaustedKeys).allocate("Value", "field"),
    );
    expect(error.code).toBe("configuration_draft_compile_key_unavailable");
    expect(configurationDraftCompilerErrorCodes).toContain(error.code);
  });

  it("appends existing-object Fields after all active and archived positions", () => {
    const input = compilerInput();
    const output = compileConfigurationDraft(input);
    const fields = output.operations.filter(
      (operation) => operation.op === "set_field",
    );
    expect(fields.every((field) => field.position < 5)).toBe(true);
  });
});

describe("fresh snapshot and additive safety checks", () => {
  it("rejects missing, inactive, inconsistent and colliding snapshot references safely", () => {
    const missing = compilerInput();
    missing.snapshot.object_definitions =
      missing.snapshot.object_definitions.filter(
        (object) => object.key !== "customer",
      );
    missing.snapshot.field_definitions =
      missing.snapshot.field_definitions.filter(
        (field) => field.object_key !== "customer",
      );
    missing.snapshot.views = [];
    missing.snapshot.forms = [];
    expect(compilerError(() => compileConfigurationDraft(missing)).code).toBe(
      "configuration_draft_compile_existing_reference_missing",
    );

    const inactive = compilerInput();
    inactive.snapshot.object_definitions[0]!.is_active = false;
    expect(compilerError(() => compileConfigurationDraft(inactive)).code).toBe(
      "configuration_draft_compile_existing_reference_inactive",
    );

    const inconsistent = compilerInput();
    inconsistent.snapshot.field_definitions[0]!.object_key =
      "archived_customer";
    expect(
      compilerError(() => compileConfigurationDraft(inconsistent)).code,
    ).toBe("configuration_draft_compile_snapshot_inconsistent");

    const duplicate = compilerInput();
    duplicate.snapshot.object_definitions.push(
      structuredClone(duplicate.snapshot.object_definitions[0]!),
    );
    expect(compilerError(() => compileConfigurationDraft(duplicate)).code).toBe(
      "configuration_draft_compile_snapshot_inconsistent",
    );
  });

  it("rejects additive Object and same-Object Field label conflicts, but not cross-Object Field labels", () => {
    const objectConflict = compilerInput();
    objectConflict.draft.objects[0]!.singular_label = "Customer";
    expect(
      compilerError(() => compileConfigurationDraft(objectConflict)).code,
    ).toBe("configuration_draft_compile_object_label_conflict");

    const fieldConflict = compilerInput();
    if (fieldConflict.taskInput.ready_plan.state !== "ready") {
      throw new Error("Expected a ready test plan.");
    }
    fieldConflict.taskInput.ready_plan.plan.steps[1]!.affected_concepts = [
      "concept_1",
      "concept_2",
    ];
    fieldConflict.taskInput.ready_plan.plan.steps[1]!.existing_object_keys = [
      "customer",
    ];
    fieldConflict.draft.fields[0]!.object_reference = {
      source: "existing",
      object_key: "customer",
    };
    fieldConflict.draft.fields[0]!.label = "Name";
    if (fieldConflict.draft.views[0]?.view_type === "table") {
      fieldConflict.draft.views[0].configuration.fields =
        fieldConflict.draft.views[0].configuration.fields.slice(0, 4);
    }
    fieldConflict.draft.forms[0]!.fields =
      fieldConflict.draft.forms[0]!.fields.slice(0, 4);
    expect(
      compilerError(() => compileConfigurationDraft(fieldConflict)).code,
    ).toBe("configuration_draft_compile_field_label_conflict");
  });

  it("never emits snapshot UUIDs or lifecycle metadata", () => {
    const input = compilerInput();
    const serialized = JSON.stringify(compileConfigurationDraft(input));
    for (const value of [id(1), id(3), id(6), id(7), id(9), id(11)]) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toMatch(
      /business_id|actor_id|expected_head|proposal|candidate/i,
    );
  });
});

describe("compiler source boundary", () => {
  it("keeps the new compiler pure and unconnected to runtime mutation surfaces", () => {
    const compilerRoot = path.join(
      repositoryRoot,
      "src/core/configuration/draft-compiler",
    );
    const source = fs
      .readdirSync(compilerRoot)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => fs.readFileSync(path.join(compilerRoot, name), "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /from ["'][^"']*(?:supabase|database|service|preorder|provider|accounting|business-execution|app|route|react)[^"']*["']/i,
    );
    expect(source).not.toMatch(
      /crypto\.randomUUID|fetch\s*\(|\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/,
    );
    expect(source).not.toMatch(
      /ConfigurationChangeService|propose_configuration_change|set_preorder_experience/,
    );
  });
});
