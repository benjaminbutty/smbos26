import "server-only";

import { builderConfigurationDraftOutputSchema } from "../../ai/configuration-drafting/schemas";
import { validateConfigurationDraftOutput } from "../../ai/configuration-drafting/validation";
import {
  acquisitionPlanningOutputSchema,
  type AcquisitionPlanningInput,
  type AcquisitionPlanningCorrectionReason,
  type AcquisitionReadyPlan,
} from "../../ai/acquisition-planning/schemas";
import {
  acquisitionAiRuntime,
  type AcquisitionExecutionCore,
} from "../../ai/acquisition-planning/runtime";
import { compileConfigurationDraft } from "../configuration/draft-compiler/compiler";
import {
  configurationOperationsSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../configuration/schemas";
import { normalizeTableViewConfig } from "../experience/schemas";
import {
  acquisitionBusinessContext,
  emptyAcquisitionSnapshot,
} from "./context";
import { deriveAcquisitionConnectionLabels } from "./connection-labels";
import {
  acquisitionBuildPayloadSchema,
  acquisitionCategorySchema,
  acquisitionProposalSchema,
  acquisitionRequestSchema,
} from "./schemas";
import {
  isMechanicallyRedundantCrossObjectIdentityField,
  removeSemanticallyRedundantIdentityFields,
  validateAcquisitionCandidate,
} from "./quality";

export const ACQUISITION_MAX_OBJECTS = 6;
export const ACQUISITION_MAX_FIELDS_PER_OBJECT = 12;
export const ACQUISITION_MAX_RELATIONSHIPS = 10;
export const ACQUISITION_MAX_VIEWS = 8;
export const ACQUISITION_MAX_PAGES = 3;
export const ACQUISITION_MAX_EMBEDDED_VIEWS_PER_PAGE = 4;
export const ACQUISITION_MAX_PLANNING_EXECUTIONS = 2;
export const ACQUISITION_MAX_PLANNING_EXECUTION_COST_MICROUSD = 47_500;
export const ACQUISITION_MAX_WORKFLOW_COST_MICROUSD =
  ACQUISITION_MAX_PLANNING_EXECUTIONS *
  ACQUISITION_MAX_PLANNING_EXECUTION_COST_MICROUSD;

export class AcquisitionInterpretationError extends Error {
  constructor(
    readonly code: "needs_more_detail" | "composition_invalid",
    readonly ownerMessage = "Lenni needs a little more detail about the work you want to organise.",
  ) {
    super(ownerMessage);
    this.name = "AcquisitionInterpretationError";
  }
}

export type AcquisitionInterpretationOptions = Readonly<{
  validate?: boolean;
  correctionReason?: AcquisitionPlanningCorrectionReason;
  onCanonicalisation?: (
    metadata: Readonly<{ removedFieldCount: number }>,
  ) => void;
}>;

function connectionLabelsForPlan(
  plan: AcquisitionReadyPlan,
  connection: AcquisitionReadyPlan["connections"][number],
) {
  const source = plan.tables.find(
    (table) => table.reference === connection.source_table_reference,
  );
  const target = plan.tables.find(
    (table) => table.reference === connection.target_table_reference,
  );
  if (!source || !target) {
    throw new AcquisitionInterpretationError("composition_invalid");
  }
  return deriveAcquisitionConnectionLabels({
    source: {
      singular: source.singular_name,
      plural: source.plural_name,
    },
    target: {
      singular: target.singular_name,
      plural: target.plural_name,
    },
    cardinality: connection.cardinality,
  });
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
    relationships: plan.connections.map((connection, index) => {
      const labels = connectionLabelsForPlan(plan, connection);
      return {
        reference: `draft_relationship_${index + 1}`,
        source_step_references: [step("define_relationship")],
        source_object_reference: objectRef(connection.source_table_reference),
        target_object_reference: objectRef(connection.target_table_reference),
        source_label: labels.source,
        target_label: labels.target,
        cardinality: connection.cardinality,
        is_required: false,
      };
    }),
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
    pages: [],
  });
  return { readyPlan, draft };
}

function canonicaliseAcquisitionPlan(plan: AcquisitionReadyPlan): Readonly<{
  plan: AcquisitionReadyPlan;
  removedFieldCount: number;
}> {
  const tables = plan.tables.map((table) => ({
    ...table,
    fields: removeSemanticallyRedundantIdentityFields(
      {
        key: table.reference,
        singular_label: table.singular_name,
        plural_label: table.plural_name,
      },
      table.fields,
    ),
  }));
  const tablesByReference = new Map(
    tables.map((table) => [table.reference, table]),
  );
  const relatedTablesByReference = new Map<
    string,
    Set<(typeof tables)[number]>
  >();
  for (const connection of plan.connections) {
    if (
      connection.source_table_reference === connection.target_table_reference
    ) {
      continue;
    }
    const source = tablesByReference.get(connection.source_table_reference);
    const target = tablesByReference.get(connection.target_table_reference);
    if (!source || !target) continue;
    const sourceRelated =
      relatedTablesByReference.get(source.reference) ?? new Set();
    sourceRelated.add(target);
    relatedTablesByReference.set(source.reference, sourceRelated);
    const targetRelated =
      relatedTablesByReference.get(target.reference) ?? new Set();
    targetRelated.add(source);
    relatedTablesByReference.set(target.reference, targetRelated);
  }

  const canonicalisedPlan = {
    ...plan,
    tables: tables.map((table) => {
      const relatedTables = relatedTablesByReference.get(table.reference);
      if (!relatedTables?.size) return table;
      const retainedFields = table.fields.filter(
        (field) =>
          field.required ||
          ![...relatedTables].some((related) =>
            isMechanicallyRedundantCrossObjectIdentityField(field, {
              key: related.reference,
              singular_label: related.singular_name,
              plural_label: related.plural_name,
            }),
          ),
      );
      return {
        ...table,
        fields: retainedFields.length > 0 ? retainedFields : table.fields,
      };
    }),
  };
  const originalFieldCount = plan.tables.reduce(
    (total, table) => total + table.fields.length,
    0,
  );
  const canonicalFieldCount = canonicalisedPlan.tables.reduce(
    (total, table) => total + table.fields.length,
    0,
  );
  return {
    plan: canonicalisedPlan,
    removedFieldCount: originalFieldCount - canonicalFieldCount,
  };
}

function addAcquisitionConnectionColumns(
  operations: readonly ConfigurationOperation[],
  plan: AcquisitionReadyPlan,
): ConfigurationOperation[] {
  const objectOperations = operations.filter(
    (
      operation,
    ): operation is Extract<ConfigurationOperation, { op: "set_object" }> =>
      operation.op === "set_object",
  );
  const objectKeysByTableReference = new Map<string, string>();
  for (const table of plan.tables) {
    const matches = objectOperations.filter(
      (operation) =>
        operation.singular_label === table.singular_name &&
        operation.plural_label === table.plural_name,
    );
    if (matches.length !== 1) {
      throw new AcquisitionInterpretationError("composition_invalid");
    }
    objectKeysByTableReference.set(table.reference, matches[0]!.key);
  }

  const relationshipOperations = operations.filter(
    (
      operation,
    ): operation is Extract<
      ConfigurationOperation,
      { op: "set_relationship" }
    > => operation.op === "set_relationship",
  );
  const connectionColumnsByObjectKey = new Map<
    string,
    Array<{
      kind: "connection";
      relationship_key: string;
      direction: "source" | "target";
      label: string;
    }>
  >();
  const addColumn = (
    objectKey: string,
    column: {
      kind: "connection";
      relationship_key: string;
      direction: "source" | "target";
      label: string;
    },
  ) => {
    const columns = connectionColumnsByObjectKey.get(objectKey) ?? [];
    columns.push(column);
    connectionColumnsByObjectKey.set(objectKey, columns);
  };

  for (const connection of plan.connections) {
    const sourceObjectKey = objectKeysByTableReference.get(
      connection.source_table_reference,
    );
    const targetObjectKey = objectKeysByTableReference.get(
      connection.target_table_reference,
    );
    const labels = connectionLabelsForPlan(plan, connection);
    const relationship = relationshipOperations.filter(
      (operation) =>
        operation.source_object_key === sourceObjectKey &&
        operation.target_object_key === targetObjectKey &&
        operation.source_label === labels.source &&
        operation.target_label === labels.target &&
        operation.cardinality === connection.cardinality,
    );
    if (!sourceObjectKey || !targetObjectKey || relationship.length !== 1) {
      throw new AcquisitionInterpretationError("composition_invalid");
    }
    const relationshipKey = relationship[0]!.key;
    addColumn(sourceObjectKey, {
      kind: "connection",
      relationship_key: relationshipKey,
      direction: "source",
      label: labels.source,
    });
    addColumn(targetObjectKey, {
      kind: "connection",
      relationship_key: relationshipKey,
      direction: "target",
      label: labels.target,
    });
  }

  return configurationOperationsSchema.parse(
    operations.map((operation) => {
      if (operation.op !== "set_view") return operation;
      const columns = connectionColumnsByObjectKey.get(operation.object_key);
      if (!columns?.length) return operation;
      const config = normalizeTableViewConfig(operation.config_json);
      return setViewOperationSchema.parse({
        ...operation,
        config_json: normalizeTableViewConfig({
          ...config,
          columns: [...config.columns, ...columns],
          fields: config.fields,
        }),
      });
    }),
  );
}
export async function interpretAcquisitionRequest(
  categoryInput: unknown,
  requestInput: unknown,
  execution: AcquisitionExecutionCore = acquisitionAiRuntime.execution,
  options: AcquisitionInterpretationOptions = {},
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
    ...(options.correctionReason
      ? { correction_reason: options.correctionReason }
      : {}),
  };
  const result = await execution.execute(
    "acquisition_workspace_plan_v1",
    planningInput,
  );
  const parsedPlan = acquisitionPlanningOutputSchema.parse(result.output);
  if (parsedPlan.state === "needs_more_detail")
    throw new AcquisitionInterpretationError(
      "needs_more_detail",
      parsedPlan.revision_prompt,
    );
  const canonicalisation = canonicaliseAcquisitionPlan(parsedPlan);
  const plan = canonicalisation.plan;
  if (canonicalisation.removedFieldCount > 0) {
    options.onCanonicalisation?.({
      removedFieldCount: canonicalisation.removedFieldCount,
    });
  }
  const { readyPlan, draft } = composeDraft(plan);
  const taskInput = {
    schema_version: 1 as const,
    owner_request: request,
    business_context: acquisitionBusinessContext(category),
    ready_plan: readyPlan,
  };
  validateConfigurationDraftOutput(taskInput, draft);
  const operations = addAcquisitionConnectionColumns(
    compileConfigurationDraft({
      taskInput,
      draft,
      snapshot: emptyAcquisitionSnapshot,
    }).operations,
    plan,
  );
  const firstStep = `Add your first real ${plan.tables[0]!.singular_name.toLocaleLowerCase("en")}.`;
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
    pages: [],
    landing_page_key: null,
    first_step: firstStep,
    not_included: [
      ...new Set([
        ...plan.unsupported_requirements,
        ...unsupportedFromRequest(request),
      ]),
    ].slice(0, 8),
  });
  const payload = acquisitionBuildPayloadSchema.parse({ proposal, operations });
  return options.validate === false
    ? payload
    : validateAcquisitionCandidate(payload);
}
