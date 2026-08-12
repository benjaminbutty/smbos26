import "server-only";

import { builderConfigurationDraftOutputSchema } from "../../ai/configuration-drafting/schemas";
import { validateConfigurationDraftOutput } from "../../ai/configuration-drafting/validation";
import {
  acquisitionPlanningOutputSchema,
  type AcquisitionPlanningInput,
  type AcquisitionReadyPlan,
} from "../../ai/acquisition-planning/schemas";
import {
  acquisitionAiRuntime,
  type AcquisitionExecutionCore,
} from "../../ai/acquisition-planning/runtime";
import { compileConfigurationDraft } from "../configuration/draft-compiler/compiler";
import { configurationOperationsSchema } from "../configuration/schemas";
import {
  acquisitionBusinessContext,
  emptyAcquisitionSnapshot,
} from "./context";
import {
  acquisitionBuildPayloadSchema,
  acquisitionCategorySchema,
  acquisitionProposalSchema,
  acquisitionRequestSchema,
} from "./schemas";

export const ACQUISITION_MAX_OBJECTS = 6;
export const ACQUISITION_MAX_FIELDS_PER_OBJECT = 12;
export const ACQUISITION_MAX_RELATIONSHIPS = 10;
export const ACQUISITION_MAX_VIEWS = 8;
export const ACQUISITION_MAX_PAGES = 3;
export const ACQUISITION_MAX_EMBEDDED_VIEWS_PER_PAGE = 4;
export const ACQUISITION_MAX_WORKFLOW_COST_MICROUSD = 47_500;

export class AcquisitionInterpretationError extends Error {
  constructor(
    readonly code: "needs_more_detail" | "composition_invalid",
    readonly ownerMessage = "Lenni needs a little more detail about the work you want to organise.",
  ) {
    super(ownerMessage);
    this.name = "AcquisitionInterpretationError";
  }
}
export function detectGroundedCurrency(
  request: string,
): "GBP" | "USD" | "EUR" | null {
  const matches = new Set<"GBP" | "USD" | "EUR">();
  if (/(?:£|\bGBP\b)/i.test(request)) matches.add("GBP");
  if (/(?:\$|\bUSD\b)/i.test(request)) matches.add("USD");
  if (/(?:€|\bEUR\b)/i.test(request)) matches.add("EUR");
  return matches.size === 1 ? [...matches][0]! : null;
}
function unsupportedFromRequest(request: string): string[] {
  const checks: Array<[RegExp, string]> = [
    [/\bpayment|checkout\b/i, "Online payments"],
    [/public booking|book online|online booking/i, "Public booking"],
    [/public form|website form/i, "Public form submission"],
    [/automat|workflow/i, "Workflow automation"],
    [/whatsapp|zapier|integration/i, "External integrations"],
    [/dashboard|analytics|reporting/i, "Dashboards and analytics"],
    [/portal/i, "Customer portal"],
  ];
  return checks
    .filter(([pattern]) => pattern.test(request))
    .map(([, label]) => label);
}
function composeDraft(plan: AcquisitionReadyPlan) {
  const categories = [
    "define_object",
    "define_field",
    ...(plan.connections.length ? ["define_relationship"] : []),
    "configure_form",
    "configure_view",
    "configure_page",
  ] as const;
  const step = (category: string) =>
    `step_${categories.indexOf(category as never) + 1}`;
  const concepts = plan.tables.map((table, index) => ({
    reference: `concept_${index + 1}`,
    label: table.singular_name,
    disposition: "new" as const,
    purpose: table.purpose,
  }));
  const readyPlan = {
    schema_version: 1 as const,
    state: "ready" as const,
    understanding: plan.understanding,
    assumptions: [],
    plan: {
      outcome: plan.why,
      concepts,
      user_journeys: [],
      steps: categories.map((category, index) => ({
        reference: `step_${index + 1}`,
        sequence: index + 1,
        lane: "configuration" as const,
        category,
        summary: `Prepare ${category.replaceAll("_", " ")}.`,
        dependencies: index ? [`step_${index}`] : [],
        affected_concepts: concepts.map(({ reference }) => reference),
        existing_object_keys: [],
        location_references: [],
        materiality: "medium" as const,
        requires_owner_confirmation: true as const,
      })),
    },
    unsupported_requirements: [],
  };
  let fieldNumber = 0;
  const fieldsByTable = new Map<
    string,
    Array<{ reference: string; label: string }>
  >();
  const fields = plan.tables.flatMap((table) =>
    table.fields.map((field) => {
      fieldNumber += 1;
      const reference = `draft_field_${fieldNumber}`;
      const list = fieldsByTable.get(table.reference) ?? [];
      list.push({ reference, label: field.label });
      fieldsByTable.set(table.reference, list);
      return {
        reference,
        source_step_references: [step("define_field")],
        object_reference: {
          source: "draft" as const,
          object_reference: `draft_object_${plan.tables.indexOf(table) + 1}`,
        },
        label: field.label,
        field_type: field.field_type,
        required: field.required,
        settings:
          field.field_type === "currency"
            ? { currency: field.currency }
            : ["select", "multi_select", "status"].includes(field.field_type)
              ? { options: field.options }
              : null,
      };
    }),
  );
  const tableIndex = (reference: string) =>
    plan.tables.findIndex((table) => table.reference === reference);
  const objectRef = (reference: string) => ({
    source: "draft" as const,
    object_reference: `draft_object_${tableIndex(reference) + 1}`,
  });
  const formRef = (index: number, edit: boolean) =>
    `draft_form_${index * 2 + (edit ? 2 : 1)}`;
  const draft = builderConfigurationDraftOutputSchema.parse({
    schema_version: 1,
    summary: plan.why,
    objects: plan.tables.map((table, index) => ({
      reference: `draft_object_${index + 1}`,
      concept_reference: `concept_${index + 1}`,
      source_step_references: [step("define_object")],
      singular_label: table.singular_name,
      plural_label: table.plural_name,
      description: table.purpose,
    })),
    fields,
    relationships: plan.connections.map((connection, index) => ({
      reference: `draft_relationship_${index + 1}`,
      source_step_references: [step("define_relationship")],
      source_object_reference: objectRef(connection.source_table_reference),
      target_object_reference: objectRef(connection.target_table_reference),
      source_label: connection.source_label,
      target_label: connection.target_label,
      cardinality: connection.cardinality,
      is_required: false,
    })),
    forms: plan.tables.flatMap((table, index) =>
      ([false, true] as const).map((edit) => ({
        reference: formRef(index, edit),
        source_step_references: [step("configure_form")],
        name: `${edit ? "Edit" : "Add"} ${table.singular_name}`,
        object_reference: objectRef(table.reference),
        mode: edit ? "edit" : "create",
        audience: "internal",
        fields: fieldsByTable.get(table.reference)!.map((field) => ({
          field_reference: {
            source: "draft",
            field_reference: field.reference,
          },
          label: null,
          help_text: null,
        })),
        submit_label: edit ? "Save changes" : `Add ${table.singular_name}`,
      })),
    ),
    views: plan.tables.map((table, index) => ({
      reference: `draft_view_${index + 1}`,
      source_step_references: [step("configure_view")],
      name: table.plural_name,
      audience: "internal",
      object_reference: objectRef(table.reference),
      view_type: "table",
      configuration: {
        fields: fieldsByTable.get(table.reference)!.map((field) => ({
          source: "draft",
          field_reference: field.reference,
        })),
        title_field: {
          source: "draft",
          field_reference: fieldsByTable.get(table.reference)![0]!.reference,
        },
        create_form_reference: {
          source: "draft",
          form_reference: formRef(index, false),
        },
        edit_form_reference: {
          source: "draft",
          form_reference: formRef(index, true),
        },
      },
    })),
    pages: [
      {
        reference: "draft_page_1",
        source_step_references: [step("configure_page")],
        title: "Overview",
        audience: "internal",
        blocks: [
          { type: "heading", text: "Overview", level: 1 },
          {
            type: "view",
            view_reference: {
              source: "draft",
              view_reference: `draft_view_${tableIndex(plan.primary_table_reference) + 1}`,
            },
          },
        ],
      },
    ],
  });
  return { readyPlan, draft };
}
export async function interpretAcquisitionRequest(
  categoryInput: unknown,
  requestInput: unknown,
  execution: AcquisitionExecutionCore = acquisitionAiRuntime.execution,
) {
  const category = acquisitionCategorySchema.parse(categoryInput);
  const request = acquisitionRequestSchema
    .parse(requestInput)
    .replace(/\s+/g, " ");
  const planningInput: AcquisitionPlanningInput = {
    schema_version: 1,
    category,
    owner_request: request,
    grounded_currency: detectGroundedCurrency(request),
  };
  const result = await execution.execute(
    "acquisition_workspace_plan_v1",
    planningInput,
  );
  const plan = acquisitionPlanningOutputSchema.parse(result.output);
  if (plan.state === "needs_more_detail")
    throw new AcquisitionInterpretationError(
      "needs_more_detail",
      plan.revision_prompt,
    );
  const { readyPlan, draft } = composeDraft(plan);
  const taskInput = {
    schema_version: 1 as const,
    owner_request: request,
    business_context: acquisitionBusinessContext(category),
    ready_plan: readyPlan,
  };
  validateConfigurationDraftOutput(taskInput, draft);
  const operations = configurationOperationsSchema.parse(
    compileConfigurationDraft({
      taskInput,
      draft,
      snapshot: emptyAcquisitionSnapshot,
    }).operations,
  );
  const proposal = acquisitionProposalSchema.parse({
    schema_version: 1,
    source: "tailored",
    category,
    title: `${plan.tables[0]!.plural_name} workspace`,
    understanding: plan.understanding,
    why: plan.why,
    concepts: plan.tables.map((table) => ({
      name: table.plural_name,
      description: table.purpose,
      tracked_information: table.fields.map(({ label }) => label),
    })),
    connections: plan.connections.map(({ explanation }) => ({
      text: explanation,
    })),
    views: plan.tables.map((table) => ({
      name: table.plural_name,
      description: `A practical saved view of ${table.plural_name.toLocaleLowerCase("en")}.`,
    })),
    pages: [
      {
        name: "Overview",
        description:
          "An internal starting page with a live saved view for everyday work.",
      },
    ],
    landing_page_key: "overview",
    first_step: `Add your first real ${plan.tables[0]!.singular_name.toLocaleLowerCase("en")}.`,
    not_included: [
      ...new Set([
        ...plan.unsupported_requirements,
        ...unsupportedFromRequest(request),
      ]),
    ].slice(0, 8),
  });
  return acquisitionBuildPayloadSchema.parse({ proposal, operations });
}
