export interface ChecklistFormState {
  afterBlockId?: string | null | undefined;
  completedField?: string | undefined;
  containerBlockId?: string | undefined;
  labelField?: string | undefined;
  mode: "create" | "existing";
  name: string;
  readOnly?: boolean | undefined;
  viewKey?: string | undefined;
}

/**
 * Switch the checklist chooser mode while keeping the insertion context that
 * was captured when the slash command opened it. Mode-specific field choices
 * are intentionally reset so a new chooser cannot submit stale mappings.
 */
export function checklistFormForMode(
  value: ChecklistFormState,
  mode: ChecklistFormState["mode"],
): ChecklistFormState {
  return {
    ...(value.afterBlockId !== undefined
      ? { afterBlockId: value.afterBlockId }
      : {}),
    ...(value.containerBlockId
      ? { containerBlockId: value.containerBlockId }
      : {}),
    mode,
    name: "",
  };
}
