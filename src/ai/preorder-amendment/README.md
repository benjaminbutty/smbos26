# Builder preorder amendments

`builder_preorder_amendment_v1` is a bounded, server-only structured task. It
returns only source-referenced amendment intents. The pure semantic validator
rechecks the ready planning output, exact active preorder identity, public
question identity, source-step coverage and duplicate/no-op rules.

The task does not receive Records or PII and cannot emit operations, IDs,
positions or lifecycle instructions. The trusted proposal boundary maps its
validated intents to the shared manual preorder composer before creating one
ordinary Milestone 5 proposal.
