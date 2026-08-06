import "server-only";

import { z } from "zod";

import type { RegisteredAiTask } from "../contracts";
import { BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY } from "../policies";
import {
  BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION,
  builderRecordUpdateIntentOutputSchema,
  builderRecordUpdateIntentTaskInputSchema,
} from "./schemas";
import {
  validateBuilderRecordUpdateIntentInput,
  validateBuilderRecordUpdateIntentOutput,
} from "./validation";

export const BUILDER_RECORD_UPDATE_INTENT_INSTRUCTION = [
  "Return exactly one bounded semantic intent for one existing generic Record update in the supplied ready plan.",
  "The plan must contain exactly one existing concept and exactly one operational update_record step with one exact existing Object key, no dependencies, no Location references, no configuration work and no unsupported requirements.",
  "Use only exact Object and Field keys and configured option spellings from the supplied Business context. Never invent IDs, UUIDs, Records, current values, defaults or mutation authority.",
  "Return one to three exact AND selector clauses using only short_text, email, phone, url, number, currency, boolean, date, datetime, select or status. Selector values must be explicit current values stated by the owner.",
  "Return one to five explicit absolute Field updates using the unchanged registered Record Field-value schema. A selector Field may also be updated, but the new value must differ semantically from its selector value.",
  "Do not output File Fields, record_status, null, clear/delete actions, arithmetic, relative values, relationships, locations, configuration operations, candidate Records, Record IDs, SQL, RPC names, tools, tokens or execution instructions.",
  "Copy configured select/status options exactly and return only configured options; return multi-select values without duplicates.",
  "Datetime values must include an explicit Z or numeric offset. Relative, inferred, latest, same-as, arithmetic or missing values require needs_clarification.",
  "If the owner did not supply both an exact current selector and an explicit absolute new value, return one bounded owner-readable needs_clarification question.",
  `Return exactly the registered schema-v${BUILDER_RECORD_UPDATE_INTENT_SCHEMA_VERSION} output and cite the one exact source step reference.`,
].join(" ");

export const builderRecordUpdateIntentTaskInputWithSemanticValidationSchema =
  builderRecordUpdateIntentTaskInputSchema.superRefine((input, context) => {
    try {
      validateBuilderRecordUpdateIntentInput(input);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Record update intent input is not valid.",
      });
    }
  });

export const builderRecordUpdateIntentTaskV1 = Object.freeze({
  key: "builder_record_update_intent_v1",
  version: 1,
  purposeLabel: "Draft one bounded generic Record update intent",
  policyKey: BUILDER_RECORD_UPDATE_INTENT_DISABLED_POLICY_KEY,
  inputSchema: builderRecordUpdateIntentTaskInputWithSemanticValidationSchema,
  outputSchema: builderRecordUpdateIntentOutputSchema,
  buildInstruction: () => BUILDER_RECORD_UPDATE_INTENT_INSTRUCTION,
  validateOutput: validateBuilderRecordUpdateIntentOutput,
}) satisfies RegisteredAiTask<
  typeof builderRecordUpdateIntentTaskInputWithSemanticValidationSchema,
  typeof builderRecordUpdateIntentOutputSchema
>;
