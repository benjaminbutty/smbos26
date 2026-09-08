# Parent review 3 — production-route UI findings

Reviewed corrected implementation `e63432a`, documentation head `160b70e`, on 8 September 2026. PR #75 remains unmerged. User explicitly authorized mutations and reversible archival cleanup of the synthetic temporary Page at `/app/lenni-connections-demo/pages/untitled-page`.

## Corrections that passed independent recheck

- Renamed the restored temporary Page to `Parent review verified` and immediately clicked Reading. The save completed and Reading showed the new title, resolving review-2 finding 1.
- In the nonempty saved body, typed `x` and immediately undid it. The body returned to its baseline and status remained Saved, resolving review-2 finding 2.
- Inspected the coordinator lifetime/request-token corrections. Reran `tests/page-save-coordinator.test.ts` and `tests/page-editor-draft-integration.test.ts`: 17 tests passed. These extracted tests are supporting evidence, not actual React mount/refresh tests.
- Opened two browser tabs against the temporary Page. First tab renamed/saved; stale second tab attempted a different title. Second tab preserved its draft, stopped with recovery controls, and remained stopped while typing another title. Deliberate Keep my version saved that title successfully.
- Pasted a screenshot of the synthetic local Page through the browser clipboard. Upload placeholder appeared, completed into a private image, and the document reached Saved. Visual inspection confirmed the image; no application error/warn entries were observed before the later checklist crash.

## Required corrections

1. **P1: Existing-checklist chooser crashes the whole Page.** Type `/checklist`, select Checklist with the pointer, choose Use existing Table, then select `Weekly opening tasks · Weekly opening tasks`. The route crashes into `This page couldn’t load`. Browser console: `TypeError: Cannot read properties of null (reading 'value')` in the React state reducer. In `internal-page-editor.tsx` around line 2309, the `setChecklistForm` updater reads `event.currentTarget.value` after the event dispatch has completed. Snapshot primitive values before deferred state updaters; audit the corresponding name, label/completion selectors, read-only checkbox and related new controls for the same pattern. Add meaningful regression coverage and execute this exact chooser path in the browser.

2. **P1: Slash-menu keyboard selection is not intercepted before Tiptap.** Typing `/checklist` displays the selected Checklist option. Pressing Return inserts a new paragraph, leaves literal `/checklist`, closes the menu and never opens the chooser. The outer section's bubbling `onKeyDown` runs too late relative to the editor key handling. Use an appropriate capture/plugin path for active-menu Enter, arrows and Escape while retaining normal editor behaviour with no menu. Verify keyboard insertion, focus return and no literal slash residue in the actual route.

3. **P2: Conflict recovery lacks the required comparison and duplicates controls.** The two-tab conflict displays the same warning twice and two Keep my version buttons. It offers replacement without showing the latest title/body alongside the retained local candidate. Provide one compact recovery surface, one action pair, bounded readable local/latest comparison, and an explicit description of which version each action replaces. Avoid JSON or platform terminology in this owner-facing flow.

These were sent to Luna during review. They are corrections to the approved handoff and existing acceptance journeys, not additional scope. Do not mark ready until fixed and verified.

The temporary Page was reloaded after the crash and archival cleanup was invoked through More → Archive Page. Preserve the reusable fixture; do not permanently delete it or its historical media.
