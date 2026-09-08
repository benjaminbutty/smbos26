import type { PageLayout } from "../../core/experience/schemas";

export interface PageDraft {
  layout: PageLayout;
  title: string;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function pageDraftEquals(left: PageDraft, right: PageDraft): boolean {
  return (
    left.title.trim() === right.title.trim() &&
    stableSerialize(left.layout) === stableSerialize(right.layout)
  );
}

export function pageLayoutEquals(left: PageLayout, right: PageLayout): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

/**
 * Keep the live Tiptap document when a route refresh reflects the same
 * acknowledged Page and the editor already contains that document. Calling
 * setContent for this no-op refresh would move the caret and reset undo
 * history; a different canonical document still needs to be applied.
 */
export function shouldPreserveEditorDocument(input: {
  acknowledged: PageDraft;
  editor: PageDraft | null;
  latest: PageDraft;
}): boolean {
  return (
    pageDraftEquals(input.latest, input.acknowledged) &&
    input.editor !== null &&
    pageDraftEquals(input.editor, input.latest)
  );
}

export interface PageSaveAcknowledgement {
  acknowledged: PageDraft;
  candidate: PageDraft;
  candidateIsCurrent: boolean;
  preserveLocalCandidate: boolean;
}

/**
 * Resolve an immutable save response against the editor's latest candidate.
 * The revision and envelope identity travel together so a title-only edit is
 * treated exactly like a body edit. A newer candidate stays local while the
 * response still advances the acknowledged baseline.
 */
export function resolvePageSaveAcknowledgement(input: {
  candidateAtRequest: PageDraft;
  canonical: PageDraft;
  latestCandidate: PageDraft;
  latestRevision: number;
  requestRevision: number;
}): PageSaveAcknowledgement {
  const candidateIsCurrent =
    input.latestRevision === input.requestRevision &&
    input.latestCandidate === input.candidateAtRequest;
  const latestMatchesCanonical = pageDraftEquals(
    input.latestCandidate,
    input.canonical,
  );
  const preserveLocalCandidate = !candidateIsCurrent && !latestMatchesCanonical;
  return {
    acknowledged: input.canonical,
    candidate: preserveLocalCandidate ? input.latestCandidate : input.canonical,
    candidateIsCurrent,
    preserveLocalCandidate,
  };
}
