import { builderPreorderAmendmentTaskV1 } from "../../preorder-amendment/task";
import { BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY } from "../../policies";

export function createBuilderPreorderAmendmentEvaluationTask() {
  return Object.freeze({
    ...builderPreorderAmendmentTaskV1,
    policyKey: BUILDER_PREORDER_AMENDMENT_TERRA_MEDIUM_POLICY_KEY,
  });
}
