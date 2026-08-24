# Page editor

The Page editor is the authoring surface for the canonical SMBOS Page grammar.
Tiptap is used only in this client-side layer. `page-translator.ts` is the
boundary: it translates the bounded Page grammar into a deliberately small
Tiptap document and translates it back before a typed `save_page_layout`
action. Raw Tiptap JSON is never persisted.

The internal editor is one continuous `EditorContent` surface. Its complete
candidate stays in component memory until `Save page` or Cmd/Ctrl+S translates
and commits it through one `save_page_layout` action. It supports paragraphs,
three heading levels, bold, italic, safe links, flat bulleted/numbered lists,
dividers, bounded Callouts and live internal View blocks. Historical image,
button, Form and preorder blocks are retained as read-only legacy atoms so
opening an older Page does not silently discard configuration. Typing and
local undo/redo create no configuration Version.

Sites keep their existing bounded authoring presentation and use the same
canonical grammar, Direct Page service and `PageRenderer` as internal Pages.
Draft Site edits save privately through the direct Page boundary and remain
private until the separate Publish Site action. For an already-published Site,
the editor keeps one complete title/layout candidate in component memory,
previews it at desktop or mobile width, warns before navigation loss, and sends
it only when the owner presses `Publish changes`. Discard restores the latest
authoritative published Page.

Heading, Text and Divider blocks can be added, edited, removed and reordered in
that candidate. Historical and capability blocks remain previewable and
reorderable but cannot be removed or configured here. Successful publication is
one immutable configuration action; stale or failed publication leaves both the
candidate and the currently public Page intact.
