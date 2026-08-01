# Deterministic configuration draft compiler

Milestone 7 Phase 1B is the trusted, synchronous platform boundary between the
untrusted `builder_configuration_draft_v1` result and the existing Milestone 5
operation grammar.

`compileConfigurationDraft()` accepts exactly:

- `taskInput`: the Phase 1A task-input base contract;
- `draft`: the Phase 1A strict additive draft contract;
- `snapshot`: one server-supplied immutable `ConfigurationSnapshotV1`.

The compiler re-runs Phase 1A semantic validation and parses the snapshot. It
then re-resolves every existing Object, Field, Form and View reference against
that snapshot, including current activity, ownership, audience and mode/type
compatibility. Snapshot keys, slugs and Field positions from both active and
archived rows are reserved; an inconsistent or ambiguous snapshot fails closed.

New stable graph keys and Page slugs are derived with deterministic ASCII
normalisation and finite `_2`/`-2` suffix allocation. New Fields are ordered by
their cited plan sequence, normalized compiler-owned base and local reference;
new Objects start at Field position `0`, while existing Objects append after
the greatest active or archived position. Nested View, Form and Page arrays
remain in their declared design order.

The output is the strict schema-v1 object containing only these operation types:

1. `set_object`
2. `set_field`
3. `set_relationship`
4. `set_form`
5. `set_view`
6. `set_page`

Every operation and the final array are parsed through the existing M5 schemas.
Pages always compile as `draft`, including public Pages. Public Form/Page intent
is still design configuration, and Relationship operations define metadata only;
they do not create operational Records or Relationship edges.

This module is pure and performs no database or network access. It does not
allocate UUIDs, derive currentness, create candidate snapshots or ID
allocations, create proposals, validate/apply/publish changes, call a provider,
load a Business, add a route/UI, or mutate configuration or operational data.
M5 later allocates trusted IDs while materialising a proposal candidate. A
future orchestration phase supplies authentication, exact currentness and
proposal metadata.
