import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Tables } from "../../db/supabase/database.types";
import {
  recordLocationLinkActionSchema,
  recordLocationLinkTargetStateSchema,
  type RecordLocationLinkAction,
  type RecordLocationLinkPairState,
  type RecordLocationLinkTargetState,
} from "./record-location-availability/schemas";
import { recordUpdateSelectorSchema } from "./record-update/schemas";

export class RecordLocationLinkError extends Error {
  readonly code: RecordLocationLinkErrorCode | string | null;

  constructor(message: string, cause?: PostgrestError | null) {
    super(message, { cause });
    this.name = "RecordLocationLinkError";
    this.code = cause ? codeFromError(cause) : null;
  }
}

function requireResult<T>(
  data: T | null,
  error: PostgrestError | null,
  message: string,
): T {
  if (error || data === null) {
    throw new RecordLocationLinkError(message, error);
  }
  return data;
}

export const recordLocationLinkErrorCodes = [
  "record_location_link_authentication_required",
  "record_location_link_actor_context_mismatch",
  "record_location_link_owner_or_admin_required",
  "record_location_link_object_not_found",
  "record_location_link_object_ineligible",
  "record_location_link_location_not_found",
  "record_location_link_location_inactive",
  "record_location_link_selector_invalid",
  "record_location_link_selector_not_found",
  "record_location_link_selector_ambiguous",
  "record_location_link_configuration_changed",
  "record_location_link_state_changed",
  "record_location_link_target_changed",
  "record_location_link_pair_exists",
  "record_location_link_not_found",
  "record_location_link_action_invalid",
  "record_location_link_failed",
  "record_location_link_response_invalid",
] as const;

export type RecordLocationLinkErrorCode =
  (typeof recordLocationLinkErrorCodes)[number];

const serviceContextSchema = z
  .object({ businessId: z.uuid(), actorId: z.uuid().optional() })
  .strict();

const recordLocationLinkRowSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    record_id: z.uuid(),
    location_id: z.uuid(),
    created_at: z.string().min(1),
  })
  .strict();

const locationRowSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    is_active: z.boolean(),
  })
  .strict();

const recordAvailabilityInputSchema = z
  .object({
    recordId: z.uuid(),
    objectDefinitionId: z.uuid(),
  })
  .strict();

const builderReadStateInputSchema = z
  .object({
    objectKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_]*$/),
    selector: z.unknown(),
    locationId: z.uuid(),
    action: recordLocationLinkActionSchema,
  })
  .strict();

const currentPairStateInputSchema = z
  .object({
    objectKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_]*$/),
    expectedObjectDefinitionId: z.uuid(),
    targetRecordId: z.uuid(),
    targetLocationId: z.uuid(),
    action: recordLocationLinkActionSchema,
  })
  .strict();

const currentObjectRowSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    key: z.string().trim().min(1).max(80),
    singular_label: z.string().trim().min(1).max(120),
    is_active: z.boolean(),
  })
  .strict();

const currentRecordRowSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    object_definition_id: z.uuid(),
    record_status: z.enum(["active", "archived"]),
  })
  .strict();

function codeFromError(
  error: PostgrestError | null,
): RecordLocationLinkErrorCode {
  const message = error?.message ?? "";
  const matched = message.match(/record_location_link_[a-z0-9_]+/);
  const candidate = matched?.[0] ?? error?.code;
  if (
    recordLocationLinkErrorCodes.includes(
      candidate as RecordLocationLinkErrorCode,
    )
  ) {
    return candidate as RecordLocationLinkErrorCode;
  }
  if (candidate === "record_update_selector_invalid") {
    return "record_location_link_selector_invalid";
  }
  if (error?.code === "23505") {
    return "record_location_link_pair_exists";
  }
  return "record_location_link_failed";
}

function unwrapState(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.length === 1 ? data[0] : undefined;
  }
  return data;
}

export interface RecordLocationAvailabilityLocation {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly linkId: string | null;
}

export interface RecordLocationAvailabilityState {
  readonly eligible: boolean;
  readonly objectLabel: string;
  readonly locations: readonly RecordLocationAvailabilityLocation[];
}

export interface RecordLocationLinkService {
  create(
    recordId: string,
    locationId: string,
  ): Promise<Tables<"record_location_links">>;
  remove(recordLocationLinkId: string): Promise<void>;
  listForRecord(recordId: string): Promise<Tables<"record_location_links">[]>;
  listLocations(): Promise<Tables<"locations">[]>;
  readPair(
    recordId: string,
    locationId: string,
  ): Promise<Tables<"record_location_links"> | null>;
  readManualAvailability(
    input: RecordLocationAvailabilityInput,
  ): Promise<RecordLocationAvailabilityState>;
  readBuilderState(
    input: RecordLocationBuilderStateInput,
  ): Promise<RecordLocationLinkTargetState>;
  readCurrentPairState(
    input: RecordLocationCurrentPairStateInput,
  ): Promise<RecordLocationLinkCurrentPairState>;
}

export interface RecordLocationAvailabilityInput {
  readonly recordId: string;
  readonly objectDefinitionId: string;
}

export interface RecordLocationBuilderStateInput {
  readonly objectKey: string;
  readonly selector: unknown;
  readonly locationId: string;
  readonly action: RecordLocationLinkAction;
}

export interface RecordLocationCurrentPairStateInput {
  readonly objectKey: string;
  readonly expectedObjectDefinitionId: string;
  readonly targetRecordId: string;
  readonly targetLocationId: string;
  readonly action: RecordLocationLinkAction;
}

export interface RecordLocationLinkCurrentPairState {
  readonly objectDefinitionId: string;
  readonly objectKey: string;
  readonly objectLabel: string;
  readonly targetRecordId: string;
  readonly targetLocationId: string;
  readonly locationName: string;
  readonly pairState: RecordLocationLinkPairState;
  readonly linkId: string | null;
}

export function createRecordLocationLinkService(
  client: SupabaseClient<Database>,
  tenant: { businessId: string; actorId?: string },
): RecordLocationLinkService {
  const trustedContext = serviceContextSchema.parse(tenant);
  const businessId = trustedContext.businessId;
  const actorId = trustedContext.actorId;

  return {
    async create(recordId, locationId) {
      const { data, error } = await client.rpc("create_record_location_link", {
        expected_business_id: businessId,
        target_record_id: z.uuid().parse(recordId),
        target_location_id: z.uuid().parse(locationId),
      });
      if (error || data === null) {
        throw new RecordLocationLinkError(
          "Could not connect the Location.",
          error,
        );
      }
      const parsed = recordLocationLinkRowSchema.safeParse(data);
      if (!parsed.success || parsed.data.business_id !== businessId) {
        throw new RecordLocationLinkError(
          "The Location connection response was invalid.",
          error,
        );
      }
      return parsed.data as Tables<"record_location_links">;
    },

    async remove(recordLocationLinkId) {
      const { data, error } = await client.rpc("remove_record_location_link", {
        expected_business_id: businessId,
        target_record_location_link_id: z.uuid().parse(recordLocationLinkId),
      });
      if (error || !data) {
        throw new RecordLocationLinkError(
          "Could not remove the Location connection.",
          error ??
            ({ code: "record_location_link_not_found" } as PostgrestError),
        );
      }
    },

    async listForRecord(recordId) {
      const { data, error } = await client
        .from("record_location_links")
        .select("*")
        .eq("business_id", businessId)
        .eq("record_id", z.uuid().parse(recordId))
        .order("created_at");
      return requireResult(data, error, "Could not load Location connections.");
    },

    async listLocations() {
      const { data, error } = await client
        .from("locations")
        .select("*")
        .eq("business_id", businessId)
        .order("name");
      return requireResult(data, error, "Could not load Locations.");
    },

    async readPair(recordId, locationId) {
      const { data, error } = await client
        .from("record_location_links")
        .select("*")
        .eq("business_id", businessId)
        .eq("record_id", z.uuid().parse(recordId))
        .eq("location_id", z.uuid().parse(locationId))
        .maybeSingle();
      if (error) {
        throw new RecordLocationLinkError(
          "Could not load the Location connection.",
          error,
        );
      }
      if (data === null) return null;
      const parsed = recordLocationLinkRowSchema.safeParse(data);
      if (!parsed.success || parsed.data.business_id !== businessId) {
        throw new RecordLocationLinkError(
          "The Location connection response was invalid.",
          error,
        );
      }
      return parsed.data as Tables<"record_location_links">;
    },

    async readManualAvailability(input) {
      const request = recordAvailabilityInputSchema.parse(input);
      const [
        recordResult,
        objectResult,
        preorderResult,
        linksResult,
        locationsResult,
      ] = await Promise.all([
        client
          .from("records")
          .select("id,business_id,object_definition_id,record_status")
          .eq("business_id", businessId)
          .eq("id", request.recordId)
          .maybeSingle(),
        client
          .from("object_definitions")
          .select("id,business_id,singular_label,is_active")
          .eq("business_id", businessId)
          .eq("id", request.objectDefinitionId)
          .maybeSingle(),
        client
          .from("preorder_experiences")
          .select(
            "order_object_definition_id,order_item_object_definition_id,is_active",
          )
          .eq("business_id", businessId),
        client
          .from("record_location_links")
          .select("*")
          .eq("business_id", businessId)
          .eq("record_id", request.recordId)
          .order("created_at"),
        client
          .from("locations")
          .select("id,business_id,name,is_active")
          .eq("business_id", businessId)
          .order("name"),
      ]);
      const queryError =
        recordResult.error ??
        objectResult.error ??
        preorderResult.error ??
        linksResult.error ??
        locationsResult.error;
      if (queryError) {
        throw new RecordLocationLinkError(
          "Could not load Location availability.",
          queryError,
        );
      }
      if (
        !recordResult.data ||
        !objectResult.data ||
        recordResult.data.object_definition_id !== request.objectDefinitionId
      ) {
        throw new RecordLocationLinkError(
          "The Record was not found for this Location availability request.",
        );
      }
      const links = z
        .array(recordLocationLinkRowSchema)
        .parse(linksResult.data);
      const locations = z.array(locationRowSchema).parse(locationsResult.data);
      const protectedByPreorder = (preorderResult.data ?? []).some(
        (preorder) =>
          preorder.is_active &&
          (preorder.order_object_definition_id === request.objectDefinitionId ||
            preorder.order_item_object_definition_id ===
              request.objectDefinitionId),
      );
      const eligible =
        recordResult.data.record_status === "active" &&
        objectResult.data.is_active &&
        !protectedByPreorder;
      const linksByLocation = new Map(
        links.map((link) => [link.location_id, link.id]),
      );
      return {
        eligible,
        objectLabel: objectResult.data.singular_label,
        locations: locations.map((location) => ({
          id: location.id,
          name: location.name,
          isActive: location.is_active,
          linkId: linksByLocation.get(location.id) ?? null,
        })),
      };
    },

    async readBuilderState(input) {
      if (!actorId) {
        throw new RecordLocationLinkError(
          "An authenticated Owner or Admin is required to resolve Location availability.",
          {
            code: "record_location_link_actor_context_mismatch",
          } as PostgrestError,
        );
      }
      const request = builderReadStateInputSchema.parse(input);
      let selector: ReturnType<typeof recordUpdateSelectorSchema.parse>;
      try {
        selector = recordUpdateSelectorSchema.parse(request.selector);
      } catch {
        throw new RecordLocationLinkError("The Record selector was invalid.", {
          code: "record_location_link_selector_invalid",
        } as PostgrestError);
      }
      const { data, error } = await client.rpc(
        "get_confirmed_record_location_link_state",
        {
          expected_business_id: businessId,
          expected_actor_id: actorId,
          target_object_key: request.objectKey,
          requested_selector: selector,
          target_location_id: request.locationId,
          requested_action: request.action,
        },
      );
      if (error || data === null || data === undefined) {
        throw new RecordLocationLinkError(
          "Could not resolve Location availability safely.",
          error,
        );
      }
      const parsed = recordLocationLinkTargetStateSchema.safeParse(
        unwrapState(data),
      );
      if (!parsed.success) {
        const code = codeFromError(error);
        throw new RecordLocationLinkError(
          "The Location availability response was invalid.",
          { code } as PostgrestError,
        );
      }
      if (
        (parsed.data.state === "ready" &&
          (parsed.data.business_id !== businessId ||
            parsed.data.actor_id !== actorId ||
            parsed.data.object_key !== request.objectKey ||
            parsed.data.target_location_id !== request.locationId ||
            parsed.data.action !== request.action)) ||
        (parsed.data.state !== "ready" &&
          parsed.data.object_key !== request.objectKey)
      ) {
        throw new RecordLocationLinkError(
          "The Location availability response was inconsistent.",
          { code: "record_location_link_response_invalid" } as PostgrestError,
        );
      }
      return parsed.data;
    },

    async readCurrentPairState(input) {
      if (!actorId) {
        throw new RecordLocationLinkError(
          "An authenticated Owner or Admin is required to revalidate Location availability.",
          {
            code: "record_location_link_actor_context_mismatch",
          } as PostgrestError,
        );
      }
      const request = currentPairStateInputSchema.parse(input);
      const [objectResult, recordResult, locationResult, pairResult] =
        await Promise.all([
          client
            .from("object_definitions")
            .select("id,business_id,key,singular_label,is_active")
            .eq("business_id", businessId)
            .eq("id", request.expectedObjectDefinitionId)
            .eq("key", request.objectKey)
            .maybeSingle(),
          client
            .from("records")
            .select("id,business_id,object_definition_id,record_status")
            .eq("business_id", businessId)
            .eq("id", request.targetRecordId)
            .maybeSingle(),
          client
            .from("locations")
            .select("id,business_id,name,is_active")
            .eq("business_id", businessId)
            .eq("id", request.targetLocationId)
            .maybeSingle(),
          client
            .from("record_location_links")
            .select("*")
            .eq("business_id", businessId)
            .eq("record_id", request.targetRecordId)
            .eq("location_id", request.targetLocationId)
            .maybeSingle(),
        ]);
      const queryError =
        objectResult.error ??
        recordResult.error ??
        locationResult.error ??
        pairResult.error;
      if (queryError) {
        throw new RecordLocationLinkError(
          "Could not revalidate Location availability safely.",
          queryError,
        );
      }

      const currentObject = currentObjectRowSchema.safeParse(objectResult.data);
      if (!currentObject.success) {
        throw new RecordLocationLinkError(
          "The signed Location availability object changed.",
          { code: "record_location_link_target_changed" } as PostgrestError,
        );
      }
      const currentRecord = currentRecordRowSchema.safeParse(recordResult.data);
      if (
        !currentRecord.success ||
        currentRecord.data.business_id !== businessId ||
        currentRecord.data.object_definition_id !== currentObject.data.id ||
        currentRecord.data.record_status !== "active"
      ) {
        throw new RecordLocationLinkError(
          "The signed Location availability Record changed.",
          { code: "record_location_link_state_changed" } as PostgrestError,
        );
      }
      const currentLocation = locationRowSchema.safeParse(locationResult.data);
      if (!currentLocation.success) {
        throw new RecordLocationLinkError(
          "The signed Location availability Location no longer exists.",
          { code: "record_location_link_location_not_found" } as PostgrestError,
        );
      }
      if (request.action === "link" && !currentLocation.data.is_active) {
        throw new RecordLocationLinkError(
          "The signed Location availability Location is inactive.",
          { code: "record_location_link_location_inactive" } as PostgrestError,
        );
      }
      if (!currentObject.data.is_active) {
        throw new RecordLocationLinkError(
          "The signed Location availability object is no longer eligible.",
          { code: "record_location_link_object_ineligible" } as PostgrestError,
        );
      }
      if (pairResult.data === null) {
        return {
          objectDefinitionId: currentObject.data.id,
          objectKey: currentObject.data.key,
          objectLabel: currentObject.data.singular_label,
          targetRecordId: currentRecord.data.id,
          targetLocationId: currentLocation.data.id,
          locationName: currentLocation.data.name,
          pairState: "unlinked",
          linkId: null,
        };
      }
      const currentLink = recordLocationLinkRowSchema.safeParse(
        pairResult.data,
      );
      if (
        !currentLink.success ||
        currentLink.data.record_id !== currentRecord.data.id ||
        currentLink.data.location_id !== currentLocation.data.id
      ) {
        throw new RecordLocationLinkError(
          "The current Location availability connection was invalid.",
          { code: "record_location_link_response_invalid" } as PostgrestError,
        );
      }
      return {
        objectDefinitionId: currentObject.data.id,
        objectKey: currentObject.data.key,
        objectLabel: currentObject.data.singular_label,
        targetRecordId: currentRecord.data.id,
        targetLocationId: currentLocation.data.id,
        locationName: currentLocation.data.name,
        pairState: "linked",
        linkId: currentLink.data.id,
      };
    },
  };
}
