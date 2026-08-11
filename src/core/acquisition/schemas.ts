import { z } from "zod";

import {
  configurationOperationsSchema,
  type ConfigurationOperation,
} from "../configuration/schemas";

export const acquisitionCategorySchema = z.enum([
  "appointments",
  "delivery",
  "jobs",
  "other",
]);

export type AcquisitionCategory = z.infer<typeof acquisitionCategorySchema>;

export const acquisitionRequestSchema = z.string().trim().min(12).max(4_000);

const proposalConceptSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
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

export const acquisitionProposalSchema = z
  .object({
    schema_version: z.literal(1),
    category: acquisitionCategorySchema,
    title: z.string().trim().min(1).max(160),
    understanding: z.string().trim().min(1).max(900),
    concepts: z.array(proposalConceptSchema).min(1).max(12),
    connections: z.array(proposalConnectionSchema).max(16),
    pages: z.array(proposalPageSchema).min(1).max(6),
    first_step: z.string().trim().min(1).max(300),
    not_included: z.array(z.string().trim().min(1).max(160)).max(8),
  })
  .strict();

export type AcquisitionProposal = z.infer<typeof acquisitionProposalSchema>;

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
    label: "Products, orders & delivery",
    description: "Organise products, orders, quantities and deliveries.",
  },
  {
    value: "jobs",
    label: "Jobs & projects",
    description: "Keep customers, jobs, quotes and tasks together.",
  },
  {
    value: "other",
    label: "Enquiries, sales or something else",
    description: "Start with a flexible customer and follow-up workspace.",
  },
];

export function acquisitionCategoryLabel(
  category: AcquisitionCategory,
): string {
  return (
    acquisitionCategoryOptions.find((option) => option.value === category)
      ?.label ?? "your business"
  );
}
