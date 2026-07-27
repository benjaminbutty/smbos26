# Authentication boundary

`actions.ts` contains the email/password signup, sign-in, and local sign-out
server actions. `authorization.ts` authenticates server requests and resolves a
route slug to an RLS-visible business plus the current user's membership.

`capabilities.ts` is the single application-level mapping for v0.1's fixed
Owner, Admin, and Staff defaults. `permissions_json` must not be interpreted
until a future architecture decision explicitly introduces custom permissions.

PostgreSQL RLS remains authoritative even when these helpers are used.
