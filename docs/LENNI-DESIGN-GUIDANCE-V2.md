# Lenni design guidance v2

**Status:** Current visual and interaction authority for Lenni work
**Date:** 8 September 2026

## Provenance and scope

This is the repository's working consolidation of the approved **Lenni Design
System and UX Constitution v2**. It preserves the decisions supplied in the
`Brand Naming and Design` conversation (`6a7466d4-6ad0-83eb-a9d2-c80064ce7e87`),
including its later Master Design System prompt. That prompt is a derived,
usable restatement; it is not represented here as the original constitution.

The original source document, an approved logo file, and an approved logo-use
specification are not present in the repository, its reachable Git history, or
the targeted local project materials inspected on 8 September. The only
approved brand asset currently available in source is the textual name
**Lenni**. Use the shared textual wordmark component. Do not draw, imply or
substitute a logo symbol until its approved source asset and usage rules are
provided.

This guidance governs product presentation and interaction. It does not change
the product north star, platform primitives, configuration lifecycle,
authorisation, Row Level Security, page grammar, or public Site boundary. Read
those sources and relevant ADRs before implementation.

## Product character

Lenni is a warm, calm and capable operating workspace for independent
businesses. It should feel direct during routine work and trustworthy where a
change has a consequence. It takes cues from clear, composable workspace
products without copying one.

- Put the owner's work before the underlying mechanics.
- Let people click the thing they want to change.
- Keep assistance quiet and integrated into the same workspace.
- Use plain business language. Do not make schema, JSON, records internals or
  configuration history the default vocabulary.
- Use cards only where they create a meaningful group. Do not wrap every Page
  block or operating surface in a card.

## Foundation

### Colour

Use warm neutrals for the canvas and operating surfaces. Coral is Lenni's
signature accent, selection colour and primary-action colour. It is not a
success, error or AI colour.

| Token | Value | Use |
| --- | --- | --- |
| `coral-50` | `#FFF1EF` | subtle selection / brand tint |
| `coral-100` | `#FFE4DF` | subtle selection / brand tint |
| `coral-200` | `#FFC9C2` | border or quiet emphasis |
| `coral-300` | `#FFA69C` | hover / underline detail |
| `coral-400` | `#FF8273` | non-text emphasis |
| `coral-500` | `#FF5A4D` | signature accent |
| `coral-600` | `#E9483C` | active detail |
| `coral-700` | `#D83A2F` | primary fill with white text |
| `coral-800` | `#B92C24` | pressed primary / accessible links |
| `coral-900` | `#8F211B` | high-contrast coral text |

| Surface / text | Value |
| --- | --- |
| canvas | `#FAF8F5` |
| base | `#FFFFFF` |
| subtle | `#F5F2EE` |
| strong | `#ECE7E1` |
| subtle border | `#E5DED7` |
| strong border | `#D5CCC3` |
| primary text | `#171A1D` |
| secondary text | `#5D646B` |
| tertiary text | `#6A7178` |

Use explicit semantic state labels and their existing semantic tokens for
success, warning, error, preview and published state. Do not use coral as a
semantic substitute.

### Type, spacing and shape

Satoshi is Lenni's working typeface, followed by a high-quality system sans
fallback. This repository loads Fontshare's official API stylesheet. Satoshi is
covered by the Indian Type Foundry Free Font License for commercial web use. Its
published terms say that transmitting the font software through independent
font-serving or font-replacement technology needs the licensor's prior written
consent; do not self-host or redistribute the binary without confirming a
licence that permits that delivery. See
[Fontshare's ITF Free Font License](https://www.fontshare.com/licenses/itf-ffl).

Use a 4px base and an 8px working rhythm. The reusable steps are 4, 8, 12, 16,
20, 24, 32, 40, 48 and 64px. Use 6px radius for compact controls, 10px for
standard controls, and 14px for panels. A flat surface with a border is the
default; shadows belong to actual layers such as menus and drawers.

| Element | Size / line height / weight |
| --- | --- |
| Product H1 | 36px / 44px / 700 |
| H2 | 28px / 36px / 600 |
| H3 | 20px / 28px / 600 |
| Body | 16px / 24px / 400 |
| Small | 14px / 20px / 400 |
| Label / button | 12–14px / 16–20px / 600 |

Use sentence case, visible labels, visible focus, and tabular numerals where
numeric alignment matters. Comfortable density belongs to Pages; denser,
operational density belongs to Tables.

## Page document contract

Pages are business documents with live operational content. They are neither a
generic CMS nor a dashboard grid.

- One title and one document hierarchy. A desktop Page title is 36px; body
  text is 16px / 24px in `text-primary`.
- Prose is about 720px wide. Images and live content may use the wider
  document region (up to roughly 1,120px) where that makes the work clearer.
- Keep 16px horizontal document gutters on mobile. Do not allow document-level
  horizontal overflow; a live Table follows the established Record-first
  mobile model.
- Autosave feedback is quiet: Saving, Saved, or a clear recovery state. It is
  not a persistent management toolbar.
- Use a slash menu and contextual block controls while editing. Controls stay
  contextual: a resting document should read as a document.
- A live Table has one purposeful header: its name, source context and an Open
  table path. View replacement and read-only configuration appear from the
  selected block's contextual menu, never as permanent embed chrome.
- A checklist is directly operable, compact, and visibly shared business data.
  Its source/configuration is contextual rather than editorial decoration.
- Selection and insertion may use restrained coral. Ordinary prose, metadata
  and empty states stay neutral.

## Review method

Visual work must be reviewed in a browser before broad restyling. Use real
Satoshi delivery, the tokens above, and actual component shapes to show at
least: an empty Page, a populated operations Page with prose/image/collapse/
compact checklist/live Table, mobile, selected and insertion states. Capture
1440px, 1024px and 390px evidence. Pair screenshots with real keyboard/caret,
formatting, insertion, movement, undo, autosave and recovery journeys; source
assertions and coordinator tests do not establish interaction acceptance.

## Historical documents

For new visual work, this document supersedes the visual-direction portions of
`LENNI-UNIFIED-PRODUCT-EXPERIENCE-PHASE-1.md`,
`lenni-journey-1-visual-convergence-resolution.md`, and
`interaction-quality-reset-tables-pages.md`. Those documents remain historical
records and retain their stated implementation/security boundaries. ADR-052
remains the authority for the Internal Pages autosave and bounded grammar
amendment; its automatic save decision supersedes earlier explicit-save
guidance.
