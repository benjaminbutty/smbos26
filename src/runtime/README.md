# Runtime boundary

Milestone 3 implements deterministic Field, Form, View, and Page rendering
here. Renderers consume schemas validated at both the TypeScript and PostgreSQL
boundaries. They never execute configuration as code, HTML, SQL, or arbitrary
requests.

The authenticated live Form boundary reads only configured Field keys, derives
the Business from the resolved tenant context, and delegates generic Record
writes to GraphService. Candidate preview reuses these renderers but supplies
no Form action, disables generic Form controls, suppresses View mutation/detail
links and keeps every Page link inside its stable-key preview route.

The Phase 12A Builder path does not add a second Record renderer. After the
confirmed graph insert, the server selects the existing active internal View
for the target Object and redirects the owner there. If no eligible View is
available, the Record remains created and the owner receives the bounded
existing fallback destination; runtime rendering still reads generic graph
metadata rather than Product-specific code.

The Phase 12B update path reuses the same generic Record renderer and selects
the first active internal non-detail View for the target Object by stable key.
The model and browser cannot choose that destination. If no suitable View
exists, the update still succeeds and the owner receives the normal workspace
fallback. The update is ordinary operational data and does not create a
configuration-history entry.

## Direct Table Workspace

The live Table workspace is a generic grid over one configured internal Table
View. Phase 15A removes the old repeated Edit-button workflow from that route:
supported cells use the existing typed submission parser and GraphService,
rows use configured Forms or visible Field/default creation, and `?record=`
opens the selected Record in a side panel. Preview and non-direct routes keep
their read-only/full-record behavior. Structural Table actions remain in
`src/core/configuration/direct-tables/`; operational row/cell writes never
create configuration history.

## Tables + Pages workspace foundation

Owner/Admin users share one workspace shell for Tables and Pages. Pages are
created, renamed, and saved through the bounded direct Page facade in
`src/core/configuration/direct-pages/`; each action reloads the active
snapshot and applies one complete M5-backed configuration change with exact
currentness. Page layout JSON is the canonical SMBOS Page grammar, not editor
JSON.

`src/runtime/page-editor/` is a small Tiptap adapter for the supported Page
blocks: plain text, Heading 1/2/3, Divider, Callout, and internal Table Views.
It translates at the persistence boundary, keeps unsupported historical
blocks as read-only atoms, and embeds the production Table kernel with
structural controls disabled. Staff and published/static renderers continue to
use `PageRenderer`; the authoring surface is not a second runtime renderer.
