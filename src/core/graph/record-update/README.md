# Generic Record update boundary

This module is the server-owned boundary for a confirmed update to one active
generic Record. It parses the narrow selector and value contracts, composes a
minimal patch and owner-safe diff, and calls the two authenticated PostgreSQL
RPCs that resolve and update the target.

It does not browse Records, run models, create configuration changes, expose
candidate rows, change lifecycle status, or contain Product-specific logic.
