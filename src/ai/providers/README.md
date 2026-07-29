# AI provider boundary

Milestone 6 Phase 1A defines one server-only, provider-neutral structured
generation interface. The only production adapter is deliberately disabled and
makes no network request. No provider SDK or API key use exists.

Future adapters must receive only the trusted request assembled by the
execution service: fixed provider/model identity, server-owned instruction,
validated structured input, the registered output contract, output-token
limit and `AbortSignal`. They must not accept arbitrary tools, URLs, headers,
credentials, database clients or mutation capabilities.

The execution service validates the provider's unknown output with the task's
strict Zod schema. The deterministic SMBOS runtime and both configuration and
operational services remain independent of AI availability.

Phase 1B does not change this provider contract. Internal execution accounting
aggregates bounded token usage across attempts, but tenancy, membership, limits,
pricing, reservation and durable audit remain in the separate server-only
accounting/orchestration layer. Providers receive none of those concerns, and
arbitrary provider metadata is not persisted.
