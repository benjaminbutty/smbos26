# Trusted preorder capability

Preorder is a reusable SMBOS capability over generic graph Records. Its
configuration names the Product, Customer, Order and Order Item Objects, the
three expected Relationships, exact Field mappings, allowed first-class
Locations, safe public Fields and deterministic schedule.

Anonymous catalogue reads use an allow-listed PostgreSQL resolver bound to a
published public Page and active same-tenant configuration. Its clock is always
the database statement time; deterministic clock injection exists only in a
private helper used by PostgreSQL integration tests. Browser writes use only
the Next.js preorder endpoint. That server hashes the network identifier and
calls service-role-only transaction and email-state RPCs; the service
credential is never sent to the browser.

PostgreSQL re-resolves Products and numeric prices, validates the Location's
timezone schedule, locks the per-slot counter and creates Customer, Order,
Order Item Records, graph Relationships and the Order Location link in one
transaction. Product and Customer changes cannot rewrite the snapshots stored
on historical Orders and Order Items.

Active configuration validation proves every required Customer, Order and Order
Item Field is supplied by the runtime, a required public Field, or a default
that the generic Record insertion trigger genuinely applies. Graph and
configuration changes that break constructability roll back immediately.

Orders preserve both the authoritative `collection_at` timestamp and generic
local-display/timezone snapshots. Staff Views show the snapshots, so server and
browser timezone cannot change the selected collection time.

Email is attempted only after commit. The console adapter writes a safe email
capture only in development/test. Production without a provider fails closed;
that failure is recorded and returned truthfully without rolling back the
Order.

Current deliberate limitations:

- each successful preorder creates a new Customer Record; normalized-email
  deduplication is deferred;
- capacity is counted in Orders and is not released by later status changes;
- the local email adapter logs safely and no production provider is configured;
- database-backed throttling is proportionate abuse protection, not a claim of
  complete fraud prevention.

Preorder configuration is read-only through this runtime service. Changes to
the capability or its allowed Locations use the Milestone 5 structured
proposal lifecycle. The older create/update RPC implementations are retained
only for migration history and are not executable by application roles.
Product Records and Product-to-Location availability remain operational data,
outside configuration versioning.

Authenticated candidate preview calls the identifier-only preview resolver
with the trusted Business, actor, change-set, Page key and preorder key. It
reuses the authoritative catalogue assembler, receives no submission endpoint
or idempotency token, and keeps quantity/Location/date/slot/customer-field
exploration in ephemeral client state with the final submission disabled.
