import { z } from "zod";

import {
  builderPreorderAmendmentOutputSchema,
  builderPreorderAmendmentTaskInputBaseSchema,
} from "./schemas";

export const BUILDER_PREORDER_AMENDMENT_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const BUILDER_PREORDER_AMENDMENT_PROPOSAL_TITLE =
  "Proposed preorder changes" as const;

const expectedCurrentnessSchema = z
  .object({
    baseVersionId: z.uuid(),
    headRevision: z.number().int().positive(),
  })
  .strict();

export const builderPreorderAmendmentProposalRequestSchema = z
  .object({
    businessId: z.uuid(),
    expectedCurrentness: expectedCurrentnessSchema,
    taskInput: builderPreorderAmendmentTaskInputBaseSchema,
    draft: builderPreorderAmendmentOutputSchema,
  })
  .strict();

export const builderPreorderAmendmentProposalResultSchema = z
  .object({
    schema_version: z.literal(
      BUILDER_PREORDER_AMENDMENT_PROPOSAL_SCHEMA_VERSION,
    ),
    proposal_id: z.uuid(),
    status: z.literal("proposed"),
    base_version_id: z.uuid(),
    base_head_revision: z.number().int().positive(),
    operation_count: z.number().int().min(1).max(100),
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type BuilderPreorderAmendmentProposalRequest = z.infer<
  typeof builderPreorderAmendmentProposalRequestSchema
>;
export type BuilderPreorderAmendmentProposalResult = z.infer<
  typeof builderPreorderAmendmentProposalResultSchema
>;
