import {
  configurationOperationsSchema,
  setFieldOperationSchema,
  setFormOperationSchema,
  setObjectOperationSchema,
  setPageOperationSchema,
  setRelationshipOperationSchema,
  setViewOperationSchema,
  type ConfigurationOperation,
} from "../configuration/schemas";
import {
  formConfigSchema,
  pageLayoutSchema,
  parseViewConfig,
} from "../experience/schemas";
import type { Json } from "../../db/supabase/database.types";
import {
  acquisitionBuildPayloadSchema,
  acquisitionCategorySchema,
  acquisitionProposalSchema,
  acquisitionRequestSchema,
  type AcquisitionBuildPayload,
  type AcquisitionCategory,
} from "./schemas";

type FieldOperation = Extract<ConfigurationOperation, { op: "set_field" }>;
type ConnectionColumn = {
  relationship_key: string;
  direction: "source" | "target";
  label?: string;
};

interface StarterField {
  key: string;
  label: string;
  field_type: FieldOperation["field_type"];
  required?: boolean;
  default_value?: Json | null;
  settings_json?: Record<string, Json>;
}

interface StarterObject {
  key: string;
  singular_label: string;
  plural_label: string;
  description: string;
  fields: readonly StarterField[];
  view_connections?: readonly ConnectionColumn[];
}

interface StarterRelationship {
  key: string;
  source_object_key: string;
  target_object_key: string;
  source_label: string;
  target_label: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_many";
  text: string;
}

interface StarterDefinition {
  title: string;
  understandingLabel: string;
  objects: readonly StarterObject[];
  relationships: readonly StarterRelationship[];
  workObjectKey: string;
  workViewLabel: string;
  workPageText: string;
  firstStep: string;
  notIncluded: readonly string[];
}

function textField(
  key: string,
  label: string,
  options: Partial<StarterField> = {},
): StarterField {
  return {
    key,
    label,
    field_type: "short_text",
    ...options,
  };
}

function longTextField(key: string, label: string): StarterField {
  return { key, label, field_type: "long_text" };
}

function statusField(
  key: string,
  label: string,
  options: readonly string[],
  defaultValue: string,
): StarterField {
  return {
    key,
    label,
    field_type: "status",
    required: true,
    default_value: defaultValue,
    settings_json: { options: [...options] },
  };
}

function dateField(key: string, label: string, required = false): StarterField {
  return { key, label, field_type: "date", required };
}

function numberField(
  key: string,
  label: string,
  required = false,
  defaultValue?: number,
): StarterField {
  return {
    key,
    label,
    field_type: "number",
    required,
    ...(defaultValue === undefined ? {} : { default_value: defaultValue }),
  };
}

const customerObject: StarterObject = {
  key: "customer",
  singular_label: "Customer",
  plural_label: "Customers",
  description: "People you work with and want to keep in one place.",
  fields: [
    textField("name", "Name", { required: true }),
    { key: "email", label: "Email", field_type: "email" },
    { key: "phone", label: "Phone", field_type: "phone" },
  ],
};

const deliveryCustomerObject: StarterObject = {
  ...customerObject,
  view_connections: [
    {
      relationship_key: "customer_places_order",
      direction: "source",
      label: "Orders",
    },
  ],
};

const jobsCustomerObject: StarterObject = {
  ...customerObject,
  view_connections: [
    {
      relationship_key: "customer_has_job",
      direction: "source",
      label: "Jobs",
    },
  ],
};

const enquiriesCustomerObject: StarterObject = {
  ...customerObject,
  view_connections: [
    {
      relationship_key: "customer_has_enquiry",
      direction: "source",
      label: "Enquiries",
    },
  ],
};

const appointmentDefinition: StarterDefinition = {
  title: "Appointment workspace",
  understandingLabel:
    "Appointments, customers and services organised around the work you do each day.",
  objects: [
    customerObject,
    {
      key: "appointment",
      singular_label: "Appointment",
      plural_label: "Appointments",
      description: "The bookings that make up your daily work.",
      fields: [
        textField("title", "Appointment", { required: true }),
        dateField("date", "Date", true),
        textField("time", "Time"),
        statusField(
          "status",
          "Status",
          ["Enquiry", "Booked", "Complete", "Cancelled"],
          "Booked",
        ),
        longTextField("notes", "Notes"),
      ],
      view_connections: [
        { relationship_key: "appointment_uses_service", direction: "source" },
      ],
    },
    {
      key: "service",
      singular_label: "Service",
      plural_label: "Services",
      description: "The treatments or services you provide.",
      fields: [
        textField("name", "Name", { required: true }),
        numberField("duration_minutes", "Duration (minutes)"),
      ],
      view_connections: [
        { relationship_key: "appointment_uses_service", direction: "target" },
      ],
    },
  ],
  relationships: [
    {
      key: "appointment_uses_service",
      source_object_key: "appointment",
      target_object_key: "service",
      source_label: "uses services",
      target_label: "appointments",
      cardinality: "many_to_many",
      text: "Appointments use services.",
    },
  ],
  workObjectKey: "appointment",
  workViewLabel: "Appointments",
  workPageText: "Add a customer or service, then keep your bookings moving.",
  firstStep:
    "Add a customer and a service, then add an appointment and connect it to the service.",
  notIncluded: ["Online payments", "Automated reminders", "Public booking"],
};

const deliveryDefinition: StarterDefinition = {
  title: "Delivery workspace",
  understandingLabel:
    "Customers, products, orders and delivery work connected in one operating list.",
  objects: [
    deliveryCustomerObject,
    {
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "The products you sell or send to customers.",
      fields: [
        textField("name", "Name", { required: true }),
        textField("unit", "Unit"),
        statusField("status", "Status", ["Active", "Paused"], "Active"),
      ],
      view_connections: [
        {
          relationship_key: "product_appears_in_item",
          direction: "source",
          label: "Order items",
        },
      ],
    },
    {
      key: "order",
      singular_label: "Order",
      plural_label: "Orders",
      description: "Orders placed by customers and ready to be fulfilled.",
      fields: [
        textField("order_number", "Order number", { required: true }),
        dateField("placed_on", "Placed on", true),
        statusField(
          "status",
          "Status",
          ["New", "Packed", "Delivered", "Cancelled"],
          "New",
        ),
        longTextField("notes", "Notes"),
      ],
      view_connections: [
        {
          relationship_key: "customer_places_order",
          direction: "target",
          label: "Customer",
        },
        {
          relationship_key: "order_contains_item",
          direction: "source",
          label: "Items",
        },
        {
          relationship_key: "order_has_delivery",
          direction: "source",
          label: "Deliveries",
        },
      ],
    },
    {
      key: "order_item",
      singular_label: "Order item",
      plural_label: "Order items",
      description: "Each product and quantity included in an order.",
      fields: [
        numberField("quantity", "Quantity", true, 1),
        longTextField("notes", "Notes"),
      ],
      view_connections: [
        {
          relationship_key: "order_contains_item",
          direction: "target",
          label: "Order",
        },
        {
          relationship_key: "product_appears_in_item",
          direction: "target",
          label: "Product",
        },
      ],
    },
    {
      key: "delivery",
      singular_label: "Delivery",
      plural_label: "Deliveries",
      description: "The deliveries your team needs to complete.",
      fields: [
        dateField("delivery_date", "Delivery date", true),
        statusField(
          "status",
          "Status",
          ["Scheduled", "Out for delivery", "Delivered", "Failed"],
          "Scheduled",
        ),
        longTextField("notes", "Notes"),
      ],
      view_connections: [
        {
          relationship_key: "order_has_delivery",
          direction: "target",
          label: "Order",
        },
      ],
    },
  ],
  relationships: [
    {
      key: "customer_places_order",
      source_object_key: "customer",
      target_object_key: "order",
      source_label: "places orders",
      target_label: "customer",
      cardinality: "one_to_many",
      text: "Customers place orders.",
    },
    {
      key: "order_contains_item",
      source_object_key: "order",
      target_object_key: "order_item",
      source_label: "contains items",
      target_label: "order",
      cardinality: "one_to_many",
      text: "Orders contain order items.",
    },
    {
      key: "product_appears_in_item",
      source_object_key: "product",
      target_object_key: "order_item",
      source_label: "appears in order items",
      target_label: "product",
      cardinality: "one_to_many",
      text: "Order items refer to products, with quantity kept on each order item.",
    },
    {
      key: "order_has_delivery",
      source_object_key: "order",
      target_object_key: "delivery",
      source_label: "has deliveries",
      target_label: "order",
      cardinality: "one_to_many",
      text: "Deliveries belong to orders.",
    },
  ],
  workObjectKey: "delivery",
  workViewLabel: "Deliveries",
  workPageText:
    "See the deliveries that need attention and keep quantities with their order items.",
  firstStep:
    "Add a customer and the products they order. Create an order, add an order item for each product with its quantity, then add a delivery linked to that order.",
  notIncluded: [
    "Online payments",
    "Automatic delivery notifications",
    "Inventory automation",
  ],
};

const jobsDefinition: StarterDefinition = {
  title: "Jobs workspace",
  understandingLabel:
    "Customers, jobs, quotes and tasks arranged around the work you deliver.",
  objects: [
    jobsCustomerObject,
    {
      key: "job",
      singular_label: "Job",
      plural_label: "Jobs",
      description: "The work you have agreed to carry out.",
      fields: [
        textField("title", "Job", { required: true }),
        statusField(
          "status",
          "Status",
          ["Planned", "In progress", "Complete", "Cancelled"],
          "Planned",
        ),
        dateField("due_date", "Due date"),
        longTextField("notes", "Notes"),
      ],
      view_connections: [
        { relationship_key: "customer_has_job", direction: "target" },
        { relationship_key: "job_has_quote", direction: "source" },
        { relationship_key: "job_has_task", direction: "source" },
      ],
    },
    {
      key: "quote",
      singular_label: "Quote",
      plural_label: "Quotes",
      description: "The prices and decisions attached to your jobs.",
      fields: [
        textField("title", "Quote", { required: true }),
        statusField(
          "status",
          "Status",
          ["Draft", "Sent", "Accepted", "Declined"],
          "Draft",
        ),
      ],
      view_connections: [
        { relationship_key: "job_has_quote", direction: "target" },
      ],
    },
    {
      key: "task",
      singular_label: "Task",
      plural_label: "Tasks",
      description: "The next actions that keep jobs moving.",
      fields: [
        textField("title", "Task", { required: true }),
        statusField(
          "status",
          "Status",
          ["To do", "In progress", "Done"],
          "To do",
        ),
        dateField("due_date", "Due date"),
        longTextField("notes", "Notes"),
      ],
      view_connections: [
        { relationship_key: "job_has_task", direction: "target" },
      ],
    },
  ],
  relationships: [
    {
      key: "customer_has_job",
      source_object_key: "customer",
      target_object_key: "job",
      source_label: "has jobs",
      target_label: "customer",
      cardinality: "one_to_many",
      text: "Jobs belong to customers.",
    },
    {
      key: "job_has_quote",
      source_object_key: "job",
      target_object_key: "quote",
      source_label: "has quotes",
      target_label: "job",
      cardinality: "one_to_many",
      text: "Quotes belong to jobs.",
    },
    {
      key: "job_has_task",
      source_object_key: "job",
      target_object_key: "task",
      source_label: "has tasks",
      target_label: "job",
      cardinality: "one_to_many",
      text: "Tasks belong to jobs.",
    },
  ],
  workObjectKey: "task",
  workViewLabel: "Tasks",
  workPageText:
    "Start with the next task, then keep the job and customer context close by.",
  firstStep:
    "Add a customer, create a job, add a quote if needed, then add the tasks that move it forward.",
  notIncluded: ["Online payments", "Automatic scheduling", "Customer portal"],
};

const otherDefinition: StarterDefinition = {
  title: "Customer follow-up workspace",
  understandingLabel:
    "A flexible starting point for customers, enquiries and the follow-ups that matter.",
  objects: [
    enquiriesCustomerObject,
    {
      key: "enquiry",
      singular_label: "Enquiry",
      plural_label: "Enquiries",
      description: "Questions, opportunities and requests from customers.",
      fields: [
        textField("subject", "Subject", { required: true }),
        statusField(
          "status",
          "Status",
          ["New", "In progress", "Won", "Closed"],
          "New",
        ),
        dateField("follow_up_date", "Follow-up date"),
        longTextField("notes", "Notes"),
      ],
      view_connections: [
        { relationship_key: "customer_has_enquiry", direction: "target" },
      ],
    },
    {
      key: "follow_up",
      singular_label: "Follow-up",
      plural_label: "Follow-ups",
      description: "The next actions you want to remember.",
      fields: [
        textField("title", "Follow-up", { required: true }),
        dateField("due_date", "Due date"),
        statusField("status", "Status", ["To do", "Done"], "To do"),
      ],
      view_connections: [
        { relationship_key: "enquiry_has_follow_up", direction: "target" },
      ],
    },
  ],
  relationships: [
    {
      key: "customer_has_enquiry",
      source_object_key: "customer",
      target_object_key: "enquiry",
      source_label: "has enquiries",
      target_label: "customer",
      cardinality: "one_to_many",
      text: "Enquiries belong to customers.",
    },
    {
      key: "enquiry_has_follow_up",
      source_object_key: "enquiry",
      target_object_key: "follow_up",
      source_label: "has follow-ups",
      target_label: "enquiry",
      cardinality: "one_to_many",
      text: "Follow-ups belong to enquiries.",
    },
  ],
  workObjectKey: "enquiry",
  workViewLabel: "Open enquiries",
  workPageText: "Capture the next enquiry and keep the next follow-up visible.",
  firstStep:
    "Add a customer, record an enquiry, then add the next follow-up linked to that enquiry.",
  notIncluded: [
    "A tailored setup for a specific industry",
    "Payments",
    "Automation",
    "Public forms",
  ],
};

const productsDefinition: StarterDefinition = {
  title: "Product tracking workspace",
  understandingLabel:
    "A reliable starting point for manually keeping product and stock information organised.",
  objects: [
    {
      key: "product",
      singular_label: "Product",
      plural_label: "Products",
      description: "The products you sell, supply or keep track of.",
      fields: [
        textField("name", "Name", { required: true }),
        textField("sku", "SKU"),
        numberField("quantity_on_hand", "Quantity on hand"),
        textField("unit", "Unit"),
        statusField("status", "Status", ["Active", "Paused"], "Active"),
        longTextField("notes", "Notes"),
      ],
    },
  ],
  relationships: [],
  workObjectKey: "product",
  workViewLabel: "Products",
  workPageText:
    "Keep product information and manually updated quantities visible.",
  firstStep: "Add the first real product you want to track.",
  notIncluded: ["Inventory automation", "Payments", "Supplier integrations"],
};

const starterDefinitions: Readonly<
  Record<AcquisitionCategory, StarterDefinition>
> = {
  appointments: appointmentDefinition,
  delivery: deliveryDefinition,
  jobs: jobsDefinition,
  enquiries: otherDefinition,
  products: productsDefinition,
  other: otherDefinition,
};

function fieldOperation(
  objectKey: string,
  field: StarterField,
  position: number,
): FieldOperation {
  return setFieldOperationSchema.parse({
    op: "set_field",
    object_key: objectKey,
    key: field.key,
    label: field.label,
    field_type: field.field_type,
    required: field.required ?? false,
    default_value: field.default_value ?? null,
    settings_json: field.settings_json ?? {},
    position,
    is_active: true,
  });
}

function formOperation(
  object: StarterObject,
  mode: "create" | "edit",
  formKey: string,
): ConfigurationOperation {
  const fields = object.fields.map((field) => ({
    field: field.key,
    hidden: false,
  }));
  return setFormOperationSchema.parse({
    op: "set_form",
    key: formKey,
    name: `${mode === "create" ? "New" : "Edit"} ${object.singular_label}`,
    object_key: object.key,
    mode,
    config_json: formConfigSchema.parse({
      fields,
      submit_label:
        mode === "create" ? `Add ${object.singular_label}` : "Save changes",
    }),
    audience: "internal",
    is_active: true,
  });
}

function viewOperation(
  object: StarterObject,
  createFormKey: string,
  editFormKey: string,
): ConfigurationOperation {
  const fields = object.fields.map((field) => field.key);
  const columns = [
    ...fields.map((field_key) => ({ kind: "field" as const, field_key })),
    ...(object.view_connections ?? []).map((connection) => ({
      kind: "connection" as const,
      ...connection,
    })),
  ];
  const config = parseViewConfig("table", {
    schema_version: 2,
    role: "primary",
    columns,
    fields,
    title_field: fields[0],
    create_form_key: createFormKey,
    edit_form_key: editFormKey,
    include_archived: false,
    filters: [],
    filter_match: "all",
    sorts: [],
    group: null,
  });
  return setViewOperationSchema.parse({
    op: "set_view",
    key: `${object.key}_view`,
    name: object.plural_label,
    view_type: "table",
    object_key: object.key,
    config_json: config,
    audience: "internal",
    is_active: true,
  });
}

function pageOperation(definition: StarterDefinition): ConfigurationOperation {
  return setPageOperationSchema.parse({
    op: "set_page",
    key: "overview",
    title: "Overview",
    slug: "overview",
    audience: "internal",
    layout_json: pageLayoutSchema.parse({
      blocks: [
        { type: "heading", text: "Overview", level: 1 },
        { type: "heading", text: "Start here", level: 2 },
        { type: "text", text: definition.firstStep },
        {
          type: "heading",
          text: "How the parts fit together",
          level: 3,
        },
        ...definition.relationships.map(({ text }) => ({
          type: "text" as const,
          text,
        })),
        { type: "text", text: definition.workPageText },
        { type: "view", view_key: `${definition.workObjectKey}_view` },
      ],
    }),
    status: "published",
    is_active: true,
  });
}

function composeOperations(
  definition: StarterDefinition,
): ConfigurationOperation[] {
  const operations: ConfigurationOperation[] = [];
  const formKeys = new Map<string, { create: string; edit: string }>();

  for (const object of definition.objects) {
    operations.push(
      setObjectOperationSchema.parse({
        op: "set_object",
        key: object.key,
        singular_label: object.singular_label,
        plural_label: object.plural_label,
        description: object.description,
        icon: null,
        is_active: true,
      }),
    );
    object.fields.forEach((field, position) => {
      operations.push(fieldOperation(object.key, field, position));
    });
  }

  for (const relationship of definition.relationships) {
    operations.push(
      setRelationshipOperationSchema.parse({
        op: "set_relationship",
        key: relationship.key,
        source_object_key: relationship.source_object_key,
        target_object_key: relationship.target_object_key,
        source_label: relationship.source_label,
        target_label: relationship.target_label,
        cardinality: relationship.cardinality,
        is_required: false,
        is_active: true,
      }),
    );
  }

  for (const object of definition.objects) {
    const create = `${object.key}_create`;
    const edit = `${object.key}_edit`;
    formKeys.set(object.key, { create, edit });
    operations.push(formOperation(object, "create", create));
    operations.push(formOperation(object, "edit", edit));
  }

  for (const object of definition.objects) {
    const keys = formKeys.get(object.key);
    if (!keys) {
      throw new Error(`Missing form keys for ${object.key}.`);
    }
    operations.push(viewOperation(object, keys.create, keys.edit));
  }
  operations.push(pageOperation(definition));

  return configurationOperationsSchema.parse(operations);
}

export function composeStarterComposition(
  categoryInput: unknown,
  requestInput: unknown,
): AcquisitionBuildPayload {
  const category = acquisitionCategorySchema.parse(categoryInput);
  acquisitionRequestSchema.parse(requestInput);
  const definition = starterDefinitions[category];
  const operations = composeOperations(definition);
  const proposal = acquisitionProposalSchema.parse({
    schema_version: 1,
    source: "fallback",
    category,
    title: definition.title,
    understanding:
      "Lenni couldn’t tailor this right now, so here’s a reliable starting point based on the kind of work you selected.",
    why: definition.understandingLabel,
    concepts: definition.objects.map((object) => ({
      name: object.plural_label,
      description: object.description,
      tracked_information: object.fields.map((field) => field.label),
    })),
    connections: definition.relationships.map((relationship) => ({
      text: relationship.text,
    })),
    views: definition.objects.map((object) => ({
      name:
        object.key === definition.workObjectKey
          ? definition.workViewLabel
          : `All ${object.plural_label.toLocaleLowerCase("en")}`,
      description: `A practical view of ${object.plural_label.toLocaleLowerCase("en")}.`,
    })),
    pages: [
      {
        name: "Overview",
        description: `A useful place to see ${definition.workViewLabel.toLocaleLowerCase("en")} and add real work.`,
      },
    ],
    landing_page_key: "overview",
    first_step: definition.firstStep,
    not_included: definition.notIncluded,
  });

  return acquisitionBuildPayloadSchema.parse({ proposal, operations });
}

export function starterDefinitionForCategory(
  category: AcquisitionCategory,
): StarterDefinition {
  return starterDefinitions[category];
}
