# Lenni Journey 1 visual convergence

Status: in progress  
Base: `4f3637c3ac08cd0b8aeb09db327bf519fce26665` (PR #57 merge)  
Branch: `journey1/visual-convergence`

## VC0 mapping

Journey 1 already has the required behaviour and trusted boundaries. This phase
maps the approved visual direction onto those existing routes and components:

| Screen | Existing implementation seam | Visual-convergence treatment |
| --- | --- | --- |
| S1 Start | `/start`, `ProposalForm`, `AcquisitionRequestInput`, `AppShell` | Focused Lenni header, warm canvas, stronger description-first hierarchy, compact category cues, examples, privacy hint and consequence-labelled action. |
| S2 Clarification | `/start`, `AcquisitionConversation` | Keep the original request and prior answers quiet, make the current bounded question dominant, and add honest journey orientation. |
| S3 Understanding | `/start`, `AcquisitionProposalCard` | Present existing candidate concepts and sentence-form Connection text as an owner-readable Workspace Map. No structured graph, persistence or AI call is added. |
| S4 Preview Home | `/start/preview/home`, `CandidatePreviewShell`, `HomePreview` | Converge on the real workspace grammar, retain a persistent Preview cue, label all candidate counts/examples honestly and keep approval separate from creation. |
| S5 Preview Table | `/start/preview/table-*`, `CandidatePreviewTable`, `ProductionTableWorkspace` | Retain the shared read-only Table runtime and improve Saved View, status and temporary-example presentation only. |
| S6 Record context | Existing read-only `RecordPanel` opened from candidate rows | Use the current contextual read path, owner-facing Connection wording and a full-screen compact layout. No Record capability is added. |
| S7 Refinement | `/start?from=preview`, `AcquisitionRefinement` | Restyle the existing bounded refinement loop without changing its allowance, reconciliation, model or prompts. |
| S8 Authentication | `/sign-up`, `/sign-in`, existing `returnTo=/start/business` flow | Keep the accepted setup in context and present authentication as saving it. Auth fields and safety behaviour remain unchanged. |
| S9 Business basics | `/start/business`, `TimezoneConfirmation`, `claimWorkspaceAction` | Retain accepted-candidate context, existing required fields and the single trusted `Create workspace` action. |
| S10 Creating | Existing server-action pending/failure/success states | Add a real indeterminate pending treatment with no percentages, fictional stages or delay. Existing error recovery and redirect remain authoritative. |
| S11 Handoff | `/app/[businessSlug]`, `WorkspaceHome`, authenticated workspace shell | Apply continuity styling and truthful copy only. Real configured destinations and empty states remain the source of truth. |

## Deliberate interpretations

- Proposal Connections expose owner-readable sentences rather than safe endpoint
  metadata, so the Workspace Map will not invent lines or source/target pairing.
- The design mock's partially filled creation bar is interpreted as indeterminate
  activity because the claim boundary exposes no staged percentage.
- Candidate example Records remain synthetic and preview-only; preview approval
  and Business creation remain separate actions.
- S11 will not add candidate-spine ordering, Work now, Needs attention, Saved View
  placement or any other Journey 2 operating model.
- Existing public Site and Booking paths remain untouched; claimed Sites remain
  Draft.
- Satoshi is named first in the existing approved fallback stack, but no compliant
  local font delivery is present. This phase does not add a font binary or CDN.

## Behavioural boundary

The implementation is limited to route composition, reusable presentation
components and CSS. Acquisition planning/refinement behaviour, AI policy and
accounting, acceptance/current-candidate checks, claim, configuration lifecycle,
permissions, RLS, public capability and persistence are not implementation seams
for this phase.
