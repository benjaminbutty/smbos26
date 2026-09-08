# Internal Pages v2 visual reference

This is a development-only visual review surface, not a second Page runtime or
a user-facing route. It renders without a login and never reads or writes Page
data.

## Review route

Run the local preview and open:

`http://localhost:3000/reference/pages`

The source is `src/app/reference/pages/page.tsx`; the strictly colocated
stylesheet is `src/app/reference/reference.css`. Production returns `notFound`
for this route.

## Captured browser states

The local browser rendered the route successfully after preview recovery on 8
September 2026. Review these exact states before applying the reference to the
production editor:

| Viewport | State | What to inspect |
| --- | --- | --- |
| 1440 × 900 | overview | empty Page, selected block, formatting control and 36px document title |
| 1440 × 900 | populated | 720px prose, wide image, collapse, compact checklist and one Table header |
| 1440 × 900 | insertion | contextual slash menu above an insertion point; no resting embed configuration controls |
| 1024 × 768 | overview | balanced document/container hierarchy without oversized top space |
| 390 × 844 | overview and populated | 16px gutters, selected formatting state, compact checklist and Record-first Table cards |

The Table values and image are static reference content, clearly disclosed in
the reference itself. Their job is to show target Page composition. Production
Pages continue to use the canonical grammar and shared Table runtime.

## Gate

This reference is a visual decision artifact. It does not demonstrate live
editor correctness. Before claiming production acceptance, run the actual
keyboard/caret, formatting, insertion, movement, undo, autosave, conflict and
reload journeys against the authenticated Page route.
