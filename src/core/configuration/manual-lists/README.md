# Manual internal lists

The manual list path is a bounded Owner/Admin setup capability over the
existing configuration primitives. It accepts owner-facing labels and up to
seven additional information rows, then composes one ordinary M5 proposal
containing an Object, Fields, internal create/edit Forms, a Table View, and an
internal draft Page.

`composer.ts` is pure and deterministic: it consumes only an authoritative
`ConfigurationSnapshotV1`, allocates identities through the neutral
configuration allocator, and performs no database, provider, or lifecycle
write. `service.ts` reloads the active head and immutable snapshot, checks the
submitted currentness, and calls `ConfigurationChangeService.proposeChangeSet`
once.

The browser submits only the bounded owner intent and expected currentness.
Business, actor, UUID, operation, candidate, lifecycle, and allocation values
are derived or checked server-side. Choice and Status options are the only
structured field settings supported by this path.
