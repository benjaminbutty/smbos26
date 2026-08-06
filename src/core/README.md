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
for the audited surface and
[`configuration/README.md`](configuration/README.md) for the bounded read model
and Phase 5A route boundary.

## Phase 10A Locations

`src/core/locations/` is the neutral server-only Location service used by both
manual Location creation and the final authenticated Builder confirmation. It
parses trusted requests, reads the operational currentness state, invokes the
hardened RPC and maps finite owner-safe errors. It owns no model execution,
configuration lifecycle, pending-action table or generic operational registry.

Location is a first-class platform concept. Builder can create only one new
Location after explicit confirmation; updates, deactivation and reactivation
remain manual-only. The operation is outside M5 Changes/versioning and has no
operational undo.

## Phase 12B generic Record update

`src/core/graph/record-update/` is the provider-neutral boundary for one
existing active Record update. It canonicalises exact selectors, validates
typed absolute values, composes a minimal patch and owner-safe diff, parses
bounded target state and calls the confirmed RPC. It has no broad Record query,
model, Product-specific path, configuration lifecycle or operational history.
