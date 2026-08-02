import type { StructuredAiProviderRequest } from "../../src/ai/contracts";
import { createAiExecutionService } from "../../src/ai/execution";
import {
  BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  openAiBuilderConfigurationDraftingPolicy,
} from "../../src/ai/policies";
import { builderConfigurationDraftTaskInputSchema } from "../../src/ai/configuration-drafting/task";
import type { BuilderConfigurationDraftOutput } from "../../src/ai/configuration-drafting/schemas";
import { configurationDraftingScenarios } from "../../src/ai/evaluation/configuration-drafting/scenarios";
import type { ConfigurationDraftingScenarioId } from "../../src/ai/evaluation/configuration-drafting/schemas";
import { createBuilderConfigurationDraftingEvaluationTask } from "../../src/ai/evaluation/configuration-drafting/task";

const draftObject = (reference: string) => ({
  source: "draft" as const,
  object_reference: reference,
});

const existingObject = (objectKey: string) => ({
  source: "existing" as const,
  object_key: objectKey,
});

const draftField = (reference: string) => ({
  source: "draft" as const,
  field_reference: reference,
});

const existingField = (objectKey: string, fieldKey: string) => ({
  source: "existing" as const,
  object_key: objectKey,
  field_key: fieldKey,
});

const draftForm = (reference: string) => ({
  source: "draft" as const,
  form_reference: reference,
});

const existingForm = (formKey: string) => ({
  source: "existing" as const,
  form_key: formKey,
});

const draftView = (reference: string) => ({
  source: "draft" as const,
  view_reference: reference,
});

function field(
  reference: string,
  sourceStep: string,
  objectReference:
    ReturnType<typeof draftObject> | ReturnType<typeof existingObject>,
  label: string,
  fieldType:
    | "short_text"
    | "long_text"
    | "number"
    | "currency"
    | "boolean"
    | "date"
    | "datetime"
    | "email"
    | "phone"
    | "url"
    | "select"
    | "multi_select"
    | "file"
    | "status",
  required: boolean,
  settings: null | { currency: string } | { options: string[] },
) {
  return {
    reference,
    source_step_references: [sourceStep],
    object_reference: objectReference,
    label,
    field_type: fieldType,
    required,
    settings,
  };
}

function formField(
  fieldReference:
    ReturnType<typeof draftField> | ReturnType<typeof existingField>,
) {
  return { field_reference: fieldReference, label: null, help_text: null };
}

export const compliantConfigurationDraftingOutputs: Readonly<
  Record<ConfigurationDraftingScenarioId, BuilderConfigurationDraftOutput>
> = Object.freeze({
  catering_enquiry_full_stack: {
    schema_version: 1,
    summary: "Draft the requested catering enquiry configuration.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_1",
        source_step_references: ["step_1"],
        singular_label: "Catering Enquiry",
        plural_label: "Catering Enquiries",
        description: "A catering enquiry.",
      },
    ],
    fields: [
      field(
        "draft_field_1",
        "step_2",
        draftObject("draft_object_1"),
        "Company name",
        "short_text",
        true,
        null,
      ),
      field(
        "draft_field_2",
        "step_2",
        draftObject("draft_object_1"),
        "Event date",
        "date",
        true,
        null,
      ),
      field(
        "draft_field_3",
        "step_2",
        draftObject("draft_object_1"),
        "Number of guests",
        "number",
        true,
        null,
      ),
      field(
        "draft_field_4",
        "step_2",
        draftObject("draft_object_1"),
        "Budget",
        "currency",
        false,
        { currency: "GBP" },
      ),
      field(
        "draft_field_5",
        "step_2",
        draftObject("draft_object_1"),
        "Notes",
        "long_text",
        false,
        null,
      ),
    ],
    relationships: [
      {
        reference: "draft_relationship_1",
        source_step_references: ["step_3"],
        source_object_reference: existingObject("customer"),
        target_object_reference: draftObject("draft_object_1"),
        source_label: "submits",
        target_label: "customer",
        cardinality: "one_to_many",
        is_required: false,
      },
    ],
    views: [
      {
        reference: "draft_view_1",
        source_step_references: ["step_5"],
        name: "Catering Enquiries",
        audience: "internal",
        object_reference: draftObject("draft_object_1"),
        view_type: "table",
        configuration: {
          fields: [
            draftField("draft_field_1"),
            draftField("draft_field_2"),
            draftField("draft_field_3"),
            draftField("draft_field_4"),
            draftField("draft_field_5"),
          ],
          title_field: draftField("draft_field_1"),
          create_form_reference: null,
          edit_form_reference: null,
        },
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_4"],
        name: "Catering Enquiry",
        object_reference: draftObject("draft_object_1"),
        mode: "create",
        audience: "public",
        fields: [
          formField(draftField("draft_field_1")),
          formField(draftField("draft_field_2")),
          formField(draftField("draft_field_3")),
          formField(draftField("draft_field_4")),
          formField(draftField("draft_field_5")),
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
          { type: "heading", text: "Tell us about your event", level: 1 },
          { type: "form", form_reference: draftForm("draft_form_1") },
        ],
      },
    ],
  },
  customer_marketing_consent_field: {
    schema_version: 1,
    summary: "Add the requested Marketing consent Field.",
    objects: [],
    fields: [
      field(
        "draft_field_1",
        "step_1",
        existingObject("customer"),
        "Marketing consent",
        "boolean",
        false,
        null,
      ),
    ],
    relationships: [],
    views: [],
    forms: [],
    pages: [],
  },
  customer_directory_internal: {
    schema_version: 1,
    summary: "Add the requested internal Customer workspace pieces.",
    objects: [],
    fields: [],
    relationships: [],
    views: [
      {
        reference: "draft_view_1",
        source_step_references: ["step_2"],
        name: "Customer Directory",
        audience: "internal",
        object_reference: existingObject("customer"),
        view_type: "table",
        configuration: {
          fields: [
            existingField("customer", "name"),
            existingField("customer", "email"),
            existingField("customer", "phone"),
          ],
          title_field: existingField("customer", "name"),
          create_form_reference: draftForm("draft_form_1"),
          edit_form_reference: null,
        },
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_1"],
        name: "New Customer",
        object_reference: existingObject("customer"),
        mode: "create",
        audience: "internal",
        fields: [
          formField(existingField("customer", "name")),
          formField(existingField("customer", "email")),
          formField(existingField("customer", "phone")),
        ],
        submit_label: "Create customer",
      },
    ],
    pages: [],
  },
  public_customer_contact_page: {
    schema_version: 1,
    summary: "Add the requested wholesale enquiries Page.",
    objects: [],
    fields: [],
    relationships: [],
    views: [],
    forms: [],
    pages: [
      {
        reference: "draft_page_1",
        source_step_references: ["step_1"],
        title: "Wholesale Enquiries",
        audience: "public",
        blocks: [
          { type: "heading", text: "Wholesale Enquiries", level: 1 },
          {
            type: "text",
            text: "Tell us how we can help with your wholesale enquiry.",
          },
          {
            type: "form",
            form_reference: existingForm("customer_contact"),
          },
        ],
      },
    ],
  },
  equipment_maintenance_workspace: {
    schema_version: 1,
    summary: "Draft Equipment and Maintenance Job workspaces.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_1",
        source_step_references: ["step_1"],
        singular_label: "Equipment",
        plural_label: "Equipment",
        description: "Equipment tracked by the business.",
      },
      {
        reference: "draft_object_2",
        concept_reference: "concept_2",
        source_step_references: ["step_1"],
        singular_label: "Maintenance Job",
        plural_label: "Maintenance Jobs",
        description: "Maintenance work for equipment.",
      },
    ],
    fields: [
      field(
        "draft_field_1",
        "step_2",
        draftObject("draft_object_1"),
        "Name",
        "short_text",
        true,
        null,
      ),
      field(
        "draft_field_2",
        "step_2",
        draftObject("draft_object_1"),
        "Serial number",
        "short_text",
        false,
        null,
      ),
      field(
        "draft_field_3",
        "step_2",
        draftObject("draft_object_2"),
        "Summary",
        "short_text",
        true,
        null,
      ),
      field(
        "draft_field_4",
        "step_2",
        draftObject("draft_object_2"),
        "Due date",
        "date",
        false,
        null,
      ),
      field(
        "draft_field_5",
        "step_2",
        draftObject("draft_object_2"),
        "Notes",
        "long_text",
        false,
        null,
      ),
    ],
    relationships: [
      {
        reference: "draft_relationship_1",
        source_step_references: ["step_3"],
        source_object_reference: draftObject("draft_object_1"),
        target_object_reference: draftObject("draft_object_2"),
        source_label: "has maintenance jobs",
        target_label: "equipment",
        cardinality: "one_to_many",
        is_required: false,
      },
    ],
    views: [
      {
        reference: "draft_view_1",
        source_step_references: ["step_5"],
        name: "Equipment",
        audience: "internal",
        object_reference: draftObject("draft_object_1"),
        view_type: "list",
        configuration: {
          primary_field: draftField("draft_field_1"),
          secondary_fields: [draftField("draft_field_2")],
          create_form_reference: draftForm("draft_form_1"),
          edit_form_reference: null,
        },
      },
      {
        reference: "draft_view_2",
        source_step_references: ["step_5"],
        name: "Maintenance Jobs",
        audience: "internal",
        object_reference: draftObject("draft_object_2"),
        view_type: "table",
        configuration: {
          fields: [
            draftField("draft_field_3"),
            draftField("draft_field_4"),
            draftField("draft_field_5"),
          ],
          title_field: null,
          create_form_reference: draftForm("draft_form_2"),
          edit_form_reference: null,
        },
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_4"],
        name: "New Equipment",
        object_reference: draftObject("draft_object_1"),
        mode: "create",
        audience: "internal",
        fields: [
          formField(draftField("draft_field_1")),
          formField(draftField("draft_field_2")),
        ],
        submit_label: "Create equipment",
      },
      {
        reference: "draft_form_2",
        source_step_references: ["step_4"],
        name: "New Maintenance Job",
        object_reference: draftObject("draft_object_2"),
        mode: "create",
        audience: "internal",
        fields: [
          formField(draftField("draft_field_3")),
          formField(draftField("draft_field_4")),
          formField(draftField("draft_field_5")),
        ],
        submit_label: "Create maintenance job",
      },
    ],
    pages: [],
  },
  supplier_quote_field_types: {
    schema_version: 1,
    summary: "Draft the Supplier Quote field types and workspace.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_1",
        source_step_references: ["step_1"],
        singular_label: "Supplier Quote",
        plural_label: "Supplier Quotes",
        description: "A quote received from a supplier.",
      },
    ],
    fields: [
      field(
        "draft_field_1",
        "step_2",
        draftObject("draft_object_1"),
        "Supplier name",
        "short_text",
        true,
        null,
      ),
      field(
        "draft_field_2",
        "step_2",
        draftObject("draft_object_1"),
        "Quote total",
        "currency",
        true,
        { currency: "GBP" },
      ),
      field(
        "draft_field_3",
        "step_2",
        draftObject("draft_object_1"),
        "Decision",
        "status",
        true,
        { options: ["Pending", "Accepted", "Declined"] },
      ),
      field(
        "draft_field_4",
        "step_2",
        draftObject("draft_object_1"),
        "Services",
        "multi_select",
        false,
        { options: ["Delivery", "Staffing", "Equipment"] },
      ),
      field(
        "draft_field_5",
        "step_2",
        draftObject("draft_object_1"),
        "Attachment",
        "file",
        false,
        null,
      ),
    ],
    relationships: [],
    views: [
      {
        reference: "draft_view_1",
        source_step_references: ["step_4"],
        name: "Supplier Quotes",
        audience: "internal",
        object_reference: draftObject("draft_object_1"),
        view_type: "table",
        configuration: {
          fields: [
            draftField("draft_field_1"),
            draftField("draft_field_2"),
            draftField("draft_field_3"),
            draftField("draft_field_4"),
            draftField("draft_field_5"),
          ],
          title_field: draftField("draft_field_1"),
          create_form_reference: draftForm("draft_form_1"),
          edit_form_reference: null,
        },
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_3"],
        name: "New Supplier Quote",
        object_reference: draftObject("draft_object_1"),
        mode: "create",
        audience: "internal",
        fields: [
          formField(draftField("draft_field_1")),
          formField(draftField("draft_field_2")),
          formField(draftField("draft_field_3")),
          formField(draftField("draft_field_4")),
          formField(draftField("draft_field_5")),
        ],
        submit_label: "Create supplier quote",
      },
    ],
    pages: [],
  },
  staff_profile_cards: {
    schema_version: 1,
    summary: "Draft the Staff Profile cards workspace.",
    objects: [
      {
        reference: "draft_object_1",
        concept_reference: "concept_1",
        source_step_references: ["step_1"],
        singular_label: "Staff Profile",
        plural_label: "Staff Profiles",
        description: "A staff profile.",
      },
    ],
    fields: [
      field(
        "draft_field_1",
        "step_2",
        draftObject("draft_object_1"),
        "Name",
        "short_text",
        true,
        null,
      ),
      field(
        "draft_field_2",
        "step_2",
        draftObject("draft_object_1"),
        "Role",
        "short_text",
        false,
        null,
      ),
      field(
        "draft_field_3",
        "step_2",
        draftObject("draft_object_1"),
        "Photo",
        "file",
        false,
        null,
      ),
      field(
        "draft_field_4",
        "step_2",
        draftObject("draft_object_1"),
        "Bio",
        "long_text",
        false,
        null,
      ),
    ],
    relationships: [],
    views: [
      {
        reference: "draft_view_1",
        source_step_references: ["step_4"],
        name: "Staff Profiles",
        audience: "internal",
        object_reference: draftObject("draft_object_1"),
        view_type: "cards",
        configuration: {
          title_field: draftField("draft_field_1"),
          subtitle_field: draftField("draft_field_2"),
          image_field: draftField("draft_field_3"),
          supporting_fields: [draftField("draft_field_4")],
          create_form_reference: draftForm("draft_form_1"),
          edit_form_reference: null,
        },
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_3"],
        name: "New Staff Profile",
        object_reference: draftObject("draft_object_1"),
        mode: "create",
        audience: "internal",
        fields: [
          formField(draftField("draft_field_1")),
          formField(draftField("draft_field_2")),
          formField(draftField("draft_field_3")),
          formField(draftField("draft_field_4")),
        ],
        submit_label: "Create profile",
      },
    ],
    pages: [],
  },
  order_detail_workspace: {
    schema_version: 1,
    summary: "Draft the requested internal Order review workspace.",
    objects: [],
    fields: [],
    relationships: [],
    views: [
      {
        reference: "draft_view_1",
        source_step_references: ["step_2"],
        name: "Order Review",
        audience: "internal",
        object_reference: existingObject("order"),
        view_type: "detail",
        configuration: {
          fields: [
            existingField("order", "public_reference"),
            existingField("order", "collection_local_display"),
            existingField("order", "customer_name"),
            existingField("order", "item_summary"),
            existingField("order", "total"),
            existingField("order", "dietary_requirements"),
            existingField("order", "status"),
          ],
          title_field: existingField("order", "public_reference"),
          edit_form_reference: draftForm("draft_form_1"),
        },
      },
    ],
    forms: [
      {
        reference: "draft_form_1",
        source_step_references: ["step_1"],
        name: "Order Update",
        object_reference: existingObject("order"),
        mode: "edit",
        audience: "internal",
        fields: [
          formField(existingField("order", "status")),
          formField(existingField("order", "dietary_requirements")),
        ],
        submit_label: "Save order",
      },
    ],
    pages: [
      {
        reference: "draft_page_1",
        source_step_references: ["step_3"],
        title: "Order Review Workspace",
        audience: "internal",
        blocks: [{ type: "view", view_reference: draftView("draft_view_1") }],
      },
    ],
  },
});

export function createInjectedConfigurationDraftingExecution(
  responseFor: (
    scenarioId: ConfigurationDraftingScenarioId,
    invocation: number,
    request: StructuredAiProviderRequest,
  ) => Promise<{
    output: unknown;
    usage?: { inputTokens: number; outputTokens: number };
  }>,
) {
  let invocation = 0;
  const task = createBuilderConfigurationDraftingEvaluationTask();
  return createAiExecutionService({
    tasks: { builder_configuration_draft_v1: task },
    policies: {
      [BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY]:
        openAiBuilderConfigurationDraftingPolicy,
    },
    providers: {
      openai: {
        key: "openai",
        async generateStructured(request) {
          const input = builderConfigurationDraftTaskInputSchema.parse(
            request.input,
          );
          const scenario = configurationDraftingScenarios.find(
            ({ owner_request }) => owner_request === input.owner_request,
          );
          if (!scenario) {
            throw new Error(
              "Unknown synthetic configuration-drafting scenario.",
            );
          }
          invocation += 1;
          return responseFor(scenario.id, invocation, request);
        },
      },
    },
    sleep: async () => undefined,
  });
}
