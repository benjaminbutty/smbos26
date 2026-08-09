# Editor kernel

This module is an embeddable, adapter-driven table editor. `EditorKernel` owns
selection, keyboard navigation, inline editing, draft-row creation, column
configuration, save/retry state, and the Record property panel. It accepts a
`TableEditorAdapter` and does not know whether the adapter is mock or backed by
production persistence.

`EditorLab` in `editor-lab-wrapper.tsx` is the isolated Reset Milestone 1
wrapper. It supplies the in-memory `MockTableAdapter`, lab-only copy, and the
deterministic `!fail` failure trigger. The route performs authentication before
rendering that wrapper; neither route concerns nor Supabase dependencies belong
in the core editor.

Future Table workspaces or interactive Table blocks can embed `EditorKernel`
with their own adapter, title, marker, and footer without importing the lab
wrapper or changing the editor contract.

The production preview lives in `production/`. Its pure mapper translates one
authenticated live Table bundle, its client adapter only calls typed server
actions, and the server actions reuse the existing direct configuration and
Record boundaries. The preview is deliberately unlinked and is enabled only by
`?editor=kernel` on an internal Table route. Owner/Admin users may add and
rename supported columns, edit Choice/Status options, reorder columns, and
rename the Table title; Staff sees the operational Record lane without those
structural controls. Column resizing is local to the preview and is never
persisted.
