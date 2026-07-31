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
change. Operation generation remains blocked until a reviewed 24/24 result.

Live GPT-5.6 Terra qualification not run.
Live GPT-5.6 Terra reliability evaluation not run.
