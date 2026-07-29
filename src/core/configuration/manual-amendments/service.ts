import "server-only";

import type { z } from "zod";

import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  setPreorderExperienceOperationSchema,
  type ConfigurationOperation,
} from "../schemas";
import type { ConfigurationChangeService } from "../service";
import { preorderScheduleSchema } from "../../preorder/schemas";
import {
  updatePreorderScheduleIntentSchema,
  type UpdatePreorderScheduleIntent,
} from "./schemas";

type PreorderSchedule = z.infer<typeof preorderScheduleSchema>;
type SetPreorderOperation = Extract<
  ConfigurationOperation,
  { op: "set_preorder_experience" }
>;

export type ManualAmendmentErrorCode =
  | "manual_preorder_ambiguous"
  | "manual_preorder_locations_invalid"
  | "manual_preorder_not_found";

const errorMessages: Readonly<Record<ManualAmendmentErrorCode, string>> = {
  manual_preorder_ambiguous:
    "These preorder collection settings could not be identified safely.",
  manual_preorder_locations_invalid:
    "This preorder setup has no available collection location.",
  manual_preorder_not_found: "This preorder setup is no longer available.",
};

export class ManualAmendmentError extends Error {
  readonly code: ManualAmendmentErrorCode;

  constructor(code: ManualAmendmentErrorCode) {
    super(errorMessages[code]);
    this.name = "ManualAmendmentError";
    this.code = code;
  }
}

export interface ActiveManualAmendmentSnapshot {
  baseVersionId: string;
  headRevision: number;
  snapshot: ConfigurationSnapshotV1;
}

export interface PreorderScheduleSetup {
  key: string;
  label: string;
  schedule: PreorderSchedule;
}

export interface ComposedPreorderScheduleAmendment {
  description: string;
  noOp: boolean;
  operation: SetPreorderOperation;
  title: "Update preorder collection settings";
}

const dayNames = new Map([
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
]);

function normalizedSchedule(schedule: PreorderSchedule): PreorderSchedule {
  return {
    ...schedule,
    days_of_week: schedule.days_of_week.toSorted((left, right) => left - right),
  };
}

function scheduleEquals(
  left: PreorderSchedule,
  right: PreorderSchedule,
): boolean {
  return (
    JSON.stringify(normalizedSchedule(left)) ===
    JSON.stringify(normalizedSchedule(right))
  );
}

function linkedPageTitle(
  snapshot: ConfigurationSnapshotV1,
  preorderKey: string,
): string | null {
  const titles = snapshot.pages
    .filter(
      (page) =>
        page.is_active &&
        page.layout_json.blocks.some(
          (block) =>
            block.type === "preorder" && block.preorder_key === preorderKey,
        ),
    )
    .map((page) => page.title);
  return titles.length === 1 ? titles[0]! : null;
}

function activePreorder(
  snapshot: ConfigurationSnapshotV1,
  preorderKey: string,
) {
  const matches = snapshot.preorder_experiences.filter(
    (preorder) => preorder.key === preorderKey && preorder.is_active,
  );
  if (matches.length === 0) {
    throw new ManualAmendmentError("manual_preorder_not_found");
  }
  if (matches.length !== 1) {
    throw new ManualAmendmentError("manual_preorder_ambiguous");
  }
  return matches[0]!;
}

function activeLocationIds(
  snapshot: ConfigurationSnapshotV1,
  preorder: ConfigurationSnapshotV1["preorder_experiences"][number],
): string[] {
  const ids = snapshot.preorder_experience_locations
    .filter(
      (association) =>
        association.is_active &&
        association.preorder_key === preorder.key &&
        association.preorder_experience_id === preorder.id,
    )
    .map((association) => association.location_id);
  if (ids.length === 0) {
    throw new ManualAmendmentError("manual_preorder_locations_invalid");
  }
  if (new Set(ids).size !== ids.length) {
    throw new ManualAmendmentError("manual_preorder_ambiguous");
  }
  return ids;
}

function describeDays(before: number[], after: number[]): string[] {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return [
    ...before
      .filter((day) => !afterSet.has(day))
      .map((day) => `Remove ${dayNames.get(day)} collection`),
    ...after
      .filter((day) => !beforeSet.has(day))
      .map((day) => `Add ${dayNames.get(day)} collection`),
  ];
}

function changedValue(
  changes: string[],
  label: string,
  before: string | number,
  after: string | number,
  suffix = "",
): void {
  if (before !== after) {
    changes.push(
      `Change ${label} from ${before}${suffix} to ${after}${suffix}`,
    );
  }
}

export function describePreorderScheduleChange(
  beforeInput: PreorderSchedule,
  afterInput: PreorderSchedule,
): string {
  const before = normalizedSchedule(beforeInput);
  const after = normalizedSchedule(afterInput);
  const changes = describeDays(before.days_of_week, after.days_of_week);
  changedValue(
    changes,
    "first collection",
    before.start_time,
    after.start_time,
  );
  changedValue(changes, "last collection", before.end_time, after.end_time);
  changedValue(
    changes,
    "slot interval",
    before.slot_interval_minutes,
    after.slot_interval_minutes,
    " minutes",
  );
  changedValue(
    changes,
    "capacity",
    before.slot_capacity,
    after.slot_capacity,
    " orders per slot",
  );
  changedValue(
    changes,
    "notice",
    before.cutoff_hours,
    after.cutoff_hours,
    " hours",
  );
  changedValue(
    changes,
    "booking horizon",
    before.booking_horizon_days,
    after.booking_horizon_days,
    " days",
  );
  return changes.join(". ");
}

export async function loadActiveManualAmendmentSnapshot(
  configuration: ConfigurationChangeService,
): Promise<ActiveManualAmendmentSnapshot> {
  const head = await configuration.getActiveHead();
  const version = await configuration.getVersion(head.active_version_id);
  return {
    baseVersionId: version.id,
    headRevision: head.head_revision,
    snapshot: configurationSnapshotV1Schema.parse(version.snapshot_json),
  };
}

export function listPreorderScheduleSetups(
  snapshotInput: ConfigurationSnapshotV1,
): PreorderScheduleSetup[] {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  return snapshot.preorder_experiences
    .filter((preorder) => preorder.is_active)
    .map((preorder) => ({
      key: preorder.key,
      label:
        linkedPageTitle(snapshot, preorder.key) ??
        "Preorder collection settings",
      schedule: preorder.config_json.schedule,
    }));
}

export function composePreorderScheduleAmendment(
  snapshotInput: ConfigurationSnapshotV1,
  intentInput: UpdatePreorderScheduleIntent,
): ComposedPreorderScheduleAmendment {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const intent = updatePreorderScheduleIntentSchema.parse(intentInput);
  const preorder = activePreorder(snapshot, intent.preorderKey);
  const allowedLocationIds = activeLocationIds(snapshot, preorder);
  const schedule = normalizedSchedule(intent.schedule);
  const operation = setPreorderExperienceOperationSchema.parse({
    op: "set_preorder_experience",
    key: preorder.key,
    product_object_key: preorder.product_object_key,
    customer_object_key: preorder.customer_object_key,
    order_object_key: preorder.order_object_key,
    order_item_object_key: preorder.order_item_object_key,
    customer_places_order_relationship_key:
      preorder.customer_places_order_relationship_key,
    order_contains_item_relationship_key:
      preorder.order_contains_item_relationship_key,
    product_appears_in_item_relationship_key:
      preorder.product_appears_in_item_relationship_key,
    config_json: {
      ...preorder.config_json,
      schedule,
    },
    allowed_location_ids: allowedLocationIds,
    is_active: preorder.is_active,
  });
  const noOp = scheduleEquals(preorder.config_json.schedule, schedule);
  return {
    title: "Update preorder collection settings",
    description: noOp
      ? ""
      : describePreorderScheduleChange(preorder.config_json.schedule, schedule),
    noOp,
    operation,
  };
}
