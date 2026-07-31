# Builder planning evaluation

The live command is an engineering-only, opt-in check of the fixed
`builder_plan_v1` production planning path:

```bash
RUN_LIVE_OPENAI_EVAL=1 \
AI_PROVIDER=openai \
OPENAI_API_KEY=... \
npm run eval:builder-planning-live
```

All three activation values are required. The command runs eight sequential
synthetic Business scenarios once, subject only to the registered two-attempt
policy, and emits bounded metadata. It does not load tenant data, use Business
accounting, persist output, invoke a route or mutation service, or generate
operations.

Invalid output is reported internally as one of three stages: `structural`,
`semantic`, or `unknown`. Structural failures use `output_contract_invalid`,
semantic failures use the finite planning diagnostic enum, and unclassified
failures use `unknown_output_invalid`. Only the scenario ID, `ai_output_invalid`,
stage and approved reason code may be emitted for that failure class. Provider
failures keep the existing scenario ID and safe execution error code only.

Requests, context, model prose, schema paths, labels, UUIDs, provider bodies,
credentials, diagnostic messages and response IDs are never emitted or stored.
The public `AiExecutionError` JSON contract and metadata-only accounting audit
remain unchanged. Operation generation stays blocked until an explicit live
evaluation succeeds and is reviewed.
