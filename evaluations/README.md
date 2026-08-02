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

Milestone 8 Phase 8A qualifies the unchanged `builder_configuration_draft_v1`
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

After independent review of qualification, reliability may be run later:

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
persisted. Qualification evidence: pending deliberate live run. Reliability
evidence: pending qualification review and deliberate live run. Any material
change to the fixed model/policy/transport, drafting subject, synthetic
context, ready plan, scenario order, deterministic evaluator or report
classification invalidates both gates.
