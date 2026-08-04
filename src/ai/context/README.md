# AI Business context boundary

Milestone 6 Phase 3A builds one deterministic, provider-neutral description of
what an authenticated Business is currently configured to do. It is structured
data, not a prompt or conversation.

The authenticated loader lives outside `src/ai`. It derives the actor from the
ordinary Supabase session, rechecks current Owner/Admin membership, reads the
tenant-scoped Business and current Locations, then reads the active immutable
configuration version. It never uses a service-role client.

The projector in this directory is pure. It performs no I/O, imports no
database client, provider, execution/accounting service, or mutation service,
and projects only explicit strict fields. Operational Records, relationships
between Records, submissions, counters, customer/order/product values, AI
settings/audit, proposals, candidates, validation data, actors, timestamps,
checksums, and configuration UUIDs are excluded.

Location UUIDs are the sole opaque database references in model-facing data.
They remain untrusted and must be tenant- and eligibility-checked if a later
model returns them. Trusted active-version identity and head revision stay in
the server-only `currentness` envelope, outside `modelContext`.

The authoritative loader additionally exposes session-derived Business and
actor identity in a separate server-only `executionContext`. The public
`buildAiBusinessContext` bundle is unchanged. Planning uses this identity only
for the existing Business-aware accounting boundary; it never enters
`modelContext` or registered task input.

Collections and JSON object keys are deterministically ordered. The complete
model context has a 128 KiB hard limit and is never truncated, persisted, or
logged.

Before external execution, Page blocks pass an additional structural
minimisation gate. Heading, text, View, Form, preorder and divider meaning is
preserved. Images expose alt/caption plus `source_kind: external_web`; buttons
expose label/style plus an internal-path, external-web, email or telephone
destination kind. Raw `src`/`href` values—and therefore credentials, hosts,
paths, queries, fragments, addresses and numbers—are excluded. Runtime Page
configuration and rendering are unchanged.

Phase 3B planning reloads and reprojects this source after execution. A change
to the base version, head revision or canonical model context discards the
result as stale. Future operation generation must still reload context and use
expected-head protection.

## Phase 10A Location context boundary

The existing model-facing Business context remains unchanged. A Location
creation intent receives only that AI-safe context and a validated ready plan;
it does not receive Business or actor UUIDs, configuration currentness,
operational Records, the Location digest, membership rows, RPC names or the
confirmation secret. The server-only Location service separately reads the
authoritative Business timezone and complete operational Location-state digest
before and after intent generation. Location creation therefore remains a
deterministic operational boundary rather than a model-authorised mutation.
