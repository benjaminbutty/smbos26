# Trusted preorder capability

Preorder is a reusable SMBOS capability over generic graph Records. Its
configuration names the Product, Customer, Order and Order Item Objects, the
three expected Relationships, exact Field mappings, allowed first-class
Locations, safe public Fields and deterministic schedule.

Anonymous catalogue reads use an allow-listed PostgreSQL resolver bound to a
published public Page and active same-tenant configuration. Browser writes use
only the Next.js preorder endpoint. That server hashes the network identifier
and calls service-role-only transaction and email-state RPCs; the service
credential is never sent to the browser.

PostgreSQL re-resolves Products and numeric prices, validates the Location's
timezone schedule, locks the per-slot counter and creates Customer, Order,
Order Item Records, graph Relationships and the Order Location link in one
transaction. Product and Customer changes cannot rewrite the snapshots stored
on historical Orders and Order Items.

Email is attempted only after commit. The local adapter writes a safe email
capture to the development terminal. Provider failure is recorded and returned
truthfully without rolling back the Order.

Current deliberate limitations:

- each successful preorder creates a new Customer Record; normalized-email
  deduplication is deferred;
- capacity is counted in Orders and is not released by later status changes;
- the local email adapter logs safely and no production provider is configured;
- database-backed throttling is proportionate abuse protection, not a claim of
  complete fraud prevention.
