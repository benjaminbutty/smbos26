# Builder Record-update intent

`builder_record_update_intent_v1` is the narrow semantic boundary for one
existing Record update. It receives only the AI-safe Business context and an
already validated one-step `update_record` plan.

The task may return one to three exact selector clauses and one to five
explicit absolute Field values. It never receives operational Records or
identifiers, never resolves a target, and never mutates data. The pure
validator proves plan scope, Object and Field ownership, finite selector
semantics, owner-request grounding, configured options and old/new inequality.

Target resolution, currentness, confirmation and mutation belong to the
server-owned `src/core/graph/record-update/` boundary.
