import { describe, expect, it } from "vitest";

import type { PageLayout } from "../src/core/experience/schemas";
import {
  pageDraftEquals,
  resolvePageSaveAcknowledgement,
  shouldPreserveEditorDocument,
  type PageDraft,
} from "../src/runtime/page-editor/page-draft-state";
import { SerialSaveCoordinator } from "../src/runtime/page-editor/save-coordinator";

function layout(text: string): PageLayout {
  return { blocks: [{ type: "text", text }] };
}

function draft(title: string, body: string): PageDraft {
  return { layout: layout(body), title };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("Internal Page draft and save integration", () => {
  it("preserves the live editor document only for an equal canonical refresh", () => {
    const acknowledged = draft("Opening guide", "Opening note");

    expect(
      shouldPreserveEditorDocument({
        acknowledged,
        editor: acknowledged,
        latest: acknowledged,
      }),
    ).toBe(true);
    expect(
      shouldPreserveEditorDocument({
        acknowledged,
        editor: acknowledged,
        latest: draft("Opening guide", "Server edit"),
      }),
    ).toBe(false);
    expect(
      shouldPreserveEditorDocument({
        acknowledged,
        editor: draft("Opening guide", "Local edit"),
        latest: acknowledged,
      }),
    ).toBe(false);
    expect(
      shouldPreserveEditorDocument({
        acknowledged,
        editor: null,
        latest: acknowledged,
      }),
    ).toBe(false);
  });

  it("acknowledges a title-only save for Reading and lifecycle operations", async () => {
    const initial = draft("Untitled page", "Opening note");
    const acknowledgements: ReturnType<
      typeof resolvePageSaveAcknowledgement
    >[] = [];
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: initial,
      save: async ({ candidate, revision }) => {
        const canonical = { ...candidate };
        acknowledgements.push(
          resolvePageSaveAcknowledgement({
            candidateAtRequest: candidate,
            canonical,
            latestCandidate: coordinator.candidate,
            latestRevision: coordinator.state.revision,
            requestRevision: revision,
          }),
        );
        return { canonical, status: "success" };
      },
    });

    coordinator.update(draft("Parent review temporary", "Opening note"));
    await coordinator.flush();

    expect(acknowledgements[0]).toMatchObject({
      candidateIsCurrent: true,
      preserveLocalCandidate: false,
      acknowledged: {
        title: "Parent review temporary",
      },
    });
    expect(coordinator.candidate.title).toBe("Parent review temporary");
    expect(coordinator.state.status).toBe("saved");
    expect(coordinator.hasUnacknowledgedWork).toBe(false);

    // Reading and lifecycle actions consume the same acknowledged candidate;
    // a title save must not leave either path with the old title.
    expect(coordinator.candidate.title).toBe("Parent review temporary");
    expect(
      pageDraftEquals(coordinator.candidate, {
        title: "Parent review temporary",
        layout: layout("Opening note"),
      }),
    ).toBe(true);
  });

  it("acknowledges a title and body save together", async () => {
    const initial = draft("Untitled page", "Opening note");
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: initial,
      save: async ({ candidate, revision }) => {
        const resolution = resolvePageSaveAcknowledgement({
          candidateAtRequest: candidate,
          canonical: candidate,
          latestCandidate: coordinator.candidate,
          latestRevision: coordinator.state.revision,
          requestRevision: revision,
        });
        expect(resolution.candidateIsCurrent).toBe(true);
        return { canonical: resolution.acknowledged, status: "success" };
      },
    });

    coordinator.update(draft("Opening guide", "Updated procedure"));
    await coordinator.flush();

    expect(coordinator.candidate).toEqual(
      draft("Opening guide", "Updated procedure"),
    );
    expect(coordinator.state.status).toBe("saved");
    expect(coordinator.hasUnacknowledgedWork).toBe(false);
  });

  it("preserves a later title/body candidate while acknowledging the request", async () => {
    const initial = draft("Untitled page", "Opening note");
    const first = deferred<{
      canonical: PageDraft;
      status: "success";
    }>();
    const requests: PageDraft[] = [];
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: initial,
      save: async ({ candidate }) => {
        requests.push(candidate);
        if (requests.length === 1) return first.promise;
        return { canonical: candidate, status: "success" };
      },
    });

    const firstCandidate = draft("Opening guide", "Opening note");
    const laterCandidate = draft("Opening guide", "Updated procedure");
    coordinator.update(firstCandidate);
    const flush = coordinator.flush();
    await Promise.resolve();
    coordinator.update(laterCandidate);
    const acknowledgement = resolvePageSaveAcknowledgement({
      candidateAtRequest: firstCandidate,
      canonical: firstCandidate,
      latestCandidate: coordinator.candidate,
      latestRevision: coordinator.state.revision,
      requestRevision: 1,
    });
    expect(acknowledgement).toMatchObject({
      acknowledged: firstCandidate,
      candidate: laterCandidate,
      candidateIsCurrent: false,
      preserveLocalCandidate: true,
    });
    first.resolve({ canonical: firstCandidate, status: "success" });
    await flush;

    expect(requests).toEqual([firstCandidate, laterCandidate]);
    expect(coordinator.candidate).toEqual(laterCandidate);
    expect(coordinator.state.status).toBe("saved");
    expect(coordinator.hasUnacknowledgedWork).toBe(false);
  });

  it("returns to Saved for edit then undo before debounce and after a rejection", async () => {
    const initial = draft("Opening guide", "Opening note");
    let attempts = 0;
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: initial,
      save: async () => {
        attempts += 1;
        return { message: "offline", status: "error" };
      },
    });

    coordinator.update(draft("Opening guide", "Changed temporarily"));
    coordinator.update(initial);
    expect(attempts).toBe(0);
    expect(coordinator.state.status).toBe("saved");
    expect(coordinator.hasUnacknowledgedWork).toBe(false);

    coordinator.update(draft("Opening guide", "Changed and rejected"));
    await coordinator.flush();
    expect(attempts).toBe(1);
    expect(coordinator.state.status).toBe("error");

    coordinator.update(initial);
    expect(coordinator.state.status).toBe("saved");
    expect(coordinator.hasUnacknowledgedWork).toBe(false);
    expect(attempts).toBe(1);
  });

  it("keeps the same coordinator state when route data is refreshed during a save", async () => {
    const initial = draft("Opening guide", "Opening note");
    const first = deferred<{
      canonical: PageDraft;
      status: "success";
    }>();
    const requests: PageDraft[] = [];
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: initial,
      save: async ({ candidate }) => {
        requests.push(candidate);
        return requests.length === 1
          ? first.promise
          : { canonical: candidate, status: "success" };
      },
    });

    const pending = draft("Opening guide", "Pending save");
    coordinator.update(pending);
    const flush = coordinator.flush();
    await Promise.resolve();
    const stateDuringRequest = coordinator.state;

    // A route refresh changes its layout object, but the editor lifetime keeps
    // this coordinator (and therefore its in-flight request) intact.
    const refreshedLayout = layout("Server route refresh");
    expect(refreshedLayout).not.toBe(pending.layout);
    expect(coordinator.state).toEqual(stateDuringRequest);
    expect(coordinator.inFlight).toBe(true);

    first.resolve({ canonical: pending, status: "success" });
    await flush;
    expect(requests).toEqual([pending]);
    expect(coordinator.state.status).toBe("saved");
  });

  it("does not resume blocked work when route data is refreshed after an error", async () => {
    const initial = draft("Opening guide", "Opening note");
    let attempts = 0;
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: initial,
      save: async () => {
        attempts += 1;
        return { message: "offline", status: "error" };
      },
    });

    coordinator.update(draft("Opening guide", "Pending save"));
    await coordinator.flush();
    expect(attempts).toBe(1);
    expect(coordinator.state.status).toBe("error");

    // A server route refresh supplies a new layout object, but it must not
    // replace this editor-lifetime coordinator and silently retry the failed
    // candidate. The explicit retry action remains the only restart path.
    const refreshedLayout = layout("Server route refresh");
    expect(refreshedLayout).not.toBe(coordinator.candidate.layout);
    await Promise.resolve();
    expect(attempts).toBe(1);
    expect(coordinator.state.status).toBe("error");
    expect(coordinator.hasUnacknowledgedWork).toBe(true);
  });

  it("keeps a competing Page edit blocked across a route refresh", async () => {
    const initial = draft("Opening guide", "Opening note");
    let attempts = 0;
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: initial,
      save: async () => {
        attempts += 1;
        return { message: "This Page changed elsewhere", status: "stale" };
      },
    });

    coordinator.update(draft("Opening guide", "Competing edit"));
    await coordinator.flush();
    expect(attempts).toBe(1);
    expect(coordinator.state.status).toBe("stale");

    const refreshedLayout = layout("Competing server edit");
    expect(refreshedLayout).not.toBe(coordinator.candidate.layout);
    await Promise.resolve();
    expect(attempts).toBe(1);
    expect(coordinator.state.status).toBe("stale");
    expect(coordinator.hasUnacknowledgedWork).toBe(true);
  });

  it("does not apply a response after a route conflict invalidates its request", async () => {
    const initial = draft("Opening guide", "Opening note");
    const first = deferred<{
      canonical: PageDraft;
      status: "success";
    }>();
    const applied: PageDraft[] = [];
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: initial,
      save: async ({ candidate, requestId }) => {
        const result = await first.promise;
        if (coordinator.isRequestActive(requestId)) applied.push(candidate);
        return result;
      },
    });

    const pending = draft("Opening guide", "Pending save");
    coordinator.update(pending);
    const flush = coordinator.flush();
    await Promise.resolve();
    expect(coordinator.inFlight).toBe(true);

    // The route reconciliation blocks the request while its action is still
    // waiting. Its eventual response must not update the editor baseline.
    coordinator.block("stale");
    first.resolve({ canonical: pending, status: "success" });
    await flush;

    expect(applied).toEqual([]);
    expect(coordinator.state.status).toBe("stale");
    expect(coordinator.candidate).toEqual(pending);
  });
});
