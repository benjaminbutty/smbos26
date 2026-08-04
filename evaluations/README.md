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
evaluation-only `builder_location_creation_intent_terra_medium_v1` policy:
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

This failed run is historical evidence only. Successful qualification and
reliability evidence remain absent; Phase 10A is not qualified or enabled. All
production mappings remain on
`builder_location_creation_intent_disabled_v1`, and the operator must review
the correction before deliberately rerunning qualification.
