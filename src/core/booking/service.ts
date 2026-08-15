import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "../../db/supabase/database.types";
import { callPublicRpc } from "../public/rpc";
import {
  bookingSubmissionSchema,
  publicBookingCatalogueSchema,
  publicBookingResultSchema,
  type BookingSubmission,
  type PublicBookingCatalogue,
  type PublicBookingResult,
} from "./schemas";

export class BookingServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BookingServiceError";
  }
}

export async function resolvePublicBooking(
  client: SupabaseClient<Database>,
  businessSlug: string,
  pageSlug: string,
  bookingKey: string,
): Promise<PublicBookingCatalogue | null> {
  const result = await callPublicRpc<Json>(client, "resolve_public_booking", {
    requested_business_slug: businessSlug,
    requested_page_slug: pageSlug,
    requested_booking_key: bookingKey,
  });
  if (result.error) {
    throw new BookingServiceError(
      "Could not load the booking page.",
      result.error,
    );
  }
  return result.data === null
    ? null
    : publicBookingCatalogueSchema.parse(result.data);
}

export async function submitPublicBooking(
  client: SupabaseClient<Database>,
  input: {
    businessSlug: string;
    pageSlug: string;
    bookingKey: string;
    submission: BookingSubmission;
    requestHash: string;
  },
): Promise<PublicBookingResult> {
  const submission = bookingSubmissionSchema.parse(input.submission);
  const result = await callPublicRpc<Json>(client, "submit_public_booking", {
    requested_business_slug: input.businessSlug,
    requested_page_slug: input.pageSlug,
    requested_booking_key: input.bookingKey,
    requested_idempotency_token: submission.idempotency_token,
    requested_submission: submission as unknown as Json,
    requested_request_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(input.requestHash),
  });
  if (result.error) {
    throw new BookingServiceError(
      "Could not submit the booking.",
      result.error,
    );
  }
  return publicBookingResultSchema.parse(result.data);
}
