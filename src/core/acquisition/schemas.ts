import { z } from "zod";

import {
  configurationOperationsSchema,
  type ConfigurationOperation,
} from "../configuration/schemas";

export const acquisitionCategorySchema = z.enum([
  "appointments",
  "delivery",
  "jobs",
  "enquiries",
  "products",
  "other",
]);

export type AcquisitionCategory = z.infer<typeof acquisitionCategorySchema>;

export const acquisitionRequestSchema = z.string().trim().min(12).max(4_000);

const proposalConceptSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    tracked_information: z.array(z.string().trim().min(1).max(120)).max(12),
  })
  .strict();

const proposalConnectionSchema = z
  .object({
    text: z.string().trim().min(1).max(240),
  })
  .strict();

const proposalPageSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(300),
  })
  .strict();

const proposalViewSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(300),
  })
  .strict();

export const acquisitionRefinementSummarySchema = z
  .object({
    headline: z.string().trim().min(1).max(240),
    added: z.array(z.string().trim().min(1).max(160)).max(12),
    updated: z.array(z.string().trim().min(1).max(160)).max(12),
    removed: z.array(z.string().trim().min(1).max(160)).max(12),
    preserved: z.array(z.string().trim().min(1).max(160)).max(12),
  })
  .strict();

export const acquisitionProposalSchema = z
  .object({
    schema_version: z.literal(1),
    source: z.enum(["tailored", "fallback"]),
    category: acquisitionCategorySchema,
    title: z.string().trim().min(1).max(160),
    understanding: z.string().trim().min(1).max(900),
    why: z.string().trim().min(1).max(900),
    concepts: z.array(proposalConceptSchema).min(1).max(6),
    connections: z.array(proposalConnectionSchema).max(10),
    views: z.array(proposalViewSchema).min(1).max(8),
    pages: z.array(proposalPageSchema).max(3),
    landing_page_key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,79}$/)
      .nullable(),
    first_step: z.string().trim().min(1).max(300),
    not_included: z.array(z.string().trim().min(1).max(160)).max(8),
    refinement_summary: acquisitionRefinementSummarySchema.optional(),
  })
  .strict();

export type AcquisitionProposal = z.infer<typeof acquisitionProposalSchema>;
export type AcquisitionRefinementSummary = z.infer<
  typeof acquisitionRefinementSummarySchema
>;

/**
 * The proposal is the only part of this payload that reaches the browser.
 * Operations stay inside the server-owned acquisition session until the
 * authenticated claim RPC hands them to the existing configuration lifecycle.
 */
export const acquisitionBuildPayloadSchema = z
  .object({
    proposal: acquisitionProposalSchema,
    operations: configurationOperationsSchema,
  })
  .strict();

export type AcquisitionBuildPayload = z.infer<
  typeof acquisitionBuildPayloadSchema
>;
export type AcquisitionOperation = ConfigurationOperation;

export const acquisitionCategoryOptions: ReadonlyArray<{
  value: AcquisitionCategory;
  label: string;
  description: string;
}> = [
  {
    value: "appointments",
    label: "Appointments & bookings",
    description: "Keep track of people, services and daily bookings.",
  },
  {
    value: "delivery",
    label: "Orders & delivery",
    description: "Organise products, orders, quantities and deliveries.",
  },
  {
    value: "jobs",
    label: "Jobs & projects",
    description: "Keep customers, jobs, quotes and tasks together.",
  },
  {
    value: "enquiries",
    label: "Enquiries & sales",
    description: "Keep enquiries, customers and follow-ups moving.",
  },
  {
    value: "products",
    label: "Products & stock",
    description: "Track products and manually maintain stock information.",
  },
  {
    value: "other",
    label: "Something else",
    description: "Describe the process and Lenni will find a useful structure.",
  },
];

export const acquisitionPromptExamples = Object.freeze([
  "I run a dog grooming business and bookings are becoming hard to keep organised.",
  "I deliver milk locally and confirm every week what each customer wants.",
  "I’m a builder and need a better way to keep customers, jobs, quotes and tasks together.",
]);

export function acquisitionCategoryLabel(
  category: AcquisitionCategory,
): string {
  return (
    acquisitionCategoryOptions.find((option) => option.value === category)
      ?.label ?? "your business"
  );
}
