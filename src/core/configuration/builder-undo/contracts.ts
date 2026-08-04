import { z } from "zod";

const proposalTitleSchema = z.string().trim().min(1).max(120);

export const builderUndoPresentationSchema = z
  .discriminatedUnion("state", [
    z
      .object({
        state: z.literal("eligible"),
        source_proposal_title: proposalTitleSchema.nullable(),
        source_version_number: z.number().int().positive(),
        previous_version_number: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        state: z.literal("superseded"),
        source_version_number: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        state: z.literal("baseline"),
        source_version_number: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        state: z.literal("active_rollback"),
        source_version_number: z.number().int().positive(),
      })
      .strict(),
  ])
  .readonly();

export type BuilderUndoPresentation = z.infer<
  typeof builderUndoPresentationSchema
>;
