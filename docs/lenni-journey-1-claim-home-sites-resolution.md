# Journey 1 — Claim, Home and Sites resolution

Checkpoint: J1-D
Baseline: `b2744b0b3e932a621d56c639e0b174ec5decdff5` (merged J1-C)

## Claim seam

`Use this setup` writes only the server-owned acquisition session acceptance
marker. The claim action recomputes the current candidate checksum and checks
the marker before calling the existing three-argument
`claim_anonymous_build_session` RPC. The RPC locks the session and requires an
accepted marker before creating a Business or applying configuration. The
existing trigger clears acceptance when the candidate is regenerated, expires
or is claimed.

The accepted candidate is applied through the existing atomic configuration
proposal, validation and application boundary. The post-claim redirect is the
real Home route, not the first generated Page. Business setup asks only for
Business name and timezone; Journey 1 acquisition candidates use Business
timezone and do not force a Location.

## Sites seam

`ExperienceService.listNavigation()` returns active public Pages separately as
`publicPages`. Authenticated navigation keeps internal Pages under Work and
places public Pages under Sites at `/app/:businessSlug/sites/:pageSlug`.
The owner Site route renders the same `PageRenderer` in read-only preview mode.
Draft Sites expose a preparation route that creates a normal reviewed
`set_page` publication proposal; acquisition and workspace creation never
publish a Page.

The public runtime remains `/p/:businessSlug/:pageSlug` and continues to
resolve only published Pages. Generic public Forms and Booking submissions
therefore retain their existing narrow public contracts. A draft booking Site
shows an honest publication boundary instead of exposing a write endpoint.

## Home seam

Home derives its first action from real navigation. A public Page is presented
as `Review draft Site` while draft; internal-only candidates retain their first
internal Page/Table destination. No synthetic acquisition Records or fake
metrics are introduced during claim.
