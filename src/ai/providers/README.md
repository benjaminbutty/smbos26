# AI provider boundary

Milestone 6 defines one server-only, provider-neutral structured generation
interface. Production defaults to the disabled network-free adapter. The only
external adapter is OpenAI Responses and is registered only when
`AI_PROVIDER=openai` has a server-only `OPENAI_API_KEY`.

Future adapters must receive only the trusted request assembled by the
execution service: fixed provider/model identity, server-owned instruction,
validated structured input, the registered output contract, output-token
limit and `AbortSignal`. They must not accept arbitrary tools, URLs, headers,
credentials, database clients or mutation capabilities.

The execution service validates the provider's unknown output with the task's
strict Zod schema. The deterministic SMBOS runtime and both configuration and
operational services remain independent of AI availability.

Phase 1B does not change this provider contract. Internal execution accounting
aggregates bounded token usage across attempts, but tenancy, membership, limits,
pricing, reservation and durable audit remain in the separate server-only
accounting/orchestration layer. Providers receive none of those concerns, and
arbitrary provider metadata is not persisted.

`builder_plan_v1` uses the fixed code-owned `gpt-5.6-terra` alias in OpenAI
mode with explicit, non-overridable `reasoning: { effort: "medium" }`. The
alias may advance independently, so its live qualification must be rerun after
a material alias advance or a change to the execution/planning subject. The
OpenAI runtime also retains the disabled provider for
`contract_probe_v1`, so deliberately unavailable tasks return controlled
`ai_disabled` rather than failing on a missing registry entry. Production
runtime construction validates every registered task → policy → provider
identity and reference before returning. Its response format is a strict
deterministic JSON Schema adaptation
wrapped under one required `result` property and unwrapped before registered
Zod and semantic validation. Object properties remain required and reject
extras; `oneOf` is explicitly converted to `anyOf`; only the provider-owned
`$schema` dialect declaration is removed. Provider-supported format
constraints are preserved only for the finite allow-list `date-time`, `time`,
`date`, `duration`, `email`, `hostname`, `ipv4`, `ipv6` and `uuid`; unsupported
formats fail locally before an SDK request. Server-side Zod validation remains
authoritative. Unsafe schemas fail before an
SDK request.

Responses receive one server instruction and one deterministically serialized
user input, `store: false`, the fixed output limit, `medium` reasoning,
`prompt_cache_options: { mode: "explicit" }` and an abort signal. They
receive no tools, previous response, conversation, background mode, arbitrary
metadata, identity, headers or endpoint. SMBOS stores no request or response.
The SDK client is explicitly constructed with `logLevel: "off"`; ambient
`OPENAI_LOG` values cannot enable SDK request or response payload logging for
SMBOS calls.
`store: false` disables Responses application-state storage for this request;
it does not assert Zero Data Retention. Provider abuse-monitoring and
organization retention depend on account controls and must be reviewed before
production activation.

GPT-5.6 otherwise uses implicit prompt caching, whose cache writes cost more
than ordinary uncached input. The first Terra profile deliberately owns
explicit mode inside this provider and sends no prompt-cache breakpoint, key or
retention option. With no explicit breakpoint, this planning request does not
use provider prompt caching. Cache use needs a separate future review with
detailed cache-token accounting; it is not caller-, Business-, task-,
environment- or model-selectable.

Refusal, content filtering and max-output incompleteness are non-retryable.
Only rate limits and transient network/5xx failures use the bounded execution
retry policy. Reported usage is retained on failures; raw content and SDK
errors never enter public errors or audit.

Phase 4C has two separate sequential engineering gates over this same
production adapter, task and policy. Qualification requires
`RUN_LIVE_OPENAI_TERRA_QUALIFICATION=1`; repeated reliability requires
`RUN_LIVE_OPENAI_TERRA_RELIABILITY=1`; each also requires
`AI_PROVIDER=openai` and a non-blank server-only `OPENAI_API_KEY`. Neither the
other gate nor the historical `RUN_LIVE_OPENAI_EVAL` variable activates a
request. Normal tests use injected providers; CI, builds and demo seed never
run either external gate.

Only bounded evaluation metadata may be printed. Request text, Business
context, Location references, model prose, provider bodies/IDs, reasoning
content and credentials are neither printed nor persisted. Qualification has a
fixed aggregate maximum reservation of 3,543,040 microusd and a code-owned
3,700,000 microusd hard ceiling; repeated reliability has 24 executions, a
10,629,120 microusd maximum and an 11,000,000 microusd ceiling.

The reviewed redacted Terra evidence passed qualification 8/8 and reliability
24/24, with every reliability scenario passing 3/3 and one provider attempt per
execution. Qualification used 34,949 input and 3,476 output tokens, 139,515
estimated microusd and 47,157 ms; reliability used 104,847 input and 8,764
output tokens, 393,585 estimated microusd and 108,779 ms. Structural,
semantic, scenario-gate and provider failure counts were zero in both gates.
This clears the planning gate for the frozen provider profile as bounded
engineering evidence, not universal model perfection. Operation generation and
mutation authority remain unimplemented; future profile or frozen-subject
changes invalidate the evidence and require both gates to be rerun.

## Phase 12B Record-update provider boundary

The Record-update task uses this same strict OpenAI Responses adapter with
`gpt-5.6-terra`, medium reasoning, `store: false`, no tools and no conversation
state. Its exact-schema compatibility gate is separately activated, sequential
and redacted; it reserves 41,920 microusd per probe, at most 32 probes and a
1,350,000-microusd hard ceiling. It receives a fixed synthetic probe only, not
owner requests or business data. The global/default update task remains
disabled until independent evidence is reviewed.
