# Experience configuration

Views, Forms, and Pages are tenant-owned configuration over the generic
business graph. Stable keys remain internal; business labels are used in the
workspace.

The TypeScript schemas reject unsupported configuration before a normal
service write. PostgreSQL repeats the constrained grammar and reference
validation so direct PostgREST writes cannot bypass it. Active configuration
may reference only active same-tenant Objects, Fields, Forms, and Views.

The public boundary exposes one narrow resolver for static `public` +
`published` Pages. Milestone 3 does not expose generic Records or accept
anonymous Form writes.
