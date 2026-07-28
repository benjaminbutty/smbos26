# Core platform boundary

The metadata-driven business graph, constrained experience configuration and
trusted reusable capabilities live here. Business-specific concepts remain
generic Objects, Fields, Records and Relationships. A capability such as
preorder may orchestrate those primitives through a narrow validated boundary,
but must not introduce domain persistence or bypass graph validation.

Versioned configuration changes use only the structured Milestone 5 lifecycle:
propose, validate, apply, or abandon. Direct projection-table writes and legacy
configuration RPCs are not production capabilities. See
[`docs/configuration-mutation-boundary.md`](../../docs/configuration-mutation-boundary.md)
for the audited surface.
