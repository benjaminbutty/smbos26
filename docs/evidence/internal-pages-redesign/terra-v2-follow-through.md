# Pages v2 follow-through evidence

Date: 8 September 2026. This record supplements the earlier historical Pages
evidence; it does not replace its baseline claims.

## Reviewed outcome

- The approved v2 reference remains available at `/reference/pages`.
- The internal Page editor and shared reading renderer now use the scoped
  `internal-page-editor.module.css` document treatment: 36 px title, 16 px
  prose, a 720 px prose measure, wider live Tables, compact contextual controls
  and 16 px mobile gutters.
- Checklist embeds remain normal shared Table Records. Their resting header is
  quiet, their editor settings sit in `View options`, and their reading header
  uses the same compact treatment.
- Native ProseMirror paragraph splits receive a new block ID before autosave,
  preventing a duplicate identity from causing a newer candidate to be ignored.
  Slash choices validate the actual `/query` range before every insertion,
  including checklist insertion; an invalid range dismisses without replacing
  unrelated selected text.
- A PostgreSQL statement timeout is presented as a retryable Page save outcome:
  “Saving took too long. Your edits are still here. Try again.” The editor keeps
  the candidate and does not fabricate a successful acknowledgement.
- `src/app/icon.svg` uses the supplied Lenni small-cut mark in white on ink.

## Browser evidence supplied by the independent reviewer

- Owner Page at 1440 px and 1024 px: compact prose-aligned checklist accepted;
  Table header/actions fit without overflow.
- Reading Page at 390 px: 16 px document gutters, compact Page controls, no
  horizontal overflow, compact checklist header, and Record-first Table layout
  accepted.
- Native `Enter` followed by delayed `/` preserved its caret and command past
  `Saved`; choosing Heading inserted at the command and a fresh reload retained
  the following prose. This is the browser reproduction for the duplicate block
  ID autosave regression.
- Formatting save/undo and reading-mode flush were exercised. A live checklist
  committed exactly once, although its post-commit response remained in
  `Saving` for several minutes before a fresh navigation recovered the
  checklist. Its toggle updated the shared Table Record, and `Open table`
  reached the same Record.
- Image upload completed. One initial Page configuration request rolled back on
  PostgreSQL timeout; the retained draft was manually retried successfully,
  rendered in reading mode, and persisted after a reload.

## Automated verification

Passed:

- `npm run format:check`
- `npm run typecheck`
- `npm run lint`
- focused Page/editor/service suites: 27 tests
- `npm test`: 105 files, 1,068 tests

Incomplete because of the local test environment:

- `npm run test:integration` could not access Docker from the sandbox, so its
  suites stopped before assertions.
- The focused escalated direct-Page, checklist, and RLS rerun reached Docker,
  but `supabase_db_smbos26` was unhealthy after local resource starvation
  (long checkpoints, delayed autovacuum and realtime scheduler delays). Its
  suites stopped in setup; do not read this as a passing RLS/integration run.
- After one non-destructive local container restart, the final authenticated
  Page preview rendered its logo, body, Table, and the shared unchecked
  checklist Record. A final bounded direct-Page/checklist/RLS retry was stopped
  when the database became unhealthy again; no assertions completed.
- `npm run build` compiled successfully in 44 seconds, then stalled in Next’s
  post-compile TypeScript/page phase. Its cause was not confirmed, so it was
  stopped rather than reported as a successful build.

## Remaining browser coverage

The final reviewer did not claim pointer drag/move evidence because the
available browser control could not perform the required hover/drag sequence.
Staff/viewer journeys and a fresh Admin journey were not re-exercised in this
final pass. A local public Site fixture was unavailable, so the shared Site
regression boundary is automated coverage rather than a fresh browser smoke.
