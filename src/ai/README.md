# AI boundaries

AI plans and expresses bounded intent; deterministic server code resolves
tenant-owned state and performs mutations. The model-facing Business context
contains configuration only, never operational Records, current Record values,
UUIDs or mutation authority.

Phase 12B adds the disabled-by-default
`builder_record_update_intent_v1` task for one generic `update_record` route.
Its independent Terra compatibility, qualification and reliability gates are
engineering-only and are not run automatically. The final Record update is
explicitly confirmed and AI-free. Phase 12A's frozen Record-creation subject
remains unchanged.
