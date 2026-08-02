import { builderConfigurationDraftTaskInputSchema } from "../../configuration-drafting/task";
import type { BuilderConfigurationDraftReadyTaskInput } from "../../configuration-drafting/schemas";
import { validateConfigurationDraftInput } from "../../configuration-drafting/validation";
import {
  builderPlanOutputSchema,
  type BuilderPlanOutput,
} from "../../planning/schemas";
import {
  configurationDraftingScenarioMetadataSchema,
  type ConfigurationDraftingScenarioId,
} from "./schemas";
import {
  configurationDraftingSyntheticContexts,
  type ConfigurationDraftingSyntheticContextId,
} from "../../../../evaluations/fixtures/synthetic-configuration-drafting-context";

export type ExpectedObjectReference =
  | { source: "new"; concept_reference: string }
  | { source: "existing"; object_key: string };

export type ExpectedFieldReference =
  | { source: "new"; object: ExpectedObjectReference; label: string }
  | { source: "existing"; object_key: string; field_key: string };

export interface ExpectedObject {
  reference: ExpectedObjectReference;
  singular_label: string;
  plural_label: string;
}

export interface ExpectedField {
  reference: ExpectedFieldReference;
  label: string;
  field_type:
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
    | "status";
  required: boolean;
  settings: null | { currency: string } | { options: readonly string[] };
}

export interface ExpectedRelationship {
  source: ExpectedObjectReference;
  target: ExpectedObjectReference;
  source_label: string;
  target_label: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_many";
  is_required: boolean;
}

export interface ExpectedForm {
  name: string;
  object: ExpectedObjectReference;
  mode: "create" | "edit";
  audience: "internal" | "public";
  fields: readonly ExpectedFieldReference[];
}

export interface ExpectedView {
  name: string;
  object: ExpectedObjectReference;
  view_type: "table" | "list" | "cards" | "detail";
  audience: "internal" | "public";
  fields: readonly ExpectedFieldReference[];
  title_field?: ExpectedFieldReference | null;
  primary_field?: ExpectedFieldReference;
  subtitle_field?: ExpectedFieldReference | null;
  image_field?: ExpectedFieldReference | null;
  supporting_fields?: readonly ExpectedFieldReference[];
  create_form_name?: string | null;
  edit_form_name?: string | null;
}

export type ExpectedPageBlock =
  | { type: "heading"; text: string; level: 1 | 2 | 3 }
  | { type: "text"; text: string }
  | { type: "form"; existing_form_key?: string; form_name?: string }
  | { type: "view"; view_name: string };

export interface ConfigurationDraftingExpectations {
  objects: readonly ExpectedObject[];
  fields: readonly ExpectedField[];
  relationships: readonly ExpectedRelationship[];
  forms: readonly ExpectedForm[];
  views: readonly ExpectedView[];
  pages: readonly {
    title: string;
    audience: "internal" | "public";
    blocks: readonly ExpectedPageBlock[];
  }[];
  forbid_status_field: boolean;
}

export interface ConfigurationDraftingScenario {
  id: ConfigurationDraftingScenarioId;
  owner_request: string;
  context_id: ConfigurationDraftingSyntheticContextId;
  task_input: BuilderConfigurationDraftReadyTaskInput;
  ready_plan: BuilderConfigurationDraftReadyTaskInput["ready_plan"];
  expected: ConfigurationDraftingExpectations;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

type ReadyPlan = Extract<BuilderPlanOutput, { state: "ready" }>;
type ReadyConcept = ReadyPlan["plan"]["concepts"][number];
type ReadyStep = ReadyPlan["plan"]["steps"][number];

function readyPlan(
  concepts: ReadonlyArray<ReadyConcept>,
  steps: ReadonlyArray<ReadyStep>,
): ReadyPlan {
  return builderPlanOutputSchema.parse({
    schema_version: 1,
    state: "ready",
    understanding:
      "A complete code-owned ready plan for drafting qualification.",
    assumptions: [],
    plan: {
      outcome: "Produce the requested bounded configuration design.",
      concepts,
      user_journeys: [],
      steps,
    },
    unsupported_requirements: [],
  }) as ReadyPlan;
}

function configurationStep(
  reference: string,
  sequence: number,
  category:
    | "define_object"
    | "define_field"
    | "define_relationship"
    | "configure_view"
    | "configure_form"
    | "configure_page",
  affectedConcepts: readonly string[],
  existingObjectKeys: readonly string[] = [],
  dependencies: readonly string[] = [],
): ReadyStep {
  return {
    reference,
    sequence,
    lane: "configuration",
    category,
    summary: `Prepare the requested ${category.replaceAll("_", " ")} design.`,
    dependencies: [...dependencies],
    affected_concepts: [...affectedConcepts],
    existing_object_keys: [...existingObjectKeys],
    location_references: [],
    materiality: "medium",
    requires_owner_confirmation: true,
  } as ReadyStep;
}

function newConcept(
  reference: string,
  label: string,
  purpose: string,
): ReadyConcept {
  return {
    reference,
    label,
    disposition: "new",
    purpose,
  };
}

function existingConcept(
  reference: string,
  label: string,
  objectKey: string,
  purpose: string,
): ReadyConcept {
  return {
    reference,
    label,
    disposition: "existing",
    existing_object_key: objectKey,
    purpose,
  };
}

const rich = "rich_existing_business" as const;
const empty = "empty_new_business" as const;

function createScenario(
  metadata: {
    id: ConfigurationDraftingScenarioId;
    owner_request: string;
    context_id: ConfigurationDraftingSyntheticContextId;
  },
  plan: ReadyPlan,
  expected: ConfigurationDraftingExpectations,
): ConfigurationDraftingScenario {
  const parsedMetadata =
    configurationDraftingScenarioMetadataSchema.parse(metadata);
  const taskInput = validateConfigurationDraftInput(
    builderConfigurationDraftTaskInputSchema.parse({
      schema_version: 1,
      owner_request: parsedMetadata.owner_request,
      business_context:
        configurationDraftingSyntheticContexts[parsedMetadata.context_id],
      ready_plan: plan,
    }),
  );
  return deepFreeze({
    ...parsedMetadata,
    task_input: taskInput,
    ready_plan: taskInput.ready_plan,
    expected,
  });
}

const customer = {
  source: "existing" as const,
  object_key: "customer",
};
const order = {
  source: "existing" as const,
  object_key: "order",
};

const cateringEnquiry = {
  source: "new" as const,
  concept_reference: "concept_1",
};
const equipment = {
  source: "new" as const,
  concept_reference: "concept_1",
};
const maintenanceJob = {
  source: "new" as const,
  concept_reference: "concept_2",
};
const supplierQuote = {
  source: "new" as const,
  concept_reference: "concept_1",
};
const staffProfile = {
  source: "new" as const,
  concept_reference: "concept_1",
};

function newField(
  object: ExpectedObjectReference,
  label: string,
): ExpectedFieldReference {
  return { source: "new", object, label };
}

function existingField(
  objectKey: string,
  fieldKey: string,
): ExpectedFieldReference {
  return { source: "existing", object_key: objectKey, field_key: fieldKey };
}

export const configurationDraftingScenarios: readonly ConfigurationDraftingScenario[] =
  Object.freeze([
    createScenario(
      {
        id: "catering_enquiry_full_stack",
        context_id: rich,
        owner_request:
          "Create a Catering Enquiry concept. Collect required Company name, Event date and Number of guests, plus optional Budget in GBP and Notes. Optionally connect each enquiry to our existing Customer concept. Add a public create Form and public Page, plus a separate internal table View for staff. Do not add a status field.",
      },
      readyPlan(
        [
          newConcept(
            "concept_1",
            "Catering Enquiry",
            "Capture a catering enquiry for owner review.",
          ),
          existingConcept(
            "concept_2",
            "Customer",
            "customer",
            "Connect an enquiry to the existing Customer concept.",
          ),
        ],
        [
          configurationStep("step_1", 1, "define_object", ["concept_1"]),
          configurationStep(
            "step_2",
            2,
            "define_field",
            ["concept_1"],
            [],
            ["step_1"],
          ),
          configurationStep(
            "step_3",
            3,
            "define_relationship",
            ["concept_1", "concept_2"],
            ["customer"],
            ["step_1"],
          ),
          configurationStep(
            "step_4",
            4,
            "configure_form",
            ["concept_1"],
            [],
            ["step_2"],
          ),
          configurationStep(
            "step_5",
            5,
            "configure_view",
            ["concept_1"],
            [],
            ["step_2"],
          ),
          configurationStep(
            "step_6",
            6,
            "configure_page",
            ["concept_1"],
            [],
            ["step_4", "step_5"],
          ),
        ],
      ),
      {
        objects: [
          {
            reference: cateringEnquiry,
            singular_label: "Catering Enquiry",
            plural_label: "Catering Enquiries",
          },
        ],
        fields: [
          {
            reference: newField(cateringEnquiry, "Company name"),
            label: "Company name",
            field_type: "short_text",
            required: true,
            settings: null,
          },
          {
            reference: newField(cateringEnquiry, "Event date"),
            label: "Event date",
            field_type: "date",
            required: true,
            settings: null,
          },
          {
            reference: newField(cateringEnquiry, "Number of guests"),
            label: "Number of guests",
            field_type: "number",
            required: true,
            settings: null,
          },
          {
            reference: newField(cateringEnquiry, "Budget"),
            label: "Budget",
            field_type: "currency",
            required: false,
            settings: { currency: "GBP" },
          },
          {
            reference: newField(cateringEnquiry, "Notes"),
            label: "Notes",
            field_type: "long_text",
            required: false,
            settings: null,
          },
        ],
        relationships: [
          {
            source: customer,
            target: cateringEnquiry,
            source_label: "submits",
            target_label: "customer",
            cardinality: "one_to_many",
            is_required: false,
          },
        ],
        forms: [
          {
            name: "Catering Enquiry",
            object: cateringEnquiry,
            mode: "create",
            audience: "public",
            fields: [
              newField(cateringEnquiry, "Company name"),
              newField(cateringEnquiry, "Event date"),
              newField(cateringEnquiry, "Number of guests"),
              newField(cateringEnquiry, "Budget"),
              newField(cateringEnquiry, "Notes"),
            ],
          },
        ],
        views: [
          {
            name: "Catering Enquiries",
            object: cateringEnquiry,
            view_type: "table",
            audience: "internal",
            fields: [
              newField(cateringEnquiry, "Company name"),
              newField(cateringEnquiry, "Event date"),
              newField(cateringEnquiry, "Number of guests"),
              newField(cateringEnquiry, "Budget"),
              newField(cateringEnquiry, "Notes"),
            ],
            title_field: null,
            create_form_name: null,
            edit_form_name: null,
          },
        ],
        pages: [
          {
            title: "Catering Enquiry",
            audience: "public",
            blocks: [
              { type: "heading", text: "Tell us about your event", level: 1 },
              { type: "form", form_name: "Catering Enquiry" },
            ],
          },
        ],
        forbid_status_field: true,
      },
    ),
    createScenario(
      {
        id: "customer_marketing_consent_field",
        context_id: rich,
        owner_request:
          "Add one optional Yes/No Field called Marketing consent to the existing Customer concept. Do not add or change any Form, View, Page, Relationship or other Object.",
      },
      readyPlan(
        [
          existingConcept(
            "concept_1",
            "Customer",
            "customer",
            "Add one Field to the existing Customer concept.",
          ),
        ],
        [
          configurationStep(
            "step_1",
            1,
            "define_field",
            ["concept_1"],
            ["customer"],
          ),
        ],
      ),
      {
        objects: [],
        fields: [
          {
            reference: newField(customer, "Marketing consent"),
            label: "Marketing consent",
            field_type: "boolean",
            required: false,
            settings: null,
          },
        ],
        relationships: [],
        forms: [],
        views: [],
        pages: [],
        forbid_status_field: false,
      },
    ),
    createScenario(
      {
        id: "customer_directory_internal",
        context_id: rich,
        owner_request:
          "Create a new internal create Form called New Customer using the existing Customer Name, Email and Phone Fields. Create an internal table View called Customer Directory showing those three Fields and connect its create action to the new Form. Do not add Fields, Objects, Relationships or Pages.",
      },
      readyPlan(
        [
          existingConcept(
            "concept_1",
            "Customer",
            "customer",
            "Use the existing Customer concept.",
          ),
        ],
        [
          configurationStep(
            "step_1",
            1,
            "configure_form",
            ["concept_1"],
            ["customer"],
          ),
          configurationStep(
            "step_2",
            2,
            "configure_view",
            ["concept_1"],
            ["customer"],
            ["step_1"],
          ),
        ],
      ),
      {
        objects: [],
        fields: [],
        relationships: [],
        forms: [
          {
            name: "New Customer",
            object: customer,
            mode: "create",
            audience: "internal",
            fields: [
              existingField("customer", "name"),
              existingField("customer", "email"),
              existingField("customer", "phone"),
            ],
          },
        ],
        views: [
          {
            name: "Customer Directory",
            object: customer,
            view_type: "table",
            audience: "internal",
            fields: [
              existingField("customer", "name"),
              existingField("customer", "email"),
              existingField("customer", "phone"),
            ],
            title_field: null,
            create_form_name: "New Customer",
            edit_form_name: null,
          },
        ],
        pages: [],
        forbid_status_field: false,
      },
    ),
    createScenario(
      {
        id: "public_customer_contact_page",
        context_id: rich,
        owner_request:
          "Create one public Page called Wholesale Enquiries. Include a heading, short explanatory text and our existing public Customer contact Form. Do not add or change any Object, Field, Relationship, View or Form.",
      },
      readyPlan(
        [
          existingConcept(
            "concept_1",
            "Customer",
            "customer",
            "Use the existing Customer concept for the public contact page.",
          ),
        ],
        [
          configurationStep(
            "step_1",
            1,
            "configure_page",
            ["concept_1"],
            ["customer"],
          ),
        ],
      ),
      {
        objects: [],
        fields: [],
        relationships: [],
        forms: [],
        views: [],
        pages: [
          {
            title: "Wholesale Enquiries",
            audience: "public",
            blocks: [
              { type: "heading", text: "Wholesale Enquiries", level: 1 },
              {
                type: "text",
                text: "Tell us how we can help with your wholesale enquiry.",
              },
              { type: "form", existing_form_key: "customer_contact" },
            ],
          },
        ],
        forbid_status_field: false,
      },
    ),
    createScenario(
      {
        id: "equipment_maintenance_workspace",
        context_id: empty,
        owner_request:
          "Create Equipment and Maintenance Job concepts. Equipment needs required Name and optional Serial number. Maintenance Job needs required Summary, optional Due date and optional Notes. One Equipment can have many Maintenance Jobs, but the relationship is optional. Add an internal create Form and internal staff View for each concept. Use a list View for Equipment and a table View for Maintenance Jobs. Do not add a Page or status Field.",
      },
      readyPlan(
        [
          newConcept("concept_1", "Equipment", "Track equipment."),
          newConcept(
            "concept_2",
            "Maintenance Job",
            "Track maintenance work for equipment.",
          ),
        ],
        [
          configurationStep("step_1", 1, "define_object", [
            "concept_1",
            "concept_2",
          ]),
          configurationStep(
            "step_2",
            2,
            "define_field",
            ["concept_1", "concept_2"],
            [],
            ["step_1"],
          ),
          configurationStep(
            "step_3",
            3,
            "define_relationship",
            ["concept_1", "concept_2"],
            [],
            ["step_1"],
          ),
          configurationStep(
            "step_4",
            4,
            "configure_form",
            ["concept_1", "concept_2"],
            [],
            ["step_2"],
          ),
          configurationStep(
            "step_5",
            5,
            "configure_view",
            ["concept_1", "concept_2"],
            [],
            ["step_4"],
          ),
        ],
      ),
      {
        objects: [
          {
            reference: equipment,
            singular_label: "Equipment",
            plural_label: "Equipment Units",
          },
          {
            reference: maintenanceJob,
            singular_label: "Maintenance Job",
            plural_label: "Maintenance Jobs",
          },
        ],
        fields: [
          {
            reference: newField(equipment, "Name"),
            label: "Name",
            field_type: "short_text",
            required: true,
            settings: null,
          },
          {
            reference: newField(equipment, "Serial number"),
            label: "Serial number",
            field_type: "short_text",
            required: false,
            settings: null,
          },
          {
            reference: newField(maintenanceJob, "Summary"),
            label: "Summary",
            field_type: "short_text",
            required: true,
            settings: null,
          },
          {
            reference: newField(maintenanceJob, "Due date"),
            label: "Due date",
            field_type: "date",
            required: false,
            settings: null,
          },
          {
            reference: newField(maintenanceJob, "Notes"),
            label: "Notes",
            field_type: "long_text",
            required: false,
            settings: null,
          },
        ],
        relationships: [
          {
            source: equipment,
            target: maintenanceJob,
            source_label: "has maintenance jobs",
            target_label: "equipment",
            cardinality: "one_to_many",
            is_required: false,
          },
        ],
        forms: [
          {
            name: "New Equipment",
            object: equipment,
            mode: "create",
            audience: "internal",
            fields: [
              newField(equipment, "Name"),
              newField(equipment, "Serial number"),
            ],
          },
          {
            name: "New Maintenance Job",
            object: maintenanceJob,
            mode: "create",
            audience: "internal",
            fields: [
              newField(maintenanceJob, "Summary"),
              newField(maintenanceJob, "Due date"),
              newField(maintenanceJob, "Notes"),
            ],
          },
        ],
        views: [
          {
            name: "Equipment",
            object: equipment,
            view_type: "list",
            audience: "internal",
            fields: [
              newField(equipment, "Name"),
              newField(equipment, "Serial number"),
            ],
            primary_field: newField(equipment, "Name"),
            title_field: null,
            create_form_name: "New Equipment",
            edit_form_name: null,
          },
          {
            name: "Maintenance Jobs",
            object: maintenanceJob,
            view_type: "table",
            audience: "internal",
            fields: [
              newField(maintenanceJob, "Summary"),
              newField(maintenanceJob, "Due date"),
              newField(maintenanceJob, "Notes"),
            ],
            title_field: null,
            create_form_name: "New Maintenance Job",
            edit_form_name: null,
          },
        ],
        pages: [],
        forbid_status_field: true,
      },
    ),
    createScenario(
      {
        id: "supplier_quote_field_types",
        context_id: empty,
        owner_request:
          "Create a Supplier Quote concept with required Supplier name, required Quote total in GBP, required Decision with Pending, Accepted and Declined options, optional Services with Delivery, Staffing and Equipment options, and optional Attachment. Decision is a status, Services allows multiple selections and Attachment is a file. Add one internal create Form and one internal table View. Do not add a Page or Relationship.",
      },
      readyPlan(
        [newConcept("concept_1", "Supplier Quote", "Track supplier quotes.")],
        [
          configurationStep("step_1", 1, "define_object", ["concept_1"]),
          configurationStep(
            "step_2",
            2,
            "define_field",
            ["concept_1"],
            [],
            ["step_1"],
          ),
          configurationStep(
            "step_3",
            3,
            "configure_form",
            ["concept_1"],
            [],
            ["step_2"],
          ),
          configurationStep(
            "step_4",
            4,
            "configure_view",
            ["concept_1"],
            [],
            ["step_3"],
          ),
        ],
      ),
      {
        objects: [
          {
            reference: supplierQuote,
            singular_label: "Supplier Quote",
            plural_label: "Supplier Quotes",
          },
        ],
        fields: [
          {
            reference: newField(supplierQuote, "Supplier name"),
            label: "Supplier name",
            field_type: "short_text",
            required: true,
            settings: null,
          },
          {
            reference: newField(supplierQuote, "Quote total"),
            label: "Quote total",
            field_type: "currency",
            required: true,
            settings: { currency: "GBP" },
          },
          {
            reference: newField(supplierQuote, "Decision"),
            label: "Decision",
            field_type: "status",
            required: true,
            settings: { options: ["Pending", "Accepted", "Declined"] },
          },
          {
            reference: newField(supplierQuote, "Services"),
            label: "Services",
            field_type: "multi_select",
            required: false,
            settings: { options: ["Delivery", "Staffing", "Equipment"] },
          },
          {
            reference: newField(supplierQuote, "Attachment"),
            label: "Attachment",
            field_type: "file",
            required: false,
            settings: null,
          },
        ],
        relationships: [],
        forms: [
          {
            name: "New Supplier Quote",
            object: supplierQuote,
            mode: "create",
            audience: "internal",
            fields: [
              newField(supplierQuote, "Supplier name"),
              newField(supplierQuote, "Quote total"),
              newField(supplierQuote, "Decision"),
              newField(supplierQuote, "Services"),
              newField(supplierQuote, "Attachment"),
            ],
          },
        ],
        views: [
          {
            name: "Supplier Quotes",
            object: supplierQuote,
            view_type: "table",
            audience: "internal",
            fields: [
              newField(supplierQuote, "Supplier name"),
              newField(supplierQuote, "Quote total"),
              newField(supplierQuote, "Decision"),
              newField(supplierQuote, "Services"),
              newField(supplierQuote, "Attachment"),
            ],
            title_field: null,
            create_form_name: "New Supplier Quote",
            edit_form_name: null,
          },
        ],
        pages: [],
        forbid_status_field: false,
      },
    ),
    createScenario(
      {
        id: "staff_profile_cards",
        context_id: empty,
        owner_request:
          "Create a Staff Profile concept with required Name, optional Role, optional Photo file and optional Bio. Add an internal create Form and an internal cards View. The cards use Name as the title, Role as the subtitle, Photo as the image and Bio as supporting information. Do not add a Page or Relationship.",
      },
      readyPlan(
        [newConcept("concept_1", "Staff Profile", "Describe a staff profile.")],
        [
          configurationStep("step_1", 1, "define_object", ["concept_1"]),
          configurationStep(
            "step_2",
            2,
            "define_field",
            ["concept_1"],
            [],
            ["step_1"],
          ),
          configurationStep(
            "step_3",
            3,
            "configure_form",
            ["concept_1"],
            [],
            ["step_2"],
          ),
          configurationStep(
            "step_4",
            4,
            "configure_view",
            ["concept_1"],
            [],
            ["step_3"],
          ),
        ],
      ),
      {
        objects: [
          {
            reference: staffProfile,
            singular_label: "Staff Profile",
            plural_label: "Staff Profiles",
          },
        ],
        fields: [
          {
            reference: newField(staffProfile, "Name"),
            label: "Name",
            field_type: "short_text",
            required: true,
            settings: null,
          },
          {
            reference: newField(staffProfile, "Role"),
            label: "Role",
            field_type: "short_text",
            required: false,
            settings: null,
          },
          {
            reference: newField(staffProfile, "Photo"),
            label: "Photo",
            field_type: "file",
            required: false,
            settings: null,
          },
          {
            reference: newField(staffProfile, "Bio"),
            label: "Bio",
            field_type: "long_text",
            required: false,
            settings: null,
          },
        ],
        relationships: [],
        forms: [
          {
            name: "New Staff Profile",
            object: staffProfile,
            mode: "create",
            audience: "internal",
            fields: [
              newField(staffProfile, "Name"),
              newField(staffProfile, "Role"),
              newField(staffProfile, "Photo"),
              newField(staffProfile, "Bio"),
            ],
          },
        ],
        views: [
          {
            name: "Staff Profiles",
            object: staffProfile,
            view_type: "cards",
            audience: "internal",
            fields: [
              newField(staffProfile, "Name"),
              newField(staffProfile, "Role"),
              newField(staffProfile, "Photo"),
              newField(staffProfile, "Bio"),
            ],
            title_field: newField(staffProfile, "Name"),
            subtitle_field: newField(staffProfile, "Role"),
            image_field: newField(staffProfile, "Photo"),
            supporting_fields: [newField(staffProfile, "Bio")],
            create_form_name: "New Staff Profile",
            edit_form_name: null,
          },
        ],
        pages: [],
        forbid_status_field: false,
      },
    ),
    createScenario(
      {
        id: "order_detail_workspace",
        context_id: rich,
        owner_request:
          "Create a new internal edit Form called Order Update for the existing Order concept using Status and Dietary requirements. Create a new internal detail View called Order Review showing Reference, Collection time display, Customer name, Items, Total, Dietary requirements and Status, linked to the new edit Form. Add an internal Page called Order Review Workspace containing that View. Do not add Objects, Fields or Relationships.",
      },
      readyPlan(
        [
          existingConcept(
            "concept_1",
            "Order",
            "order",
            "Use the existing Order concept.",
          ),
        ],
        [
          configurationStep(
            "step_1",
            1,
            "configure_form",
            ["concept_1"],
            ["order"],
          ),
          configurationStep(
            "step_2",
            2,
            "configure_view",
            ["concept_1"],
            ["order"],
            ["step_1"],
          ),
          configurationStep(
            "step_3",
            3,
            "configure_page",
            ["concept_1"],
            ["order"],
            ["step_2"],
          ),
        ],
      ),
      {
        objects: [],
        fields: [],
        relationships: [],
        forms: [
          {
            name: "Order Update",
            object: order,
            mode: "edit",
            audience: "internal",
            fields: [
              existingField("order", "status"),
              existingField("order", "dietary_requirements"),
            ],
          },
        ],
        views: [
          {
            name: "Order Review",
            object: order,
            view_type: "detail",
            audience: "internal",
            fields: [
              existingField("order", "public_reference"),
              existingField("order", "collection_local_display"),
              existingField("order", "customer_name"),
              existingField("order", "item_summary"),
              existingField("order", "total"),
              existingField("order", "dietary_requirements"),
              existingField("order", "status"),
            ],
            title_field: null,
            create_form_name: null,
            edit_form_name: "Order Update",
          },
        ],
        pages: [
          {
            title: "Order Review Workspace",
            audience: "internal",
            blocks: [{ type: "view", view_name: "Order Review" }],
          },
        ],
        forbid_status_field: false,
      },
    ),
  ]) as readonly ConfigurationDraftingScenario[];

export const configurationDraftingScenarioIds = Object.freeze(
  configurationDraftingScenarios.map(({ id }) => id),
);

export function configurationDraftingScenarioById(
  id: ConfigurationDraftingScenarioId,
): ConfigurationDraftingScenario {
  const scenario = configurationDraftingScenarios.find(
    (candidate) => candidate.id === id,
  );
  if (!scenario) {
    throw new Error("The configuration-drafting scenario is missing.");
  }
  return scenario;
}
