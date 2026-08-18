# Page editor

The Page editor is the authoring surface for the canonical SMBOS Page grammar.
Tiptap is used only in this client-side layer. `page-translator.ts` is the
boundary: it translates the bounded Page grammar into a deliberately small
Tiptap document and translates it back before a typed `save_page_layout`
action. Raw Tiptap JSON is never persisted.

The editor supports plain text paragraphs, three heading levels, dividers,
bounded Callouts, and live internal View blocks. Historical image, button,
Form, and preorder blocks are retained as read-only legacy atoms so opening an
older Page does not silently discard configuration.

Sites use the same bounded editor for existing public Pages. Saving preserves
their public audience and current draft/published status: draft edits remain
private until the separate Publish Site action, while edits to an already
published Site are live immediately after the immutable configuration action
applies.
