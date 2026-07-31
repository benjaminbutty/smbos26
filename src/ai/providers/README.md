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

`builder_plan_v1` uses the fixed `gpt-5.4-mini-2026-03-17` model in OpenAI
mode. The OpenAI runtime also retains the disabled provider for
`contract_probe_v1`, so deliberately unavailable tasks return controlled
`ai_disabled` rather than failing on a missing registry entry. Production
runtime construction validates every registered task → policy → provider
identity and reference before returning. Its response format is a strict
deterministic JSON Schema adaptation
wrapped under one required `result` property and unwrapped before registered
Zod and semantic validation. Object properties remain required and reject
extras; `oneOf` is explicitly converted to `anyOf`; only the provider-owned
`$schema` dialect declaration is removed. Provider-supported format
constraints are preserved, and server-side Zod validation remains
authoritative. Unsafe schemas fail before an
SDK request.

Responses receive one server instruction and one deterministically serialized
user input, `store: false`, the fixed output limit and abort signal. They
receive no tools, previous response, conversation, background mode, arbitrary
metadata, identity, headers or endpoint. SMBOS stores no request or response.
The SDK client is explicitly constructed with `logLevel: "off"`; ambient
`OPENAI_LOG` values cannot enable SDK request or response payload logging for
SMBOS calls.
`store: false` disables Responses application-state storage for this request;
it does not assert Zero Data Retention. Provider abuse-monitoring and
organization retention depend on account controls and must be reviewed before
production activation.

Refusal, content filtering and max-output incompleteness are non-retryable.
Only rate limits and transient network/5xx failures use the bounded execution
retry policy. Reported usage is retained on failures; raw content and SDK
errors never enter public errors or audit.
