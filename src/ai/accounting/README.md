# AI accounting boundary

Milestone 6 Phase 1B adds a server-only Business-aware layer around the
provider-neutral execution core. It validates and prepares the registered task
before reading settings or reserving, derives the trusted worst-case envelope,
then uses one narrow accounting service to reserve and settle.

Every Business starts disabled. The UTC usage day comes from PostgreSQL
statement time at reservation. Reservation locks only that Business's settings
row and includes one request plus the maximum input and output tokens across
all allowed attempts. Cost uses integer microusd and separately rounds up the
input and output rate components.

Complete usage settles to the aggregate actuals reported across every attempt.
Incomplete or unknown usage charges at least the reservation; an overrun is
recorded rather than clamped. A failure before any provider invocation cancels
the reservation. Settlement is retried once with the same immutable identity;
if it still fails, model output is not returned as a normal success.

Authenticated Owner/Admin RPCs expose only typed settings, the current UTC-day
summary and the latest 50 metadata-only runs. Service-role credentials exist
only inside this module and can execute only the reserve/settle RPCs; even
`service_role` has no direct table access. No prompt, task input, instruction,
model output, raw response, credential or arbitrary provider metadata is stored.

Phase 3B builder planning uses this boundary unchanged. Semantic-invalid output
settles as failed with aggregate usage, while a structurally and semantically
valid execution settles before the planning service performs its final context
comparison. If context changed during execution, usage remains recorded even
though the stale plan is discarded and never returned as current.

In Phase 4A OpenAI planning reserves 128,000 input and 8,192 output tokens
across two attempts at code-owned rates of 750,000 and 4,500,000 microusd per
million tokens. Integer ceiling arithmetic yields an exact worst-case
reservation of 132,864 microusd. All reported input tokens use the standard
rate; cached-token discounts are not applied. Refusal and incomplete responses
settle failed with reported usage, while missing usage remains conservatively
charged.
