import type { RegisteredAiTask } from "../contracts";
import { builderPlanOutputSchema, builderPlanTaskInputSchema } from "./schemas";
import { validateBuilderPlanOutput } from "./validation";

export const BUILDER_PLANNING_INSTRUCTION = [
  "Interpret the owner's bounded request in ordinary Business language.",
  "Use only capabilities and existing references declared in business_context.",
  "Return exactly one schema-v1 clarification result or ready owner-readable plan.",
  "Distinguish configuration steps from operational steps and preserve their dependencies.",
  "Prefer a clarification question over a high-impact unsupported or unresolved assumption.",
  "Surface workflows, rules, payments, inventory, integrations, arbitrary code, and every other unavailable capability explicitly; never pretend they exist.",
  "Never produce SQL, source code, HTTP requests, tool calls, executable workflows, executable rules, or arbitrary code.",
  "This task must not produce Milestone 5 operations, candidates, proposals, validation, application, publication, or runtime mutations.",
  "Never invent an existing Object key or Location reference.",
  "New concepts use plan-local references only and receive no UUID or trusted platform key.",
  "Every ready-plan step is proposed planning only and requires later owner confirmation.",
].join(" ");

export const builderPlanTaskV1 = Object.freeze({
  key: "builder_plan_v1",
  version: 1,
  purposeLabel: "Plan a bounded Business request",
  policyKey: "builder_planning_v1",
  inputSchema: builderPlanTaskInputSchema,
  outputSchema: builderPlanOutputSchema,
  buildInstruction: () => BUILDER_PLANNING_INSTRUCTION,
  validateOutput: validateBuilderPlanOutput,
}) satisfies RegisteredAiTask<
  typeof builderPlanTaskInputSchema,
  typeof builderPlanOutputSchema
>;
