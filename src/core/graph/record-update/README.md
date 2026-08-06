# Generic Record update boundary

This module is the server-owned boundary for a confirmed update to one active
generic Record. It parses one exact supported selector and one to three typed
absolute update values, composes a minimal patch and owner-safe diff, and calls
the two authenticated PostgreSQL RPCs that resolve and update the target.

PostgreSQL owns selector matching and returns only bounded not-found,
ambiguous or ready state. The preparation result includes the actual current
values needed for confirmation, but not a full Record or candidate rows. The
confirmation token carries the server-selected Record ID, its `updated_at`
currentness and the typed patch. The final RPC checks the head, locks that
Record once and lets the existing graph validation/timestamp triggers perform
the deterministic write.

It does not browse Records, run models, create configuration changes, expose
candidate rows, change lifecycle status, or contain Product-specific logic.
