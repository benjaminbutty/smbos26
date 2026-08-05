import "server-only";

import { z } from "zod";

import type { RegisteredAiTask } from "../contracts";
import { BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY } from "../policies";
import {
  BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION,
  builderRecordCreationIntentOutputSchema,
  builderRecordCreationIntentTaskInputSchema,
} from "./schemas";
import {
  validateBuilderRecordCreationIntentInput,
  validateBuilderRecordCreationIntentOutput,
} from "./validation";

export const BUILDER_RECORD_CREATION_INTENT_INSTRUCTION = [
  "Return only one semantic intent for one new generic Record in the exact validated ready plan.",
  "The plan must contain exactly one existing concept and exactly one operational create_initial_record step with its exact Object key and no dependencies, Location references, configuration work or unsupported requirements.",
  "Use only exact existing Object and Field keys present in the supplied configuration context. Do not invent new keys, UUIDs, IDs, defaults, Records, relationships or mutation authority.",
  "Use the exact existing Object key from the plan and only return Field values explicitly supplied by the owner in owner_request.",
  "Omit a Field with a configured default when the owner did not explicitly supply a value for it. If the owner explicitly supplied a value for that configured Field, return that exact value. Do not request, expose or invent a hidden default value; the deterministic server will apply that configured default after validation.",
  "Do not output or choose the platform-owned Record lifecycle value record_status.",
  "A normal configured Field whose field_type is status may be returned only when the owner explicitly supplied one of its configured options.",
  "Do not output File Fields, Relationships, Location links, database data, currentness, tokens, SQL, source code, HTTP, tools or execution instructions.",
  "Copy configured select/status options exactly and return only configured options; return multi-select values without duplicates.",
  "Datetime values must include an explicit Z or numeric offset. Use the registered strict discriminated Field-value schema.",
  "If a required owner-supplied value is missing or ambiguous, return needs_clarification instead of inventing it.",
  `Return exactly the registered schema-v${BUILDER_RECORD_CREATION_INTENT_SCHEMA_VERSION} output and cite the one exact source step reference.`,
].join(" ");

export const builderRecordCreationIntentTaskInputWithSemanticValidationSchema =
  builderRecordCreationIntentTaskInputSchema.superRefine((input, context) => {
    try {
      validateBuilderRecordCreationIntentInput(input);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Record creation intent input is not valid.",
      });
    }
  });

export const builderRecordCreationIntentTaskV1 = Object.freeze({
  key: "builder_record_creation_intent_v1",
  version: 1,
  purposeLabel: "Draft one bounded generic Record creation intent",
  policyKey: BUILDER_RECORD_CREATION_INTENT_DISABLED_POLICY_KEY,
  inputSchema: builderRecordCreationIntentTaskInputWithSemanticValidationSchema,
  outputSchema: builderRecordCreationIntentOutputSchema,
  buildInstruction: () => BUILDER_RECORD_CREATION_INTENT_INSTRUCTION,
  validateOutput: validateBuilderRecordCreationIntentOutput,
}) satisfies RegisteredAiTask<
  typeof builderRecordCreationIntentTaskInputWithSemanticValidationSchema,
  typeof builderRecordCreationIntentOutputSchema
>;
