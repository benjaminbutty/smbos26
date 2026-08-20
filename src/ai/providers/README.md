# AI provider boundary

Milestone 6 defines one server-only, provider-neutral structured generation
interface. Production defaults to the disabled network-free adapter. The only
external adapter is OpenAI Responses and is registered only when
`AI_PROVIDER=openai` has a server-only `OPENAI_API_KEY`.

Future adapters must receive only the trusted request assembled by the
execution service: fixed provider/model identity, server-owned reasoning effort
and service tier, server-owned instruction, validated structured input, the
registered output contract, output-token limit and `AbortSignal`. They must not
accept arbitrary tools, URLs, headers, credentials, database clients or
mutation capabilities.

The execution service validates the provider's unknown output with the task's
strict Zod schema. The deterministic SMBOS runtime and both configuration and
operational services remain independent of AI availability.

Phase 1B does not change this provider contract. Internal execution accounting
aggregates bounded token usage across attempts, but tenancy, membership, limits,
pricing, reservation and durable audit remain in the separate server-only
accounting/orchestration layer. Providers receive none of those concerns, and
arbitrary provider metadata is not persisted.

`builder_plan_v1` uses the fixed code-owned `gpt-5.6-terra` alias in OpenAI
mode with explicit, non-overridable `reasoning: { effort: "medium" }` and
`service_tier: "auto"`. The
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
user input, `store: false`, the policy-owned output limit, reasoning effort and
service tier, `prompt_cache_options: { mode: "explicit" }` and an abort signal.
For a code-owned Fast profile, the request uses `service_tier: "fast"` and the
adapter requires the response's effective `service_tier: "priority"`; the
effective tier is exposed only as bounded metadata. They
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

## Journey 1 acquisition profile comparison — 20 August 2026

The dedicated correction subject was evaluated once for each candidate, with
the original tasks, prompts, schemas, validators, scenarios, 25-second timeout
and 24/24 correction gate unchanged. Luna Max Standard (`5007b895`) passed
2/24 hard executions because 22 timed out. Luna Max Fast (`d4ac56cc`) also
passed 2/24: 22 reached the unchanged output cap, while both successful
responses verified effective `priority`. Sol Medium (`77e318b`) passed 20/24:
three `unusual_other` runs repeated the authoritative cross-object leakage
failure and one run timed out. All three candidates passed quality validation
24/24, but none cleared the hard correction gate. Acquisition qualification,
reliability, product corpus and exact-head CI were consequently not run. No
current acquisition winner is approved; further profile work is
PRODUCT DECISION REQUIRED.

## Journey 1 R4a latency diagnostic — 20 August 2026

Luna Max Fast and Sol Medium were each run once over the unchanged eight
scenario × three repetition correction workload with a temporary 45-second
diagnostic ceiling. This evidence is diagnostic only; the production 25-second
timeout and all qualification thresholds remain unchanged.

All 24 Luna calls and all 24 Sol calls returned the finite
`provider_transport_rate_limited` failure before a provider response. Luna's
rate-limit response times were min/median/p90/p95/max/average
`455/565/906/1,638/1,969/720 ms`; Sol's were
`448/579/815/921/1,025/610 ms`. Both candidates therefore have zero completed
responses, zero observed effective tiers, zero tokens and zero cost in this
diagnostic. Successful latency percentiles, maximum successful latency and a
timeout recommendation are unavailable. The run was not repeated and does not
constitute correction qualification evidence.

## Phase 12B Record-update provider boundary

The Record-update task uses this same strict OpenAI Responses adapter with
`gpt-5.6-terra`, medium reasoning, `store: false`, no tools and no conversation
state. Its exact-schema compatibility gate is separately activated, sequential
and redacted; it reserves 41,920 microusd per probe, at most 32 probes and a
1,350,000-microusd hard ceiling. It receives a fixed synthetic probe only, not
owner requests or business data. The global/default update task remains
disabled until independent evidence is reviewed.
