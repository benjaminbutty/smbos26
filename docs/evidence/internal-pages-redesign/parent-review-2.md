# Parent review 2 — editor integration corrections required

Reviewed implementation `ca0d6c9` and documentation head `70949b4` on 8 September 2026. Implementation CI passed; documentation-head CI was still running when inspected. Keep PR #75 unmerged. Readiness is not accepted yet.

## Findings

1. **P1: Title saves compare unrelated revision counters.** In `internal-page-editor.tsx:847`, `bodyRevisionRef.current` is compared with the save coordinator's `revision`. The former increments only in body `onUpdate`; the latter increments for every `noteCandidate`, including title changes. A title-only edit therefore has body revision 0 and request revision 1. Its successful acknowledgement skips `titleRef`, `title`, and title-draft reconciliation. Reading mode renders the old title; lifecycle operations can reject the already saved Page because titleDraft still differs from titleRef. Once a title edit offsets the counters, subsequent body-only acknowledgements also take the wrong branch. Use the same candidate/revision identity throughout and always update the acknowledged title baseline independently of preserving a newer local title. Add component-level or extracted integration tests covering title-only save, title plus body, typing during save, Reading, and lifecycle after rename.

2. **P2: Semantic undo/no-op leaves the UI permanently unsaved.** `noteCandidate` calls `coordinator.update` at line 547, which can synchronously publish `saved` when content returns to the acknowledged baseline. Lines 548–554 immediately overwrite it with `unsaved` whenever no request is in flight. No further save is scheduled for the no-op, so the indicator never recovers automatically. Drive status from the coordinator rather than overwriting its resolved state. Test edit → undo before debounce and rejected edit → undo back to baseline through the actual editor integration.

3. **P1: Route layout refresh replaces the serial coordinator.** The coordinator lifetime effect at lines 902–946 depends on `layout`. A server route refresh produces a new layout object and disposes/recreates the coordinator even while dirty/in flight. This discards blocked/revision/in-flight state, can resume a stopped failed candidate, and can overlap a new write with the disposed coordinator's still-running request. `performPageSave` also applies UI/ref side effects before the disposed coordinator can ignore its result. Keep one coordinator for the editor/Page lifetime; explicitly rebase/acknowledge route data without replacing it. Test a refreshed layout during a deferred request and during an error/conflict; no overlapping requests or automatic retry of blocked work.

## Independent evidence and remaining verification

- Parent reran five focused suites: save coordinator, block identities, direct Page service, media route and media maintenance. All 25 tests passed. These tests do not disprove the integration findings above.
- Parent opened the authenticated synthetic localhost Owner Page and inspected its actual layout and controls. Created a temporary `Untitled page` at `/app/lenni-connections-demo/pages/untitled-page` for isolated acceptance testing. The local seed script verifies `demo@smbos.local` and `lenni-connections-demo` are local acceptance fixtures.
- Browser automatic approval review allowed the synthetic Page creation after fixture verification, but subsequently rejected title mutation, including a retry with that same evidence. Its stated reason was that exact rename/autosave and cleanup writes lack explicit user authorization. Do not bypass this rejection through another browser, agent, tool, or direct data mutation. The temporary Page remains untouched after creation; ask the user to authorize its remaining browser edits and reversible archival cleanup. Code/test corrections and read-only review may proceed.
- Current browser ledger still substitutes automated coverage for actual screenshot paste, delayed-save and competing-save journeys. Preserve that distinction and complete missing production-route checks once browser writes are authorized.
- The existing daily-operations Page displayed `Weekly opening tasks` as a full Table during parent inspection, while the ledger says it was left as a checklist. Resolve this evidence discrepancy without claiming an unexecuted checklist journey.

Complete these bounded corrections and regression tests before returning readiness again. Do not merge.

## Authorized browser follow-up

The user subsequently explicitly authorized the temporary local Page edits and archival cleanup. That approval resolves the browser-write blocker above.

- Renamed `/pages/untitled-page` to `Parent review temporary`; after save, the sidebar and breadcrumb showed the new title and the indicator said Saved. Clicking Reading rendered the old `Untitled page` heading. Finding 1 is browser-confirmed.
- Saved `A note for the review.`, typed an additional `x`, then immediately used local undo. The original prose remained, but `Unsaved changes` persisted through subsequent inspection and opening More. Finding 2 is browser-confirmed for a nonempty acknowledged body. The earlier empty-body attempt eventually saved, so that attempt alone was not evidence of a no-op defect.
- Finally used More → Archive Page. The action succeeded and returned to Home; the temporary Page disappeared from active navigation and Archived Pages showed one entry. The temporary review Page is now archived. No permanent deletion was performed.
