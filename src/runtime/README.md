# Runtime boundary

Milestone 3 implements deterministic Field, Form, View, and Page rendering
here. Renderers consume schemas validated at both the TypeScript and PostgreSQL
boundaries. They never execute configuration as code, HTML, SQL, or arbitrary
requests.

The authenticated Form boundary reads only configured Field keys, derives the
Business from the resolved tenant context, and delegates generic Record writes
to GraphService. Relationship controls and public submissions are intentionally
deferred.
