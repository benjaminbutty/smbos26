# Pages block interaction follow-through — 8 September 2026

## Scope

This pass removes the owner/editor Reading/Edit switch, keeps authorised Page
authors in the continuous editor, and leaves the shared `PageRenderer` as the
automatic viewer surface. It narrows block controls to a hover/focus gutter:
an add control and native drag grip, with a compact contextual menu for Move
up, Move down, Duplicate, and Remove.

The persistence boundary is unchanged. Native pointer moves and menu moves
both remain ordinary edits to the in-memory canonical Page candidate and pass
through the existing serial autosave coordinator and `save_page_layout` action.
No schema, RPC, RLS, Table, Record, or Site changes were made.

## Browser review

Parent review used the normal authenticated owner route on the disposable
`Block interaction review` Page (`untitled-page-4`) in the main-worktree
preview on port 3003 on 8 September. This was separate from the isolated manual
test preview on port 3002. The original user Page was not used.

| Journey | Observed result |
| --- | --- |
| Native pointer reorder at 1280px and 1440px | Clicking Alpha kept its compact `+`/grip gutter visible. Dragging the grip between Bravo and Charlie changed the document to Bravo, Alpha, Charlie. Cmd/Ctrl+Z restored Alpha, Bravo, Charlie. The native gesture was repeated successfully at 1440px. |
| Cross-atom pointer reorder | Dragging the embedded Table moved the whole Table before Alpha; Table Records were not changed. Text-block dragging repeatedly reordered the intended source block. |
| Cancelled/outside drop recovery | An invalid drop above the editor left the document order unchanged. Re-entering the same Bravo block immediately showed its handle again; no different-block hover was needed. |
| Compact actions and keyboard | The first Move up control was visibly disabled. Arrow navigation focused enabled menu items; Duplicate created Alpha with a fresh block ID. Shift+F10 on prose opened actions for the current caret block, Move up focused the editor body, and immediate Cmd/Ctrl+Z restored the preceding order. |
| Mobile and viewport placement | At 390px the cold-loaded first block handle stayed on-screen. `+` → search Divider → Enter inserted the divider immediately after Alpha; Shift+F10 then Escape closed the menu and returned focus to the Page body. The action menu fit in the viewport, while 1440px and 1024px checks had no document overflow. |
| Structural selection cleanup | Source review confirmed the guard now requires a nonempty text selection before showing prose Bold/Italic/Link controls. The disposable fixture was already archived, so this small follow-through was not re-exercised in the browser. |
| Reload and cleanup | Reload retained Table, Bravo, Alpha, Divider, Charlie in the expected order. The disposable Page was archived through the normal UI and Home then had no active fixture links. |
| Viewer path | The implementation now selects `PageRenderer` whenever `canEdit` is false; authoring controls and the Tiptap surface are not rendered on that path. This code path was not re-authenticated in this focused owner interaction pass. |

The native CUA drag gesture is atomic, so sustained edge-hover scrolling could
not be independently observed. The implementation requests bounded viewport
edge scrolling during dragover and has focused unit coverage for its direction
and no-op middle/invalid-viewport cases; this is not presented as prolonged
pointer-hold browser evidence.

## Transient-menu follow-through

Parent repeated this browser review on the main-worktree preview at port 3003
after the block-action menu fix:

| Journey | Observed result |
| --- | --- |
| Block actions, outside pointer | Shift+F10 on a heading opened the action menu. Clicking the Page name closed it and focused the name input. |
| Block actions, Escape | Escape closed the action menu and restored focus to the editable Page body. |
| Block actions, embedded target | Opening the grip menu then clicking an embedded checklist Search control closed the menu and focused the search box. |
| Slash chooser, internal and outside pointers | A `+` chooser stayed open when its internal search input was clicked. Clicking the Page name closed it and focused the title input. |

No document content was edited in these journeys. The listener is registered
at capture phase (with focused unit coverage); the browser check confirms an
embedded target receives focus while the menu dismisses. The listener does not
prevent the outside target's pointer, click, or focus behavior. Link dialog
Escape restores the captured link selection and editor focus; the same
outside-pointer rule dismisses the dialog without forcing focus away from its
target.

## Checks

The following completed against this source after the interaction changes:

```text
npm run typecheck
  next typegen && tsc --noEmit                         PASS

npm run lint
  eslint . --max-warnings=0                            PASS

node ./node_modules/vitest/vitest.mjs run \
  tests/page-editor-block-actions.test.ts \
  tests/page-editor-block-menu-layout.test.ts \
  tests/page-editor-drag-scroll.test.ts \
  tests/page-editor-slash-menu-layout.test.ts \
  tests/page-editor-transient-pointer-dismissal.test.ts \
  tests/lenni-unified-ui.test.ts
  6 files, 38 tests                                   PASS

node ./node_modules/prettier/bin/prettier.cjs --check [touched files]
  formatting                                           PASS

git diff --check                                      PASS
```

The new block-action tests exercise ID-stable targeting through unrelated
changes, direct sibling movement in both directions, an atom/Table-like block,
boundary no-ops, and actual ProseMirror history undo. Menu-layout tests cover
desktop and narrow/short viewport clamping. These are regression support; the
browser results above remain the product-interaction evidence.

Transient-pointer regression coverage verifies internal and outside-target
classification, that dismissal does not call `preventDefault`, and capture-phase
listener registration and cleanup. Browser review remains the evidence for
actual focus transfer and Escape behavior.
