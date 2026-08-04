import "server-only";

import { z } from "zod";

import type { RegisteredAiTask } from "../contracts";
import { BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY } from "../policies";
import {
  BUILDER_LOCATION_CREATION_INTENT_SCHEMA_VERSION,
  builderLocationCreationIntentOutputSchema,
  builderLocationCreationIntentTaskInputSchema,
} from "./schemas";
import {
  validateBuilderLocationCreationIntentInput,
  validateBuilderLocationCreationIntentOutput,
} from "./validation";

export const BUILDER_LOCATION_CREATION_INTENT_INSTRUCTION = [
  "Return only a semantic Location creation intent for the exact validated ready plan.",
  "The plan must contain exactly one operational create_location step and no concepts, journeys, assumptions, dependencies, affected concepts, existing Object keys or Location references.",
  "Copy the exact owner-stated Location name; never invent or generalise it.",
  "Return a short owner-readable summary of this one Location request.",
  "Return timezone_intent {kind: use_business_timezone} when the owner did not state one exact valid IANA timezone and the request contains no timezone ambiguity.",
  "Return timezone_intent {kind: explicit_timezone, timezone: exact IANA value} only when the owner stated one exact valid IANA timezone, copied character-for-character.",
  "If the request explicitly asks for a local, different or otherwise overridden timezone without an exact valid IANA timezone, return needs_clarification.",
  "Never infer a timezone from geographic wording, an address or a name.",
  "Never output IDs, UUIDs, slugs, Business identity, actor identity, currentness, tokens, SQL, source code, HTTP, tools or execution instructions.",
  `Return exactly the registered schema-v${BUILDER_LOCATION_CREATION_INTENT_SCHEMA_VERSION} output and cite the one exact source step reference.`,
].join(" ");

export const builderLocationCreationIntentTaskInputWithSemanticValidationSchema =
  builderLocationCreationIntentTaskInputSchema.superRefine((input, context) => {
    try {
      validateBuilderLocationCreationIntentInput(input);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Location creation intent input is not valid.",
      });
    }
  });

export const builderLocationCreationIntentTaskV1 = Object.freeze({
  key: "builder_location_creation_intent_v1",
  version: 1,
  purposeLabel: "Draft one bounded Location creation intent",
  policyKey: BUILDER_LOCATION_CREATION_DISABLED_POLICY_KEY,
  inputSchema:
    builderLocationCreationIntentTaskInputWithSemanticValidationSchema,
  outputSchema: builderLocationCreationIntentOutputSchema,
  buildInstruction: () => BUILDER_LOCATION_CREATION_INTENT_INSTRUCTION,
  validateOutput: validateBuilderLocationCreationIntentOutput,
}) satisfies RegisteredAiTask<
  typeof builderLocationCreationIntentTaskInputWithSemanticValidationSchema,
  typeof builderLocationCreationIntentOutputSchema
>;
