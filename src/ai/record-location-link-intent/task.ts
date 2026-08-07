import "server-only";

import { z } from "zod";

import type { RegisteredAiTask } from "../contracts";
import { BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY } from "../policies";
import {
  BUILDER_RECORD_LOCATION_LINK_INTENT_SCHEMA_VERSION,
  builderRecordLocationLinkIntentOutputSchema,
  builderRecordLocationLinkIntentTaskInputSchema,
} from "./schemas";
import {
  validateBuilderRecordLocationLinkIntentInput,
  validateBuilderRecordLocationLinkIntentOutput,
} from "./validation";

export const BUILDER_RECORD_LOCATION_LINK_INTENT_INSTRUCTION = [
  "Return exactly one bounded semantic intent for one existing generic Record's availability at one existing Location in the supplied ready plan.",
  "The plan must contain exactly one existing concept and one operational link_record_to_location step with one exact existing Object key, one exact Location reference, no dependencies, no journeys, no configuration work and no unsupported requirements.",
  "Interpret an explicit request to make or keep a Record available at a Location as link, and an explicit request that it should not be available or should be removed as unlink.",
  "Return one exact selector copied from the owner's request using the registered selector schema. Use only supported scalar Field types and configured select/status option spellings.",
  "Use the exact Object key and exact Location UUID reference from the supplied context and plan. Never invent Record IDs, candidate Records, current Record rows, link rows, SQL, RPCs, tokens, tools or mutation authority.",
  "A Location may be used in a ready intent only when it exists in the supplied Business context and is active. If the exact Location referenced by the ready plan is inactive, return needs_clarification and ask the owner to choose an active Location. Never substitute or invent another Location.",
  "If the action, exact selector value, Object, or Location is missing or ambiguous, return one owner-readable needs_clarification result.",
  `Return exactly the registered schema-v${BUILDER_RECORD_LOCATION_LINK_INTENT_SCHEMA_VERSION} output and cite the one exact source step reference.`,
].join(" ");

export const builderRecordLocationLinkIntentTaskInputWithSemanticValidationSchema =
  builderRecordLocationLinkIntentTaskInputSchema.superRefine(
    (input, context) => {
      try {
        validateBuilderRecordLocationLinkIntentInput(input);
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The Record availability intent input is not valid.",
        });
      }
    },
  );

export const builderRecordLocationLinkIntentTaskV1 = Object.freeze({
  key: "builder_record_location_link_intent_v1",
  version: 1,
  purposeLabel:
    "Draft one bounded generic Record-to-Location availability intent",
  policyKey: BUILDER_RECORD_LOCATION_LINK_INTENT_DISABLED_POLICY_KEY,
  inputSchema:
    builderRecordLocationLinkIntentTaskInputWithSemanticValidationSchema,
  outputSchema: builderRecordLocationLinkIntentOutputSchema,
  buildInstruction: () => BUILDER_RECORD_LOCATION_LINK_INTENT_INSTRUCTION,
  validateOutput: validateBuilderRecordLocationLinkIntentOutput,
}) satisfies RegisteredAiTask<
  typeof builderRecordLocationLinkIntentTaskInputWithSemanticValidationSchema,
  typeof builderRecordLocationLinkIntentOutputSchema
>;
