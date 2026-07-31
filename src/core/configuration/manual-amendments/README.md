# Deterministic manual amendments

This server-owned boundary turns a bounded owner intent into an existing strict
Milestone 5 configuration operation. It always composes from the active
immutable configuration snapshot, preserves non-edited meaning, and creates an
ordinary proposal through `ConfigurationChangeService`.

Supported intents are:

- `update_preorder_schedule` for collection availability and capacity;
- `update_preorder_question` for the wording, help text and journey-level
  requiredness of one existing public preorder question;
- `add_preorder_question` for one server-keyed optional generic Order Field
  using the supported short- or long-answer style.

Question controls resolve the preorder, public Field mapping, configured Object
and complete Field definition from the active immutable snapshot. Making a
question optional also relaxes a globally required Field; making it required
for one preorder never tightens the generic Field. New keys are derived
server-side from the label and every active or archived Field key on the Order
Object.

Manual amendments do not write projection tables, validate, apply, publish,
invoke AI, or create AI usage/accounting rows.
