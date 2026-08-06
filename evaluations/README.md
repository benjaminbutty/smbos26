# Builder planning evaluation

Phase 4C provides two isolated engineering-only live gates for the frozen
`builder_plan_v1` planning subject and code-owned `gpt-5.6-terra` alias with
`medium` reasoning. Neither gate is part of the deployed application, tenant
runtime, accounting boundary, mutation path, route, Server Action, or UI.

GPT-5.6 otherwise uses implicit prompt caching. The production request for this
profile explicitly sends `prompt_cache_options: { mode: "explicit" }` and no
prompt-cache breakpoint, key or retention option, so these evaluations use no
provider prompt caching. The ordinary $2.50/M input rate therefore remains the
trusted reservation rate. Cache-token accounting and cache pricing require a
separate future review.

Qualification runs exactly eight existing scenarios once, sequentially:

```bash
RUN_LIVE_OPENAI_TERRA_QUALIFICATION=1 \
AI_PROVIDER=openai \
OPENAI_API_KEY=... \
npm run eval:builder-planning-terra-qualification-live
```

It fails unless all eight complete, parse and validate structurally and
semantically, and pass their unchanged deterministic gates. Its trusted maximum
reservation is 3,543,040 microusd under a 3,700,000 microusd hard ceiling.

Only after an operator reviews an 8/8 qualification result may they deliberately
run repeated reliability:

```bash
RUN_LIVE_OPENAI_TERRA_RELIABILITY=1 \
AI_PROVIDER=openai \
OPENAI_API_KEY=... \
npm run eval:builder-planning-terra-reliability-live
```

Reliability runs the same eight scenarios in three sequential rounds (24 total
executions) and fails unless all 24 pass. Its trusted maximum reservation is
10,629,120 microusd under an 11,000,000 microusd hard ceiling. The gates do not
trigger each other, and the historical `RUN_LIVE_OPENAI_EVAL` flag is inert.

Only redacted scenario metadata, bounded validation diagnostics, token counts,
integer cost and elapsed time may be emitted. No owner request, Business
context, model prose, reasoning content, question or assumption text, labels,
Object keys, Location UUIDs, provider body/ID, API key or raw error is emitted
or persisted. The Terra alias can advance independently, so evidence must be
rerun after a material alias advance or any permitted execution/planning-subject
change. Operation generation is not implemented in this milestone and remains
outside the planning gates.

### Reviewed redacted live evidence

Qualification completed the eight unchanged scenarios once and passed 8/8.
Structural failures: 0. Semantic failures: 0. Scenario-gate failures: 0.
Provider failures: 0. Input tokens: 34,949. Output tokens: 3,476. Estimated
cost: 139,515 microusd. Elapsed: 47,157 ms.

Reliability completed three sequential repetitions of the same eight scenarios
(24 executions) and passed 24/24. Every scenario passed 3/3 and every
execution used one provider attempt. Failures: 0. Structural failures: 0.
Semantic failures: 0. Scenario-gate failures: 0. Provider failures: 0. Input
tokens: 104,847. Output tokens: 8,764. Estimated cost: 393,585 microusd.
Elapsed: 108,779 ms.

Reliability scenario totals: `preorder_phone_optional` 3/3,
`preorder_schedule_change` 3/3, `corporate_catering_enquiries` 3/3,
`create_cambridge_location` 3/3, `add_cambridge_preorder_collection` 3/3,
`automated_weekly_customer_email` 3/3, `card_payment_at_checkout` 3/3 and
`ambiguous_bookings` 3/3.

The planning gate is cleared for this frozen profile as bounded engineering
evidence, not universal model perfection. No model prose, questions,
assumptions, summaries, Object keys, Location references, provider IDs or
provider bodies are recorded here. Any material model-alias, prompt, schema,
validator, context or provider-transport change invalidates the evidence and
requires both gates to be rerun.

## Configuration drafting evaluation

Milestone 8 Phase 8A qualifies the corrected `builder_configuration_draft_v1`
subject independently of planning. The isolated evaluation task reuses the
exact drafting instruction, schemas and semantic validator and changes only
the unregistered policy reference to
`builder_configuration_drafting_terra_medium_v1`. The fixed candidate is
`gpt-5.6-terra` with explicit `medium` reasoning; production drafting remains
mapped to `builder_configuration_drafting_disabled_v1` in both disabled and
OpenAI runtime modes.

The suite uses exactly two frozen, schema-validated in-memory contexts:
`rich_existing_business` and `empty_new_business`. Its eight scenarios are,
in fixed order: `catering_enquiry_full_stack`,
`customer_marketing_consent_field`, `customer_directory_internal`,
`public_customer_contact_page`, `equipment_maintenance_workspace`,
`supplier_quote_field_types`, `staff_profile_cards` and
`order_detail_workspace`. Every code-owned ready plan parses through the real
drafting task input schema and semantic input validator; deterministic gates
then compare exact entity families, references, types, settings, audiences,
relationships, links and page blocks.

The two exact opt-in commands are deliberately separate:

```bash
RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION=1 \
AI_PROVIDER=openai \
OPENAI_API_KEY=... \
npm run eval:builder-configuration-drafting-terra-qualification-live
```

After independent review of a successful qualification, the separate
reliability command may be run for a reviewed frozen subject:

```bash
RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY=1 \
AI_PROVIDER=openai \
OPENAI_API_KEY=... \
npm run eval:builder-configuration-drafting-terra-reliability-live
```

Qualification is exactly 8 sequential executions with a 5,806,080 microusd
reservation and 6,000,000 hard ceiling. Reliability is exactly 3 sequential
rounds (24 executions) with a 17,418,240 microusd reservation and 18,000,000
hard ceiling. The one-execution reservation is 725,760 microusd, derived from
the trusted integer accounting functions. Live commands are absent from CI;
deterministic tests use injected providers only.

Reports are one-line, strict, redacted metadata only: bounded scenario and
repetition identity, pass state, entity counts, attempts, usage, integer cost,
elapsed time and finite failure codes. No owner request, Business context,
labels, keys, local references, page text, options, provider body/ID,
response, raw error, stack trace, credential or model prose is emitted or
persisted. The complete Phase 8A evidence record follows. Any material change
to the fixed model/policy/transport, drafting subject, synthetic context,
ready plan, scenario order, deterministic evaluator or report classification
invalidates both gates.

### Milestone 8 Phase 8A closeout evidence

Phase 8A is complete for the frozen code subject tested at
`acc9eecf652dfcd393c63ee4b9517316a00cdf90`. The profile was task
`builder_configuration_draft_v1`, model `gpt-5.6-terra`, explicit `medium`
reasoning and policy `builder_configuration_drafting_terra_medium_v1`.

#### Final qualification evidence

The qualification was executed exactly once:

- 8 total scenarios; 8/8 passed; 0 failed;
- 8 total attempts;
- 53,719 input tokens and 4,647 output tokens;
- 204,005 estimated microusd and 41,615 ms elapsed;
- usage complete for every execution;
- structural failures 0, semantic failures 0, unknown-output failures 0,
  deterministic scenario-gate failures 0 and provider/execution failures 0;
- exit code 0.

All eight scenarios passed: `catering_enquiry_full_stack`,
`customer_marketing_consent_field`, `customer_directory_internal`,
`public_customer_contact_page`, `equipment_maintenance_workspace`,
`supplier_quote_field_types`, `staff_profile_cards` and
`order_detail_workspace`.

#### Final reliability evidence

The first reliability run at the same exact SHA remains recorded as bounded
historical evidence. It executed 24 times and passed 23/24; repetition 2 of
`equipment_maintenance_workspace` had one bounded 60-second `ai_timeout`.
Structural, semantic, unknown-output and deterministic scenario-gate failures
were 0; provider/execution failures were 1. It used 24 attempts, 155,672 input
tokens, 13,059 output tokens, 585,072 estimated microusd and 172,058 ms, with
exit code 1. The Equipment scenario passed qualification and repetitions 1 and 3. No model, policy or source change was made in response to the timeout.

A single controlled complete reliability rerun was then explicitly authorised
and passed:

- 8 scenarios, 3 repetitions per scenario, 24/24 executions passed;
- 24 total attempts;
- 161,157 input tokens and 13,463 output tokens;
- 604,845 estimated microusd and 112,191 ms elapsed;
- usage complete for every execution;
- structural failures 0, semantic failures 0, unknown-output failures 0,
  deterministic scenario-gate failures 0 and provider/execution failures 0;
- exit code 0.

Every scenario passed 3/3: `catering_enquiry_full_stack`,
`customer_marketing_consent_field`, `customer_directory_internal`,
`public_customer_contact_page`, `equipment_maintenance_workspace`,
`supplier_quote_field_types`, `staff_profile_cards` and
`order_detail_workspace`.

The reports remained bounded and redacted metadata only. No owner request,
Business context, ready plan, model output, provider response, raw error,
credential or model prose is recorded. Production drafting remains disabled.
This evidence qualifies one frozen profile rather than proving generic AI
correctness. Any material change to the model, policy, provider transport,
drafting task, input/output schemas, semantic validator, contexts, scenarios or
evaluator invalidates this evidence and requires both gates to be rerun.

Milestone 8 Phase 8B is the next product phase and has not started. Its
intended handoff is authenticated owner request → Business context → qualified
planning → bounded clarification or ready plan → qualified configuration
drafting → deterministic compiler → authenticated ordinary M5 proposal. The
Builder UI and generic public Form submission are not claimed here.

## Builder preorder-amendment evaluation

Phase 9A evaluates the separate `builder_preorder_amendment_v1` subject against
exactly eight frozen synthetic requests: phone optional, Sunday removal, a
72-hour cutoff, the combined Sunday/cutoff change, optional short-answer
Occasion, optional long-answer Gift message, existing wording/help text, and
the combined phone/Occasion request. The subject uses
`builder_preorder_amendment_terra_medium_v1`, `gpt-5.6-terra`, explicit medium
reasoning, a 256 KiB input ceiling, 80,000 billable input tokens per attempt,
4,096 output tokens, a 30-second timeout and two attempts.

The one-execution reservation is 522,880 microusd. Qualification is one ordered
round of 8 executions (4,183,040 microusd reserved; 4,300,000 microusd hard
ceiling). Reliability is three ordered rounds of 24 executions (12,549,120
microusd reserved; 12,700,000 microusd hard ceiling). The live commands are
opt-in only and require `AI_PROVIDER=openai` plus a non-blank server-side key.

```bash
RUN_LIVE_OPENAI_PREORDER_AMENDMENT_QUALIFICATION=1 \
AI_PROVIDER=openai OPENAI_API_KEY=... \
npm run eval:builder-preorder-amendment-terra-qualification-live
```

Reliability may be run only after a separately reviewed successful
qualification. These harnesses use no Supabase client, accounting reservation,
file write or durable persistence, and emit only bounded scenario/gate metadata.

### Phase 9A qualification closeout evidence

The reviewed live gates completed against exact qualified implementation SHA
`10e2dfe9859fa289bc5949fa5825fc6700a883a3`. The task was
`builder_preorder_amendment_v1`, model `gpt-5.6-terra`, policy
`builder_preorder_amendment_terra_medium_v1`, with explicit `medium`
reasoning.

Qualification completed with 8 scenarios, 8/8 passed, 0 failed, and exit code 0. It used 8 provider attempts, exactly one per scenario, with 29,948 input
tokens, 874 output tokens, 87,982 estimated microusd and 20,758 ms elapsed.
The scenarios were `phone_optional`, `remove_sunday`, `cutoff_to_72`,
`remove_sunday_cutoff_72`, `occasion_optional_short`,
`gift_message_optional_long`, `existing_question_wording_help` and
`phone_optional_and_occasion`.

Reliability completed with 8 scenarios × 3 repetitions, 24/24 passed, 0
failed, and exit code 0. It used 24 provider attempts, exactly one per
execution, with 89,844 input tokens, 2,535 output tokens, 262,641 estimated
microusd and 42,174 ms elapsed. Every scenario passed 3/3: the same eight
scenario IDs listed above.

Combined reviewed evidence was 32/32 live executions passed, 119,792 input
tokens, 3,409 output tokens, 350,623 estimated microusd and one provider
attempt per execution. Reports were bounded/redacted metadata only. No owner
request, Business context, model output, provider body or ID, reasoning,
credential or raw provider data was persisted. Any material change to the
model alias, policy, provider transport, task instruction, schemas, validator,
contexts, scenarios or evaluator invalidates this evidence and requires both
gates to be rerun. The reviewed gates cleared the private runtime enablement
boundary; global/default registration remains disabled.

### Milestone 10 Phase 10A Location-intent gates

`builder_location_creation_intent_v1` has its own disabled production policy and
private-runtime-qualified `builder_location_creation_intent_terra_medium_v1` policy:
`gpt-5.6-terra`, medium reasoning, 256 KiB input, 80,000 billable input
tokens, 2,048 output tokens, 30-second timeout and two attempts. The exact
reservation is 461,440 microusd per execution; the eight-scenario qualification
ceiling is 3,800,000 microusd and the 24-execution reliability ceiling is
11,200,000 microusd.

Qualification and reliability are separate, sequential, explicitly opted-in
commands. Their provider-backed subject is frozen to this exact ordered set:

1. `explicit_timezone`
2. `business_timezone`
3. `alternate_wording`
4. `active_duplicate`
5. `inactive_duplicate`
6. `missing_name`
7. `local_timezone_without_iana`
8. `multi_word_identity`

Every input is valid for the strict one-step Location-intent task. Mixed
Location/preorder plans, Location updates and deactivation are tested
separately at deterministic Builder routing and must stop after planning with
no intent execution or intent reservation. They are not provider-backed intent
scenarios.

Before provider construction, each live command validates the exact scenario
count/order, repetition and execution counts, task/policy/model/reasoning
identities, reservation totals and hard ceilings. Reports preserve bounded
attempt/usage completeness on failures, classify failures as output contract,
semantic validation, scenario expectation, provider execution, setup or
unknown, stop on the first failure, and aggregate actual reported token cost.
Qualification requires 8/8 and reliability requires 24/24 with every scenario
3/3 and actual cost below the relevant ceiling. CI runs only deterministic
tests and never activates live OpenAI gates. When live credentials or reviewed
evidence are unavailable, the private Builder mapping remains disabled; no
qualification result is inferred or claimed. Reports are bounded redacted
metadata and omit owner requests, Business context, Location names/timezones,
model output, credentials and tokens.

#### Failed qualification evidence and bounded correction

The operator ran qualification once against exact candidate SHA
`27f2c122f08ddc52f417bc60861f164bc96f8edd`. The first three scenarios,
`explicit_timezone`, `business_timezone` and `alternate_wording`, passed.
`active_duplicate` failed with `ai_output_invalid`, and the gate correctly
stopped before the remaining four scenarios. The aggregate was 3 passed, 1
failed, 4 attempts, 12,737 input tokens, 263 output tokens, 35,788 estimated
microusd, 7,703 ms and exit code 1. Reliability was not run.

No hidden model output was inspected or retained. The bounded diagnosis is an
instruction/validator mismatch: the semantic validator already rejected a
ready exact active or inactive duplicate, but the instruction did not tell the
model to return `needs_clarification` for those contexts. The correction adds
that exact duplicate rule, forbids ready, slight rename, numeric suffix,
reactivation, update and adjacent work, and explicitly rejects fuzzy or
substring matching. The deterministic validator remains authoritative and is
unchanged. Evaluation-only cause-chain metadata now separates output-contract,
semantic-validation, provider invalid-response and unknown invalid-output
causes using finite redacted reason codes.

This first failed run is historical evidence only. It did not qualify or enable
Phase 10A, and all production mappings remained on
`builder_location_creation_intent_disabled_v1`.

#### Accepted qualification and reliability evidence

The corrected frozen subject was qualified against exact SHA
`0598068617f25e541ef49cde50aea307dc98047e`. Qualification passed all 8/8
scenarios with 8 attempts, 26,389 input tokens, 700 output tokens, 76,475
estimated microusd, 23,479 ms elapsed and exit code 0.

The first reliability attempt on this exact subject is retained as historical
evidence. It passed 16 executions before execution 17 failed at
`explicit_timezone`, repetition 3, with `provider_execution` / `ai_timeout`,
30,030 ms elapsed, incomplete usage and zero input/output tokens. Its stopped
aggregate was 52,778 input tokens, 1,488 output tokens, 154,270 estimated
microusd, 77,651 ms and exit code 1.

The final accepted reliability rerun used the same exact SHA and passed all 24
executions: 8/8 scenarios, every scenario 3/3, 24 attempts, 79,167 input
tokens, 2,145 output tokens, 230,100 estimated microusd, 48,334 ms elapsed and
exit code 0. Every scenario passed 3/3:

```text
explicit_timezone: 3
business_timezone: 3
alternate_wording: 3
active_duplicate: 3
inactive_duplicate: 3
missing_name: 3
local_timezone_without_iana: 3
multi_word_identity: 3
```

Every successful report had `passed: true`, `failure_class: null`, empty
`failed_gate_codes`, null `error_code`, null `validation_reason_code`,
`usage_complete: true` and `attempts: 1`. No task, instruction, schema,
validator, scenario, evaluator, model, policy parameters, limits, pricing or
provider transport changed between qualification and the final reliability
rerun. The successful rerun supersedes the isolated timeout for acceptance;
the timeout remains historical evidence.

After exact-head CI passed, the private authenticated OpenAI Builder runtime
maps `builder_location_creation_intent_v1` to
`builder_location_creation_intent_terra_medium_v1`. The global/default task
and disabled runtime remain mapped to
`builder_location_creation_intent_disabled_v1`. The enablement commit changes
only this private runtime binding, assertions and documentation; it is not
itself live-qualified. Phase 10A is implemented, qualified and enabled in the
private authenticated runtime, while PR #16 remains open, draft and unmerged.

## Milestone 12 Phase 12A generic Record-intent gates

Phase 12A uses two frozen strict AI-safe contexts and exactly eight ordered
deterministic scenarios, each repeated once for qualification and three times
for reliability. Context A contains generic Product and Menu-item metadata;
Context B contains Equipment, Catering Enquiry and Lead/contact metadata. They
contain no Records, Record values, PII or owner data. The scenario fixture is
owned by `src/ai/evaluation/record-creation-intent/scenarios.ts` and the
deterministic evaluator compares output state, exact Field set, types, values,
omitted optionals and bounded failure codes without a model judge.

The exact Terra profile is `gpt-5.6-terra` with `medium` reasoning. It uses the
independent `builder_record_creation_intent_v1` task, the disabled production
policy's limits and the exact maximum reservation of 522,880 microusd per
execution. Qualification is capped at 8 executions / 4,300,000 microusd;
reliability is capped at 24 executions / 12,700,000 microusd. Actual reported
usage is aggregated, and setup, contract, semantic, scenario and provider
failures are emitted only as finite redacted metadata. Reports contain no
Object labels or keys, Field labels or keys, values, requests, context, model
prose, provider IDs/bodies, credentials or raw errors.

The live commands are opt-in only:

```bash
RUN_LIVE_OPENAI_RECORD_CREATION_TERRA_QUALIFICATION=1 \
AI_PROVIDER=openai OPENAI_API_KEY=... \
npm run eval:builder-record-creation-terra-qualification-live

RUN_LIVE_OPENAI_RECORD_CREATION_TERRA_RELIABILITY=1 \
AI_PROVIDER=openai OPENAI_API_KEY=... \
npm run eval:builder-record-creation-terra-reliability-live
```

### Failed Phase 12A qualification evidence and bounded correction

The first Phase 12A qualification run was executed against exact SHA
`7c03b743480016f24c5d6922ec6e4933103dce35` and stopped on its first scenario.
No model output was returned, so no scenario quality or deterministic semantic
gate was evaluated:

```text
scenario_id: product_text_currency_default
repetition: 1
passed: false
output_state: null
field_value_count: 0
failure_class: provider_execution
failed_gate_codes:
  - provider_execution
attempts: 1
usage_complete: false
input_tokens: 0
output_tokens: 0
estimated_microusd: 0
elapsed_ms: 1061
error_code: ai_execution_failed
validation_reason_code: null
```

The aggregate was:

```text
gate: qualification
total_scenarios: 8
passed_scenarios: 0
failed_scenarios: 1
total_attempts: 1
total_input_tokens: 0
total_output_tokens: 0
total_estimated_cost_microusd: 0
total_elapsed_ms: 1061
exit_code: 1
```

The existing OpenAI boundary mapped both local `OpenAiSchemaAdaptationError`
and provider HTTP 400/422 failures to the same public
`StructuredAiProviderError(kind: invalid_request)`, while the redacted
engineering report had no safe stage diagnostic. The exact provider cause was
not inferred. The bounded correction adds the finite internal taxonomy
`local_schema_adaptation`, `provider_schema_rejected`,
`provider_response_format_rejected`, `provider_model_rejected`,
`provider_parameter_rejected` and `provider_invalid_request_unknown`, carries
only that code through a depth- and cycle-bounded cause traversal, and exposes
it only as `provider_reason_code` in the engineering evaluation report.
Provider messages, bodies, headers, arbitrary parameters, requests, schema
JSON, model output and Field values remain excluded. The exact Record output
schema was then deterministically converted through draft-7 generation,
OpenAI adaptation and an injected Responses client request; local adaptation
succeeded and the injected client received one valid request.

Reliability was not run, qualification was not rerun, production remains
disabled, and no additional live provider spend occurred. This failure remains
historical evidence only and does not claim schema rejection as the cause.

#### Current-head transport diagnosis

The operator subsequently ran qualification against exact head
`a6054b63477664cc9e422e4c2cb6e8179dcddd84`. It stopped on the same first
scenario, `product_text_currency_default`, repetition 1, with the following
bounded report:

```text
passed: false
output_state: null
field_value_count: 0
failure_class: provider_execution
failed_gate_codes:
  - provider_execution
attempts: 1
usage_complete: false
input_tokens: 0
output_tokens: 0
estimated_microusd: 0
elapsed_ms: 715
error_code: ai_execution_failed
validation_reason_code: null
provider_reason_code: provider_schema_rejected
```

The aggregate was 8 total scenarios, 0 passed, 1 failed, 1 attempt, zero
input/output tokens, zero estimated microusd, 715 ms and exit code 1. No model
output was produced or evaluated, and reliability was not run.

The exact unsupported transport was identified: the Record URL variant used
`z.string().url()`, which emitted `format: "uri"` in draft-7 JSON Schema, while
the documented OpenAI Structured Outputs subset supports only
`date-time`, `time`, `date`, `duration`, `email`, `hostname`, `ipv4`, `ipv6`
and `uuid`. The correction therefore keeps URL Fields and deterministic
HTTP(S) URL validation, but emits a bounded structural string with
`minLength: 1`, `maxLength: 2048` and an HTTP(S) prefix pattern. Unsupported
formats now fail locally as `local_schema_adaptation`; no unsupported format
is silently forwarded. At that historical point production remained disabled
and no further live spend had occurred; the final correction still required
fresh compatibility and qualification evidence, which is recorded below.

#### Third failed qualification and compatibility isolation boundary

The operator ran qualification against exact SHA
`c6e4cf6e72d0a59231eb729489319de2c6a62b0b`. It again stopped on
`product_text_currency_default`, repetition 1, before model output:

```text
passed: false
output_state: null
field_value_count: 0
failure_class: provider_execution
failed_gate_codes:
  - provider_execution
attempts: 1
usage_complete: false
input_tokens: 0
output_tokens: 0
estimated_microusd: 0
elapsed_ms: 3507
error_code: ai_execution_failed
validation_reason_code: null
provider_reason_code: provider_schema_rejected
```

The aggregate was 8 total scenarios, 0 passed, 1 failed, 1 attempt, zero
input/output tokens, zero estimated microusd, 3507 ms and exit code 1. No model
output or scenario quality was evaluated. The URL correction did not resolve
the complete schema rejection, and no further root cause is claimed. At that
historical point qualification was paused pending the bounded compatibility
gate; reliability had not run and production remained disabled. The accepted
evidence below subsequently cleared that gate without changing the frozen
subject.

The operator then ran the bounded compatibility diagnostic against exact SHA
`356b5fd237a7f821cda4744a7b51a7a0fb45e4b7`. It completed normally with:

```text
stop_reason: completed
probes_executed: 27
accepted_probes: 17
rejected_probes: 10
exact_schema_accepted: false
first_structural_failure_probe_id: d_email
family: text_like
conclusion: individual_branch_rejected

d_email: rejected
keyword_without_patterns: accepted
keyword_without_formats: rejected
```

The email branch was the first individual failure. Removing its generated
email regex pattern made that probe provider-compatible, while removing its
email format and retaining the pattern did not. Every non-email individual
Field branch passed, and both primitive and option cumulative families passed.
The complete Field union and exact Record schema failed because they contained
the email branch. No model output or business-quality evaluation occurred.

The subsequent Record-local correction uses one shared server-owned email
value schema in the AI intent and trusted creation/confirmation boundaries.
Its provider-facing JSON Schema is a bounded string with `minLength: 1`,
`maxLength: 320`, no email format and no email pattern; strict deterministic
runtime validation still delegates to Zod's email parser and preserves valid
owner-supplied strings exactly. At the time of this historical correction
record, the compatibility diagnostic and ordinary qualification had not yet
been rerun. The accepted final evidence below supersedes that interim status;
the failed runs remain retained historical evidence.

The engineering-only command is:

```bash
RUN_LIVE_OPENAI_RECORD_CREATION_SCHEMA_COMPATIBILITY=1 \
AI_PROVIDER=openai OPENAI_API_KEY=... \
npm run eval:builder-record-creation-schema-compatibility-live
```

All three activation values are mandatory; a key alone grants no permission.
The command uses only the fixed synthetic input `Return the smallest valid
result.` with the existing OpenAI Responses provider, `gpt-5.6-terra`, medium
reasoning, strict `text.format`, `store: false`, one attempt and 128 maximum
output tokens. It receives no owner request, Business context, Object/Field
values, operational Record, tenant/actor ID or real PII.

The 20 frozen base probes are ordered as follows:

```text
a_transport_baseline
b_state_union
c_short_text
d_long_text
d_email
d_phone
d_url
d_text_like_cumulative
e_number
e_currency
e_boolean
e_date
e_datetime
e_primitive_cumulative
f_select
f_status
f_multi_select
f_option_cumulative
g_complete_field_union
h_exact_full_record_schema
```

Schema rejections continue through the matrix. Authentication failure,
provider outage, rate limiting, timeout and unexpected non-schema failures
stop immediately. A failed complete union triggers no more than five ordered
branch-count/rotated-combination probes. A complete-ready pass followed by an
exact-schema failure triggers no more than four clarification, source-step,
annotation and rebuilt-composition probes. The first structural failure then
receives seven remove-one-keyword-family diagnostics for string bounds,
patterns, formats, numeric bounds, array bounds, annotations and safely
inlineable `$defs`/`$ref` reuse. Diagnostic variants never replace the exact
Record contract.

The maximum is 32 probes. Each reserves 16,000 input tokens and 128 output
tokens, or exactly 41,920 microusd; the aggregate reservation is 1,341,440
microusd under a 1,350,000-microusd hard ceiling. Each probe emits only:

```text
schema_version
probe_id
schema_digest
accepted
result_class
provider_reason_code
safe_schema_context
attempts
usage_complete
input_tokens
output_tokens
estimated_microusd
elapsed_ms
schema_metrics
```

`safe_schema_context` is either `unknown` or an allow-listed JSON Schema
keyword plus a bounded path containing only code-owned structural tokens and
numeric union/array indexes. Any unrecognised token collapses the entire
context to `unknown`. Reports exclude schema JSON, inputs, prompts, model
output, provider messages/parameters, headers, bodies and credentials.

The installed OpenAI SDK comparison uses `zodTextFormat` with the strict root
`{ result: builderRecordCreationIntentOutputSchema }`. It reports only helper
generation success, canonical digests, deterministic metrics and finite
keyword/path difference categories. It does not print either schema or alter
the production provider. This diagnostic implementation has not been run
live, so it incurred no additional provider spend.

Normal tests and CI never activate these flags. The accepted final evidence
for the frozen subject is recorded below; these engineering-only commands are
not part of ordinary runtime startup.

#### Accepted Phase 12A qualification and private enablement

Compatibility, qualification and reliability were accepted against exact head
SHA `99988cc7950bb009f290f9f23f84f61dbbef4d0e`:

```text
compatibility: completed; 20/20 probes accepted; 0 rejected;
  exact_schema_accepted: true; exit_code: 0; cost_microusd: 29976
qualification: 8/8 scenarios passed; 0 failed; 8 attempts;
  input_tokens: 17265; output_tokens: 937; cost_microusd: 57220; exit_code: 0
reliability: 24/24 executions passed; 8/8 scenarios; 3 repetitions each;
  attempts: 24; input_tokens: 51795; output_tokens: 2831;
  cost_microusd: 171960; exit_code: 0
```

No failure, error, validation or provider reason codes were reported. At the
Phase 12A enablement point, only the private authenticated Builder OpenAI runtime
was enabled:
`builder_record_creation_intent_v1` resolves through the private frozen clone
to `builder_record_creation_intent_terra_medium_v1` and
`openAiBuilderRecordCreationIntentPolicy`. The global/default production
runtime, including OpenAI mode, remains disabled for Record intent and does
not register the Terra policy; disabled Builder mode remains disabled. The
Phase 12A private registry contained exactly five tasks and five policies;
Phase 12B adds a sixth update task that remains disabled pending its own gates.

The qualification/reliability reports are not a claim that the frozen subject
changed. A new live rerun is required only if the frozen subject changes.
Planning still precedes intent generation, and only a ready one-step
`create_initial_record` route reaches the intent task. Unsupported or mixed
plans do not. Final confirmation remains deterministic and AI-free: no
provider call, task/accounting reservation, planning, configuration mutation,
or provider-version change occurs after confirmation.

PR #17 merged the Phase 12A implementation. Phase 12B remains independently
reviewable on its feature branch.

## Phase 12B Record-update evaluation

The independent Record-update subject is
`builder_record_update_intent_v1`, with the global/default/private-disabled
production task and no enabled Terra mapping. Its deterministic task tests
cover one exact selector, bounded one-to-three absolute updates, configured
option handling, unsupported relative requests and missing-target
clarification. The scenario fixture remains configuration-only and never
loads operational Records or current values.

The compatibility command is opt-in only:

```bash
RUN_LIVE_OPENAI_RECORD_UPDATE_SCHEMA_COMPATIBILITY=1 \
AI_PROVIDER=openai OPENAI_API_KEY=... \
npm run eval:builder-record-update-schema-compatibility-live
```

It remains opt-in engineering scaffolding only: compatibility, qualification
and reliability require separate explicit flags and are not run by CI, build,
seed or application startup. A first live Phase 12B qualification command was
run once against the exact SHA recorded below and failed its scenario gate; it
was not used to qualify or enable the task. Reliability was not run. Reports
are metadata-only and never include owner requests, context, values, model
output, provider bodies or credentials. Phase 12B remains unmerged and
private-disabled pending any separately authorized evidence review.

#### Failed Phase 12B qualification evidence and bounded correction

The first Phase 12B qualification run was executed once against exact SHA
`aab28f6fa0d9036f84579f4261e32641ab033146`. The run stopped correctly at the
fifth scenario because the scenario expectation did not match the approved
one-selector boundary:

```text
Exact SHA:
aab28f6fa0d9036f84579f4261e32641ab033146

Passed:
4

Failed:
1

Failure scenario:
single_selector_update

Failure class:
scenario_expectation

Failed gate:
expected_update_set

Attempts:
5

Input tokens:
14370

Output tokens:
622

Estimated cost:
45256 microusd

Exit:
1
```

No structural failure occurred. No semantic-validator failure occurred. No
provider failure occurred. Reliability was not run. The correction removes a
scenario inconsistent with the approved one-selector boundary and replaces it
with a missing-replacement clarification scenario. No hidden model output was
inspected or retained.

#### Second failed Phase 12B qualification evidence and bounded correction

The second Phase 12B qualification run was executed once against exact SHA
`e232686eacc3ef47e3f0a66f015eac081dfebb83`. It stopped immediately on the core
Product rename scenario because the task returned clarification instead of the
expected ready intent:

```text
Exact SHA:
e232686eacc3ef47e3f0a66f015eac081dfebb83

Passed:
0

Failed:
1

Failure scenario:
product_rename

Expected state:
ready

Actual state:
needs_clarification

Failure class:
scenario_expectation

Failed gate:
expected_state

Attempts:
1

Input tokens:
3408

Output tokens:
121

Estimated cost:
10335 microusd

Exit:
1
```

No output-contract failure occurred. No semantic-validator failure occurred.
No provider failure occurred. Usage was complete. Reliability was not run. No
hidden model output was inspected or retained. The correction clarifies a
common explicit rename instruction without expanding the Phase 12B scope.
