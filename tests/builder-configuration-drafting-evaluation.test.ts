import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AI_BUSINESS_CONTEXT_MAX_BYTES,
  aiBusinessModelContextV1Schema,
} from "../src/ai/context/schemas";
import { serializeAiBusinessModelContext } from "../src/ai/context/projector";
import {
  builderConfigurationDraftOutputSchema,
  builderConfigurationDraftTaskInputBaseSchema,
} from "../src/ai/configuration-drafting/schemas";
import {
  builderConfigurationDraftTaskInputSchema,
  builderConfigurationDraftTaskV1,
} from "../src/ai/configuration-drafting/task";
import { validateConfigurationDraftInput } from "../src/ai/configuration-drafting/validation";
import {
  evaluateConfigurationDraft,
  type ConfigurationDraftingExecutionMetadata,
} from "../src/ai/evaluation/configuration-drafting/evaluator";
import {
  configurationDraftingSyntheticContextBytes,
  configurationDraftingSyntheticContexts,
} from "../evaluations/fixtures/synthetic-configuration-drafting-context";
import {
  configurationDraftingScenarios,
  configurationDraftingScenarioIds,
} from "../src/ai/evaluation/configuration-drafting/scenarios";
import { configurationDraftingReportSchema } from "../src/ai/evaluation/configuration-drafting/schemas";
import {
  compliantConfigurationDraftingOutputs,
  createInjectedConfigurationDraftingExecution,
} from "./support/builder-configuration-drafting-evaluation-fixtures";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const metadata: ConfigurationDraftingExecutionMetadata = {
  attempts: 1,
  inputTokens: 1_200,
  outputTokens: 400,
  usageComplete: true,
  elapsedMs: 25,
};

function outputFor(id: (typeof configurationDraftingScenarioIds)[number]) {
  return structuredClone(compliantConfigurationDraftingOutputs[id]);
}

function draftFormReference(reference: string) {
  return { source: "draft" as const, form_reference: reference };
}

function draftFieldReference(reference: string) {
  return { source: "draft" as const, field_reference: reference };
}

describe("configuration drafting scenario and context definitions", () => {
  it("defines exactly the approved eight scenarios in fixed order", () => {
    expect(configurationDraftingScenarioIds).toEqual([
      "catering_enquiry_full_stack",
      "customer_marketing_consent_field",
      "customer_directory_internal",
      "public_customer_contact_page",
      "equipment_maintenance_workspace",
      "supplier_quote_field_types",
      "staff_profile_cards",
      "order_detail_workspace",
    ]);
    expect(configurationDraftingScenarios).toHaveLength(8);
    expect(new Set(configurationDraftingScenarioIds).size).toBe(8);
    expect(
      new Set(
        configurationDraftingScenarios.map(({ context_id }) => context_id),
      ),
    ).toEqual(new Set(["rich_existing_business", "empty_new_business"]));
  });

  it("parses every complete task input through the actual drafting schema", () => {
    for (const scenario of configurationDraftingScenarios) {
      expect(
        builderConfigurationDraftTaskInputSchema.parse(scenario.task_input),
      ).toEqual(scenario.task_input);
      expect(
        validateConfigurationDraftInput(scenario.task_input).ready_plan.state,
      ).toBe("ready");
      expect(scenario.ready_plan.unsupported_requirements).toEqual([]);
      expect(scenario.ready_plan.plan.steps).toHaveLength(
        scenario.ready_plan.plan.steps.length,
      );
      for (const step of scenario.ready_plan.plan.steps) {
        expect(step.lane).toBe("configuration");
        expect([
          "define_object",
          "define_field",
          "define_relationship",
          "configure_view",
          "configure_form",
          "configure_page",
        ]).toContain(step.category);
        expect(step.location_references).toEqual([]);
      }
    }
  });

  it("contains exactly two bounded, deterministic, non-operational contexts", () => {
    expect(
      Object.keys(configurationDraftingSyntheticContexts).toSorted(),
    ).toEqual(["empty_new_business", "rich_existing_business"]);
    for (const context of Object.values(
      configurationDraftingSyntheticContexts,
    )) {
      expect(aiBusinessModelContextV1Schema.parse(context)).toEqual(context);
      expect(Object.isFrozen(context)).toBe(true);
      expect(serializeAiBusinessModelContext(context)).toBe(
        serializeAiBusinessModelContext(structuredClone(context)),
      );
      expect(
        new TextEncoder().encode(serializeAiBusinessModelContext(context))
          .byteLength,
      ).toBeLessThan(AI_BUSINESS_CONTEXT_MAX_BYTES);
      const serialized = JSON.stringify(context);
      const withoutUuidReferences = serialized.replaceAll(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
        "",
      );
      for (const prohibited of [
        /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/,
        /https?:\/\//i,
        /\b(?:api[_ -]?key|password|secret|bearer)\b/i,
        /\bPO-[A-F0-9]{8}\b/i,
        /\+?\d[\d ()-]{8,}\d/,
      ]) {
        expect(withoutUuidReferences).not.toMatch(prohibited);
      }
      expect(context).not.toHaveProperty("records");
      expect(context).not.toHaveProperty("record_relationships");
      expect(context).not.toHaveProperty("proposals");
      expect(context).not.toHaveProperty("provider_response");
    }
    expect(
      configurationDraftingSyntheticContextBytes.rich_existing_business,
    ).toBeGreaterThan(0);
    expect(
      configurationDraftingSyntheticContextBytes.empty_new_business,
    ).toBeGreaterThan(0);
    expect(
      configurationDraftingSyntheticContextBytes.rich_existing_business,
    ).toBeLessThan(128 * 1024);
    expect(
      configurationDraftingSyntheticContextBytes.empty_new_business,
    ).toBeLessThan(128 * 1024);

    const empty = configurationDraftingSyntheticContexts.empty_new_business;
    expect(empty.objects).toEqual([]);
    expect(empty.locations).toEqual([]);
    expect(empty.relationships).toEqual([]);
    expect(empty.views).toEqual([]);
    expect(empty.forms).toEqual([]);
    expect(empty.pages).toEqual([]);
    expect(empty.preorder_experiences).toEqual([]);

    const rich = configurationDraftingSyntheticContexts.rich_existing_business;
    expect(rich.objects.map(({ key }) => key)).toEqual([
      "customer",
      "order",
      "order_item",
      "product",
    ]);
    expect(rich.forms.map(({ key }) => key)).toEqual([
      "edit_order",
      "customer_contact",
    ]);
    expect(rich.views.map(({ key }) => key)).toEqual([
      "orders",
      "order_details",
    ]);
    expect(rich.platform_capabilities.registry_version).toBe(1);
  });
});

describe("actual drafting task contract and deterministic evaluator", () => {
  it("passes all eight compliant fixtures through execution, schema, validator, and gates", async () => {
    const execution = createInjectedConfigurationDraftingExecution(
      async (scenarioId) => ({
        output: structuredClone(
          compliantConfigurationDraftingOutputs[scenarioId],
        ),
        usage: { inputTokens: 1_200, outputTokens: 400 },
      }),
    );
    for (const scenario of configurationDraftingScenarios) {
      const result = await execution.execute(
        "builder_configuration_draft_v1",
        scenario.task_input,
      );
      const report = evaluateConfigurationDraft(
        scenario,
        builderConfigurationDraftOutputSchema.parse(result.output),
        {
          attempts: result.accounting.attemptsStarted,
          inputTokens: result.accounting.inputTokens,
          outputTokens: result.accounting.outputTokens,
          usageComplete: result.accounting.usageComplete,
          elapsedMs: 25,
        },
      );
      expect(report.passed, scenario.id).toBe(true);
      expect(report.failed_gate_codes, scenario.id).toEqual([]);
      expect(configurationDraftingReportSchema.parse(report)).toEqual(report);
    }
  });

  it("keeps reports bounded and redacted", () => {
    for (const scenario of configurationDraftingScenarios) {
      const report = evaluateConfigurationDraft(
        scenario,
        compliantConfigurationDraftingOutputs[scenario.id],
        metadata,
      );
      const serialized = JSON.stringify(report);
      for (const marker of [
        scenario.owner_request,
        scenario.task_input.business_context.business.name,
        "Catering Enquiry",
        "Company name",
        "draft_object_1",
        "Pending",
        "Tell us about your event",
      ]) {
        expect(serialized).not.toContain(marker);
      }
      expect(report).not.toHaveProperty("owner_request");
      expect(report).not.toHaveProperty("business_context");
      expect(report).not.toHaveProperty("plan");
      expect(report).not.toHaveProperty("output");
    }
  });

  it("fails deterministic gates for semantically valid adjacent or incorrect intent", () => {
    const extraField = outputFor("catering_enquiry_full_stack");
    extraField.fields.push({
      reference: "draft_field_6",
      source_step_references: ["step_2"],
      object_reference: { source: "draft", object_reference: "draft_object_1" },
      label: "Internal code",
      field_type: "short_text",
      required: false,
      settings: null,
    });
    const extraFieldReport = evaluateAfterTaskValidation(
      "catering_enquiry_full_stack",
      extraField,
    );
    expect(extraFieldReport.passed).toBe(false);
    expect(extraFieldReport.failed_gate_codes).toEqual(
      expect.arrayContaining(["field_set_mismatch", "adjacent_scope_added"]),
    );

    const requiredness = outputFor("customer_marketing_consent_field");
    requiredness.fields[0]!.required = true;
    const requirednessReport = evaluateAfterTaskValidation(
      "customer_marketing_consent_field",
      requiredness,
    );
    expect(requirednessReport.failed_gate_codes).toContain(
      "field_requiredness_mismatch",
    );

    const wrongFormAudience = outputFor("customer_directory_internal");
    wrongFormAudience.forms[0]!.audience = "public";
    wrongFormAudience.views[0]!.audience = "public";
    const wrongFormAudienceReport = evaluateAfterTaskValidation(
      "customer_directory_internal",
      wrongFormAudience,
    );
    expect(wrongFormAudienceReport.failed_gate_codes).toEqual(
      expect.arrayContaining(["form_mismatch", "view_mismatch"]),
    );

    const wrongCurrency = outputFor("supplier_quote_field_types");
    const currency = wrongCurrency.fields.find(
      ({ label }) => label === "Quote total",
    );
    if (!currency || currency.field_type !== "currency")
      throw new Error("Missing currency fixture.");
    currency.settings = { currency: "USD" };
    const currencyReport = evaluateAfterTaskValidation(
      "supplier_quote_field_types",
      wrongCurrency,
    );
    expect(currencyReport.failed_gate_codes).toContain(
      "field_settings_mismatch",
    );

    const wrongRelationship = outputFor("equipment_maintenance_workspace");
    const relationship = wrongRelationship.relationships[0]!;
    [
      relationship.source_object_reference,
      relationship.target_object_reference,
    ] = [
      relationship.target_object_reference,
      relationship.source_object_reference,
    ];
    const relationshipReport = evaluateAfterTaskValidation(
      "equipment_maintenance_workspace",
      wrongRelationship,
    );
    expect(relationshipReport.failed_gate_codes).toContain(
      "relationship_mismatch",
    );

    const wrongType = outputFor("equipment_maintenance_workspace");
    wrongType.views[0]!.view_type = "table";
    wrongType.views[0]!.configuration = {
      fields: [
        { source: "draft", field_reference: "draft_field_1" },
        { source: "draft", field_reference: "draft_field_2" },
      ],
      title_field: null,
      create_form_reference: {
        source: "draft",
        form_reference: "draft_form_1",
      },
      edit_form_reference: null,
    };
    const wrongTypeReport = evaluateAfterTaskValidation(
      "equipment_maintenance_workspace",
      wrongType,
    );
    expect(wrongTypeReport.failed_gate_codes).toContain("view_mismatch");

    const wrongImage = outputFor("staff_profile_cards");
    if (wrongImage.views[0]?.view_type !== "cards")
      throw new Error("Missing Cards fixture.");
    wrongImage.views[0].configuration.image_field = null;
    const wrongImageReport = evaluateAfterTaskValidation(
      "staff_profile_cards",
      wrongImage,
    );
    expect(wrongImageReport.failed_gate_codes).toContain("view_mismatch");

    const missingLink = outputFor("order_detail_workspace");
    if (missingLink.views[0]?.view_type !== "detail")
      throw new Error("Missing Detail fixture.");
    missingLink.views[0].configuration.edit_form_reference = null;
    const missingLinkReport = evaluateAfterTaskValidation(
      "order_detail_workspace",
      missingLink,
    );
    expect(missingLinkReport.failed_gate_codes).toContain(
      "view_form_link_mismatch",
    );

    const pageAudience = outputFor("public_customer_contact_page");
    pageAudience.pages[0]!.audience = "internal";
    pageAudience.pages[0]!.blocks = pageAudience.pages[0]!.blocks.slice(0, 2);
    const pageAudienceReport = evaluateAfterTaskValidation(
      "public_customer_contact_page",
      pageAudience,
    );
    expect(pageAudienceReport.failed_gate_codes).toEqual(
      expect.arrayContaining(["page_mismatch", "page_block_mismatch"]),
    );

    const forbiddenStatus = outputFor("catering_enquiry_full_stack");
    forbiddenStatus.fields.push({
      reference: "draft_field_6",
      source_step_references: ["step_2"],
      object_reference: { source: "draft", object_reference: "draft_object_1" },
      label: "Status",
      field_type: "status",
      required: false,
      settings: { options: ["New", "Done"] },
    });
    const statusReport = evaluateAfterTaskValidation(
      "catering_enquiry_full_stack",
      forbiddenStatus,
    );
    expect(statusReport.failed_gate_codes).toContain("forbidden_status_field");
  });
});

describe("fair deterministic drafting gates", () => {
  it("accepts Catering wording and generated-name variation", () => {
    const output = outputFor("catering_enquiry_full_stack");
    output.relationships[0]!.source_label = "submits requests";
    output.relationships[0]!.target_label = "customer record";
    output.forms[0]!.name = "Send catering request";
    output.views[0]!.name = "Enquiry pipeline";
    output.pages[0]!.title = "Event enquiry form";
    const heading = output.pages[0]!.blocks[0]!;
    if (heading.type !== "heading") throw new Error("Missing heading fixture.");
    heading.text = "Share your event details";

    expect(
      evaluateAfterTaskValidation("catering_enquiry_full_stack", output),
    ).toMatchObject({ passed: true, failed_gate_codes: [] });
  });

  it("accepts Wholesale heading and explanatory-text variation", () => {
    const output = outputFor("public_customer_contact_page");
    const heading = output.pages[0]!.blocks[0]!;
    const text = output.pages[0]!.blocks[1]!;
    if (heading.type !== "heading" || text.type !== "text") {
      throw new Error("Missing Wholesale page prose fixtures.");
    }
    heading.text = "Talk to our wholesale team";
    text.text = "Tell us what your business needs.";

    expect(
      evaluateAfterTaskValidation("public_customer_contact_page", output),
    ).toMatchObject({ passed: true, failed_gate_codes: [] });
  });

  it("accepts Equipment and Maintenance label, relationship, and name variation", () => {
    const output = outputFor("equipment_maintenance_workspace");
    output.objects.find(
      ({ concept_reference }) => concept_reference === "concept_1",
    )!.plural_label = "Equipment Items";
    output.objects.find(
      ({ concept_reference }) => concept_reference === "concept_2",
    )!.plural_label = "Maintenance Work Items";
    output.relationships[0]!.source_label = "tracks work for";
    output.relationships[0]!.target_label = "equipment item";
    output.forms[0]!.name = "Add an equipment item";
    output.forms[1]!.name = "Log maintenance work";
    output.views[0]!.name = "Equipment register";
    output.views[1]!.name = "Maintenance worklist";

    expect(
      evaluateAfterTaskValidation("equipment_maintenance_workspace", output),
    ).toMatchObject({ passed: true, failed_gate_codes: [] });
  });

  it("does not gate Equipment on an invented plural label", () => {
    const output = outputFor("equipment_maintenance_workspace");
    output.objects.find(
      ({ concept_reference }) => concept_reference === "concept_1",
    )!.plural_label = "Equipment";
    const scenario = configurationDraftingScenarios.find(
      ({ id }) => id === "equipment_maintenance_workspace",
    )!;

    // The production semantic validator retains its frozen duplicate-intent
    // rule; this direct evaluator assertion isolates the corrected gate.
    expect(
      evaluateConfigurationDraft(
        scenario,
        builderConfigurationDraftOutputSchema.parse(output),
        metadata,
      ),
    ).toMatchObject({ passed: true, failed_gate_codes: [] });
  });

  it("accepts Supplier Quote generated-name variation", () => {
    const output = outputFor("supplier_quote_field_types");
    output.forms[0]!.name = "Add supplier pricing";
    output.views[0]!.name = "Quote comparison";

    expect(
      evaluateAfterTaskValidation("supplier_quote_field_types", output),
    ).toMatchObject({ passed: true, failed_gate_codes: [] });
  });

  it("accepts Staff Profile generated-name variation while preserving Cards mappings", () => {
    const output = outputFor("staff_profile_cards");
    output.forms[0]!.name = "Add team member";
    output.views[0]!.name = "Team directory cards";

    expect(
      evaluateAfterTaskValidation("staff_profile_cards", output),
    ).toMatchObject({ passed: true, failed_gate_codes: [] });
  });
});

describe("configuration drafting evaluator negative coverage", () => {
  it("keeps relationship direction, cardinality, and requiredness exact", () => {
    for (const [mutation, expectedCode] of [
      [
        (output: ReturnType<typeof outputFor>) => {
          const relationship = output.relationships[0]!;
          [
            relationship.source_object_reference,
            relationship.target_object_reference,
          ] = [
            relationship.target_object_reference,
            relationship.source_object_reference,
          ];
        },
        "relationship_mismatch",
      ],
      [
        (output: ReturnType<typeof outputFor>) => {
          output.relationships[0]!.cardinality = "one_to_one";
        },
        "relationship_mismatch",
      ],
      [
        (output: ReturnType<typeof outputFor>) => {
          output.relationships[0]!.is_required = true;
        },
        "relationship_mismatch",
      ],
    ] as const) {
      const output = outputFor("equipment_maintenance_workspace");
      mutation(output);
      const report = evaluateAfterTaskValidation(
        "equipment_maintenance_workspace",
        output,
      );
      expect(report.passed).toBe(false);
      expect(report.failed_gate_codes).toContain(expectedCode);
    }
  });

  it("keeps Form mode, audience, and Field set exact", () => {
    const wrongMode = outputFor("customer_directory_internal");
    wrongMode.forms[0]!.mode = "edit";
    if (wrongMode.views[0]?.view_type !== "table") {
      throw new Error("Missing Customer table fixture.");
    }
    wrongMode.views[0]!.configuration.create_form_reference = null;
    wrongMode.views[0]!.configuration.edit_form_reference =
      draftFormReference("draft_form_1");
    expect(
      evaluateAfterTaskValidation("customer_directory_internal", wrongMode)
        .failed_gate_codes,
    ).toEqual(expect.arrayContaining(["form_mismatch"]));

    const wrongAudience = outputFor("customer_directory_internal");
    wrongAudience.forms[0]!.audience = "public";
    wrongAudience.views[0]!.audience = "public";
    expect(
      evaluateAfterTaskValidation("customer_directory_internal", wrongAudience)
        .failed_gate_codes,
    ).toEqual(expect.arrayContaining(["form_mismatch"]));

    const wrongFields = outputFor("order_detail_workspace");
    wrongFields.forms[0]!.fields.pop();
    expect(
      evaluateAfterTaskValidation("order_detail_workspace", wrongFields)
        .failed_gate_codes,
    ).toContain("form_field_set_mismatch");
  });

  it("keeps View type, audience, Field set, Cards image, and Form links exact", () => {
    const wrongType = outputFor("equipment_maintenance_workspace");
    wrongType.views[0]!.view_type = "table";
    wrongType.views[0]!.configuration = {
      fields: [
        draftFieldReference("draft_field_1"),
        draftFieldReference("draft_field_2"),
      ],
      title_field: null,
      create_form_reference: draftFormReference("draft_form_1"),
      edit_form_reference: null,
    };
    expect(
      evaluateAfterTaskValidation("equipment_maintenance_workspace", wrongType)
        .failed_gate_codes,
    ).toContain("view_mismatch");

    const wrongAudience = outputFor("customer_directory_internal");
    wrongAudience.forms[0]!.audience = "public";
    wrongAudience.views[0]!.audience = "public";
    expect(
      evaluateAfterTaskValidation("customer_directory_internal", wrongAudience)
        .failed_gate_codes,
    ).toContain("view_mismatch");

    const wrongFields = outputFor("equipment_maintenance_workspace");
    if (wrongFields.views[1]?.view_type !== "table") {
      throw new Error("Missing Maintenance table fixture.");
    }
    wrongFields.views[1].configuration.fields.pop();
    expect(
      evaluateAfterTaskValidation(
        "equipment_maintenance_workspace",
        wrongFields,
      ).failed_gate_codes,
    ).toContain("view_field_set_mismatch");

    const wrongImage = outputFor("staff_profile_cards");
    if (wrongImage.views[0]?.view_type !== "cards") {
      throw new Error("Missing Cards fixture.");
    }
    wrongImage.views[0].configuration.image_field = null;
    expect(
      evaluateAfterTaskValidation("staff_profile_cards", wrongImage)
        .failed_gate_codes,
    ).toContain("view_mismatch");

    const wrongLink = outputFor("customer_directory_internal");
    if (wrongLink.views[0]?.view_type !== "table") {
      throw new Error("Missing Customer table fixture.");
    }
    wrongLink.views[0]!.configuration.create_form_reference = null;
    expect(
      evaluateAfterTaskValidation("customer_directory_internal", wrongLink)
        .failed_gate_codes,
    ).toContain("view_form_link_mismatch");
  });

  it("keeps Page block order and draft/existing link identity exact", () => {
    const wrongOrder = outputFor("public_customer_contact_page");
    [wrongOrder.pages[0]!.blocks[0], wrongOrder.pages[0]!.blocks[1]] = [
      wrongOrder.pages[0]!.blocks[1]!,
      wrongOrder.pages[0]!.blocks[0]!,
    ];
    expect(
      evaluateAfterTaskValidation("public_customer_contact_page", wrongOrder)
        .failed_gate_codes,
    ).toContain("page_block_mismatch");

    const wrongDraftForm = outputFor("catering_enquiry_full_stack");
    wrongDraftForm.forms.push({
      ...wrongDraftForm.forms[0]!,
      reference: "draft_form_2",
      name: "Another valid enquiry form",
    });
    wrongDraftForm.pages[0]!.blocks[1] = {
      type: "form",
      form_reference: draftFormReference("draft_form_2"),
    };
    expect(
      evaluateAfterTaskValidation("catering_enquiry_full_stack", wrongDraftForm)
        .failed_gate_codes,
    ).toEqual(
      expect.arrayContaining(["entity_count_mismatch", "page_block_mismatch"]),
    );

    const wrongExistingForm = outputFor("public_customer_contact_page");
    wrongExistingForm.pages[0]!.blocks[2] = {
      type: "form",
      form_reference: draftFormReference("draft_form_1"),
    };
    expect(
      evaluateConfigurationDraft(
        configurationDraftingScenarios.find(
          ({ id }) => id === "public_customer_contact_page",
        )!,
        builderConfigurationDraftOutputSchema.parse(wrongExistingForm),
        metadata,
      ).failed_gate_codes,
    ).toContain("page_block_mismatch");
  });

  it("keeps required entity families, forbidden Fields, and explicit names exact", () => {
    const missingPage = outputFor("catering_enquiry_full_stack");
    missingPage.pages.pop();
    expect(
      evaluateConfigurationDraft(
        configurationDraftingScenarios.find(
          ({ id }) => id === "catering_enquiry_full_stack",
        )!,
        builderConfigurationDraftOutputSchema.parse(missingPage),
        metadata,
      ).failed_gate_codes,
    ).toContain("entity_count_mismatch");

    const missingView = outputFor("supplier_quote_field_types");
    missingView.views.pop();
    expect(
      evaluateConfigurationDraft(
        configurationDraftingScenarios.find(
          ({ id }) => id === "supplier_quote_field_types",
        )!,
        builderConfigurationDraftOutputSchema.parse(missingView),
        metadata,
      ).failed_gate_codes,
    ).toContain("entity_count_mismatch");

    const missingForm = outputFor("customer_directory_internal");
    missingForm.forms.pop();
    expect(
      evaluateConfigurationDraft(
        configurationDraftingScenarios.find(
          ({ id }) => id === "customer_directory_internal",
        )!,
        builderConfigurationDraftOutputSchema.parse(missingForm),
        metadata,
      ).failed_gate_codes,
    ).toContain("entity_count_mismatch");

    const extraObject = outputFor("catering_enquiry_full_stack");
    extraObject.objects.push({
      ...extraObject.objects[0]!,
      reference: "draft_object_2",
      concept_reference: "concept_99",
    });
    expect(
      evaluateConfigurationDraft(
        configurationDraftingScenarios.find(
          ({ id }) => id === "catering_enquiry_full_stack",
        )!,
        builderConfigurationDraftOutputSchema.parse(extraObject),
        metadata,
      ).failed_gate_codes,
    ).toEqual(
      expect.arrayContaining([
        "object_concept_mismatch",
        "adjacent_scope_added",
      ]),
    );

    const extraField = outputFor("catering_enquiry_full_stack");
    extraField.fields.push({
      ...extraField.fields[0]!,
      reference: "draft_field_6",
      label: "Internal code",
      required: false,
    });
    expect(
      evaluateAfterTaskValidation("catering_enquiry_full_stack", extraField)
        .failed_gate_codes,
    ).toEqual(
      expect.arrayContaining(["field_set_mismatch", "adjacent_scope_added"]),
    );

    const forbiddenStatus = outputFor("catering_enquiry_full_stack");
    forbiddenStatus.fields.push({
      ...forbiddenStatus.fields[0]!,
      reference: "draft_field_6",
      label: "Status",
      field_type: "status",
      required: false,
      settings: { options: ["New", "Done"] },
    });
    expect(
      evaluateAfterTaskValidation(
        "catering_enquiry_full_stack",
        forbiddenStatus,
      ).failed_gate_codes,
    ).toContain("forbidden_status_field");

    for (const [scenarioId, mutate, expectedCode] of [
      [
        "customer_directory_internal",
        (output: ReturnType<typeof outputFor>) => {
          output.forms[0]!.name = "Customer intake";
        },
        "form_mismatch",
      ],
      [
        "customer_directory_internal",
        (output: ReturnType<typeof outputFor>) => {
          output.views[0]!.name = "Customer list";
        },
        "view_mismatch",
      ],
      [
        "order_detail_workspace",
        (output: ReturnType<typeof outputFor>) => {
          output.forms[0]!.name = "Update order";
        },
        "form_mismatch",
      ],
      [
        "order_detail_workspace",
        (output: ReturnType<typeof outputFor>) => {
          output.views[0]!.name = "Review orders";
        },
        "view_mismatch",
      ],
      [
        "order_detail_workspace",
        (output: ReturnType<typeof outputFor>) => {
          output.pages[0]!.title = "Order workspace";
        },
        "page_mismatch",
      ],
    ] as const) {
      const output = outputFor(
        scenarioId as keyof typeof compliantConfigurationDraftingOutputs,
      );
      mutate(output);
      const report = evaluateAfterTaskValidation(
        scenarioId as keyof typeof compliantConfigurationDraftingOutputs,
        output,
      );
      expect(report.passed).toBe(false);
      expect(report.failed_gate_codes).toContain(expectedCode);
    }
  });
});

function evaluateAfterTaskValidation(
  scenarioId: (typeof configurationDraftingScenarioIds)[number],
  output: ReturnType<typeof outputFor>,
) {
  const scenario = configurationDraftingScenarios.find(
    ({ id }) => id === scenarioId,
  );
  if (!scenario) throw new Error("Missing scenario fixture.");
  const parsedInput = builderConfigurationDraftTaskInputBaseSchema.parse(
    scenario.task_input,
  );
  const validatedInput =
    builderConfigurationDraftTaskV1.inputSchema.parse(parsedInput);
  const validatedOutput =
    builderConfigurationDraftTaskV1.outputSchema.parse(output);
  const semanticOutput = builderConfigurationDraftTaskV1.validateOutput
    ? builderConfigurationDraftTaskV1.validateOutput(
        validatedInput,
        validatedOutput,
      )
    : validatedOutput;
  return evaluateConfigurationDraft(scenario, semanticOutput, metadata);
}

describe("configuration drafting evaluation source boundaries", () => {
  it("does not add application, database, lifecycle, compiler, or persistence access", () => {
    const evaluationRoot = path.join(
      repositoryRoot,
      "src",
      "ai",
      "evaluation",
      "configuration-drafting",
    );
    const source = fs
      .readdirSync(evaluationRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) =>
        fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
      )
      .join("\n");
    expect(source).not.toMatch(
      /supabase|createAdminClient|\.rpc\(|writeFile|appendFile/i,
    );
    expect(source).not.toMatch(
      /ConfigurationChangeService|draft-compiler|configuration-proposal|proposeChangeSet|createGraphService|createRecord/i,
    );
    expect(source).not.toMatch(
      /OPENAI_API_KEY.*console|console.*OPENAI_API_KEY/i,
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
      /configuration-drafting|builder_configuration_draft_v1/,
    );

    const ci = fs.readFileSync(
      path.join(repositoryRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).not.toMatch(/eval:builder-configuration-drafting/);
    for (const script of [
      "test:builder-configuration-drafting-evaluation",
      "test:builder-configuration-drafting-terra-profile",
      "test:builder-configuration-drafting-terra-qualification",
      "test:builder-configuration-drafting-terra-reliability",
    ]) {
      expect(ci).toContain(script);
    }
  });
});
