# Parent review 4 — preserve the writing position through autosave

Reviewed `a5b7c41` / documentation head `8e80248` on 8 September 2026. The implementation commit has green CI; final documentation-head CI was still running at inspection. Do not merge yet.

## Rechecks that pass

- Slash-menu Return now opens the checklist chooser instead of inserting a newline.
- Use existing Table → Weekly opening tasks now loads Name/Completed mapping without crashing; Add existing Table commits and renders the live checklist, reaching Saved.
- The conflict panel now has one warning, readable local/latest title and body previews, one action pair and replacement consequences. A real two-tab conflict showed different local/latest titles. Use latest replaced the local candidate and returned to Saved.
- The comparison fits a 390 × 844 viewport: measured document scroll width 390. Visual screenshot inspection confirmed stacked comparisons and accessible recovery controls.
- Focused draft-integration and conflict-panel suites: 10 tests passed.

## P1 remaining blocker: own autosave refresh moves the caret

The currentness effect's clean route-refresh branch still calls `editor.commands.setContent(...)` even when the refreshed Page is the editor's own acknowledged canonical document. That changes selection and history for an otherwise unchanged document.

Actual browser reproduction on temporary `/pages/untitled-page` with a first prose paragraph, image and checklist:

1. Select the caret immediately after `A note for the review.` in the first paragraph.
2. Type ` Alpha.`.
3. Allow automatic save to finish, without clicking or changing selection.
4. Type ` Beta.`.
5. **Observed:** Beta appears in a final paragraph after the checklist, instead of after Alpha in the first paragraph.

This also affects slash insertion. Typing `/checklist` at a paragraph caret, allowing a quiet save and then choosing it left literal `/checklist` in that paragraph and placed the checklist at the end. The checklist handler derives position from the current editor selection rather than the captured menu range, so refresh movement changes the insertion target. It also deletes a whole current paragraph, which must not discard text surrounding the slash range.

Required correction: do not reset Tiptap content for semantically identical own acknowledgements/route refreshes. Preserve selection and local undo. Use the captured insertion range/position for checklist placement, remove only the slash command, and preserve surrounding prose. Verify typing across autosave, undo across save, and slash insertion after a save delay through the production route. A standalone coordinator test alone cannot establish this React/Tiptap behaviour.

The user explicitly authorizes this temporary local Page's edits and reversible archival cleanup. No new approval is needed. Keep all other fixture data intact.

## Recheck on implementation 95f629b

- Caret retention now passes: inserted Gamma after the first prose sentence, let autosave finish, then typed Delta. Delta stayed after Gamma in that same paragraph. Undo after the completed save removed Delta while preserving the rest of the document.
- Reran save-coordinator, draft-integration and translator suites: 26 tests passed.
- Delayed slash-menu acceptance now removes only the command and preserves surrounding prose. The menu remained open after Saved and Enter opened the chooser.
- Existing checklist selection and insertion complete without a crash, and two instances of the same checklist preserve independent search state (first search returned zero matching items; sibling still showed Count cash and one item).
- **Remaining placement defect:** switching chooser mode drops the captured placement. `Use existing Table` calls `setChecklistForm({ mode: "existing", name: "" })`; `Create new checklist` likewise replaces the object. Both lose `afterBlockId`/`containerBlockId`. The subsequent existing-checklist insertion therefore appends after Beta instead of after the first prose paragraph. Preserve placement when switching modes and verify the resulting document order. This is a small correction to the same finding, not a new requirement.
