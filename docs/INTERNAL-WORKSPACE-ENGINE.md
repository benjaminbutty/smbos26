# Internal Workspace Engine

**Status:** Accepted implementation contract for v0.1
**Date:** 10 August 2026

The Internal Workspace Engine is the reusable Table runtime for non-technical
small-business operators. It extends the existing Object, Field, Relationship,
View, Page, Record and Milestone 5 configuration primitives. It does not create
domain-specific modules, custom SQL tables, a second configuration store, or an
AI execution path.

## Product boundary

The default experience is a familiar Table: properties, connected Records,
saved tabs, filters, sorting and grouping. Database, JSON, relationship
cardinality and query-grammar terms stay behind the platform boundary.

Manual controls are the first client of the engine. Future AI planning must
produce the same typed intents that manual controls produce. The runtime never
executes model-generated code, SQL, arbitrary query text or generic HTTP
requests.

## Table View contract

Historical Table configurations remain readable in their V1 shape:

```json
{
  "fields": ["name", "status"],
  "title_field": "name",
  "include_archived": false
}
```

The runtime deterministically normalizes that shape to V2 at the boundary.
New or changed Table Views use mixed columns:

```json
{
  "schema_version": 2,
  "role": "primary",
  "columns": [
    { "kind": "field", "field_key": "name" },
    {
      "kind": "connection",
      "relationship_key": "customer_places_order",
      "direction": "target",
      "label": "customer"
    }
  ],
  "title_field": "name",
  "filters": [],
  "filter_match": "all",
  "sorts": [],
  "group": null,
  "include_archived": false
}
```

`fields` is a derived compatibility projection of V2 field columns. Record
JSON never stores relationship IDs; connected Records remain in the generic
`record_relationships` edge store.

There is exactly one active primary Table per Object. The sidebar shows the
primary Table once. Saved Tables are available as tabs and can be embedded by
their exact View key in a Page. An embedded Table keeps the View's query and
connection behavior but has no structural or query controls.

## Connections

Connection property configuration is an atomic M5 change over one relationship
and the affected endpoint Views. Manual creation is exposed from the existing
Add property flow using two independent owner-facing choices: One or Several
for the current Table and One or Several for the other Table. The trusted
composer derives one-to-one, one-to-many orientation, or many-to-many from
those choices; the current Table is not assumed to be the stored source.
Every manually created Connection is optional. The current View receives its
requested V2 Connection column and, when enabled, only the other Table's
primary View receives the inverse column. Saved Views, Records and
record_relationships are not changed by structural creation.

Reverse properties are optional and default to on. V1 does not support deleting
a property, changing cardinality, or creating required connections. Operational
Record updates replace one side atomically, accept at most 100 target IDs, and
never create a configuration Version.

The picker searches active Records in the same Business, returns stable labels,
and writes through the narrow `set_record_connection_values` RPC. The server
derives the target Object from the relationship and rechecks membership,
cardinality, active Records and the configured View column.

## Saved View query contract

Saved View queries are typed JSON validated by Zod, the M5 candidate trigger and
the query RPC. They allow up to 20 filters, 5 sorts and one grouping.
Every filter, sort and group uses the same canonical `property` identity:
`field:<field_key>` for a Field or
`connection:<relationship_key>:<source|target>` for a Connection. The direction
is part of the identity, so Field/Connection key collisions and self-relationship
source/target properties remain unambiguous at every boundary.
Operators are chosen according to the Field type; Connection filters are
membership-only. Single-value Connections may be sorted or grouped by their
primary display value; multi-value Connections may not. Relative dates are
bounded to a finite day/week/month range. Reads return at most 250 Records per
page and include deterministic pagination metadata and group counts.

The browser submits only a trusted View key and bounded paging. It does not
submit SQL, a query language, column expressions or a filter predicate.

## Proof coverage

The same engine contract is exercised by local-only fixtures for:

- a Milk round with customers and deliveries;
- a dog groomer with dogs and owners;
- a Catering Enquiry concept.

These are business concepts built with generic primitives. They are not
production-only branches, migrations or hard-coded runtime modules.

The repository includes a reusable local-only seed command and a concise manual
proof runbook in `docs/INTERNAL-WORKSPACE-PROOF.md`. The proof is deliberately
performed with AI disabled.

## Legacy snapshot decision

Milestone 5 snapshots are immutable historical records. Rewriting old V1
snapshots would change the meaning of configuration history and rollback. The
smallest safe boundary is therefore a deterministic V1 reader/normalizer,
canonical V2 writes for new and changed Tables, and server-side validation of
both forms. This is an intentional compatibility seam, not a second source of
truth.

## Roadmap freeze note

For this v0.1 proof, the engine scope is frozen at mixed Table columns,
Connections, saved queries, deterministic reads, bounded operational writes and
Page reuse. The internal engine now includes Tables, ordinary properties,
Records, Connections, saved Views, filtering, sorting, grouping, Pages and
embedded Views, with trusted configuration history and separate
configuration/operational lanes.

The following remain outside the internal engine: the final Lenni UI overhaul;
public websites and public Record collections; media/upload; a public Form
builder; workflows/actions; formulas/rollups; sophisticated AI Builder; and AI
analysis/advice. Formulas, arbitrary expressions, bulk command languages,
workflow automation, collaboration, public connected-record editing, Builder
changes and AI-generated runtime operations remain outside this boundary.

> No new internal platform primitive or broad engine programme should begin
> before the three-business proof is reviewed and the unified Lenni UI overhaul
> is completed, unless the proof exposes a material engine defect.

Any expansion must first show a recurring cross-business need and reuse the
existing primitives and typed action lifecycle.
