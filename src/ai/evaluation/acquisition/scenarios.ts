import type { AcquisitionCategory } from "../../../core/acquisition/schemas";

export type AcquisitionEvaluationScenario = {
  id: string;
  category: AcquisitionCategory;
  request: string;
  requiredConcepts: readonly (string | readonly string[])[];
  requiredRelationships?: readonly AcquisitionRelationshipExpectation[];
  forbiddenConcepts?: readonly string[];
  requiredUnsupported?: readonly string[];
  requiresLineItemQuantity?: boolean;
};

export type AcquisitionRelationshipExpectation = {
  code: string;
  sourceConceptAliases: readonly string[];
  targetConceptAliases: readonly string[];
  cardinality: "one_to_one" | "one_to_many" | "many_to_many";
};

const CUSTOMER_ALIASES = ["customer", "customers", "client", "clients"];
const ORDER_ALIASES = [
  "order",
  "orders",
  "standing order",
  "standing orders",
  "regular order",
  "regular orders",
];
const ORDER_ITEM_ALIASES = [
  "item",
  "items",
  "order item",
  "order items",
  "line item",
  "line items",
];
const PRODUCT_ALIASES = ["product", "products"];
const JOB_ALIASES = [
  "job",
  "jobs",
  "project",
  "projects",
  "work order",
  "work orders",
];
const TASK_ALIASES = [
  "task",
  "tasks",
  "next action",
  "next actions",
  "action",
  "actions",
];
const CONTACT_ALIASES = [
  ...CUSTOMER_ALIASES,
  "contact",
  "contacts",
  "prospect",
  "prospects",
];
const ENQUIRY_ALIASES = [
  "enquiry",
  "enquiries",
  "inquiry",
  "inquiries",
  "lead",
  "leads",
  "opportunity",
  "opportunities",
];
const FOLLOW_UP_ALIASES = [
  "follow-up",
  "follow-ups",
  "follow up",
  "follow ups",
  "next action",
  "next actions",
];

const deliveryRelationships = Object.freeze([
  {
    code: "customer_to_order_one_to_many",
    sourceConceptAliases: CUSTOMER_ALIASES,
    targetConceptAliases: ORDER_ALIASES,
    cardinality: "one_to_many",
  },
  {
    code: "order_to_item_one_to_many",
    sourceConceptAliases: ORDER_ALIASES,
    targetConceptAliases: ORDER_ITEM_ALIASES,
    cardinality: "one_to_many",
  },
  {
    code: "product_to_item_one_to_many",
    sourceConceptAliases: PRODUCT_ALIASES,
    targetConceptAliases: ORDER_ITEM_ALIASES,
    cardinality: "one_to_many",
  },
] as const satisfies readonly AcquisitionRelationshipExpectation[]);

export const acquisitionEvaluationScenarios = Object.freeze([
  {
    id: "dog_groomer",
    category: "appointments",
    request:
      "I run a dog grooming business and bookings are becoming hard to keep organised.",
    requiredConcepts: [
      ["customer", "client", "owner"],
      ["pet", "animal", "dog"],
      ["appointment", "booking", "session"],
    ],
  },
  {
    id: "hair_salon",
    category: "appointments",
    request:
      "I run a hair salon and need a better way to organise clients, bookings and services.",
    requiredConcepts: [
      ["customer", "client"],
      ["appointment", "booking"],
      ["service", "treatment"],
    ],
    forbiddenConcepts: ["pet"],
  },
  {
    id: "milk_round",
    category: "delivery",
    request:
      "I deliver milk locally and use WhatsApp every week to work out which customers want milk and how much.",
    requiredConcepts: [
      ["customer", "client"],
      "product",
      "order",
      ["item", "line"],
    ],
    requiredUnsupported: ["whatsapp", "integration"],
    requiresLineItemQuantity: true,
    requiredRelationships: deliveryRelationships,
  },
  {
    id: "general_delivery",
    category: "delivery",
    request:
      "I sell baked goods locally and need to keep customers, products, orders and deliveries organised.",
    requiredConcepts: [
      ["customer", "client"],
      "product",
      "order",
      ["item", "line"],
      "deliver",
    ],
    requiresLineItemQuantity: true,
    requiredRelationships: deliveryRelationships,
  },
  {
    id: "trades_jobs",
    category: "jobs",
    request:
      "I’m a builder and need a better way to keep customers, jobs, quotes and tasks together.",
    requiredConcepts: [
      ["customer", "client"],
      "job",
      ["quote", "estimate"],
      "task",
    ],
    requiredRelationships: [
      {
        code: "customer_to_job_one_to_many",
        sourceConceptAliases: CUSTOMER_ALIASES,
        targetConceptAliases: JOB_ALIASES,
        cardinality: "one_to_many",
      },
      {
        code: "job_to_task_one_to_many",
        sourceConceptAliases: JOB_ALIASES,
        targetConceptAliases: TASK_ALIASES,
        cardinality: "one_to_many",
      },
    ],
  },
  {
    id: "enquiry_service",
    category: "enquiries",
    request:
      "I run a consulting business and want website enquiries, prospective clients and follow-ups in one place.",
    requiredConcepts: [
      ["customer", "client", "contact", "prospect"],
      ["enquir", "lead", "opportun"],
      ["follow", "action"],
    ],
    requiredRelationships: [
      {
        code: "contact_to_enquiry_one_to_many",
        sourceConceptAliases: CONTACT_ALIASES,
        targetConceptAliases: ENQUIRY_ALIASES,
        cardinality: "one_to_many",
      },
      {
        code: "enquiry_to_follow_up_one_to_many",
        sourceConceptAliases: ENQUIRY_ALIASES,
        targetConceptAliases: FOLLOW_UP_ALIASES,
        cardinality: "one_to_many",
      },
    ],
  },
  {
    id: "product_tracking",
    category: "products",
    request:
      "I need a straightforward list of products and stock counts that I can update myself.",
    requiredConcepts: ["product"],
  },
  {
    id: "unusual_other",
    category: "other",
    request:
      "I rent party props and want to organise items, customer bookings and take online payments.",
    requiredConcepts: ["item", ["customer", "client"], ["booking", "rental"]],
    requiredUnsupported: ["payment"],
  },
] as const satisfies readonly AcquisitionEvaluationScenario[]);

export const ACQUISITION_EVALUATION_SCENARIO_COUNT = 8;
export const ACQUISITION_RELIABILITY_REPETITIONS = 3;
export const ACQUISITION_RELIABILITY_EXECUTIONS = 24;
