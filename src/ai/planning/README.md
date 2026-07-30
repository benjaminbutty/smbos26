# Builder planning boundary

`builder_plan_v1` turns one bounded owner request plus the exact Phase 3A
model-facing Business context into either one to five clarification questions
or an owner-readable proposed plan. The registered input, server-owned
instruction, strict output schema, semantic validator and trusted execution
policy are fixed in production.

Planning categories describe possible later configuration or operational work.
They are not tools, Milestone 5 operations or mutation authority. Planning does
not create a proposal, validate, apply, publish, change a Record or Location, or
persist the request or result.

Domain concepts appear only when a plan concerns generic Business concepts.
Platform-only operational plans, such as creating or renaming a Location, keep
the required `concepts` property as an explicit empty array and use empty
`affected_concepts`. Location remains a first-class platform entity; planning
does not invent or imply a generic Location Object. Such a plan is still
descriptive and non-executing.

The authenticated loader derives actor and Business identity for accounting and
keeps both outside task input. Exact configuration currentness also remains
outside model input. After a metered execution, the service reloads and
canonically projects context again; any version, revision or projected-context
change discards the plan as stale. The metadata-only execution audit still
records usage incurred by that discarded execution.

There is an unavoidable race after the final read. Future operation generation
and proposal creation must rebuild context and retain expected-head protection.

Before any live external provider is enabled, SMBOS must decide and test whether
configured HTTPS query strings/fragments and `mailto:`/`tel:` links are sent in
full, reduced to normalized origins, or redacted. No live provider may be
enabled before that URL-minimisation decision is implemented.
