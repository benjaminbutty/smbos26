import "server-only";

import type { RegisteredAiTask } from "../contracts";
import { ACQUISITION_PLANNING_POLICY_KEY } from "../policies";
import {
  acquisitionPlanningInputSchema,
  acquisitionPlanningOutputSchema,
} from "./schemas";
import { validateAcquisitionPlanningOutput } from "./validation";

export const ACQUISITION_PLANNING_INSTRUCTION = [
  "Interpret one anonymous owner's business description into the smallest coherent internal operating workspace.",
  "The category is a context hint only; the description determines the proposed business areas.",
  "Return needs_more_detail only when a safe useful internal workspace cannot be inferred; ask for one concise revised description, not a conversation.",
  "For a ready result, describe no more than six reusable business areas, their important information and ordinary-language connections. Prefer fewer.",
  "For one_to_many connections, source_table_reference is the ONE side and target_table_reference is the MANY side. Choose source and target so the Relationship reflects the real business meaning: one Customer can have several Jobs means Customer is source and Job is target.",
  "For one_to_one connections, both sides permit one; keep the direction aligned with the clearest ordinary business phrasing. For many_to_many connections, both sides permit several; keep the direction stable and coherent even though the one/many meaning is symmetric.",
  "A salon must not receive Pets unless the description actually involves animals.",
  "Recurring deliveries should use reusable Customers and Products plus a standing or regular order structure; quantities belong on an item or line concept between Products and Orders.",
  "When the request explicitly names deliveries, include a reusable Deliveries or delivery-runs business area unless the request clearly names a more specific equivalent.",
  "For enquiry-led work, include reusable customer or prospective-client, enquiry or lead, and follow-up or next-action business areas when the request names those stages.",
  "Do not create or reference Locations. Routes, territories, addresses and regions are not Locations.",
  "Do not include operational Records or sample data.",
  "Do not claim payments, public booking, public generic forms, inventory automation, workflow automation, integrations, email or SMS automation, arbitrary code, availability engines, dashboards, analytics or customer portals.",
  "Put requested unavailable capabilities in unsupported_requirements and still plan the useful internal part.",
  "Do not create a currency Field when grounded_currency is null. If it is present, use only that exact currency later in drafting.",
  "Write understanding, why, labels and purposes in ordinary owner language without platform terms such as Object, Field, schema, UUID, JSON, database or cardinality.",
  "Use table_N references only to connect business areas and choose one primary business area; do not invent an Overview Page or generic schema documentation.",
  "Every business area needs useful information. Choice and status properties require options; other properties use null options. Currency is null unless grounded_currency supplies the exact currency.",
  "Never output SQL, code, tools, IDs, database access, configuration operations, Apply, Publish or mutation instructions.",
].join(" ");

export const acquisitionPlanningTaskV1 = Object.freeze({
  key: "acquisition_workspace_plan_v1",
  version: 1,
  purposeLabel: "Plan one anonymous starting workspace",
  policyKey: ACQUISITION_PLANNING_POLICY_KEY,
  inputSchema: acquisitionPlanningInputSchema,
  outputSchema: acquisitionPlanningOutputSchema,
  buildInstruction: () => ACQUISITION_PLANNING_INSTRUCTION,
  validateOutput: validateAcquisitionPlanningOutput,
}) satisfies RegisteredAiTask<
  typeof acquisitionPlanningInputSchema,
  typeof acquisitionPlanningOutputSchema
>;
