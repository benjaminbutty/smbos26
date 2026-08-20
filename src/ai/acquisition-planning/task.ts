import "server-only";

import type { RegisteredAiTask } from "../contracts";
import {
  ACQUISITION_PLANNING_POLICY_KEY,
  ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
} from "../policies";
import {
  acquisitionPlanningInputSchema,
  acquisitionPlanningOutputSchema,
  acquisitionRequiredIdentityCorrectionInputSchema,
  acquisitionRequiredIdentityCorrectionOutputSchema,
} from "./schemas";
import { validateAcquisitionPlanningOutput } from "./validation";

/** Rules owned by Lenni and never attributed to the owner request. */
export const ACQUISITION_SERVER_OWNED_PLANNING_CONTRACT = [
  "Server-owned planning contract: preserve every explicit reusable business concept in the owner request.",
  "Connected identity belongs on the business area that owns it; do not duplicate connected identity or contact information as scalar Fields on a related area.",
  "Represent reusable business concepts through Connections.",
  "When quantity varies between a reusable Product or item and a transaction, use an item or line structure rather than putting quantity on the reusable concept.",
  "Keep unsupported actions as unsupported requirements.",
  "Return the smallest coherent workspace satisfying both the owner request and this server-owned contract.",
].join(" ");

export const ACQUISITION_PLANNING_INSTRUCTION = [
  "Interpret one anonymous owner's business description into the smallest coherent internal operating workspace.",
  "The category is a context hint only; the description determines the proposed business areas.",
  "Return needs_more_detail only when a safe useful internal workspace cannot be inferred; ask for one concise revised description, not a conversation.",
  "A clear business type plus a clear operational problem such as bookings, jobs, orders, deliveries, enquiries or product tracking is normally enough to infer a safe minimal internal workspace. Do not return needs_more_detail merely because the owner has not specified exact Fields, statuses, services, scheduling rules, staff processes or other implementation details. Keep uncertain extras out and propose the smallest useful internal starting point.",
  "For a ready result, describe no more than six reusable business areas, their important information and ordinary-language connections. Prefer fewer.",
  "For one_to_many connections, source_table_reference is the ONE side and target_table_reference is the MANY side. Choose source and target so the Relationship reflects the real business meaning: one Customer can have several Jobs means Customer is source and Job is target.",
  "For one_to_one connections, both sides permit one; keep the direction aligned with the clearest ordinary business phrasing. For many_to_many connections, both sides permit several; keep the direction stable and coherent even though the one/many meaning is symmetric.",
  "When two reusable business areas are connected, keep identity and contact information on the business area it belongs to and use the Connection to represent the relationship.",
  "Do not repeat related names, email addresses, phone numbers, addresses, contact identities or equivalent relationship identity as ordinary information on the other connected business area unless the owner explicitly described genuinely distinct information.",
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
  ACQUISITION_SERVER_OWNED_PLANNING_CONTRACT,
].join(" ");

export const ACQUISITION_REQUIRED_IDENTITY_REPAIR_INSTRUCTION = [
  "This dedicated task is the one permitted scoped correction after the exact server-side trigger: cross_object_field_leakage plus recovery refusal required_field.",
  "The input is a server-owned repair manifest, not an owner request and not a rejected model response.",
  "Return only the smallest Field-layer repair: choose one or more existing Field references from affected_fields to remove.",
  "Do not add, rename or edit Fields; do not change requiredness; do not add or remove business areas, Connections or unsupported requirements; do not change cardinality; do not broaden scope.",
  "Keep legitimate richer Fields that are not listed in affected_fields.",
  "Never return a complete plan, needs_more_detail, operational Records, sample data, configuration operations, Apply or Publish instructions.",
  ACQUISITION_SERVER_OWNED_PLANNING_CONTRACT,
].join(" ");

// Compatibility export for existing boundary fixtures; the correction task
// now uses the scoped repair contract above rather than a complete replan.
export const ACQUISITION_REQUIRED_IDENTITY_REPLAN_INSTRUCTION =
  ACQUISITION_REQUIRED_IDENTITY_REPAIR_INSTRUCTION;

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

export const acquisitionRequiredIdentityCorrectionTaskV1 = Object.freeze({
  key: "acquisition_required_identity_correction_v1",
  version: 1,
  purposeLabel: "Repair one bounded required identity Field representation",
  policyKey: ACQUISITION_REQUIRED_IDENTITY_CORRECTION_POLICY_KEY,
  inputSchema: acquisitionRequiredIdentityCorrectionInputSchema,
  outputSchema: acquisitionRequiredIdentityCorrectionOutputSchema,
  buildInstruction: () => ACQUISITION_REQUIRED_IDENTITY_REPAIR_INSTRUCTION,
}) satisfies RegisteredAiTask<
  typeof acquisitionRequiredIdentityCorrectionInputSchema,
  typeof acquisitionRequiredIdentityCorrectionOutputSchema
>;
