# Builder Location creation intent

`builder_location_creation_intent_v1` is the private, bounded semantic task
used by the Milestone 10 Phase 10A Builder path. It receives the owner request,
the authoritative AI-safe Business context and a previously validated plan. It
returns either one exact Location name plus a timezone intent, or a bounded
clarification. The task-valid qualification set is frozen to eight inputs:
explicit IANA timezone, Business-timezone default, alternate wording, exact
active duplicate, exact inactive duplicate, missing name, generic local-time
override without an IANA value, and a multi-word identity such as New York with
an existing York Location.

The task cannot create a Location and cannot emit IDs, slugs, SQL, source code,
tokens or execution instructions. The deterministic validator revalidates the
planning boundary, exact one-step scope, owner-stated name, exact normalized
duplicate context and neutral timezone rules. It has no city, country, region,
geocoding or timezone-lookup table: local/different-timezone wording without an
exact IANA value clarifies, while otherwise the authoritative Business timezone
is allowed. The shared Location service and hardened database RPC remain the
only operational creation boundary.

The registered task and disabled runtime remain mapped to
`builder_location_creation_intent_disabled_v1`. After the reviewed exact
qualification and reliability gates passed, only the private authenticated
OpenAI Builder runtime uses the immutable task clone with policy
`builder_location_creation_intent_terra_medium_v1`; the global/default registry
does not expose that policy.
