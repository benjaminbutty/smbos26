import "server-only";

import { z } from "zod";

import type { RegisteredAiTask } from "../contracts";
import {
  BUILDER_CONFIGURATION_DRAFT_SCHEMA_VERSION,
  builderConfigurationDraftOutputSchema,
  builderConfigurationDraftTaskInputBaseSchema,
} from "./schemas";
import {
  validateConfigurationDraftInput,
  validateConfigurationDraftOutput,
} from "./validation";
import { BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY } from "../policies";

export const BUILDER_CONFIGURATION_DRAFT_INSTRUCTION = [
  "Use the validated ready plan and owner request as the complete scope for this draft.",
  "Produce the smallest coherent additive configuration draft and do not add useful adjacent work.",
  "Represent only Objects, Fields, Relationships, Views, Forms and Pages.",
  "Use exact existing Object, Field, View and Form keys from business_context.",
  "Use a correctly prefixed local draft reference for every new definition.",
  "Never invent database IDs, trusted stable keys, positions, allocations or currentness values.",
  "Never output SQL, source code, HTTP, tools, function calls or executable instructions.",
  "Never output Milestone 5 set_* operations, a candidate, proposal, validation result, Apply or Publish instruction.",
  "Never describe operational Records, Relationship edges, Record-to-Location links or Locations.",
  "Never draft configure_preorder or any other operational category in v1.",
  "Do not describe updates, archival, deactivation, restoration, deletion or Field type changes.",
  "Cover every configuration step from the ready plan and cite its exact step_N reference.",
  "A public Form or Page is configuration design intent only; do not claim that it is executable or published.",
  "A Relationship is definition intent only and does not create operational Relationship edges.",
  `Return exactly the registered schema-v${BUILDER_CONFIGURATION_DRAFT_SCHEMA_VERSION} output with every collection present.`,
].join(" ");

/**
 * The normal execution-core input parse includes the ready-plan semantic gate.
 * The base schema remains exported separately so the pure validator can parse
 * the untrusted value without recursing through this refinement.
 */
export const builderConfigurationDraftTaskInputSchema =
  builderConfigurationDraftTaskInputBaseSchema.superRefine((input, context) => {
    try {
      validateConfigurationDraftInput(input);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The ready configuration plan is not valid.",
      });
    }
  });

export const builderConfigurationDraftTaskV1 = Object.freeze({
  key: "builder_configuration_draft_v1",
  version: 1,
  purposeLabel: "Draft bounded additive configuration intent",
  policyKey: BUILDER_CONFIGURATION_DRAFTING_DISABLED_POLICY_KEY,
  inputSchema: builderConfigurationDraftTaskInputSchema,
  outputSchema: builderConfigurationDraftOutputSchema,
  buildInstruction: () => BUILDER_CONFIGURATION_DRAFT_INSTRUCTION,
  validateOutput: validateConfigurationDraftOutput,
}) satisfies RegisteredAiTask<
  typeof builderConfigurationDraftTaskInputSchema,
  typeof builderConfigurationDraftOutputSchema
>;
