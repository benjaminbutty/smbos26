# Tenant and Location management

Tenant identity is always resolved from the authenticated session and the
route Business slug. Owner/Admin capability checks happen before Location
management actions; browser or model values never choose the Business or
actor.

Manual Location creation delegates to `src/core/locations/` and the strict
expected-state `create_location` RPC. Builder preparation only returns a
transient confirmation; its final POST re-authenticates the tenant and calls
the same service once. Active and inactive normalized names are both reserved,
timezone validity is database-authoritative, and slugs are derived by the
server.

Manual update and deactivation remain available here. Builder does not update,
deactivate, reactivate or delete Locations, create multiple Locations, add
Products or alter preorder setup. Location creation is ordinary operational
data outside M5 Changes/versioning and has no operational undo.
