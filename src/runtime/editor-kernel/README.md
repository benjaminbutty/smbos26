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

The production workspace lives in `production/`. Its pure mapper translates
one authenticated live Table bundle, its client adapter only calls typed server
actions, and the server actions reuse the existing direct configuration and
Record boundaries. Ordinary internal Table routes use this kernel directly;
the old repeated Edit-button workspace is retained only for focused legacy
regressions. Owner/Admin users may add, insert, rename and reorder supported
columns, edit Choice/Status options, change compatible types, and rename the
Table title; Staff sees the operational Record lane without those structural
controls. Type changes preserve Field identity and Record values, inspect
active and archived Records, and create one configuration Version only on
success. Requiredness is existing Field metadata, not a new editor control.
Column resizing is local to the workspace and is never persisted.

The kernel also owns rectangular selection, bounded clipboard copy/paste and
optional-value clearing. Paste delegates to a tenant-safe operational batch
boundary limited to one live Table View, 100 rows and 500 cells; it creates no
configuration history. The same adapter contract is used for embedded Tables,
where operational editing remains available only when permitted and all
structural controls stay hidden.

`EditorKernel` also supports an embedded read-only surface for Page View
blocks. Embedded Tables always suppress structural controls and use the same
adapter contract as the ordinary workspace. The Page editor owns the
Tiptap-to-SMBOS translation; the kernel remains a deterministic Table runtime.
