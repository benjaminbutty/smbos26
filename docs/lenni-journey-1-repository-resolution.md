# Lenni Journey 1 — Repository Resolution

Date: 15 August 2026  
Post-hygiene baseline: `5079100f653ae8e8ecf378b32eb444d42e2e9ea3`  
Pre-reset hygiene: PR #49, expected head `06f4b9643a4a41e9546b72467129e4e867b871dd`

## J1-0 resolution

PR #49 was already merged unchanged with the normal merge policy. Its exact
head was `06f4b9643a4a41e9546b72467129e4e867b871dd`; the merge commit is
`5079100f653ae8e8ecf378b32eb444d42e2e9ea3`. The repository `validate` check
was successful and the merge diff remains within the approved pre-reset
hygiene scope. The Journey 1 branch starts from the resulting `main` commit.

The current accepted architecture decisions end at ADR-040. The next
non-conflicting Journey 1 decision record is therefore ADR-041, subject to a
fresh check immediately before it is added.

## Audited seams and chosen implementation boundaries

| Area | Current seam | Journey 1 boundary |
| --- | --- | --- |
| Acquisition | `anonymous_build_sessions`, opaque HttpOnly cookie, `src/core/acquisition/service.ts`, `/start` actions and M5 claim RPC | Add bounded structured clarification state and accepted-candidate/currentness metadata to the existing temporary session. Keep Business creation behind the existing authoritative claim transaction. |
| Candidate configuration | M5 operation grammar, pure draft compiler, PostgreSQL candidate snapshot/checksum and `claim_anonymous_build_session` | Extend the existing strict versioned snapshot only for a generic Booking capability. Do not create a dog-grooming schema or a second configuration lane. |
| Authenticated preview | Change-set snapshot source and `PageRenderer`/preorder preview | Preserve this authenticated preview contract. Add a separate opaque-session candidate adapter for pre-signup preview so no authenticated Business or live records are required. |
| Runtime anatomy | `ExperienceService`, `ProductionTableWorkspace`, `PageRenderer`, `FormRenderer`, record/detail routes and navigation | Reuse the same renderers with an explicit read-only candidate data source. Synthetic records and connections stay in memory/server response data and never enter graph services. |
| Public Pages | `resolve_public_page` RPC and `/p/[businessSlug]/[pageSlug]` | Keep Page identity and `audience`/`status` as the primitive. Add narrow public capability resolution for active public Forms and Booking only when the published Page references them. |
| Generic Forms | Internal `FormRenderer` and `submitExperienceForm`; public renderer currently rejects submission | Add one server-resolved anonymous create boundary. It accepts only an active create Form allow-list on a published same-Business Page, creates one generic Record through the graph integrity boundary, and has no public generic reads or relationship writes. |
| Scheduling evidence | `src/core/preorder/*`, preorder RPCs, slot/capacity counters, timezone/notice/horizon and idempotency logic | Add a separate reusable Booking capability and extract only pure helpers when preorder behavior remains logically equivalent under its existing tests. Do not rewrite preorder. |
| Authenticated navigation | `src/app/app/[businessSlug]/layout.tsx`, `WorkspaceTopbar`, `WorkspaceMobileNav`, `ExperienceService.listNavigation()` | Add Sites as a grouping of public Pages while retaining Work for internal Pages and preserving Page IDs, routes and publication boundaries. |
| Publication | Existing trusted preorder publication boundary | Keep accepted public Pages draft. Expose the current trusted review/publication route; do not auto-publish during claim. |

## Migrations and schema work expected

The smallest safe additive changes are expected to be:

1. bounded clarification entries, candidate revision/currentness and accepted
   candidate metadata in the existing temporary acquisition session store;
2. a generic tenant-scoped Booking capability configuration representation,
   included in the M5 snapshot/compiler/claim boundary;
3. Booking slot/idempotency/capacity state with a narrow public RPC, if the
   existing preorder counters cannot safely represent the generic capability;
4. public Form replay/rate safety only if existing abuse utilities cannot
   cover the boundary without persistence;
5. generated Supabase types and focused RLS/grant changes for each new table or
   function.

No concept-specific business tables, public generic Record-read endpoint,
customer-created primitive, payment table, or vertical Booking module is
authorised or required.

## Known current gaps mapped to checkpoints

- J1-A: public create Forms, generic Booking configuration/runtime, preview
  no-write contracts and ADR-041.
- J1-B: bounded Q&A state, discovery fallback/provider boundary and candidate
  capability composition.
- J1-C: pre-signup candidate shell, deterministic synthetic graph-shaped data,
  Sites/Booking/Form preview and persistent preview overlay.
- J1-D: accepted-candidate continuity through auth, deterministic claim,
  draft Sites and Home/Sites navigation.
- J1-E: cross-business acceptance, security/RLS, responsive browser evidence,
  full repository gates and final report.

This resolution records implementation seams only. It does not reopen the
approved Journey 1 product or architecture decisions.
