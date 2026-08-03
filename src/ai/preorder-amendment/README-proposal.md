# Proposal boundary

The proposal service loads the authoritative context twice, compares the
caller-supplied AI-safe projection and exact version/head, composes once from
the first immutable snapshot, and calls the existing Milestone 5 proposal
service once. Actor identity, proposal metadata, locations, mappings and
operations remain server-owned.
