import { builderConfigurationDraftTaskV1 } from "../../configuration-drafting/task";
import { BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY } from "../../policies";

/**
 * The qualification task is deliberately not registered. It reuses the
 * production drafting subject and changes only the evaluation policy key.
 */
export function createBuilderConfigurationDraftingEvaluationTask() {
  return Object.freeze({
    ...builderConfigurationDraftTaskV1,
    policyKey: BUILDER_CONFIGURATION_DRAFTING_TERRA_MEDIUM_POLICY_KEY,
  });
}
