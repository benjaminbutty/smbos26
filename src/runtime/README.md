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
