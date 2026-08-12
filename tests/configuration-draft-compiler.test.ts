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
import {
  configurationOperationsSchema,
  setFieldOperationSchema,
  setFormOperationSchema,
  setObjectOperationSchema,
  setPageOperationSchema,
  setRelationshipOperationSchema,
  setViewOperationSchema,
} from "../src/core/configuration/schemas";

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
          title_field: fieldReference("draft_field_1"),
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

type CompilerFixture = ReturnType<typeof compilerInput>;

function authorizeExistingObject(
  input: CompilerFixture,
  stepReferences: ReadonlyArray<string>,
  objectKey = "customer",
): void {
  if (input.taskInput.ready_plan.state !== "ready") {
    throw new Error("Expected a ready test plan.");
  }
  for (const stepReference of stepReferences) {
    const step = input.taskInput.ready_plan.plan.steps.find(
      (candidate) => candidate.reference === stepReference,
    );
    if (!step) {
      throw new Error(`Unknown test step: ${stepReference}`);
    }
    if (!step.affected_concepts.includes("concept_2")) {
      step.affected_concepts.push("concept_2");
    }
    if (!step.existing_object_keys.includes(objectKey)) {
      step.existing_object_keys.push(objectKey);
    }
  }
}

function appendSnapshotField(
  input: CompilerFixture,
  overrides: Partial<CompilerFixture["snapshot"]["field_definitions"][number]>,
): void {
  const source = input.snapshot.field_definitions[0];
  if (!source) {
    throw new Error("Expected a snapshot field fixture.");
  }
  input.snapshot.field_definitions.push({
    ...structuredClone(source),
    id: id(13),
    ...overrides,
  });
}

function appendDraftField(
  input: CompilerFixture,
  overrides: Partial<CompilerFixture["draft"]["fields"][number]> & {
    reference: string;
  },
): void {
  const source = input.draft.fields[0];
  if (!source) {
    throw new Error("Expected a draft field fixture.");
  }
  input.draft.fields.push({
    ...structuredClone(source),
    ...overrides,
  });
}

function appendSnapshotObject(
  input: CompilerFixture,
  overrides: Partial<CompilerFixture["snapshot"]["object_definitions"][number]>,
): void {
  const source = input.snapshot.object_definitions[1];
  if (!source) {
    throw new Error("Expected an archived snapshot Object fixture.");
  }
  input.snapshot.object_definitions.push({
    ...structuredClone(source),
    id: id(13),
    ...overrides,
  });
}

function sourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(entryPath);
    }
    return [".ts", ".tsx", ".js", ".jsx", ".mjs"].some((suffix) =>
      entry.name.endsWith(suffix),
    )
      ? [entryPath]
      : [];
  });
}

function existingCustomerCreateFormInput(): CompilerFixture {
  const input = compilerInput();
  authorizeExistingObject(input, ["step_5", "step_6"]);
  const form = input.draft.forms[0];
  if (!form) {
    throw new Error("Expected a draft form fixture.");
  }
  input.draft.forms[0] = {
    ...form,
    object_reference: { source: "existing", object_key: "customer" },
    fields: [
      {
        field_reference: {
          source: "existing",
          object_key: "customer",
          field_key: "name",
        },
        label: null,
        help_text: null,
      },
    ],
  };
  appendSnapshotField(input, {
    key: "fresh_required",
    label: "Fresh required",
    object_definition_id: id(1),
    object_key: "customer",
    field_type: "short_text",
    required: true,
    default_value: null,
    position: 2,
    is_active: true,
  });
  return input;
}

function existingCustomerCardsInput(): CompilerFixture {
  const input = compilerInput();
  authorizeExistingObject(input, ["step_4"]);
  const customer = input.taskInput.business_context.objects.find(
    (object) => object.key === "customer",
  );
  if (!customer) {
    throw new Error("Expected the Customer context Object.");
  }
  customer.fields.push({
    key: "avatar",
    label: "Avatar",
    field_type: "file",
    required: false,
    position: 2,
    is_active: true,
    has_default: false,
    settings: {},
  });
  appendSnapshotField(input, {
    key: "avatar",
    label: "Avatar",
    object_definition_id: id(1),
    object_key: "customer",
    field_type: "file",
    required: false,
    position: 2,
    is_active: true,
  });
  const view = input.draft.views[0];
  if (!view) {
    throw new Error("Expected a draft View fixture.");
  }
  input.draft.views[0] = {
    ...view,
    object_reference: { source: "existing", object_key: "customer" },
    view_type: "cards",
    configuration: {
      title_field: {
        source: "existing",
        object_key: "customer",
        field_key: "name",
      },
      subtitle_field: null,
      image_field: {
        source: "existing",
        object_key: "customer",
        field_key: "avatar",
      },
      supporting_fields: [],
      create_form_reference: null,
      edit_form_reference: null,
    },
  };
  return input;
}

function existingCustomerFieldReferenceInput(): CompilerFixture {
  const input = compilerInput();
  authorizeExistingObject(input, ["step_4"]);
  const view = input.draft.views[0];
  if (!view) {
    throw new Error("Expected a draft View fixture.");
  }
  input.draft.views[0] = {
    ...view,
    object_reference: { source: "existing", object_key: "customer" },
    view_type: "table",
    configuration: {
      fields: [
        {
          source: "existing",
          object_key: "customer",
          field_key: "name",
        },
      ],
      title_field: {
        source: "existing",
        object_key: "customer",
        field_key: "name",
      },
      create_form_reference: null,
      edit_form_reference: null,
    },
  };
  return input;
}

function existingCustomerDetailReferenceInput(): CompilerFixture {
  const input = existingCustomerFieldReferenceInput();
  const view = input.draft.views[0];
  if (!view || view.view_type !== "table") {
    throw new Error("Expected the existing Customer table fixture.");
  }
  input.draft.views[0] = {
    ...view,
    view_type: "detail",
    configuration: {
      fields: view.configuration.fields,
      title_field: {
        source: "existing",
        object_key: "customer",
        field_key: "name",
      },
      edit_form_reference: null,
    },
  };
  return input;
}

function existingCustomerFormReferenceInput(): CompilerFixture {
  const input = compilerInput();
  authorizeExistingObject(input, ["step_6"]);
  const page = input.draft.pages[0];
  if (!page) {
    throw new Error("Expected a draft Page fixture.");
  }
  input.draft.pages[0] = {
    ...page,
    audience: "internal",
    blocks: [
      {
        type: "form",
        form_reference: { source: "existing", form_key: "customer_create" },
      },
    ],
  };
  return input;
}

function existingCustomerViewReferenceInput(): CompilerFixture {
  const input = compilerInput();
  authorizeExistingObject(input, ["step_6"]);
  const page = input.draft.pages[0];
  if (!page) {
    throw new Error("Expected a draft Page fixture.");
  }
  input.draft.pages[0] = {
    ...page,
    audience: "internal",
    blocks: [
      {
        type: "view",
        view_reference: { source: "existing", view_key: "customer_table" },
      },
    ],
  };
  return input;
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
      expect(view.config_json.title_field).toBe("company_name");
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

  it("allocates fresh-object Fields contiguously from zero", () => {
    const input = compilerInput();
    const output = compileConfigurationDraft(input);
    const fields = output.operations.filter(
      (operation) => operation.op === "set_field",
    );
    expect(fields.map((field) => field.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("appends existing-object Fields after every active and archived position", () => {
    const input = compilerInput();
    authorizeExistingObject(input, ["step_2"]);
    const oldNote = input.snapshot.field_definitions.find(
      (field) => field.key === "old_note",
    );
    if (!oldNote) {
      throw new Error("Expected the old note snapshot field.");
    }
    oldNote.is_active = true;
    appendSnapshotField(input, {
      key: "archived_customer_position",
      label: "Archived customer position",
      object_definition_id: id(1),
      object_key: "customer",
      position: 4,
      is_active: false,
    });
    appendDraftField(input, {
      reference: "draft_field_6",
      object_reference: { source: "existing", object_key: "customer" },
      label: "Customer new alpha",
      required: false,
      field_type: "short_text",
      settings: null,
    });
    appendDraftField(input, {
      reference: "draft_field_7",
      object_reference: { source: "existing", object_key: "customer" },
      label: "Customer new beta",
      required: false,
      field_type: "short_text",
      settings: null,
    });

    const output = compileConfigurationDraft(input);
    const customerFields = output.operations.filter(
      (
        operation,
      ): operation is Extract<
        (typeof output.operations)[number],
        { op: "set_field" }
      > => operation.op === "set_field" && operation.object_key === "customer",
    );
    expect(customerFields.map((field) => field.key)).toEqual([
      "customer_new_alpha",
      "customer_new_beta",
    ]);
    expect(customerFields.map((field) => field.position)).toEqual([5, 6]);

    const reversed = structuredClone(input);
    reversed.draft.fields.reverse();
    expect(JSON.stringify(compileConfigurationDraft(reversed))).toBe(
      JSON.stringify(output),
    );
  });

  it("keeps an existing primary Table operating surface coherent for additive Fields", () => {
    const input = compilerInput();
    authorizeExistingObject(input, ["step_2"]);
    const table = input.snapshot.views.find(
      (view) => view.key === "customer_table",
    );
    const createForm = input.snapshot.forms.find(
      (form) => form.key === "customer_create",
    );
    if (!table || !createForm) {
      throw new Error("Expected the Customer Table and create Form fixtures.");
    }
    table.config_json = {
      fields: ["name"],
      create_form_key: "customer_create",
      edit_form_key: "customer_edit",
      include_archived: false,
    };
    input.snapshot.forms.push({
      ...structuredClone(createForm),
      id: id(14),
      key: "customer_edit",
      name: "Edit customer",
      mode: "edit",
    });
    appendDraftField(input, {
      reference: "draft_field_6",
      object_reference: { source: "existing", object_key: "customer" },
      label: "Allergies",
      required: false,
      field_type: "long_text",
      settings: null,
    });

    const output = compileConfigurationDraft(input);
    const forms = output.operations.filter(
      (operation): operation is Extract<typeof operation, { op: "set_form" }> =>
        operation.op === "set_form",
    );
    const views = output.operations.filter(
      (operation): operation is Extract<typeof operation, { op: "set_view" }> =>
        operation.op === "set_view",
    );
    expect(forms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "customer_create",
          config_json: {
            fields: [
              { field: "name", hidden: false },
              { field: "allergies", hidden: false },
            ],
          },
        }),
        expect.objectContaining({
          key: "customer_edit",
          config_json: {
            fields: [
              { field: "name", hidden: false },
              { field: "allergies", hidden: false },
            ],
          },
        }),
      ]),
    );
    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "customer_table",
          config_json: expect.objectContaining({
            fields: ["name", "allergies"],
            create_form_key: "customer_create",
            edit_form_key: "customer_edit",
          }),
        }),
      ]),
    );
    expect(
      output.operations.filter(
        (operation) =>
          (operation.op === "set_field" &&
            operation.object_key === "customer") ||
          ((operation.op === "set_form" || operation.op === "set_view") &&
            ["customer_create", "customer_edit", "customer_table"].includes(
              operation.key,
            )),
      ),
    ).toHaveLength(4);
  });

  it("fails safely instead of overflowing an existing-object position", () => {
    const input = compilerInput();
    authorizeExistingObject(input, ["step_2"]);
    appendSnapshotField(input, {
      key: "archived_customer_position",
      label: "Archived customer position",
      object_definition_id: id(1),
      object_key: "customer",
      position: Number.MAX_SAFE_INTEGER,
      is_active: false,
    });
    appendDraftField(input, {
      reference: "draft_field_6",
      object_reference: { source: "existing", object_key: "customer" },
      label: "Customer new field",
      required: false,
      field_type: "short_text",
      settings: null,
    });

    let returned = false;
    const error = compilerError(() => {
      const output = compileConfigurationDraft(input);
      returned = true;
      return output;
    });
    expect(returned).toBe(false);
    expect(error.code).toBe("configuration_draft_compile_position_unavailable");
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

  it("enforces fresh snapshot required-field coverage for an existing-object create Form", () => {
    const missing = existingCustomerCreateFormInput();
    expect(compilerError(() => compileConfigurationDraft(missing)).code).toBe(
      "configuration_draft_compile_existing_reference_mismatch",
    );

    const withDefault = existingCustomerCreateFormInput();
    const freshRequired = withDefault.snapshot.field_definitions.find(
      (field) => field.key === "fresh_required",
    );
    if (!freshRequired) {
      throw new Error("Expected the fresh required snapshot field.");
    }
    freshRequired.default_value = "fallback";
    const output = compileConfigurationDraft(withDefault);
    const form = output.operations.find(
      (operation) => operation.op === "set_form",
    );
    expect(form?.op === "set_form" ? form.config_json.fields : []).toEqual([
      { field: "name", hidden: false },
    ]);

    const requiredDraftField = existingCustomerCreateFormInput();
    authorizeExistingObject(requiredDraftField, ["step_2"]);
    appendDraftField(requiredDraftField, {
      reference: "draft_field_6",
      object_reference: { source: "existing", object_key: "customer" },
      label: "New required field",
      required: true,
      field_type: "short_text",
      settings: null,
    });
    expect(
      compilerError(() => compileConfigurationDraft(requiredDraftField)).code,
    ).toBe("configuration_draft_compile_input_invalid");

    const optionalDraftField = existingCustomerCreateFormInput();
    authorizeExistingObject(optionalDraftField, ["step_2"]);
    optionalDraftField.snapshot.field_definitions.find(
      (field) => field.key === "fresh_required",
    )!.default_value = "fallback";
    appendDraftField(optionalDraftField, {
      reference: "draft_field_6",
      object_reference: { source: "existing", object_key: "customer" },
      label: "New optional field",
      required: false,
      field_type: "short_text",
      settings: null,
    });
    expect(() => compileConfigurationDraft(optionalDraftField)).not.toThrow();
  });

  it("rejects an omitted required fresh-object Field from a create Form", () => {
    const input = compilerInput();
    input.draft.forms[0]!.fields = input.draft.forms[0]!.fields.slice(1);
    expect(compilerError(() => compileConfigurationDraft(input)).code).toBe(
      "configuration_draft_compile_input_invalid",
    );
  });

  it("validates a fresh Cards image Field through the public compiler entrypoint", () => {
    const input = existingCustomerCardsInput();
    const output = compileConfigurationDraft(input);
    const view = output.operations.find(
      (operation) => operation.op === "set_view",
    );
    expect(view?.op === "set_view" ? view.config_json : null).toMatchObject({
      title_field: "name",
      image_field: "avatar",
      supporting_fields: [],
      include_archived: false,
    });

    const invalid = existingCustomerCardsInput();
    const avatar = invalid.snapshot.field_definitions.find(
      (field) => field.key === "avatar",
    );
    if (!avatar) {
      throw new Error("Expected the avatar snapshot field.");
    }
    avatar.field_type = "short_text";
    expect(compilerError(() => compileConfigurationDraft(invalid)).code).toBe(
      "configuration_draft_compile_existing_reference_mismatch",
    );
  });

  it("covers the existing Field reference matrix at the compiler boundary", () => {
    const valid = existingCustomerFieldReferenceInput();
    const validOutput = compileConfigurationDraft(valid);
    const validView = validOutput.operations.find(
      (operation) => operation.op === "set_view",
    );
    expect(
      validView?.op === "set_view" ? validView.config_json.fields : [],
    ).toEqual(["name"]);
    expect(
      validView?.op === "set_view" ? validView.config_json.title_field : null,
    ).toBe("name");

    const validDetail = existingCustomerDetailReferenceInput();
    const validDetailOutput = compileConfigurationDraft(validDetail);
    const validDetailView = validDetailOutput.operations.find(
      (operation) => operation.op === "set_view",
    );
    expect(validDetailView).toMatchObject({
      op: "set_view",
      view_type: "detail",
    });
    if (validDetailView?.op === "set_view") {
      expect(validDetailView.config_json.fields).toEqual(["name"]);
      expect(validDetailView.config_json.title_field).toBe("name");
    }

    const missing = existingCustomerFieldReferenceInput();
    missing.snapshot.field_definitions =
      missing.snapshot.field_definitions.filter(
        (field) => field.key !== "name",
      );
    expect(compilerError(() => compileConfigurationDraft(missing)).code).toBe(
      "configuration_draft_compile_existing_reference_missing",
    );

    const inactive = existingCustomerFieldReferenceInput();
    inactive.snapshot.field_definitions.find(
      (field) => field.key === "name",
    )!.is_active = false;
    expect(compilerError(() => compileConfigurationDraft(inactive)).code).toBe(
      "configuration_draft_compile_existing_reference_inactive",
    );

    const mismatch = existingCustomerFieldReferenceInput();
    mismatch.snapshot.field_definitions =
      mismatch.snapshot.field_definitions.filter(
        (field) => field.key !== "name",
      );
    mismatch.snapshot.field_definitions.find(
      (field) => field.key === "old_name",
    )!.key = "name";
    expect(compilerError(() => compileConfigurationDraft(mismatch)).code).toBe(
      "configuration_draft_compile_existing_reference_mismatch",
    );

    const inconsistent = existingCustomerFieldReferenceInput();
    inconsistent.snapshot.field_definitions.find(
      (field) => field.key === "name",
    )!.object_key = "archived_customer";
    expect(
      compilerError(() => compileConfigurationDraft(inconsistent)).code,
    ).toBe("configuration_draft_compile_snapshot_inconsistent");
  });

  it("covers the existing Form and View reference matrices at the compiler boundary", () => {
    const validForm = existingCustomerFormReferenceInput();
    expect(() => compileConfigurationDraft(validForm)).not.toThrow();

    const missingForm = existingCustomerFormReferenceInput();
    missingForm.snapshot.forms = missingForm.snapshot.forms.filter(
      (form) => form.key !== "customer_create",
    );
    expect(
      compilerError(() => compileConfigurationDraft(missingForm)).code,
    ).toBe("configuration_draft_compile_existing_reference_missing");

    const inactiveForm = existingCustomerFormReferenceInput();
    inactiveForm.snapshot.forms.find(
      (form) => form.key === "customer_create",
    )!.is_active = false;
    expect(
      compilerError(() => compileConfigurationDraft(inactiveForm)).code,
    ).toBe("configuration_draft_compile_existing_reference_inactive");

    const formAudienceMismatch = existingCustomerFormReferenceInput();
    formAudienceMismatch.snapshot.forms.find(
      (form) => form.key === "customer_create",
    )!.audience = "public";
    expect(
      compilerError(() => compileConfigurationDraft(formAudienceMismatch)).code,
    ).toBe("configuration_draft_compile_existing_reference_mismatch");

    const formModeMismatch = existingCustomerFormReferenceInput();
    formModeMismatch.snapshot.forms.find(
      (form) => form.key === "customer_create",
    )!.mode = "edit";
    expect(
      compilerError(() => compileConfigurationDraft(formModeMismatch)).code,
    ).toBe("configuration_draft_compile_existing_reference_mismatch");

    const formObjectMismatch = existingCustomerFormReferenceInput();
    appendSnapshotObject(formObjectMismatch, {
      id: id(13),
      key: "other",
      singular_label: "Other",
      plural_label: "Others",
      is_active: true,
    });
    const customerForm = formObjectMismatch.snapshot.forms.find(
      (form) => form.key === "customer_create",
    );
    if (!customerForm) {
      throw new Error("Expected the Customer form snapshot row.");
    }
    customerForm.object_definition_id = id(13);
    customerForm.object_key = "other";
    expect(
      compilerError(() => compileConfigurationDraft(formObjectMismatch)).code,
    ).toBe("configuration_draft_compile_existing_reference_mismatch");

    const validView = existingCustomerViewReferenceInput();
    expect(() => compileConfigurationDraft(validView)).not.toThrow();

    const missingView = existingCustomerViewReferenceInput();
    missingView.snapshot.views = missingView.snapshot.views.filter(
      (view) => view.key !== "customer_table",
    );
    expect(
      compilerError(() => compileConfigurationDraft(missingView)).code,
    ).toBe("configuration_draft_compile_existing_reference_missing");

    const inactiveView = existingCustomerViewReferenceInput();
    inactiveView.snapshot.views.find(
      (view) => view.key === "customer_table",
    )!.is_active = false;
    expect(
      compilerError(() => compileConfigurationDraft(inactiveView)).code,
    ).toBe("configuration_draft_compile_existing_reference_inactive");

    const viewAudienceMismatch = existingCustomerViewReferenceInput();
    viewAudienceMismatch.snapshot.views.find(
      (view) => view.key === "customer_table",
    )!.audience = "public";
    expect(
      compilerError(() => compileConfigurationDraft(viewAudienceMismatch)).code,
    ).toBe("configuration_draft_compile_existing_reference_mismatch");

    const viewTypeMismatch = existingCustomerViewReferenceInput();
    viewTypeMismatch.snapshot.views.find(
      (view) => view.key === "customer_table",
    )!.view_type = "list";
    expect(
      compilerError(() => compileConfigurationDraft(viewTypeMismatch)).code,
    ).toBe("configuration_draft_compile_existing_reference_mismatch");

    const viewObjectMismatch = existingCustomerViewReferenceInput();
    appendSnapshotObject(viewObjectMismatch, {
      id: id(13),
      key: "other",
      singular_label: "Other",
      plural_label: "Others",
      is_active: true,
    });
    const customerView = viewObjectMismatch.snapshot.views.find(
      (view) => view.key === "customer_table",
    );
    if (!customerView) {
      throw new Error("Expected the Customer View snapshot row.");
    }
    customerView.object_definition_id = id(13);
    customerView.object_key = "other";
    expect(
      compilerError(() => compileConfigurationDraft(viewObjectMismatch)).code,
    ).toBe("configuration_draft_compile_existing_reference_mismatch");
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

  it("compiles identical singular and plural labels for one draft Object", () => {
    const input = compilerInput();
    input.draft.objects[0]!.singular_label = "Equipment";
    input.draft.objects[0]!.plural_label = "Equipment";
    const output = compileConfigurationDraft(input);
    expect(
      output.operations.find((operation) => operation.op === "set_object"),
    ).toMatchObject({
      singular_label: "Equipment",
      plural_label: "Equipment",
    });
  });

  it("rejects cross-Object label collisions before emitting compiler operations", () => {
    const input = compilerInput();
    if (input.taskInput.ready_plan.state !== "ready") {
      throw new Error("Expected a ready test plan.");
    }
    input.taskInput.ready_plan.plan.concepts.push({
      reference: "concept_3",
      label: "Second new concept",
      disposition: "new",
      purpose: "Provide a second generic configuration concept.",
    });
    input.taskInput.ready_plan.plan.steps[0]!.affected_concepts.push(
      "concept_3",
    );
    input.draft.objects.push({
      ...structuredClone(input.draft.objects[0]!),
      reference: "draft_object_2",
      concept_reference: "concept_3",
      singular_label: "Beta",
      plural_label: "Gamma",
    });
    input.draft.objects[0]!.singular_label = "Alpha";
    input.draft.objects[0]!.plural_label = "Beta";

    expect(compilerError(() => compileConfigurationDraft(input)).code).toBe(
      "configuration_draft_compile_input_invalid",
    );
  });

  it.each([
    ["Customer", "Catering Enquiries"],
    ["Catering Request", "Customers"],
    ["Archived customer", "Catering Enquiries"],
    ["Archived request", "Archived customers"],
    ["ＣUSTOMER", "Catering Enquiries"],
  ])(
    "rejects additive Object labels against active/archived singular/plural identities (%s / %s)",
    (singularLabel, pluralLabel) => {
      const input = compilerInput();
      input.draft.objects[0]!.singular_label = singularLabel;
      input.draft.objects[0]!.plural_label = pluralLabel;
      expect(compilerError(() => compileConfigurationDraft(input)).code).toBe(
        "configuration_draft_compile_object_label_conflict",
      );
    },
  );

  it.each(["Name", "Old note", "ＮＡＭＥ"])(
    "rejects additive Field labels against active and archived same-Object identities (%s)",
    (label) => {
      const input = compilerInput();
      authorizeExistingObject(input, ["step_2"]);
      appendDraftField(input, {
        reference: "draft_field_6",
        object_reference: { source: "existing", object_key: "customer" },
        label,
        required: false,
        field_type: "short_text",
        settings: null,
      });
      expect(compilerError(() => compileConfigurationDraft(input)).code).toBe(
        "configuration_draft_compile_field_label_conflict",
      );
    },
  );

  it("allows the same Field label on a different Object without update, restore or reuse semantics", () => {
    const input = compilerInput();
    appendDraftField(input, {
      reference: "draft_field_6",
      object_reference: {
        source: "draft",
        object_reference: "draft_object_1",
      },
      label: "Name",
      required: false,
      field_type: "short_text",
      settings: null,
    });
    const output = compileConfigurationDraft(input);
    expect(
      output.operations.filter(
        (operation) =>
          operation.op === "set_field" &&
          operation.object_key === "catering_enquiry" &&
          operation.key === "name",
      ),
    ).toHaveLength(1);
    expect(
      output.operations.every((operation) => operation.op.startsWith("set_")),
    ).toBe(true);
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

describe("integrated identity reservation and M5 boundaries", () => {
  it.each([true, false])(
    "reserves a colliding Object key for %s active lifecycle state",
    (isActive) => {
      const input = compilerInput();
      appendSnapshotObject(input, {
        key: "catering_enquiry",
        singular_label: "Legacy request",
        plural_label: "Legacy requests",
        is_active: isActive,
      });
      const output = compileConfigurationDraft(input);
      expect(
        output.operations.find((operation) => operation.op === "set_object"),
      ).toMatchObject({ key: "catering_enquiry_2" });
    },
  );

  it.each([true, false])(
    "reserves a colliding Field key for %s active lifecycle state",
    (isActive) => {
      const input = compilerInput();
      authorizeExistingObject(input, ["step_2"]);
      appendSnapshotField(input, {
        key: "preferred_contact",
        label: "Historic contact",
        object_definition_id: id(1),
        object_key: "customer",
        required: false,
        position: 2,
        is_active: isActive,
      });
      appendDraftField(input, {
        reference: "draft_field_6",
        object_reference: { source: "existing", object_key: "customer" },
        label: "Preferred contact",
        required: false,
        field_type: "short_text",
        settings: null,
      });
      const output = compileConfigurationDraft(input);
      expect(
        output.operations.find(
          (operation) =>
            operation.op === "set_field" &&
            operation.object_key === "customer" &&
            operation.label === "Preferred contact",
        ),
      ).toMatchObject({ key: "preferred_contact_2" });
    },
  );

  it.each([true, false])(
    "reserves a colliding Relationship key for %s active lifecycle state",
    (isActive) => {
      const input = compilerInput();
      const source = input.snapshot.relationship_definitions[0];
      if (!source) {
        throw new Error("Expected an archived relationship fixture.");
      }
      input.snapshot.relationship_definitions.push({
        ...structuredClone(source),
        id: id(13),
        key: "customer_submits_customer",
        source_object_definition_id: id(1),
        source_object_key: "customer",
        target_object_definition_id: id(1),
        target_object_key: "customer",
        source_label: "legacy submits",
        target_label: "legacy customer",
        is_active: isActive,
      });
      input.draft.relationships[0]!.target_object_reference = {
        source: "existing",
        object_key: "customer",
      };
      const output = compileConfigurationDraft(input);
      expect(
        output.operations.find(
          (operation) => operation.op === "set_relationship",
        ),
      ).toMatchObject({ key: "customer_submits_customer_2" });
    },
  );

  it.each([true, false])(
    "reserves a colliding Form key for %s active lifecycle state",
    (isActive) => {
      const input = compilerInput();
      const source = input.snapshot.forms[0];
      if (!source) {
        throw new Error("Expected a Customer form fixture.");
      }
      input.snapshot.forms.push({
        ...structuredClone(source),
        id: id(13),
        key: "catering_enquiry_create_public",
        is_active: isActive,
      });
      const output = compileConfigurationDraft(input);
      expect(
        output.operations.find((operation) => operation.op === "set_form"),
      ).toMatchObject({ key: "catering_enquiry_create_public_2" });
    },
  );

  it.each([true, false])(
    "reserves a colliding View key for %s active lifecycle state",
    (isActive) => {
      const input = compilerInput();
      const source = input.snapshot.views[0];
      if (!source) {
        throw new Error("Expected a Customer View fixture.");
      }
      input.snapshot.views.push({
        ...structuredClone(source),
        id: id(13),
        key: "catering_enquiry_table",
        is_active: isActive,
      });
      const output = compileConfigurationDraft(input);
      expect(
        output.operations.find((operation) => operation.op === "set_view"),
      ).toMatchObject({ key: "catering_enquiry_table_2" });
    },
  );

  it.each([true, false])(
    "reserves a colliding Page key and slug for %s active lifecycle state",
    (isActive) => {
      const input = compilerInput();
      const source = input.snapshot.pages[1];
      if (!source) {
        throw new Error("Expected an archived Page fixture.");
      }
      input.snapshot.pages.push({
        ...structuredClone(source),
        id: id(13),
        key: "catering_enquiry",
        slug: "catering-enquiry",
        is_active: isActive,
      });
      const output = compileConfigurationDraft(input);
      expect(
        output.operations.find((operation) => operation.op === "set_page"),
      ).toMatchObject({
        key: "catering_enquiry_2",
        slug: "catering-enquiry-2",
      });
    },
  );

  it("reserves keys allocated earlier in the same compilation", () => {
    const input = compilerInput();
    appendDraftField(input, {
      reference: "draft_field_6",
      label: "Special field",
      required: false,
      field_type: "short_text",
      settings: null,
    });
    appendDraftField(input, {
      reference: "draft_field_7",
      label: "Special-field",
      required: false,
      field_type: "short_text",
      settings: null,
    });
    const output = compileConfigurationDraft(input);
    expect(
      output.operations
        .filter((operation) => operation.op === "set_field")
        .map((field) => field.key),
    ).toContain("special_field");
    expect(
      output.operations
        .filter((operation) => operation.op === "set_field")
        .map((field) => field.key),
    ).toContain("special_field_2");
  });

  it("parses every emitted operation through its exact family schema and never adds preorder work", () => {
    const output = compileConfigurationDraft(compilerInput());
    for (const operation of output.operations) {
      switch (operation.op) {
        case "set_object":
          setObjectOperationSchema.parse(operation);
          break;
        case "set_field":
          setFieldOperationSchema.parse(operation);
          break;
        case "set_relationship":
          setRelationshipOperationSchema.parse(operation);
          break;
        case "set_view":
          setViewOperationSchema.parse(operation);
          break;
        case "set_form":
          setFormOperationSchema.parse(operation);
          break;
        case "set_page":
          setPageOperationSchema.parse(operation);
          break;
        case "set_preorder_experience":
          throw new Error("Phase 1B must not emit preorder operations.");
      }
    }
    expect(configurationOperationsSchema.parse(output.operations)).toEqual(
      output.operations,
    );
    expect(
      output.operations.some(
        (operation) => operation.op === "set_preorder_experience",
      ),
    ).toBe(false);
  });

  it("fails at the operation ceiling without truncating a 100-Field draft", () => {
    const input = compilerInput();
    const source = input.draft.fields[0];
    if (!source) {
      throw new Error("Expected a draft field fixture.");
    }
    for (let index = 6; index <= 100; index += 1) {
      input.draft.fields.push({
        ...structuredClone(source),
        reference: `draft_field_${index}`,
        label: `Optional field ${index}`,
        required: false,
      });
    }
    expect(input.draft.fields).toHaveLength(100);
    let returned = false;
    const error = compilerError(() => {
      const output = compileConfigurationDraft(input);
      returned = true;
      return output;
    });
    expect(returned).toBe(false);
    expect(error.code).toBe("configuration_draft_compile_operations_invalid");
    expect(input.draft.fields).toHaveLength(100);
  });
});

describe("compiler source boundary", () => {
  it("keeps the new compiler pure and unconnected to runtime mutation surfaces", () => {
    const compilerRoot = path.join(
      repositoryRoot,
      "src/core/configuration/draft-compiler",
    );
    const source = sourceFiles(compilerRoot)
      .filter((filePath) => filePath.endsWith(".ts"))
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
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
    expect(source).not.toMatch(
      /\bDate\b|performance|setTimeout|crypto\.|Math\.random|fetch\s*\(|(?:writeFile|appendFile|mkdir|rm)\s*\(/,
    );
  });

  it("keeps application routes, components, evaluations, scripts and Phase 1A free of compiler invocation", () => {
    const applicationSource = [
      ...sourceFiles(path.join(repositoryRoot, "src/app")),
      ...sourceFiles(path.join(repositoryRoot, "src/components")),
    ]
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");
    const evaluationAndScriptSource = [
      ...sourceFiles(path.join(repositoryRoot, "evaluations")),
      ...sourceFiles(path.join(repositoryRoot, "scripts")),
    ]
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");
    const phase1ASource = sourceFiles(
      path.join(repositoryRoot, "src/ai/configuration-drafting"),
    )
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");

    expect(applicationSource).not.toMatch(
      /draft-compiler|compileConfigurationDraft/,
    );
    expect(evaluationAndScriptSource).not.toMatch(
      /draft-compiler|compileConfigurationDraft/,
    );
    expect(phase1ASource).not.toMatch(
      /draft-compiler|compileConfigurationDraft|ConfigurationChangeService|propose_configuration_change|apply_configuration_change|prepare_configuration_rollback/,
    );

    const migrationSource = sourceFiles(
      path.join(repositoryRoot, "supabase/migrations"),
    )
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");
    expect(migrationSource).not.toMatch(
      /draft-compiler|compileConfigurationDraft/,
    );
  });
});
