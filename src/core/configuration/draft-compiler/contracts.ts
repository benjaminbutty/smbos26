import { z } from "zod";

import {
  builderConfigurationDraftOutputSchema,
  builderConfigurationDraftTaskInputBaseSchema,
} from "../../../ai/configuration-drafting/schemas";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  configurationOperationsSchema,
  type ConfigurationOperation,
} from "../schemas";

export const CONFIGURATION_DRAFT_COMPILER_SCHEMA_VERSION = 1 as const;

export const configurationDraftCompilerInputSchema = z
  .object({
    taskInput: builderConfigurationDraftTaskInputBaseSchema,
    draft: builderConfigurationDraftOutputSchema,
    snapshot: configurationSnapshotV1Schema,
  })
  .strict();

export const configurationDraftCompilerOutputSchema = z
  .object({
    schema_version: z.literal(CONFIGURATION_DRAFT_COMPILER_SCHEMA_VERSION),
    operations: configurationOperationsSchema,
  })
  .strict();

export type ConfigurationDraftCompilerInput = z.input<
  typeof configurationDraftCompilerInputSchema
>;
export type ConfigurationDraftCompilerOutput = z.infer<
  typeof configurationDraftCompilerOutputSchema
>;
export type { ConfigurationOperation, ConfigurationSnapshotV1 };
