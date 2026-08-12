import type { AcquisitionCategory } from "../../../core/acquisition/schemas";

export type AcquisitionEvaluationScenario = {
  id: string;
  category: AcquisitionCategory;
  request: string;
  requiredConcepts: readonly (string | readonly string[])[];
  forbiddenConcepts?: readonly string[];
  requiredUnsupported?: readonly string[];
  requiresLineItemQuantity?: boolean;
};

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
