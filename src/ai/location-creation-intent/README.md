# Builder Location creation intent

`builder_location_creation_intent_v1` is the private, bounded semantic task
used by the Milestone 10 Phase 10A Builder path. It receives the owner request,
the authoritative AI-safe Business context and a previously validated plan. It
returns either one exact Location name plus a timezone intent, or a bounded
clarification.

The task cannot create a Location and cannot emit IDs, slugs, SQL, source code,
tokens or execution instructions. The deterministic validator revalidates the
planning boundary, exact one-step scope, owner-stated name, duplicate context
and timezone rules. The shared Location service and the hardened database RPC
remain the only operational creation boundary.
