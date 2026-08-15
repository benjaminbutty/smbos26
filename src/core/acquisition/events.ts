import "server-only";

import { z } from "zod";

export const acquisitionEventNameSchema = z.enum([
  "public_build_viewed",
  "prompt_submitted",
  "clarification_question_shown",
  "clarification_answered",
  "clarification_completed",
  "candidate_accepted",
  "proposal_ready",
  "proposal_failed",
  "proposal_regenerated",
  "create_workspace_clicked",
  "signup_started",
  "signup_completed",
  "proposal_claimed",
  "workspace_apply_started",
  "workspace_apply_succeeded",
  "workspace_apply_failed",
  "first_record_created",
]);

export type AcquisitionEventName = z.infer<typeof acquisitionEventNameSchema>;

export function emitAcquisitionEvent(
  name: AcquisitionEventName,
  metadata: Readonly<Record<string, string | number | boolean | null>> = {},
): void {
  const deniedMetadataKeys = new Set([
    "request",
    "prompt",
    "customer",
    "email",
    "phone",
    "model_output",
    "proposal",
    "operations",
    "configuration",
    "business_slug",
  ]);
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata)
      .filter(
        ([key, value]) =>
          !deniedMetadataKeys.has(key) &&
          /^[a-z][a-z0-9_]{0,39}$/.test(key) &&
          (typeof value === "string"
            ? value.length <= 120
            : typeof value === "number" ||
              typeof value === "boolean" ||
              value === null),
      )
      .slice(0, 8),
  );
  console.info(
    JSON.stringify({
      event: acquisitionEventNameSchema.parse(name),
      occurred_at: new Date().toISOString(),
      ...safeMetadata,
    }),
  );
}
