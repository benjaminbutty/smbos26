# Experience configuration

Views, Forms, and Pages are tenant-owned configuration over the generic
business graph. Stable keys remain internal; business labels are used in the
workspace.

The TypeScript schemas reject unsupported configuration before a normal
service write. PostgreSQL repeats the constrained grammar and reference
validation so direct PostgREST writes cannot bypass it. Active configuration
may reference only active same-tenant Objects, Fields, Forms, and Views.

The public boundary exposes narrow resolvers for `public` + `published` Pages.
Generic View and Form blocks remain forbidden publicly. Milestone 4 adds one
trusted `preorder` block that resolves a same-tenant active preorder capability
without exposing generic Records, graph configuration or generic Form writes.
