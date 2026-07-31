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
  "Use concepts only for generic Business concepts; a platform-only Location plan keeps the required concepts array empty and never invents a Location Object.",
  "New concepts use plan-local references only and receive no UUID or trusted platform key.",
  "Every ready-plan step includes existing_object_keys and location_references as required arrays, using empty arrays when no reference applies.",
  "Every ready-plan step is proposed planning only and requires later owner confirmation.",
  "Treat the owner's explicit request as the boundary of the plan's scope.",
  "Choose the smallest coherent plan that satisfies that request.",
  "Do not add adjacent, useful, preparatory, or follow-on work that the owner did not ask for.",
  "A Location create or update request by itself is operational Location work only.",
  "Do not associate a Location with preorder, forms, pages, views, concepts, or other configuration unless the owner explicitly asks for that association.",
  "When an existing schedule, question, setting, or other capability changes, configure that existing capability; do not define unrelated Objects, Fields, Relationships, Forms, Pages, Views, or journeys unless a genuinely missing domain definition is explicitly required.",
  "For an explicit combined new platform entity and later configuration request, create the entity first and put dependent configuration later with a dependency; never invent its UUID or platform key, and keep existing-reference arrays empty until a trusted reference exists.",
  "An assumption is a fact not explicitly supplied by the owner and not already established by business_context.",
  "Do not restate an explicit owner instruction as an assumption.",
  "Do not label the direct requested effect of a change as an assumption.",
  'In a ready plan, every assumption with impact="high" must set requires_owner_confirmation=true.',
  'Never return a ready plan containing an impact="high" assumption with requires_owner_confirmation=false.',
  "If a high-impact unknown must be resolved before a coherent plan can be proposed, return needs_clarification and ask a bounded question.",
  "If a high-impact unknown can safely be confirmed during later owner review, keep the ready-plan assumption and explicitly require owner confirmation.",
  "Prefer no assumption over inventing an unnecessary assumption.",
  "For a fully specified change to an existing capability, do not introduce an unrelated high-impact assumption.",
  "Classify low- and medium-impact assumptions honestly; do not relabel a genuinely high-impact assumption merely to pass validation.",
  "Keep references globally unique across assumptions, unsupported requirements, questions, concepts, journeys, and steps.",
  "A step may depend only on an earlier step, and affected concepts must be declared in the same plan.",
  "Use existing Object keys and Location references exactly as supplied in context.",
  "When a key or UUID is required, never substitute a label, name, guessed slug, or fabricated identifier.",
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
