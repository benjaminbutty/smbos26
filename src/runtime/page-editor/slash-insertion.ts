export interface SlashInsertionRangeInput {
  query: string;
  requestedFrom?: number;
  requestedTo?: number;
  documentSize: number;
  textBetween: (from: number, to: number) => string;
}

/**
 * A slash menu is rendered outside Tiptap, so an autosave reconciliation can
 * update the document between opening the menu and choosing a block. Replace
 * the typed command only while its saved range still names that command.
 * Dismiss a stale menu instead of applying the choice at an unrelated live
 * selection, which could otherwise replace an owner's selected text.
 */
export function resolveSlashInsertionRange({
  documentSize,
  query,
  requestedFrom,
  requestedTo,
  textBetween,
}: SlashInsertionRangeInput): { from: number; to: number } | null {
  const rangeIsInDocument =
    typeof requestedFrom === "number" &&
    typeof requestedTo === "number" &&
    requestedFrom >= 0 &&
    requestedTo >= requestedFrom &&
    requestedTo <= documentSize;

  if (
    rangeIsInDocument &&
    textBetween(requestedFrom, requestedTo) === `/${query}`
  ) {
    return { from: requestedFrom, to: requestedTo };
  }

  return null;
}
