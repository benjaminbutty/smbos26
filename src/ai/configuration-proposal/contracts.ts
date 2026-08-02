import { z } from "zod";

import {
  builderConfigurationDraftOutputSchema,
  builderConfigurationDraftTaskInputBaseSchema,
} from "../configuration-drafting/schemas";

export const BUILDER_CONFIGURATION_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const BUILDER_CONFIGURATION_PROPOSAL_TITLE =
  "Proposed configuration changes" as const;

const expectedCurrentnessSchema = z
  .object({
    baseVersionId: z.uuid(),
    headRevision: z.number().int().positive(),
  })
  .strict();

export const builderConfigurationProposalRequestSchema = z
  .object({
    businessId: z.uuid(),
    expectedCurrentness: expectedCurrentnessSchema,
    taskInput: builderConfigurationDraftTaskInputBaseSchema,
    draft: builderConfigurationDraftOutputSchema,
  })
  .strict();

export const builderConfigurationProposalResultSchema = z
  .object({
    schema_version: z.literal(BUILDER_CONFIGURATION_PROPOSAL_SCHEMA_VERSION),
    proposal_id: z.uuid(),
    status: z.literal("proposed"),
    base_version_id: z.uuid(),
    base_head_revision: z.number().int().positive(),
    operation_count: z.number().int().min(1).max(100),
  })
  .strict();

export type BuilderConfigurationProposalRequest = z.infer<
  typeof builderConfigurationProposalRequestSchema
>;
export type BuilderConfigurationProposalResult = z.infer<
  typeof builderConfigurationProposalResultSchema
>;
