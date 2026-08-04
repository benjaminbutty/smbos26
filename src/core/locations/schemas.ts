import { z } from "zod";

import type { Json, Tables } from "../../db/supabase/database.types";

export const LOCATION_CREATION_STATE_SCHEMA_VERSION = 1 as const;

export const locationNameSchema = z.string().trim().min(1).max(120);
export const locationTimezoneSchema = z.string().trim().min(1).max(80);

export const locationCreationStateSummarySchema = z
  .object({
    id: z.uuid(),
    name: locationNameSchema,
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    timezone: locationTimezoneSchema,
    is_active: z.boolean(),
  })
  .strict();

const jsonValueSchema = z.custom<Json>((value) => {
  if (value === null) {
    return true;
  }
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
});

export const locationServiceResponseSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    name: locationNameSchema,
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    timezone: locationTimezoneSchema,
    is_active: z.boolean(),
    address_json: jsonValueSchema,
    opening_hours_json: jsonValueSchema,
    settings_json: jsonValueSchema,
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const locationCreationStateSchema = z
  .object({
    schema_version: z.literal(LOCATION_CREATION_STATE_SCHEMA_VERSION),
    business_id: z.uuid(),
    actor_id: z.uuid(),
    business_timezone: locationTimezoneSchema,
    location_state_digest: z.string().regex(/^[a-f0-9]{64}$/),
    locations: z.array(locationCreationStateSummarySchema).max(10_000),
  })
  .strict();

export const createLocationRequestSchema = z
  .object({
    name: locationNameSchema,
    timezone: locationTimezoneSchema,
    expectedBusinessTimezone: locationTimezoneSchema,
    expectedLocationStateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type LocationCreationState = z.infer<typeof locationCreationStateSchema>;
export type CreateLocationRequest = z.infer<typeof createLocationRequestSchema>;
export type Location = Tables<"locations">;

/**
 * This is intentionally an early-feedback check only. PostgreSQL's
 * pg_timezone_names trigger remains the authoritative validator.
 */
export function isValidIanaTimezone(value: string): boolean {
  const timezone = value.trim();
  if (!timezone) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}
