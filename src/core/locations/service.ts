import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "../../db/supabase/database.types";
import {
  createLocationRequestSchema,
  isValidIanaTimezone,
  locationCreationStateSchema,
  locationServiceResponseSchema,
  type CreateLocationRequest,
  type Location,
  type LocationCreationState,
} from "./schemas";

type SessionClient = SupabaseClient<Database>;

export const locationServiceErrorCodes = [
  "location_authentication_required",
  "location_actor_context_mismatch",
  "location_owner_or_admin_required",
  "location_business_not_found",
  "location_creation_state_changed",
  "location_name_invalid",
  "location_timezone_invalid",
  "location_active_duplicate",
  "location_inactive_duplicate",
  "location_creation_failed",
  "location_response_invalid",
] as const;

export type LocationServiceErrorCode =
  (typeof locationServiceErrorCodes)[number];

const locationServiceErrorMessages: Readonly<
  Record<LocationServiceErrorCode, string>
> = {
  location_authentication_required:
    "Authentication is required to manage Locations.",
  location_actor_context_mismatch:
    "The authenticated Location-management actor did not match the trusted request context.",
  location_owner_or_admin_required:
    "Owner or Admin access is required to manage Locations.",
  location_business_not_found:
    "The Business could not be found for this Location request.",
  location_creation_state_changed:
    "The Business or its Locations changed while this Location request was being prepared.",
  location_name_invalid: "Enter a valid Location name.",
  location_timezone_invalid: "Enter a valid IANA timezone.",
  location_active_duplicate:
    "That Location already exists as an active Location.",
  location_inactive_duplicate:
    "That Location already exists as an inactive Location.",
  location_creation_failed: "The Location could not be created safely.",
  location_response_invalid: "The Location service returned an invalid result.",
};

function codeFromError(error: PostgrestError | null): LocationServiceErrorCode {
  const message = error?.message ?? "";
  const matched = message.match(/location_[a-z0-9_]+/);
  const candidate = matched?.[0] ?? error?.code;
  return locationServiceErrorCodes.includes(
    candidate as LocationServiceErrorCode,
  )
    ? (candidate as LocationServiceErrorCode)
    : "location_creation_failed";
}

export class LocationServiceError extends Error {
  readonly code: LocationServiceErrorCode;
  override readonly cause: unknown;

  constructor(code: LocationServiceErrorCode, cause?: unknown) {
    super(locationServiceErrorMessages[code]);
    this.name = "LocationServiceError";
    this.code = code;
    this.cause = cause;
  }
}

const serviceContextSchema = z
  .object({
    businessId: z.uuid(),
    actorId: z.uuid(),
  })
  .strict();

export interface LocationService {
  readCreationState(): Promise<LocationCreationState>;
  create(input: CreateLocationRequest): Promise<Location>;
}

export function createLocationService(
  client: SessionClient,
  context: { businessId: string; actorId: string },
): LocationService {
  const trustedContext = serviceContextSchema.parse(context);

  return {
    async readCreationState() {
      const { data, error } = await client.rpc("get_location_creation_state", {
        expected_business_id: trustedContext.businessId,
        expected_actor_id: trustedContext.actorId,
      });
      if (error || !data) {
        throw new LocationServiceError(codeFromError(error), error);
      }

      const rows = Array.isArray(data) ? data : [];
      if (rows.length !== 1) {
        throw new LocationServiceError("location_response_invalid");
      }

      const state = locationCreationStateSchema.safeParse(rows[0]);
      if (
        !state.success ||
        state.data.business_id !== trustedContext.businessId ||
        state.data.actor_id !== trustedContext.actorId
      ) {
        throw new LocationServiceError(
          "location_response_invalid",
          state.success ? undefined : state.error,
        );
      }

      return state.data;
    },

    async create(input) {
      const request = createLocationRequestSchema.parse(input);
      if (
        !isValidIanaTimezone(request.timezone) ||
        !isValidIanaTimezone(request.expectedBusinessTimezone)
      ) {
        throw new LocationServiceError("location_timezone_invalid");
      }

      const { data, error } = await client.rpc("create_location", {
        expected_business_id: trustedContext.businessId,
        expected_actor_id: trustedContext.actorId,
        expected_business_timezone: request.expectedBusinessTimezone,
        expected_location_state_digest: request.expectedLocationStateDigest,
        location_name: request.name,
        requested_timezone: request.timezone,
      });
      if (error || !data) {
        throw new LocationServiceError(codeFromError(error), error);
      }

      const location = locationServiceResponseSchema.safeParse(data);
      if (
        !location.success ||
        location.data.business_id !== trustedContext.businessId
      ) {
        throw new LocationServiceError("location_response_invalid");
      }

      return location.data;
    },
  };
}

export function locationServiceOwnerMessage(
  code: LocationServiceErrorCode,
): string {
  return locationServiceErrorMessages[code];
}
