export type DirectTableEditorKeyAction =
  "cancel" | "commit" | "commit_next" | "commit_previous";

export function directTableEditorKeyAction(
  key: string,
  shiftKey = false,
): DirectTableEditorKeyAction | null {
  if (key === "Escape") return "cancel";
  if (key === "Enter") return "commit";
  if (key === "Tab") return shiftKey ? "commit_previous" : "commit_next";
  return null;
}

export function directTableCellNavigationTarget(
  key: string,
  recordIndex: number,
  fieldIndex: number,
): { recordIndex: number; fieldIndex: number } | null {
  switch (key) {
    case "ArrowDown":
      return { recordIndex: recordIndex + 1, fieldIndex };
    case "ArrowLeft":
      return { recordIndex, fieldIndex: fieldIndex - 1 };
    case "ArrowRight":
      return { recordIndex, fieldIndex: fieldIndex + 1 };
    case "ArrowUp":
      return { recordIndex: recordIndex - 1, fieldIndex };
    default:
      return null;
  }
}
