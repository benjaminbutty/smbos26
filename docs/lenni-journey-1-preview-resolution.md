# Lenni Journey 1 preview resolution

## Chosen seams

The candidate preview is assembled from the current acquisition payload in
`src/core/acquisition/preview.ts`. The assembly is a pure server-side
projection of candidate operations:

- Object, Field, View, Page, Form, Booking and preorder definitions are read
  from the candidate payload only.
- Synthetic Records and Connections use deterministic server-owned values and
  fake preview identifiers. No operational table is queried or written.
- A candidate checksum includes the payload and the acquisition proposal
  revision. Refinement therefore invalidates older preview URLs even when the
  regenerated structure is equivalent.

## Presentation

Candidate Pages are rendered through `PageRenderer`. Candidate Table blocks
use `ProductionTableWorkspace` through the explicit read-only
`CandidateTableWorkspace` adapter, preserving the live Table and Record-panel
anatomy. Candidate public Forms, Booking Sites and preorder Sites use the
existing renderer components in their preview modes, which provide local
exploration without an endpoint or write action.

The preview shell exposes Home, internal Pages, candidate Tables/saved Views,
Sites and Tell Lenni. Its fixed Preview mode card is the only approval surface:
Back to Lenni returns to the bounded acquisition session and Use this setup
records acceptance without creating a Business.

## Required migration

`20260815120000_journey_1_candidate_acceptance.sql` adds the server-owned
accepted candidate checksum/timestamp to the temporary acquisition session.
The database trigger clears acceptance when the session is regenerated,
claimed or otherwise leaves the active state. J1-D must enforce this accepted
identity at final claim/application.

## Deliberate deferrals

This checkpoint does not create a Business, apply configuration, persist
synthetic data, redesign authenticated Builder/Changes UX, publish Sites or
change the trusted public write capabilities delivered by J1-A.
