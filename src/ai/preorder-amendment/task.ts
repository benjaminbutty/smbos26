import "server-only";

import { z } from "zod";

import type { RegisteredAiTask } from "../contracts";
import {
  BUILDER_PREORDER_AMENDMENT_SCHEMA_VERSION,
  builderPreorderAmendmentOutputSchema,
  builderPreorderAmendmentTaskInputBaseSchema,
} from "./schemas";
import {
  validateBuilderPreorderAmendmentInput,
  validateBuilderPreorderAmendmentOutput,
} from "./validation";
import { BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY } from "../policies";

export const BUILDER_PREORDER_AMENDMENT_INSTRUCTION = [
  "Use only the validated ready plan, owner request and current AI-safe Business context.",
  "Return only bounded preorder amendment intents for the one exact active preorder identified by the server-provided preorder_scope.",
  "Cover every supported configure_preorder planning step and cite exact step_N references on every amendment.",
  "Use configure_preorder for schedule and existing-question changes; use define_field only for a new Order question.",
  "Copy the exact preorder_key from preorder_scope and the exact target and field_key from the current public preorder fields.",
  "For a new question, return exactly one add_preorder_question amendment with the requested owner-facing label, an explicit help_text string or null, the requested public requiredness, and answer_style exactly short_answer or long_answer.",
  "For a requested new long-answer question, set answer_style exactly long_answer; if the validated ready plan contains both configure_preorder and define_field steps, cite both exact relevant step_N references on that one amendment.",
  "Always include both relevant configure_preorder and define_field step_N references when both categories appear in the validated ready plan, even for a long-answer question.",
  "Do not include a Field key, position, UUID, operation, or lifecycle instruction in a new-question amendment.",
  "Never invent Field keys, positions, IDs, allocations, Business or actor identity, currentness, complete configuration or M5 operations.",
  "Never output SQL, source code, tools, HTTP, Records, Locations, validation, application, publication or lifecycle instructions.",
  `Return exactly the registered schema-v${BUILDER_PREORDER_AMENDMENT_SCHEMA_VERSION} output.`,
].join(" ");

export const builderPreorderAmendmentTaskInputSchema =
  builderPreorderAmendmentTaskInputBaseSchema.superRefine((input, context) => {
    try {
      validateBuilderPreorderAmendmentInput(input);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The ready preorder amendment plan is not valid.",
      });
    }
  });

export const builderPreorderAmendmentTaskV1 = Object.freeze({
  key: "builder_preorder_amendment_v1",
  version: 1,
  purposeLabel: "Draft bounded preorder amendment intent",
  policyKey: BUILDER_PREORDER_AMENDMENT_DISABLED_POLICY_KEY,
  inputSchema: builderPreorderAmendmentTaskInputSchema,
  outputSchema: builderPreorderAmendmentOutputSchema,
  buildInstruction: () => BUILDER_PREORDER_AMENDMENT_INSTRUCTION,
  validateOutput: validateBuilderPreorderAmendmentOutput,
}) satisfies RegisteredAiTask<
  typeof builderPreorderAmendmentTaskInputSchema,
  typeof builderPreorderAmendmentOutputSchema
>;
