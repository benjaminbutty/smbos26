import { z } from "zod";

export const configurationActionNoticeSchema = z.enum([
  "validated",
  "validation_rejected",
  "validation_conflicted",
  "applied",
  "application_rejected",
  "application_conflicted",
  "abandoned",
  "rollback_prepared",
  "builder_prepared",
  "state_changed",
  "input_invalid",
]);

export type ConfigurationActionNotice = z.infer<
  typeof configurationActionNoticeSchema
>;
