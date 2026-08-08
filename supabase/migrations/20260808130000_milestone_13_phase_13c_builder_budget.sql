/*
 * Milestone 13 Phase 13C
 *
 * The authenticated Builder reserves planning and configuration drafting as
 * two sequential executions. Keep the existing qualified policy envelopes
 * unchanged and make a fresh Business able to complete both reservations.
 *
 * Planning: 64,000 input tokens x 2 attempts = 128,000.
 * Drafting: 96,000 input tokens x 2 attempts = 192,000.
 * Complete supported path: 320,000 input tokens.
 */

alter table public.business_ai_settings
  alter column daily_input_token_limit set default 320000;

-- Upgrade only rows that still carry the complete historical system-default
-- tuple. Any Business with a customized limit is intentionally untouched.
update public.business_ai_settings
set daily_input_token_limit = 320000
where daily_request_limit = 25
  and daily_input_token_limit = 250000
  and daily_output_token_limit = 100000
  and daily_cost_limit_microusd = 5000000;
