# Lenni pre-reset UX hygiene report

## Scope

- Branch: `ux/pre-reset-hygiene`
- Base: `main` at `6f48ab75c7e6172730d91e910a3420ac9d595eb2`
- Purpose: correct objectively broken or misleading owner-testing details before the separate Experience Architecture Reset.
- Excluded: architecture, routes, lifecycle, AI/provider/model behaviour, migrations, dependencies, new primitives, and all reset/C2+ work.

## Corrections

### Public acquisition

`/start` now uses the approved heading, supporting copy, product description, and `Start building` CTA. The category fieldset uses the existing spacing tokens, category options use the ordinary Lenni card/control radius, and the manual route shares the acquisition form container alignment.

### Table property menus

The existing `Popover` is reused with an explicit column-header anchor. Property menus and option editors use the existing Lenni panel tokens, a consistent `18rem` maximum width, constrained height, fixed viewport-safe placement, and a body portal so transformed grid ancestors cannot clip or offset the menu. Save and Back remain the existing controls and the structural persistence boundary is unchanged. Escape closes the menu and returns focus to the invoking column-menu button.

### Connection picker

The existing generic connected-Record picker now has an explicit no-query hint, an unmistakable disabled create state, and the canonical Coral action treatment once a name is entered. Create failures are announced in an alert. Unsupported quick-create actions are not rendered as dead buttons; existing configured-creation guidance remains available through the current workspace creation-screen path.

### Empty Choice / Status

Empty Choice/Status values render `No options yet` instead of a meaningless `Choose…` picker. The owner-facing empty state points to the existing column-menu option editor, and the existing non-editable/read-only boundary is preserved. Empty option configuration starts empty and cannot be saved until it contains valid options.

### Column reorder

The existing React Data Grid `draggable` and `onColumnsReorder` boundary remains the only reorder path. Headers now expose a visible drag affordance, cursor state, and the existing keyboard/menu Move left / Move right fallback. No second persistence mechanism was added.

## Browser evidence

Evidence was captured against the seeded local dog-grooming workspace and `/start` before and after the changes.

### `/start`

| Viewport | Acquisition form | Manual route | Category radius | Horizontal overflow |
| --- | --- | --- | --- | --- |
| 1440×900 | left 144, width 928 | left 144, width 928, left-aligned | 14px | none (`scrollWidth = 1440`) |
| 1024×768 | left 16, width 928 | left 16, width 928, left-aligned | 14px | none (`scrollWidth = 1024`) |
| 390×844 | left 10, width 370 | left 10, width 370, left-aligned | 14px | none (`scrollWidth = 390`) |

The final rendered heading is `Tell Lenni about your business`, the supporting copy is `Describe the work you run and Lenni will suggest a setup to get you started`, and the CTA is `Start building`.

### Popover and option editor

- At 390×844, the property menu measured left 89 / right 377 / top 294 / bottom 584, with no page overflow; it retained the normal 288px width, 10px panel radius, fixed placement, and elevated layer.
- The option editor retained the same 288px menu, a 270px form, stable `Save options` and `Back` controls, and no clipping. Escape closed it and restored focus to the invoking column-menu button.
- At 1440×900, the same menu measured 288px wide with the Lenni panel elevation and z-index 90.

### Connection picker

- No query: `Type a name to enable quick-create.` is shown and `+ Create pet` is disabled with neutral surface/border styling.
- Typed unmatched query: `No matching records.` is shown and the create action uses Coral (`var(--coral-600)`).
- Safe quick-create was exercised in the seeded dog-grooming workspace and created `Hygiene check pet`, which subsequently appeared in the Pets table.
- A target without an exposed create callback renders no apparently actionable create button. The existing configured-creation-screen footer/guidance path remains unchanged.

### Drag reorder

All reorderable dog-grooming headers exposed `draggable="true"`, the visible `⋮⋮` affordance, and the existing reorder hint. The in-app browser harness did not fire the native React Data Grid reorder callback during the pointer-drag attempt; the existing Move left fallback was also exercised and the proof fixture safely rejected that structural mutation with `That Table change could not be completed safely.` The implementation does not alter the existing persistence/currentness/configuration-version boundary, so no backend or fixture workaround was added to this hygiene PR.

## Verification

- Focused: 5 hygiene tests plus the editor-kernel, production-kernel, and unified UI suites — **43 passed**.
- TypeScript: `tsc --noEmit --incremental false` — **passed**.
- Repository: `npm run check` — **78 files / 831 tests passed**; format, typecheck, and lint passed.
- Production: `npm run build` — **passed** with the documented `.env.example` fixture value for `ACQUISITION_RATE_LIMIT_SECRET`.

## Design and architecture guardrails

No database migration, dependency, route, state framework, UI framework, platform primitive, generic action registry, AI change, provider/model change, or business-specific source was added. Existing acquisition, proposal, authentication, planning, deterministic fallback, table actions, and persistence boundaries remain in place.
