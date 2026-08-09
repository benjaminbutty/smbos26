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
