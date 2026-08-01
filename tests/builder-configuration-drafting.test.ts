import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { StructuredAiProvider } from "../src/ai/contracts";
import { createAiExecutionService } from "../src/ai/execution";
import { AiExecutionError } from "../src/ai/errors";
import { BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY } from "../src/ai/policies";
import {
  aiExecutionPolicies,
  createProductionAiRuntime,
  registeredAiTasks,
} from "../src/ai/registry";
import type { AiBusinessModelContextV1 } from "../src/ai/context/schemas";
import {
  BUILDER_CONFIGURATION_DRAFT_INSTRUCTION,
  builderConfigurationDraftTaskInputSchema,
  builderConfigurationDraftTaskV1,
} from "../src/ai/configuration-drafting/task";
import {
  BuilderConfigurationDraftValidationError,
  type BuilderConfigurationDraftDiagnosticCode,
} from "../src/ai/configuration-drafting/diagnostics";
import {
  builderConfigurationDraftOutputSchema,
  builderConfigurationDraftTaskInputBaseSchema,
  draftFieldSchema,
  type BuilderConfigurationDraftOutput,
  type BuilderConfigurationDraftTaskInput,
} from "../src/ai/configuration-drafting/schemas";
import {
  validateConfigurationDraftInput,
  validateConfigurationDraftOutput,
} from "../src/ai/configuration-drafting/validation";
import type { BuilderPlanOutput } from "../src/ai/planning/schemas";

type BuilderPlanReadyResult = Extract<BuilderPlanOutput, { state: "ready" }>;

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

type ConfigurationCategory =
  | "define_object"
  | "define_field"
  | "define_relationship"
  | "configure_view"
  | "configure_form"
  | "configure_page"
  | "configure_preorder";

const platformCapabilities: AiBusinessModelContextV1["platform_capabilities"] =
  {
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
        mechanism:
          "proposal_preview_validation_deliberate_application" as const,
      },
      {
        name: "operational" as const,
        supports: ["records", "locations", "record_to_location_connections"],
        mechanism: "narrow_deterministic_services" as const,
      },
    ],
  };

function context(): AiBusinessModelContextV1 {
  return {
    schema_version: 1,
    business: {
      name: "Example Business",
      business_type: "catering",
      timezone: "Europe/London",
    },
    access: {
      role: "owner",
      capabilities: ["manage_configuration"],
    },
    active_configuration: {
      version_number: 2,
      revision: 4,
    },
    locations: [],
    objects: [
      {
        key: "customer",
        singular_label: "Customer",
        plural_label: "Customers",
        description: "A customer who contacts the business.",
        kind: "custom",
        semantic_type: "customer",
        icon: null,
        is_active: true,
        fields: [
          {
            key: "name",
            label: "Name",
            field_type: "short_text",
            required: true,
            position: 0,
            is_active: true,
            has_default: false,
            settings: {},
          },
          {
            key: "old_note",
            label: "Old note",
            field_type: "long_text",
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
        description: "An inactive context Object.",
        kind: "custom",
        semantic_type: null,
        icon: null,
        is_active: false,
        fields: [
          {
            key: "old_name",
            label: "Old name",
            field_type: "short_text",
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
        view_type: "table",
        object_key: "customer",
        audience: "internal",
        is_active: true,
        configuration: {
          fields: ["name"],
          include_archived: false,
        },
      },
      {
        key: "archived_view",
        name: "Archived customers",
        view_type: "table",
        object_key: "customer",
        audience: "internal",
        is_active: false,
        configuration: {
          fields: ["name"],
          include_archived: false,
        },
      },
    ],
    forms: [
      {
        key: "customer_create",
        name: "Create customer",
        object_key: "customer",
        mode: "create",
        audience: "internal",
        is_active: true,
        fields: [
          {
            field: "name",
            hidden: false,
            has_default: false,
          },
        ],
      },
      {
        key: "archived_form",
        name: "Archived customer form",
        object_key: "customer",
        mode: "create",
        audience: "internal",
        is_active: false,
        fields: [
          {
            field: "name",
            hidden: false,
            has_default: false,
          },
        ],
      },
    ],
    pages: [],
    preorder_experiences: [],
    platform_capabilities: platformCapabilities,
  };
}

function readyPlan(
  categories: ReadonlyArray<ConfigurationCategory> = [
    "define_object",
    "define_field",
    "define_relationship",
    "configure_view",
    "configure_form",
    "configure_page",
  ],
): BuilderPlanReadyResult {
  return {
    schema_version: 1,
    state: "ready",
    understanding:
      "Create a generic Catering Enquiry configuration for owner review.",
    assumptions: [],
    plan: {
      outcome: "The business can review a proposed Catering Enquiry design.",
      concepts: [
        {
          reference: "concept_1",
          label: "Catering Enquiry",
          disposition: "new",
          purpose: "Capture a customer's catering request.",
        },
        {
          reference: "concept_2",
          label: "Customer",
          disposition: "existing",
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

function inputValue(
  plan: BuilderPlanReadyResult = readyPlan(),
): BuilderConfigurationDraftTaskInput {
  return builderConfigurationDraftTaskInputSchema.parse({
    schema_version: 1,
    owner_request:
      "Create a Catering Enquiry with Company name, Event date, Number of guests, Budget and Notes.",
    business_context: context(),
    ready_plan: plan,
  });
}

function rawInput(plan: unknown = readyPlan()): Record<string, unknown> {
  return {
    schema_version: 1,
    owner_request:
      "Create a Catering Enquiry with Company name, Event date, Number of guests, Budget and Notes.",
    business_context: context(),
    ready_plan: plan,
  };
}

const draftObjectReference = {
  source: "draft" as const,
  object_reference: "draft_object_1",
};

function draftFieldReference(fieldReference: string) {
  return { source: "draft" as const, field_reference: fieldReference };
}

function validDraft(): BuilderConfigurationDraftOutput {
  return {
    schema_version: 1,
    summary:
      "Draft a Catering Enquiry Object with the five requested Fields, an internal View, a public create Form and a public Page for owner review.",
    objects: [
      {
        reference: "draft_object_1",
        source_step_references: ["step_1"],
        singular_label: "Catering Enquiry",
        plural_label: "Catering Enquiries",
        description: "A request for a business catering service.",
      },
    ],
    fields: [
      {
        reference: "draft_field_1",
        source_step_references: ["step_2"],
        object_reference: draftObjectReference,
        label: "Company name",
        field_type: "short_text",
        required: true,
        settings: {},
      },
      {
        reference: "draft_field_2",
        source_step_references: ["step_2"],
        object_reference: draftObjectReference,
        label: "Event date",
        field_type: "date",
        required: true,
        settings: {},
      },
      {
        reference: "draft_field_3",
        source_step_references: ["step_2"],
        object_reference: draftObjectReference,
        label: "Number of guests",
        field_type: "number",
        required: true,
        settings: {},
      },
      {
        reference: "draft_field_4",
        source_step_references: ["step_2"],
        object_reference: draftObjectReference,
        label: "Budget",
        field_type: "currency",
        required: false,
        settings: { currency: "GBP" },
      },
      {
        reference: "draft_field_5",
        source_step_references: ["step_2"],
        object_reference: draftObjectReference,
        label: "Notes",
        field_type: "long_text",
        required: false,
        settings: {},
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
        target_object_reference: draftObjectReference,
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
        object_reference: draftObjectReference,
        view_type: "table",
        configuration: {
          fields: [
            draftFieldReference("draft_field_1"),
            draftFieldReference("draft_field_2"),
            draftFieldReference("draft_field_3"),
            draftFieldReference("draft_field_4"),
            draftFieldReference("draft_field_5"),
          ],
        },
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_5"],
        name: "Catering Enquiry",
        object_reference: draftObjectReference,
        mode: "create",
        audience: "public",
        fields: [
          { field_reference: draftFieldReference("draft_field_1") },
          { field_reference: draftFieldReference("draft_field_2") },
          { field_reference: draftFieldReference("draft_field_3") },
          { field_reference: draftFieldReference("draft_field_4") },
          { field_reference: draftFieldReference("draft_field_5") },
        ],
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
          {
            type: "heading",
            text: "Tell us about your event",
            level: 1,
          },
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
  };
}

function expectDiagnostic(
  action: () => unknown,
  code: BuilderConfigurationDraftDiagnosticCode,
): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(BuilderConfigurationDraftValidationError);
  expect(
    (thrown as BuilderConfigurationDraftValidationError).diagnosticCode,
  ).toBe(code);
}

function tableView(output: BuilderConfigurationDraftOutput) {
  const view = output.views[0];
  if (!view || view.view_type !== "table") {
    throw new Error("Expected the fixture to contain a table View.");
  }
  return view;
}

function draftExecutionService(
  generateStructured: StructuredAiProvider["generateStructured"],
) {
  return createAiExecutionService({
    tasks: {
      builder_configuration_draft_v1: builderConfigurationDraftTaskV1,
    },
    policies: {
      [BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY]:
        aiExecutionPolicies[BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY],
    },
    providers: {
      disabled: {
        key: "disabled",
        generateStructured,
      },
    },
  });
}

describe("builder_configuration_draft_v1 strict contract", () => {
  it("accepts the generic Catering Enquiry fixture as untrusted intent", () => {
    const input = inputValue();
    const output = validDraft();

    expect(builderConfigurationDraftTaskInputBaseSchema.parse(input)).toEqual(
      input,
    );
    expect(builderConfigurationDraftOutputSchema.parse(output)).toEqual(output);
    expect(validateConfigurationDraftOutput(input, output)).toEqual(output);
    expect(output.fields.map(({ label }) => label)).toEqual([
      "Company name",
      "Event date",
      "Number of guests",
      "Budget",
      "Notes",
    ]);
    expect(output.pages[0]?.audience).toBe("public");
    expect(output.pages[0]).not.toHaveProperty("status");
    expect(output.relationships[0]).toMatchObject({
      source_object_reference: { source: "existing", object_key: "customer" },
    });
  });

  it("requires all top-level collections while accepting empty non-used collections", () => {
    const output = validDraft();
    const withoutPages = { ...output, pages: [] };
    expect(
      builderConfigurationDraftOutputSchema.safeParse(withoutPages).success,
    ).toBe(true);
    expect(
      builderConfigurationDraftOutputSchema.safeParse({
        ...withoutPages,
        forms: undefined,
      }).success,
    ).toBe(false);
  });

  it("rejects an entirely empty draft", () => {
    expectDiagnostic(
      () =>
        validateConfigurationDraftOutput(inputValue(), {
          schema_version: 1,
          summary: "No definitions.",
          objects: [],
          fields: [],
          relationships: [],
          views: [],
          forms: [],
          pages: [],
        }),
      "draft_empty",
    );
  });

  it("rejects unknown properties, malformed references and forbidden authority", () => {
    expect(
      builderConfigurationDraftOutputSchema.safeParse({
        ...validDraft(),
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      builderConfigurationDraftOutputSchema.safeParse({
        ...validDraft(),
        objects: [
          {
            ...validDraft().objects[0],
            reference: "object_1",
          },
        ],
      }).success,
    ).toBe(false);

    for (const property of [
      "id",
      "business_id",
      "object_definition_id",
      "key",
      "position",
      "is_active",
      "status",
      "slug",
      "op",
      "operations",
      "set_object",
      "set_field",
      "expected_base_version_id",
      "expected_head_revision",
      "candidate",
      "proposal",
      "validation_result",
      "apply",
      "publish",
    ]) {
      expect(
        builderConfigurationDraftOutputSchema.safeParse({
          ...validDraft(),
          [property]: "not-authoritative-input",
        }).success,
      ).toBe(false);
    }

    const field = validDraft().fields[0]!;
    for (const property of [
      "id",
      "business_id",
      "object_definition_id",
      "key",
      "field_key",
      "position",
      "default_value",
      "settings_json",
      "is_active",
    ]) {
      expect(
        draftFieldSchema.safeParse({
          ...field,
          [property]: "not-authoritative-input",
        }).success,
      ).toBe(false);
    }
    expect(
      draftFieldSchema.safeParse({
        ...field,
        field_type: "status",
        settings: { options: ["New", "Confirmed"] },
      }).success,
    ).toBe(true);
  });

  it("enforces bounds, strict field settings and the closed Page block grammar", () => {
    expect(
      builderConfigurationDraftOutputSchema.safeParse({
        ...validDraft(),
        summary: "x".repeat(2_001),
      }).success,
    ).toBe(false);
    expect(
      builderConfigurationDraftOutputSchema.safeParse({
        ...validDraft(),
        pages: [
          {
            ...validDraft().pages[0],
            blocks: Array.from({ length: 101 }, () => ({
              type: "divider" as const,
            })),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      draftFieldSchema.safeParse({
        ...validDraft().fields[0],
        field_type: "short_text",
        settings: { options: ["Not allowed"] },
      }).success,
    ).toBe(false);
    expect(
      draftFieldSchema.safeParse({
        ...validDraft().fields[0],
        field_type: "currency",
        settings: { currency: "gbp" },
      }).success,
    ).toBe(false);
    expect(
      draftFieldSchema.safeParse({
        ...validDraft().fields[0],
        field_type: "select",
        settings: { options: ["New", "new"] },
      }).success,
    ).toBe(false);
    expect(
      builderConfigurationDraftOutputSchema.safeParse({
        ...validDraft(),
        pages: [
          {
            ...validDraft().pages[0],
            blocks: [{ type: "image", src: "https://example.test/image" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate local references and enforces the serialized output limit", () => {
    const duplicate = validDraft();
    duplicate.objects.push({
      ...duplicate.objects[0]!,
      singular_label: "Another Object",
      plural_label: "Another Objects",
    });
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), duplicate),
      "duplicate_local_reference",
    );

    const largeInput = inputValue(
      readyPlan(["define_object", "define_field", "define_relationship"]),
    );
    const largeOutput: BuilderConfigurationDraftOutput = {
      schema_version: 1,
      summary: "A deliberately over-sized bounded draft.",
      objects: Array.from({ length: 20 }, (_, index) => ({
        reference: `draft_object_${index + 1}`,
        source_step_references: ["step_1"],
        singular_label: `Object ${index + 1}`,
        plural_label: `Objects ${index + 1}`,
        description: "x".repeat(5_000),
      })),
      fields: Array.from({ length: 100 }, (_, index) => ({
        reference: `draft_field_${index + 1}`,
        source_step_references: ["step_2"],
        object_reference: {
          source: "draft" as const,
          object_reference: `draft_object_${(index % 20) + 1}`,
        },
        label: `Field ${index + 1} ${"x".repeat(100)}`,
        field_type: "short_text" as const,
        required: false,
        settings: {},
      })),
      relationships: Array.from({ length: 50 }, (_, index) => ({
        reference: `draft_relationship_${index + 1}`,
        source_step_references: ["step_3"],
        source_object_reference: {
          source: "draft" as const,
          object_reference: `draft_object_${(index % 20) + 1}`,
        },
        target_object_reference: {
          source: "draft" as const,
          object_reference: `draft_object_${((index + 1) % 20) + 1}`,
        },
        source_label: `source ${"x".repeat(100)}`,
        target_label: `target ${"x".repeat(100)}`,
        cardinality: "one_to_many" as const,
        is_required: false,
      })),
      views: [],
      forms: [],
      pages: [],
    };
    expectDiagnostic(
      () => validateConfigurationDraftOutput(largeInput, largeOutput),
      "output_too_large",
    );
  });
});

describe("builder configuration draft input semantics", () => {
  it("requires a ready, configuration-only plan with supported categories", () => {
    expect(validateConfigurationDraftInput(inputValue())).toMatchObject({
      ready_plan: { state: "ready" },
    });

    const clarification = {
      schema_version: 1,
      state: "needs_clarification" as const,
      understanding: "More detail is needed.",
      known_requirements: [],
      assumptions: [],
      questions: [
        {
          reference: "question_1",
          question: "What should be collected?",
          reason: "The form fields are not known.",
          response_style: "free_text" as const,
        },
      ],
      unsupported_requirements: [],
    };
    expect(
      builderConfigurationDraftTaskInputSchema.safeParse(
        rawInput(clarification),
      ).success,
    ).toBe(false);

    const operational = {
      ...readyPlan(["define_object"]),
      plan: {
        ...readyPlan(["define_object"]).plan,
        concepts: [],
        steps: [
          {
            reference: "step_1",
            sequence: 1,
            lane: "operational" as const,
            category: "create_location" as const,
            summary: "Create a Location.",
            dependencies: [],
            affected_concepts: [],
            existing_object_keys: [],
            location_references: [],
            materiality: "medium" as const,
            requires_owner_confirmation: true as const,
          },
        ],
      },
    };
    expectDiagnostic(
      () => validateConfigurationDraftInput(rawInput(operational)),
      "input_plan_not_configuration_only",
    );

    const mixed = readyPlan(["define_object"]);
    mixed.plan.steps.push({
      reference: "step_2",
      sequence: 2,
      lane: "operational",
      category: "create_location",
      summary: "Create a Location.",
      dependencies: ["step_1"],
      affected_concepts: [],
      existing_object_keys: [],
      location_references: [],
      materiality: "medium",
      requires_owner_confirmation: true,
    });
    expectDiagnostic(
      () => validateConfigurationDraftInput(rawInput(mixed)),
      "input_plan_not_configuration_only",
    );

    const preorder = readyPlan(["configure_preorder"]);
    preorder.plan.concepts = [];
    preorder.plan.steps[0]!.affected_concepts = [];
    expectDiagnostic(
      () => validateConfigurationDraftInput(rawInput(preorder)),
      "input_category_not_supported",
    );

    const inventedObject = readyPlan(["define_field"]);
    inventedObject.plan.steps[0]!.existing_object_keys = ["invented"];
    expectDiagnostic(
      () => validateConfigurationDraftInput(rawInput(inventedObject)),
      "input_plan_invalid",
    );
  });

  it("fails invalid task input before the injected provider is called", async () => {
    const generateStructured = vi.fn();
    const service = draftExecutionService(generateStructured);
    const invalid = rawInput(readyPlan(["configure_preorder"]));

    await expect(
      service.execute("builder_configuration_draft_v1", invalid),
    ).rejects.toMatchObject({ code: "ai_input_invalid" });
    expect(generateStructured).not.toHaveBeenCalled();
  });
});

describe("builder configuration draft semantic validation", () => {
  it("requires every source step and compatible entity category", () => {
    const unknownStep = validDraft();
    unknownStep.objects[0]!.source_step_references = ["step_99"];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), unknownStep),
      "unknown_source_step",
    );

    const mismatch = validDraft();
    mismatch.objects[0]!.source_step_references = ["step_4"];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), mismatch),
      "source_step_category_mismatch",
    );

    const uncovered = validDraft();
    uncovered.pages = [];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), uncovered),
      "source_step_uncovered",
    );
  });

  it("resolves exact active context keys and draft references", () => {
    const unknownObject = validDraft();
    unknownObject.relationships[0]!.source_object_reference = {
      source: "existing",
      object_key: "invented",
    };
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), unknownObject),
      "existing_object_unknown_or_inactive",
    );

    const inactiveField = validDraft();
    tableView(inactiveField).configuration.fields = [
      { source: "existing", object_key: "customer", field_key: "old_note" },
    ];
    inactiveField.views[0]!.object_reference = {
      source: "existing",
      object_key: "customer",
    };
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), inactiveField),
      "existing_field_unknown_or_inactive",
    );

    const inactiveForm = validDraft();
    tableView(inactiveForm).configuration.create_form_reference = {
      source: "existing",
      form_key: "archived_form",
    };
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), inactiveForm),
      "existing_form_unknown_or_inactive",
    );

    const inactiveView = validDraft();
    inactiveView.pages[0]!.blocks = [
      {
        type: "view",
        view_reference: { source: "existing", view_key: "archived_view" },
      },
    ];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), inactiveView),
      "existing_view_unknown_or_inactive",
    );

    const unknownDraft = validDraft();
    unknownDraft.fields[0]!.object_reference = {
      source: "draft",
      object_reference: "draft_object_9",
    };
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), unknownDraft),
      "draft_object_unknown",
    );

    const unknownField = validDraft();
    tableView(unknownField).configuration.fields = [
      { source: "draft", field_reference: "draft_field_99" },
    ];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), unknownField),
      "draft_field_unknown",
    );
  });

  it("enforces Field ownership, View/Form ownership and create coverage", () => {
    const crossObjectView = validDraft();
    crossObjectView.views[0]!.object_reference = {
      source: "existing",
      object_key: "customer",
    };
    tableView(crossObjectView).configuration.fields = [
      draftFieldReference("draft_field_1"),
    ];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), crossObjectView),
      "view_field_object_mismatch",
    );

    const crossObjectForm = validDraft();
    crossObjectForm.forms[0]!.object_reference = {
      source: "existing",
      object_key: "customer",
    };
    crossObjectForm.forms[0]!.fields = [
      { field_reference: draftFieldReference("draft_field_1") },
    ];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), crossObjectForm),
      "form_field_object_mismatch",
    );

    const missingRequired = validDraft();
    missingRequired.forms[0]!.fields = missingRequired.forms[0]!.fields.filter(
      ({ field_reference }) =>
        field_reference.source !== "draft" ||
        field_reference.field_reference !== "draft_field_2",
    );
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), missingRequired),
      "required_create_form_field_missing",
    );

    const duplicateViewField = validDraft();
    tableView(duplicateViewField).configuration.fields = [
      draftFieldReference("draft_field_1"),
      draftFieldReference("draft_field_1"),
    ];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), duplicateViewField),
      "duplicate_field_intent",
    );

    const duplicateFormField = validDraft();
    duplicateFormField.forms[0]!.fields = [
      { field_reference: draftFieldReference("draft_field_1") },
      { field_reference: draftFieldReference("draft_field_1") },
    ];
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), duplicateFormField),
      "duplicate_field_intent",
    );
  });

  it("enforces View/Form mode and audience compatibility and Page block audiences", () => {
    const mismatchedViewForm = validDraft();
    tableView(mismatchedViewForm).configuration.create_form_reference = {
      source: "draft",
      form_reference: "draft_form_1",
    };
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), mismatchedViewForm),
      "view_form_mismatch",
    );

    const mismatchedPage = validDraft();
    mismatchedPage.pages[0]!.audience = "internal";
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), mismatchedPage),
      "page_block_audience_mismatch",
    );
  });

  it("requires a file Field for Cards images", () => {
    const cards = validDraft();
    cards.views[0] = {
      reference: "draft_view_1",
      source_step_references: ["step_4"],
      name: "Catering Enquiry cards",
      audience: "internal",
      object_reference: draftObjectReference,
      view_type: "cards",
      configuration: {
        title_field: draftFieldReference("draft_field_1"),
        image_field: draftFieldReference("draft_field_2"),
        supporting_fields: [],
      },
    };
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), cards),
      "cards_image_field_invalid",
    );
  });

  it("rejects duplicate new Object and same-Object Field labels deterministically", () => {
    const duplicateObject = validDraft();
    duplicateObject.objects.push({
      ...duplicateObject.objects[0]!,
      reference: "draft_object_2",
      singular_label: "  Catering\u00a0Enquiry ",
      plural_label: "Other enquiries",
    });
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), duplicateObject),
      "duplicate_object_intent",
    );

    const duplicateField = validDraft();
    duplicateField.fields.push({
      ...duplicateField.fields[0]!,
      reference: "draft_field_6",
      label: "  COMPANY NAME ",
    });
    expectDiagnostic(
      () => validateConfigurationDraftOutput(inputValue(), duplicateField),
      "duplicate_field_intent",
    );
  });

  it("does not turn collection order into position or allocation authority", () => {
    const output = validDraft();
    const reordered = {
      ...output,
      fields: [...output.fields].reverse(),
      objects: [...output.objects].reverse(),
    };
    expect(validateConfigurationDraftOutput(inputValue(), reordered)).toEqual(
      reordered,
    );
    expect(JSON.stringify(reordered)).not.toContain('"position"');
    expect(JSON.stringify(reordered)).not.toContain('"id"');
  });
});

describe("builder configuration draft task and disabled registry", () => {
  it("registers the task and exact production-disabled policy bounds", () => {
    expect(registeredAiTasks.builder_configuration_draft_v1).toBe(
      builderConfigurationDraftTaskV1,
    );
    expect(builderConfigurationDraftTaskV1).toMatchObject({
      key: "builder_configuration_draft_v1",
      version: 1,
      purposeLabel: "Draft bounded additive configuration intent",
      policyKey: BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
    });
    expect(
      aiExecutionPolicies[BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY],
    ).toMatchObject({
      providerKey: "disabled",
      modelKey: "unconfigured",
      maxInputBytes: 256 * 1024,
      maxBillableInputTokens: 96_000,
      maxOutputTokens: 8_192,
      timeoutMs: 30_000,
      maxAttempts: 2,
      retryDelayMs: 250,
      retryableFailureKinds: ["rate_limited", "transient"],
      inputMicrousdPerMillion: 0,
      outputMicrousdPerMillion: 0,
    });
    expect(BUILDER_CONFIGURATION_DRAFT_INSTRUCTION).toContain(
      "Never output Milestone 5 set_* operations",
    );
    expect(BUILDER_CONFIGURATION_DRAFT_INSTRUCTION).not.toContain(
      "builder_planning_terra_medium_v1",
    );
  });

  it("keeps the drafting task disabled in both server modes", async () => {
    const disabledRuntime = createProductionAiRuntime({
      AI_PROVIDER: "disabled",
    });
    expect(
      disabledRuntime.policies[
        BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY
      ].providerKey,
    ).toBe("disabled");
    expect(disabledRuntime.providers.disabled?.key).toBe("disabled");

    const openAiFactory = vi.fn(() => ({
      key: "openai" as const,
      generateStructured: vi.fn(),
    }));
    const openAiRuntime = createProductionAiRuntime(
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
      { createOpenAiProvider: openAiFactory },
    );
    expect(
      openAiRuntime.policies[BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY]
        .providerKey,
    ).toBe("disabled");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must remain disabled"));
    await expect(
      createAiExecutionService({
        tasks: openAiRuntime.tasks,
        policies: openAiRuntime.policies,
        providers: openAiRuntime.providers,
      }).execute("builder_configuration_draft_v1", inputValue()),
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openAiFactory).toHaveBeenCalledOnce();
  });

  it("passes valid injected output, preserves usage, and never retries semantic invalidity", async () => {
    const provider = vi.fn().mockResolvedValue({
      output: validDraft(),
      usage: { inputTokens: 77, outputTokens: 33 },
    });
    const result = await draftExecutionService(provider).execute(
      "builder_configuration_draft_v1",
      inputValue(),
    );
    expect(result.output).toEqual(validDraft());
    expect(result.accounting).toMatchObject({
      attemptsStarted: 1,
      inputTokens: 77,
      outputTokens: 33,
      usageReported: true,
      usageComplete: true,
    });
    expect(provider).toHaveBeenCalledOnce();

    const invalid = validDraft();
    invalid.relationships[0]!.source_object_reference = {
      source: "existing",
      object_key: "invented",
    };
    const invalidProvider = vi.fn().mockResolvedValue({
      output: invalid,
      usage: { inputTokens: 19, outputTokens: 8 },
    });
    let caught: unknown;
    try {
      await draftExecutionService(invalidProvider).execute(
        "builder_configuration_draft_v1",
        inputValue(),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiExecutionError);
    expect(caught).toMatchObject({ code: "ai_output_invalid" });
    expect((caught as AiExecutionError).accounting).toMatchObject({
      inputTokens: 19,
      outputTokens: 8,
      usageReported: true,
    });
    expect(invalidProvider).toHaveBeenCalledOnce();
    expect(JSON.stringify(caught)).not.toContain("duplicate_object_intent");
    expect(JSON.stringify(caught)).not.toContain("invented");
  });
});

describe("builder configuration drafting source boundaries", () => {
  it("contains no mutation, provider, database, operation, route or client imports", () => {
    const draftingRoot = path.join(
      repositoryRoot,
      "src",
      "ai",
      "configuration-drafting",
    );
    const source = fs
      .readdirSync(draftingRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) =>
        fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
      )
      .join("\n");

    expect(source).not.toMatch(
      /from ["'][^"']*(?:supabase|database|service|openai|provider|accounting|business-execution|configuration|preorder)[^"']*["']/i,
    );
    expect(source).not.toMatch(
      /\b(?:configurationOperationSchema|configurationOperationsSchema|propose_configuration_change|apply_configuration_change|validate_configuration_change|createGraphService|ConfigurationChangeService)\b/,
    );

    const appSource = fs
      .readdirSync(path.join(repositoryRoot, "src", "app"), {
        recursive: true,
        withFileTypes: true,
      })
      .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
      .map((entry) =>
        fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
      )
      .join("\n");
    expect(appSource).not.toMatch(
      /builder_configuration_draft_v1|configuration-drafting/,
    );
  });

  it("adds no migration, operation schema, evaluation or runtime mutation file", () => {
    const migrationFiles = fs
      .readdirSync(path.join(repositoryRoot, "supabase", "migrations"))
      .filter((file) => file.endsWith(".sql"));
    const migrationSource = migrationFiles
      .map((file) =>
        fs.readFileSync(
          path.join(repositoryRoot, "supabase", "migrations", file),
          "utf8",
        ),
      )
      .join("\n");
    expect(migrationSource).not.toMatch(
      /builder_configuration_draft_v1|draft_(?:object|field|relationship|view|form|page)_\d+/,
    );
    expect(
      fs.existsSync(
        path.join(
          repositoryRoot,
          "evaluations",
          "builder-configuration-drafting.live.eval.ts",
        ),
      ),
    ).toBe(false);
  });

  it("keeps the public Page and generic Form gap explicit in the contract", () => {
    expect(BUILDER_CONFIGURATION_DRAFT_INSTRUCTION).toContain(
      "A public Form or Page is configuration design intent only",
    );
    expect(BUILDER_CONFIGURATION_DRAFT_INSTRUCTION).toContain(
      "Relationship is definition intent only",
    );
  });
});
