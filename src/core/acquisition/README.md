# Phase 5 acquisition boundary

The public `/start` journey uses temporary server-owned state before a Business
exists. The browser holds only an opaque HttpOnly token and receives the
owner-readable proposal. Configuration operations remain in a service-role-only
row until authenticated claim.

Each session can reserve two provider-backed attempts. Reservation happens
atomically before provider execution, so failures after execution still consume
an attempt. A separate daily row keyed by a one-way HMAC of trusted deployment
request metadata caps replacement-cookie attempts at six per day. Those rows
are retained for no more than the current day plus two prior days through
bounded opportunistic acquisition cleanup; no raw IP address is stored.

One reserved owner submission normally executes the acquisition planner once.
It may execute the same task one second time only after the exact deterministic
`cross_object_field_leakage` plus `required_field` refusal. That correction uses
the original grounded request without the invalid output and does not reserve
another owner-facing attempt. No other failure triggers semantic replanning,
and there is no third execution.

Raw descriptions and proposal operations are retained only while an active
session can be reviewed, regenerated or claimed. Successful claim immediately
sets both values to null. Expired sessions are scrubbed when they are read and
by the next bounded reservation cleanup; already-scrubbed expired rows are
deleted after two days. Raw descriptions, model output and operation JSON are
not included in acquisition events or application error messages.

The model uses no tools or database client. A narrow acquisition design is
strictly validated and passed through a small pure adapter into the existing
frozen draft grammar, then validated and compiled by the existing pure compiler.
The result is retained as untrusted proposed operations. Only the
authenticated atomic claim invokes Milestone 5 validation and application.
Deterministic category starters and the manual route remain available without
AI.
