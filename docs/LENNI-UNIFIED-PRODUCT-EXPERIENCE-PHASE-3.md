# Lenni Unified Product Experience — Phase 3

**Status:** Implemented bounded manual Connection creation
**Date:** 11 August 2026

Phase 3 adds one owner-facing structural action to the existing Table
workspace: an Owner or Admin can choose **Connect to another Table** from Add
property and create a Connection between two existing generic Tables.

The flow stays inside the existing anchored property menu. It uses plain
business language only:

- Table to connect;
- the property name on each Table;
- One or Several on each side;
- whether to show the reverse property.

The browser submits a bounded intent. The server resolves the authenticated
Business and actor, checks the existing configuration capability, validates
active custom Tables and the current configuration, derives the canonical
orientation/cardinality and allocates the stable Connection identity. The
existing direct Table configuration boundary then applies one relationship
operation and the required preserved V2 Table View operations atomically.

The phase does not add a primitive, persistence model, migration, relationship
service, schema editor or alternate mutation path. It does not create Records
or operational Record Relationship edges. After the structure exists, its
cells, picker, connected-record navigation and Record drawer remain the Phase
2 runtime. Trusted preorder relationships remain governed by their existing
read-only capability-owned treatment.

The target list is limited to active same-Business custom Tables. Self-links,
platform-controlled concepts, inactive targets, required Connections,
Connection edits/removal, target Table creation and saved-View fan-out are
outside this phase.
