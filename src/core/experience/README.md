# Experience configuration

Views, Forms, and Pages are tenant-owned configuration over the generic
business graph. Stable keys remain internal; business labels are used in the
workspace.

The TypeScript schemas describe the constrained configuration grammar.
PostgreSQL repeats its shape, reference, and compatibility validation inside
the Milestone 5 proposal lifecycle. Active configuration may reference only
active same-tenant Objects, Fields, Forms, and Views.

The experience service is runtime read-only. Owner/Admin changes to Views,
Forms, and Pages must be structured operations proposed, validated, and
applied by `ConfigurationChangeService`; authenticated and service-role direct
table writes are unavailable.

The public boundary exposes narrow resolvers for `public` + `published` Pages.
Generic View and Form blocks remain forbidden publicly. Milestone 4 adds one
trusted `preorder` block that resolves a same-tenant active preorder capability
without exposing generic Records, graph configuration or generic Form writes.
