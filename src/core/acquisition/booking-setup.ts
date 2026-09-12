import "server-only";

import { z } from "zod";

import {
  configurationOperationsSchema,
  setPageOperationSchema,
  type ConfigurationOperation,
} from "../configuration/schemas";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../configuration/definition-source";
import {
  pageLayoutSchema,
  type PageBlock,
  type PageLayout,
} from "../experience/schemas";
import { enhanceAcquisitionPayload } from "./capabilities";
import { composeStarterComposition } from "./composer";

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const bookingSetupRequestSchema = z
  .object({
    expectedBaseVersionId: z.uuid(),
    expectedHeadRevision: z.number().int().positive(),
    daysOfWeek: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length),
    firstTime: timeSchema,
    lastTime: timeSchema,
    slotIntervalMinutes: z.number().int().min(5).max(240),
    capacityPerSlot: z.number().int().min(1).max(1000),
    minimumNoticeMinutes: z
      .number()
      .int()
      .min(0)
      .max(8760 * 60),
    bookingHorizonDays: z.number().int().min(1).max(365),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.firstTime >= request.lastTime) {
      context.addIssue({
        code: "custom",
        message: "The last booking time must be later than the first.",
        path: ["lastTime"],
      });
    }
  });

export type BookingSetupRequest = z.infer<typeof bookingSetupRequestSchema>;

export const bookingSetupErrorCodes = [
  "booking_already_installed",
  "booking_existing_setup",
  "booking_incompatible_existing_fields",
] as const;

export type BookingSetupErrorCode = (typeof bookingSetupErrorCodes)[number];

export class BookingSetupError extends Error {
  readonly code: BookingSetupErrorCode;

  constructor(code: BookingSetupErrorCode) {
    super(
      code === "booking_already_installed"
        ? "This Business already has a public booking setup. Use the existing setup controls."
        : code === "booking_incompatible_existing_fields"
          ? "The existing Customer fields do not match the booking questions. Keep those fields unchanged and choose compatible Customer fields before adding public booking."
          : "This Business has an incomplete appointments setup. Use the existing configuration controls before adding public booking.",
    );
    this.name = "BookingSetupError";
    this.code = code;
  }
}

function operationTarget(operation: ConfigurationOperation): string {
  switch (operation.op) {
    case "set_object":
      return `object:${operation.key}`;
    case "set_field":
      return `field:${operation.object_key}.${operation.key}`;
    case "set_relationship":
      return `relationship:${operation.key}`;
    case "set_view":
      return `view:${operation.key}`;
    case "set_form":
      return `form:${operation.key}`;
    case "set_page":
      return `page:${operation.key}`;
    case "set_preorder_experience":
      return `preorder:${operation.key}`;
  }
}

function hasBookingBlock(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const block = value as {
    type?: unknown;
    booking_key?: unknown;
    blocks?: unknown;
  };
  if (block.type === "booking" && block.booking_key === "booking") {
    return true;
  }
  return Array.isArray(block.blocks) && block.blocks.some(hasBookingBlock);
}

export function hasPublicBookingPage(
  snapshotInput: ConfigurationSnapshotV1,
): boolean {
  return findPublicBookingPage(snapshotInput) !== null;
}

export function findPublicBookingPage(
  snapshotInput: ConfigurationSnapshotV1,
): ConfigurationSnapshotV1["pages"][number] | null {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  return (
    snapshot.pages.find(
      (page) =>
        page.is_active &&
        page.audience === "public" &&
        hasBookingBlock(page.layout_json),
    ) ?? null
  );
}

function currentTargetSet(snapshot: ConfigurationSnapshotV1): Set<string> {
  return new Set([
    ...snapshot.object_definitions.map((row) => `object:${row.key}`),
    ...snapshot.field_definitions.map(
      (row) => `field:${row.object_key}.${row.key}`,
    ),
    ...snapshot.relationship_definitions.map(
      (row) => `relationship:${row.key}`,
    ),
    ...snapshot.views.map((row) => `view:${row.key}`),
    ...snapshot.forms.map((row) => `form:${row.key}`),
    ...snapshot.pages.map((row) => `page:${row.key}`),
    ...snapshot.preorder_experiences.map((row) => `preorder:${row.key}`),
  ]);
}

function nextAvailable(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Could not allocate a public booking Page key.");
}

function nextAvailableSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Could not allocate a public booking Page address.");
}

function assertCompatibleCustomerFields(
  snapshot: ConfigurationSnapshotV1,
): void {
  const customer = snapshot.object_definitions.find(
    (object) => object.key === "customer" && object.is_active,
  );
  if (!customer) return;
  const fields = new Map(
    snapshot.field_definitions
      .filter((field) => field.object_key === customer.key && field.is_active)
      .map((field) => [field.key, field]),
  );
  const name = fields.get("name");
  const email = fields.get("email");
  const phone = fields.get("phone");
  if (
    (name &&
      ((name.field_type !== "short_text" && name.field_type !== "long_text") ||
        !name.required)) ||
    (email && email.field_type !== "email") ||
    (phone && phone.field_type !== "phone")
  ) {
    throw new BookingSetupError("booking_incompatible_existing_fields");
  }
}

function bookingScheduleForRequest(request: BookingSetupRequest) {
  return {
    timezone_source: "business" as const,
    location_id: null,
    days_of_week: [...request.daysOfWeek].sort((left, right) => left - right),
    first_time: request.firstTime,
    last_time: request.lastTime,
    slot_interval_minutes: request.slotIntervalMinutes,
    capacity_per_slot: request.capacityPerSlot,
    minimum_notice_minutes: request.minimumNoticeMinutes,
    booking_horizon_days: request.bookingHorizonDays,
  };
}

type ContainedPageBlock = Exclude<PageBlock, { type: "collapsible" }>;

function updateContainedBookingBlock(
  block: ContainedPageBlock,
  schedule: ReturnType<typeof bookingScheduleForRequest>,
): ContainedPageBlock {
  if (block.type === "booking") {
    return { ...block, config: { ...block.config, schedule } };
  }
  return block;
}

function updateBookingBlock(
  block: PageBlock,
  schedule: ReturnType<typeof bookingScheduleForRequest>,
): PageBlock {
  if (block.type === "collapsible") {
    return {
      ...block,
      blocks: block.blocks.map((child) =>
        updateContainedBookingBlock(child, schedule),
      ),
    };
  }
  return updateContainedBookingBlock(block, schedule);
}

function updateBookingBlocks(
  blocks: PageLayout["blocks"],
  schedule: ReturnType<typeof bookingScheduleForRequest>,
): PageLayout["blocks"] {
  return blocks.map((block) => updateBookingBlock(block, schedule));
}

export function composeBookingScheduleAmendmentOperations(
  snapshotInput: ConfigurationSnapshotV1,
  requestInput: BookingSetupRequest,
): ConfigurationOperation[] {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const request = bookingSetupRequestSchema.parse(requestInput);
  const page = findPublicBookingPage(snapshot);
  if (!page) throw new BookingSetupError("booking_existing_setup");
  if (page.status === "published") {
    throw new BookingSetupError("booking_existing_setup");
  }
  const layout = pageLayoutSchema.parse(page.layout_json);
  const operation = setPageOperationSchema.parse({
    op: "set_page",
    key: page.key,
    title: page.title,
    slug: page.slug,
    audience: page.audience,
    layout_json: {
      blocks: updateBookingBlocks(
        layout.blocks,
        bookingScheduleForRequest(request),
      ),
    },
    status: page.status,
    is_active: page.is_active,
  });
  return configurationOperationsSchema.parse([operation]);
}

export function composeBookingSetupOperations(
  snapshotInput: ConfigurationSnapshotV1,
  requestInput: BookingSetupRequest,
): ConfigurationOperation[] {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const request = bookingSetupRequestSchema.parse(requestInput);
  if (findPublicBookingPage(snapshot)) {
    throw new BookingSetupError("booking_already_installed");
  }

  const existingAppointmentObjects = snapshot.object_definitions.some(
    (object) =>
      object.is_active &&
      ["appointment", "booking", "service"].includes(object.key),
  );
  if (existingAppointmentObjects) {
    throw new BookingSetupError("booking_existing_setup");
  }
  assertCompatibleCustomerFields(snapshot);

  const requestText =
    "Set up a public appointments and booking experience for this Business.";
  const enhanced = enhanceAcquisitionPayload(
    composeStarterComposition("appointments", requestText),
    {
      onlineBooking: true,
      usesServices: true,
      capacityPerSlot: request.capacityPerSlot,
      publicEnquiry: false,
    },
    requestText,
  );
  const existingTargets = currentTargetSet(snapshot);
  const operations = enhanced.operations.filter(
    (operation) => !existingTargets.has(operationTarget(operation)),
  );
  type PageOperation = Extract<ConfigurationOperation, { op: "set_page" }>;
  const pageOperation = operations.find(
    (operation): operation is PageOperation =>
      operation.op === "set_page" &&
      operation.audience === "public" &&
      hasBookingBlock(operation.layout_json),
  );
  if (!pageOperation) {
    throw new Error("The booking starter did not include a public Page.");
  }
  const bookingPageIndex = operations.indexOf(pageOperation);
  const usedPageKeys = new Set(snapshot.pages.map((page) => page.key));
  const usedPageSlugs = new Set(snapshot.pages.map((page) => page.slug));
  const pageKey = nextAvailable(pageOperation.key, usedPageKeys);
  const pageSlug = nextAvailableSlug(pageOperation.slug, usedPageSlugs);
  const layout = pageLayoutSchema.parse(pageOperation.layout_json);
  const schedule = bookingScheduleForRequest(request);
  const nextLayout = {
    blocks: layout.blocks.map((block) =>
      block.type === "booking"
        ? { ...block, config: { ...block.config, schedule } }
        : block,
    ),
  };
  operations[bookingPageIndex] = setPageOperationSchema.parse({
    ...pageOperation,
    key: pageKey,
    slug: pageSlug,
    layout_json: nextLayout,
  });

  return configurationOperationsSchema.parse(operations);
}
