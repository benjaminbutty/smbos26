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

The Interaction Quality Reset keeps that runtime and tightens its presentation
contract. Cell saves are optimistic; a failed save retains the attempted value
and offers working Retry and Cancel actions, while an adapter refresh restores
the selected cell. Desktop and tablet keep every Property at a readable width
inside the grid's own horizontal scroll. At phone width the same kernel becomes
a Record-first surface with one explicit working-Property chooser: tapping its
value opens that Property directly in the full-screen Record editor, while the
Record name still opens the complete Record.

Shared Saved View configuration remains a separate, currentness-checked action.
The view controls publish an unsaved preview through a local React context so
the real grid immediately shows the proposed filters, sorts, grouping and
Property order. The preview is transient, creates no Version, and never becomes
a second Table runtime; one final Save view action creates or updates one
shared View and one configuration Version.

`EditorKernel` also supports an embedded read-only surface for Page View
blocks. Embedded Tables always suppress structural controls and use the same
adapter contract as the ordinary workspace. The Page editor owns the
Tiptap-to-SMBOS translation; the kernel remains a deterministic Table runtime.
