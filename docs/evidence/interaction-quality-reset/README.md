# Interaction Quality Reset browser evidence

Date: 2026-08-24

Branch: `codex/interaction-quality-reset-tables-pages`

Businesses: the initial matrix used
`proof-mobile-dog-groomer-17473a77`; after the mandatory clean database reset,
the final one-save task used the freshly generated
`proof-mobile-dog-groomer` proof business.

This directory is the durable visual record for the joined-up Table and
internal Page acceptance pass. The browser work used the local Supabase stack
and the seeded Owner, Admin and Staff memberships. All final fresh-tab console
checks returned no warnings or errors.

## Joined-up Owner tasks

### Table

The Owner completed the real `Customers` task rather than a component demo:

1. Selected `Aisha Khan / Area` with the keyboard, entered edit with Enter,
   changed the value to `North Bedford`, and used Tab to retain grid focus.
2. Searched the Choice editor and set `Referral source` to `Website`.
3. Searched the Connection editor and linked `Milo`; the selection summary
   showed `Pets · Milo`, never a UUID.
4. Created `Jamie Cole` inline.
5. Created the `Customer type` Choice Property with `Regular` and `New`
   options, placed it after `Area`, and immediately edited real records.
6. Created the `New customers` Saved View with a real-grid live preview,
   filter, sort and visible-property order; saved it and returned from a
   Record without losing the selected grid cell.
7. At 390px, selected `Customer type` through the working-property chooser
   and edited through the record-first surface.

Key evidence:

- [Resting Table](owner-1440-table-resting.png)
- [Searchable Choice editor](owner-1440-choice-editor.png)
- [Searchable Connection picker](owner-1440-connection-picker.png)
- [Inline record creation](owner-1440-inline-record.png)
- [Property live preview](owner-1440-property-preview.png)
- [Saved View real-grid preview](owner-1440-saved-view-preview.png)
- [Record return and focus](owner-1440-saved-view-record-return.png)
- [1024px Table](owner-1024-table.png)
- [390px record-first Table](owner-390-table-record-first.png)
- [390px working-property chooser](owner-390-working-property.png)

At 1024px, the document remained exactly 1024px wide while the real DataGrid
reported `clientWidth: 742` and `scrollWidth: 970` with `overflow-x: auto`.
The overflow is therefore Table-local and intentional.

### Internal Page

The Owner completed the real `This week` Page task:

1. Typed a natural introduction.
2. Inserted a heading and bulleted list through `/` insertion.
3. Inserted the exact `Appointments this week` Saved View.
4. Dragged the embedded View above the list with the visible Tiptap gutter
   handle; the same movement is also exposed as accessible block actions.
5. Changed the embedded appointment Status to `Complete` through the real
   operational editor.
6. Continued writing after the embedded View and list.
7. Saved the complete Page with Cmd+S, switched to Reading, and reloaded the
   exact order and operational value.

The final reloaded top-level order was:

1. introduction paragraph;
2. `Appointments to confirm` heading;
3. exact embedded `Appointments this week` View;
4. action list;
5. continuation paragraph.

Key evidence:

- [Slash insertion](owner-1440-page-slash-menu.png)
- [Successful pointer drag](owner-1440-page-dragged-view.png)
- [Continuous saved Page](owner-1440-page-continuous-saved.png)
- [Reloaded Reading mode](owner-1440-page-reading-reloaded.png)
- [Final clean one-save reload](owner-1440-page-final-clean.png)
- [1024px Page](owner-1024-page.png)
- [390px Reading mode](owner-390-page-reading.png)

The Page document reported no document-level horizontal overflow at 1440,
1024 or 390px. A clean tab exercised editing/reading transitions and reload;
its captured console contained no warnings or errors.

## Role and viewport matrix

| Role | 1440px | 1024px | 390px | Boundary proved |
| --- | --- | --- | --- | --- |
| Owner | [Table](owner-1440-table-resting.png), [Page](owner-1440-page-reading-reloaded.png) | [Table](owner-1024-table.png), [Page](owner-1024-page.png) | [Table](owner-390-table-record-first.png), [Page](owner-390-page-reading.png) | Operational and structural controls available |
| Admin | [Table](admin-1440-table.png), [Page](admin-1440-page.png) | [Table](admin-1024-table.png), [Page](admin-1024-page.png) | [Table](admin-390-table.png), [Page](admin-390-page-editing.png) | Same structural Page/Table access as Owner |
| Staff | [Table](staff-1440-table.png), [Page](staff-1440-page-reading.png) | [Table](staff-1024-table.png), [Page](staff-1024-page.png) | [Table](staff-390-table.png), [Page](staff-390-page-reading.png) | Records remain operable; Property, Saved View and Page structure controls are absent |

For every matrix cell, `document.documentElement.scrollWidth` equalled its
viewport width. Staff had zero `Add property`, `Create saved view`, column
menu, `Editing`, `Save page` and `Rename Page` controls, while Record actions
remained present in the Table and embedded Saved View.

## Browser-discovered corrections

The acceptance pass found and corrected five defects before closeout:

- Connection summaries exposed record ids after save; summaries now resolve
  the configured record labels.
- A Saved View draft could become stale after a structural Table refresh;
  the controls now remount against the new currentness head.
- Saved View visible-property order ignored the primary View ordering; the
  primary order now leads and newly available Properties append safely.
- Page block actions could act on a neighboring empty paragraph after focus
  moved to the toolbar; the exact Tiptap top-level position is retained through
  the action.
- The upstream native gutter drag rendered but did not complete the move in
  the acceptance browser; the handle now owns a bounded pointer/mouse drop path
  that maps the visible target back to a Tiptap top-level position. A second
  clean browser run dragged the exact atom above the list successfully.
- After operating the embedded grid, an empty continuation paragraph needed a
  reliable one-click caret target; the Page boundary now restores the exact
  empty top-level paragraph without reacting to clicks inside the embed.
- Tiptap editability/content synchronization emitted React lifecycle
  `flushSync` errors; synchronization now runs in a guarded microtask. A fresh
  console pass is clean.

The first exploratory Page attempt exposed stale selection around an atom and
the native drag limitation. Both were corrected and the full task was repeated
from an empty seeded Page: actual pointer drag, embedded Status edit, one-click
continuation, one Cmd+S save, Reading and exact reload.

## Version and permission evidence

The focused direct-Page integration test asserts that one
`save_page_layout` intent creates one configuration Version for the complete
candidate. Operational embedded-record edits do not create configuration
Versions. Existing RLS integration coverage verifies the seeded Owner/Admin/
Staff membership boundaries, while route-level browser evidence proves the
actual control presentation.

The final clean browser run measured the dog-groomer business immediately
after the embedded operational edit and before Page save as `19 Versions / 18
Changes / head 19`. After the single Cmd+S Page save it was `20 / 19 / head
20`: exactly one Version, one Change and one head revision for the complete
Page candidate. The final reload retained the `Complete` operational value and
the exact five-block Page order.
