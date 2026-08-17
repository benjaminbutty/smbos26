import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../../db/supabase/database.types";
import {
  bookingConfigSchema,
  publicBookingCatalogueSchema,
  type BookingConfig,
  type PublicBookingCatalogue,
} from "./schemas";

interface DraftBookingCatalogueInput {
  businessId: string;
  businessName: string;
  businessSlug: string;
  bookingKey: string;
  pageTitle: string;
  pageSlug: string;
  blockConfig: unknown;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function formatParts(date: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: timezone,
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function localDateParts(date: Date, timezone: string): LocalDateParts {
  const parts = formatParts(date, timezone);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function localDateString(parts: LocalDateParts): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function timezoneOffset(date: Date, timezone: string): number {
  const parts = formatParts(date, timezone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function localDateTimeToUtc(
  date: string,
  time: string,
  timezone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const localAsUtc = Date.UTC(year!, month! - 1, day!, hour, minute);
  let utc = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    utc = localAsUtc - timezoneOffset(new Date(utc), timezone);
  }
  return new Date(utc);
}

function addDays(parts: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function makeSlots(
  schedule: BookingConfig["schedule"],
  timezone: string,
  now = new Date(),
): PublicBookingCatalogue["booking"]["slots"] {
  const slots: PublicBookingCatalogue["booking"]["slots"] = [];
  const first =
    Number(schedule.first_time.slice(0, 2)) * 60 +
    Number(schedule.first_time.slice(3));
  const last =
    Number(schedule.last_time.slice(0, 2)) * 60 +
    Number(schedule.last_time.slice(3));
  const earliest = new Date(
    now.getTime() + schedule.minimum_notice_minutes * 60_000,
  );
  const today = localDateParts(now, timezone);

  for (
    let dayOffset = 0;
    dayOffset < schedule.booking_horizon_days;
    dayOffset += 1
  ) {
    const dateParts = addDays(today, dayOffset);
    const date = new Date(
      Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day),
    );
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if (!schedule.days_of_week.includes(weekday)) continue;
    const localDate = localDateString(dateParts);
    for (
      let minutes = first;
      minutes < last;
      minutes += schedule.slot_interval_minutes
    ) {
      const localTime = `${Math.floor(minutes / 60)
        .toString()
        .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
      const start = localDateTimeToUtc(localDate, localTime, timezone);
      if (start < earliest) continue;
      slots.push({
        start_at: start.toISOString(),
        local_date: localDate,
        local_time: localTime,
        remaining: schedule.capacity_per_slot,
      });
    }
  }
  return slots;
}

function recordText(data: Json, fieldKey: string): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const value = data[fieldKey];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function bookingTimezone(
  client: SupabaseClient<Database>,
  businessId: string,
  config: BookingConfig,
): Promise<string | null> {
  if (config.schedule.timezone_source === "location") {
    if (!config.schedule.location_id) return null;
    const result = await client
      .from("locations")
      .select("timezone")
      .eq("business_id", businessId)
      .eq("id", config.schedule.location_id)
      .eq("is_active", true)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data?.timezone ?? null;
  }

  const result = await client
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.timezone ?? null;
}

export async function resolveDraftBooking(
  client: SupabaseClient<Database>,
  input: DraftBookingCatalogueInput,
): Promise<PublicBookingCatalogue | null> {
  const config = bookingConfigSchema.parse(input.blockConfig);
  const timezone = await bookingTimezone(client, input.businessId, config);
  if (!timezone) return null;

  let services: Array<{ id: string; name: string }> = [];
  if (config.service_object_key && config.field_mappings.service) {
    const objectResult = await client
      .from("object_definitions")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("key", config.service_object_key)
      .eq("is_active", true)
      .maybeSingle();
    if (objectResult.error) throw objectResult.error;
    if (objectResult.data) {
      const recordsResult = await client
        .from("records")
        .select("id,data_json")
        .eq("business_id", input.businessId)
        .eq("object_definition_id", objectResult.data.id)
        .eq("record_status", "active")
        .order("created_at");
      if (recordsResult.error) throw recordsResult.error;
      services = recordsResult.data.flatMap((record) => {
        const name = recordText(
          record.data_json,
          config.field_mappings.service!.name,
        );
        return name ? [{ id: record.id, name }] : [];
      });
    }
  }

  return publicBookingCatalogueSchema.parse({
    business: { name: input.businessName, slug: input.businessSlug },
    page: { title: input.pageTitle, slug: input.pageSlug },
    booking: {
      key: input.bookingKey,
      timezone,
      schedule: config.schedule,
      slots: makeSlots(config.schedule, timezone),
      services,
      public_fields: config.public_fields,
    },
  });
}
