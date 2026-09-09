# Business software that fits — review evidence

Captured 9 September 2026 against the rebuilt local production server at
`http://localhost:3013/business-software-that-fits`. The retained server is
for review only; it does not use a production signup or a test route.

## Browser-rendered states

- [Desktop, 1440 × 900](desktop-1440x900.png)
- [Tablet, 1024 × 768](tablet-1024x768.png)
- [Mobile, 390 × 844](mobile-390x844.png)
- [Narrow mobile, 360 × 800](mobile-360x800.png)
- [Opaque non-modal sample-record sheet](record-sheet-1440x900.png)
- [Trades labels and connected work](trades-connected-1440x900.png)

The machine-readable browser record is
[browser-acceptance-2026-09-09.json](browser-acceptance-2026-09-09.json).
Chrome 152 drove real pointer and keyboard input against the production build.
It records no horizontal overflow at all four viewports, compact navigation and
filter type at 11px, left-aligned record rows, reduced-motion duration of
0.01ms, and no browser console errors or runtime exceptions.

The keyboard journeys verify skip-link focus, arrow-key tab movement, preview
focus, Names Apply/Cancel return to the name input, Stage Cancel returns to Add
stage, Reset returns to Reset example, and Escape returns to the record
trigger. The sample-record sheet has `role="dialog"`, `aria-modal="false"`,
and an opaque white computed background. An actual outside pointer on the
header's Find your fit link closes the sheet, follows `#fit-details`, and keeps
focus on that link.

The same run checks the Trades and Consultancy descriptors/work labels. It
records no local demo write request. A delayed POST to `jamp.io/api/main` is
listed separately: it comes from the pre-existing global analytics scripts in
`src/app/layout.tsx`, not from the page demo. The only local POST in the form
part of the journey is a deliberate blank submission; it renders the existing
safe validation message before the waitlist action reaches storage.

## Form-state coverage

The actual browser journey covers the blank-email error. Test-only rendering in
`tests/early-access-form-ui.test.ts` drives the real `EarlyAccessForm` through
pending, storage-error and success hook states. `tests/marketing-waitlist.test.ts`
covers the corresponding validated Server Action outcomes. No successful
signup was sent during browser evidence capture.

## Checks after the security maintenance

- `npm run check` — 113 test files, 1,094 tests passed.
- `npm run build` — passed; the route is static.
- `npm audit --omit=dev --audit-level=high` — 0 vulnerabilities.
- Focused marketing, form, and transient-pointer tests — 10 passed.

The package maintenance pins Next and its ESLint plugin to 16.3.3, direct
Tiptap packages to 3.30.5, and the Sharp override to 0.35.4.
