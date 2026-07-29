# Configuration mutation boundary

Milestone 5 Phase 3B makes the versioned change-set engine the only normal
production path for changing graph, experience, or preorder configuration.
This inventory records the repository paths examined and their final
classification.

## Versioned projection tables

The boundary covers:

- `object_definitions`
- `field_definitions`
- `relationship_definitions`
- `views`
- `forms`
- `pages`
- `preorder_experiences`
- `preorder_experience_locations`

For all eight tables, `anon`, `authenticated`, and `service_role` have no
direct `INSERT`, `UPDATE`, or `DELETE` privilege. The former Owner/Admin insert
and update policies, plus preorder allowed-Location insert/update/delete
policies, are removed. Authenticated users retain `SELECT`, constrained by the
existing membership RLS policies, because generated workspaces need the live
projection. Anonymous users retain no table access.

Classification: **close direct mutation; runtime read only**.

## Database functions

| Surface | Final classification |
| --- | --- |
| `propose_configuration_change`, `prepare_configuration_rollback`, `validate_configuration_change`, `apply_configuration_change`, `abandon_configuration_change_set` | Sole authenticated Owner/Admin configuration mutation lifecycle |
| `list_configuration_change_sets`, `get_configuration_change_set`, `list_configuration_versions`, `get_configuration_version` | Owner/Admin history reads |
| `create_preorder_experience`, `set_preorder_experience_locations` | Retained only for historical migration compatibility; execution revoked from `public`, `anon`, `authenticated`, and `service_role` |
| Candidate materialiser, rollback candidate derivation, replay dispatcher, semantic diff, projector, validation sandbox, projection/head assertions, and change/version/head protection helpers in `private` | Engine internals; application-role execution revoked |
| `resolve_public_page`, `resolve_public_preorder` | Narrow anonymous runtime reads; no table access |
| Graph Record and Record Relationship RPCs | Operational and outside configuration versioning |
| Record-to-Location link RPCs | Operational and outside configuration versioning |
| Public preorder submission and confirmation-email state RPCs | Trusted operational transaction boundary; not configuration mutation |
| Business and Location lifecycle RPCs | Platform/operational lifecycle; Location versioning is out of scope |

No generic private-function proxy exists. The migration also revokes the
`public` default execute privilege for future functions created by `postgres`
in the `private` schema.

## Application and tooling paths

| Path | Final classification |
| --- | --- |
| `src/core/configuration/service.ts` | Structured M5 lifecycle and history only |
| `src/core/graph/service.ts` | Configuration reads plus operational Record/edge writes |
| `src/core/experience/service.ts` | Configuration reads only |
| `src/core/preorder/service.ts` | Runtime resolution, submission, and email state only |
| Server routes/actions under `src/app` | Operational preorder endpoint or runtime reads; no configuration DML |
| `scripts/demo-seed.mjs` | Local-only; installs Bedford through propose → validate → apply, then seeds operational data |
| `tests/integration/support/configuration-fixtures.ts` | Local/test-only database-owner fixture for M1–M4 integrity setup |
| Explicit tamper/failure-injection tests | Test-only privileged diagnostics; never production setup |

The source regression test scans `src/` for direct DML against every versioned
table and calls to the two revoked legacy RPCs. Database tests separately
verify catalogue privileges, RLS policy removal, actual PostgREST denial for
all application roles, private/legacy function denial, and the exact public
configuration-function allow-list.
