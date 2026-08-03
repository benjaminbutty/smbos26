"use server";

import type { BuilderUiState } from "../../../../components/builder-ui-state";
import { createBuilderAction } from "./action-service";

const executeBuilderAction = createBuilderAction();

export async function runBuilderAction(
  businessSlugInput: string,
  _previousState: BuilderUiState,
  formData: FormData,
): Promise<BuilderUiState> {
  return executeBuilderAction(businessSlugInput, _previousState, formData);
}
