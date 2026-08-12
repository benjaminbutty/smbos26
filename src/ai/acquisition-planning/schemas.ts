import { z } from "zod";
import {
  acquisitionCategorySchema,
  acquisitionRequestSchema,
} from "../../core/acquisition/schemas";

const text = z.string().trim().min(1).max(1_000);
const ref = z.string().regex(/^table_[1-9][0-9]*$/);
const fieldType = z.enum([
  "short_text",
  "long_text",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "email",
  "phone",
  "url",
  "select",
  "multi_select",
  "status",
]);
const field = z
  .object({
    label: z.string().trim().min(1).max(120),
    field_type: fieldType,
    required: z.boolean(),
    options: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(20)
      .nullable(),
    currency: z.enum(["GBP", "USD", "EUR"]).nullable(),
  })
  .strict();
const table = z
  .object({
    reference: ref,
    singular_name: z.string().trim().min(1).max(120),
    plural_name: z.string().trim().min(1).max(120),
    purpose: text,
    fields: z.array(field).min(1).max(12),
  })
  .strict();
const connection = z
  .object({
    source_table_reference: ref,
    target_table_reference: ref,
    source_label: z.string().trim().min(1).max(120),
    target_label: z.string().trim().min(1).max(120),
    cardinality: z.enum(["one_to_one", "one_to_many", "many_to_many"]),
    explanation: z.string().trim().min(1).max(240),
  })
  .strict();
export const acquisitionPlanningInputSchema = z
  .object({
    schema_version: z.literal(1),
    category: acquisitionCategorySchema,
    owner_request: acquisitionRequestSchema,
    grounded_currency: z.enum(["GBP", "USD", "EUR"]).nullable(),
  })
  .strict();
const needs = z
  .object({
    schema_version: z.literal(1),
    state: z.literal("needs_more_detail"),
    understanding: text,
    revision_prompt: z.string().trim().min(1).max(300),
  })
  .strict();
const ready = z
  .object({
    schema_version: z.literal(1),
    state: z.literal("ready"),
    understanding: text,
    why: text,
    tables: z.array(table).min(1).max(6),
    connections: z.array(connection).max(10),
    primary_table_reference: ref,
    unsupported_requirements: z.array(z.string().trim().min(1).max(160)).max(8),
  })
  .strict();
export const acquisitionPlanningOutputSchema = z.discriminatedUnion("state", [
  needs,
  ready,
]);
export type AcquisitionPlanningInput = z.infer<
  typeof acquisitionPlanningInputSchema
>;
export type AcquisitionPlanningOutput = z.infer<
  typeof acquisitionPlanningOutputSchema
>;
export type AcquisitionReadyPlan = Extract<
  AcquisitionPlanningOutput,
  { state: "ready" }
>;
