create type public.ai_execution_status as enum (
  'reserved',
  'succeeded',
  'failed',
  'cancelled',
  'expired'
);

create table public.business_ai_settings (
  business_id uuid primary key
    references public.businesses(id) on delete cascade,
  is_enabled boolean not null default false,
  daily_request_limit integer not null default 25
    check (daily_request_limit between 1 and 1000),
  daily_input_token_limit bigint not null default 250000
    check (daily_input_token_limit between 1 and 100000000),
  daily_output_token_limit bigint not null default 100000
    check (daily_output_token_limit between 1 and 50000000),
  daily_cost_limit_microusd bigint not null default 5000000
    check (daily_cost_limit_microusd between 1 and 1000000000),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  check (
    not is_enabled
    or (
      daily_request_limit > 0
      and daily_input_token_limit > 0
      and daily_output_token_limit > 0
      and daily_cost_limit_microusd > 0
    )
  )
);

comment on table public.business_ai_settings is
  'Finite per-Business UTC-day AI execution limits. AI is disabled by default.';
comment on column public.business_ai_settings.daily_cost_limit_microusd is
  'Integer micro-US-dollars. 1 USD = 1,000,000 microusd.';

create table public.ai_execution_runs (
  id uuid primary key,
  business_id uuid not null
    references public.businesses(id) on delete cascade,
  actor_id uuid not null,
  usage_day date not null,
  task_key text not null check (
    char_length(task_key) between 1 and 80
    and task_key ~ '^[a-z][a-z0-9_]*$'
  ),
  task_version integer not null check (task_version > 0),
  purpose_label text not null check (
    char_length(trim(purpose_label)) between 1 and 120
  ),
  policy_key text not null check (
    char_length(policy_key) between 1 and 80
    and policy_key ~ '^[a-z][a-z0-9_]*$'
  ),
  provider_key text not null check (
    char_length(provider_key) between 1 and 80
    and provider_key ~ '^[a-z][a-z0-9_-]*$'
  ),
  model_key text not null check (
    char_length(model_key) between 1 and 120
    and model_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  ),
  input_microusd_per_million bigint not null check (
    input_microusd_per_million between 0 and 1000000000
  ),
  output_microusd_per_million bigint not null check (
    output_microusd_per_million between 0 and 1000000000
  ),
  status public.ai_execution_status not null default 'reserved',
  outcome_code text check (
    outcome_code is null
    or (
      char_length(outcome_code) between 1 and 80
      and outcome_code ~ '^ai_[a-z0-9_]+$'
    )
  ),
  reserved_request_count integer not null default 1 check (
    reserved_request_count = 1
  ),
  reserved_input_tokens bigint not null check (
    reserved_input_tokens between 1 and 50000000
  ),
  reserved_output_tokens bigint not null check (
    reserved_output_tokens between 1 and 5000000
  ),
  reserved_cost_microusd bigint not null check (
    reserved_cost_microusd between 0 and 50000000000
  ),
  actual_input_tokens bigint check (
    actual_input_tokens between 0 and 5000000000
  ),
  actual_output_tokens bigint check (
    actual_output_tokens between 0 and 5000000000
  ),
  actual_cost_microusd bigint check (
    actual_cost_microusd between 0 and 9000000000000000000
  ),
  charged_input_tokens bigint not null default 0 check (
    charged_input_tokens between 0 and 5000000000
  ),
  charged_output_tokens bigint not null default 0 check (
    charged_output_tokens between 0 and 5000000000
  ),
  charged_cost_microusd bigint not null default 0 check (
    charged_cost_microusd between 0 and 9000000000000000000
  ),
  provider_attempt_count integer not null default 0 check (
    provider_attempt_count between 0 and 5
  ),
  provider_invocation_started boolean not null default false,
  usage_complete boolean not null default false,
  usage_overrun boolean not null default false,
  reserved_at timestamptz not null default statement_timestamp(),
  settled_at timestamptz,
  check (
    (
      status = 'reserved'::public.ai_execution_status
      and outcome_code is null
      and settled_at is null
      and actual_input_tokens is null
      and actual_output_tokens is null
      and actual_cost_microusd is null
      and charged_input_tokens = 0
      and charged_output_tokens = 0
      and charged_cost_microusd = 0
      and provider_attempt_count = 0
      and not provider_invocation_started
      and not usage_complete
      and not usage_overrun
    )
    or (
      status <> 'reserved'::public.ai_execution_status
      and outcome_code is not null
      and settled_at is not null
    )
  )
);

comment on table public.ai_execution_runs is
  'One metadata-only AI budget reservation and bounded execution audit row.';
comment on column public.ai_execution_runs.usage_day is
  'UTC date captured from PostgreSQL statement time when the reservation is created.';

create index ai_execution_runs_business_day_status_idx
  on public.ai_execution_runs(business_id, usage_day, status);

create index ai_execution_runs_business_latest_idx
  on public.ai_execution_runs(business_id, reserved_at desc, id desc);

create trigger business_ai_settings_set_updated_at
before update on public.business_ai_settings
for each row execute function private.set_updated_at();

create function private.create_business_ai_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_ai_settings (business_id)
  values (new.id);
  return new;
end;
$$;

create trigger businesses_create_ai_settings
after insert on public.businesses
for each row execute function private.create_business_ai_settings();

insert into public.business_ai_settings (business_id)
select business.id
from public.businesses as business
on conflict (business_id) do nothing;

create function private.calculate_ai_cost_microusd(
  input_tokens bigint,
  output_tokens bigint,
  input_rate_microusd_per_million bigint,
  output_rate_microusd_per_million bigint
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  calculated numeric;
begin
  if input_tokens < 0
    or output_tokens < 0
    or input_rate_microusd_per_million < 0
    or output_rate_microusd_per_million < 0 then
    raise exception 'ai_accounting_value_invalid' using errcode = '22023';
  end if;

  calculated :=
    ceil(
      input_tokens::numeric
      * input_rate_microusd_per_million::numeric
      / 1000000::numeric
    )
    + ceil(
      output_tokens::numeric
      * output_rate_microusd_per_million::numeric
      / 1000000::numeric
    );

  if calculated > 9000000000000000000::numeric then
    raise exception 'ai_accounting_value_overflow' using errcode = '22003';
  end if;

  return calculated::bigint;
end;
$$;

create function private.assert_ai_manager(
  expected_business_id uuid,
  expected_actor_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
begin
  if current_actor_id is null then
    raise exception 'ai_authentication_required' using errcode = '42501';
  end if;
  if current_actor_id is distinct from expected_actor_id then
    raise exception 'ai_actor_context_mismatch' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.business_memberships as membership
    where membership.business_id = expected_business_id
      and membership.user_id = current_actor_id
      and membership.role in (
        'owner'::public.business_role,
        'admin'::public.business_role
      )
  ) then
    raise exception 'ai_owner_or_admin_required' using errcode = '42501';
  end if;
end;
$$;

create function public.get_business_ai_settings(
  expected_business_id uuid,
  expected_actor_id uuid
)
returns table (
  business_id uuid,
  is_enabled boolean,
  daily_request_limit integer,
  daily_input_token_limit bigint,
  daily_output_token_limit bigint,
  daily_cost_limit_microusd bigint,
  created_at timestamptz,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_ai_manager(expected_business_id, expected_actor_id);
  return query
  select
    settings.business_id,
    settings.is_enabled,
    settings.daily_request_limit,
    settings.daily_input_token_limit,
    settings.daily_output_token_limit,
    settings.daily_cost_limit_microusd,
    settings.created_at,
    settings.updated_at,
    settings.updated_by
  from public.business_ai_settings as settings
  where settings.business_id = expected_business_id;
end;
$$;

create function public.update_business_ai_settings(
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_is_enabled boolean,
  requested_daily_request_limit integer,
  requested_daily_input_token_limit bigint,
  requested_daily_output_token_limit bigint,
  requested_daily_cost_limit_microusd bigint
)
returns table (
  business_id uuid,
  is_enabled boolean,
  daily_request_limit integer,
  daily_input_token_limit bigint,
  daily_output_token_limit bigint,
  daily_cost_limit_microusd bigint,
  created_at timestamptz,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_ai_manager(expected_business_id, expected_actor_id);

  return query
  update public.business_ai_settings as settings
  set
    is_enabled = requested_is_enabled,
    daily_request_limit = requested_daily_request_limit,
    daily_input_token_limit = requested_daily_input_token_limit,
    daily_output_token_limit = requested_daily_output_token_limit,
    daily_cost_limit_microusd = requested_daily_cost_limit_microusd,
    updated_by = expected_actor_id
  where settings.business_id = expected_business_id
  returning
    settings.business_id,
    settings.is_enabled,
    settings.daily_request_limit,
    settings.daily_input_token_limit,
    settings.daily_output_token_limit,
    settings.daily_cost_limit_microusd,
    settings.created_at,
    settings.updated_at,
    settings.updated_by;
end;
$$;

create function public.get_business_ai_usage_summary(
  expected_business_id uuid,
  expected_actor_id uuid
)
returns table (
  usage_day date,
  request_count bigint,
  input_tokens bigint,
  output_tokens bigint,
  cost_microusd bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_ai_manager(expected_business_id, expected_actor_id);

  return query
  select
    (statement_timestamp() at time zone 'UTC')::date,
    coalesce(sum(run.reserved_request_count), 0)::bigint,
    coalesce(sum(
      case
        when run.status = 'reserved'::public.ai_execution_status
          then run.reserved_input_tokens
        else run.charged_input_tokens
      end
    ), 0)::bigint,
    coalesce(sum(
      case
        when run.status = 'reserved'::public.ai_execution_status
          then run.reserved_output_tokens
        else run.charged_output_tokens
      end
    ), 0)::bigint,
    coalesce(sum(
      case
        when run.status = 'reserved'::public.ai_execution_status
          then run.reserved_cost_microusd
        else run.charged_cost_microusd
      end
    ), 0)::bigint
  from public.ai_execution_runs as run
  where run.business_id = expected_business_id
    and run.usage_day = (statement_timestamp() at time zone 'UTC')::date
    and run.status in (
      'reserved'::public.ai_execution_status,
      'succeeded'::public.ai_execution_status,
      'failed'::public.ai_execution_status
    );
end;
$$;

create function public.list_business_ai_execution_runs(
  expected_business_id uuid,
  expected_actor_id uuid
)
returns table (
  id uuid,
  business_id uuid,
  actor_id uuid,
  usage_day date,
  task_key text,
  task_version integer,
  purpose_label text,
  policy_key text,
  provider_key text,
  model_key text,
  status public.ai_execution_status,
  outcome_code text,
  reserved_request_count integer,
  reserved_input_tokens bigint,
  reserved_output_tokens bigint,
  reserved_cost_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  actual_cost_microusd bigint,
  charged_input_tokens bigint,
  charged_output_tokens bigint,
  charged_cost_microusd bigint,
  provider_attempt_count integer,
  provider_invocation_started boolean,
  usage_complete boolean,
  usage_overrun boolean,
  reserved_at timestamptz,
  settled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_ai_manager(expected_business_id, expected_actor_id);

  return query
  select
    run.id,
    run.business_id,
    run.actor_id,
    run.usage_day,
    run.task_key,
    run.task_version,
    run.purpose_label,
    run.policy_key,
    run.provider_key,
    run.model_key,
    run.status,
    run.outcome_code,
    run.reserved_request_count,
    run.reserved_input_tokens,
    run.reserved_output_tokens,
    run.reserved_cost_microusd,
    run.actual_input_tokens,
    run.actual_output_tokens,
    run.actual_cost_microusd,
    run.charged_input_tokens,
    run.charged_output_tokens,
    run.charged_cost_microusd,
    run.provider_attempt_count,
    run.provider_invocation_started,
    run.usage_complete,
    run.usage_overrun,
    run.reserved_at,
    run.settled_at
  from public.ai_execution_runs as run
  where run.business_id = expected_business_id
  order by run.reserved_at desc, run.id desc
  limit 50;
end;
$$;

create function public.reserve_business_ai_execution(
  requested_execution_id uuid,
  expected_business_id uuid,
  expected_actor_id uuid,
  requested_task_key text,
  requested_task_version integer,
  requested_purpose_label text,
  requested_policy_key text,
  requested_provider_key text,
  requested_model_key text,
  requested_reserved_input_tokens bigint,
  requested_reserved_output_tokens bigint,
  requested_input_microusd_per_million bigint,
  requested_output_microusd_per_million bigint
)
returns table (
  id uuid,
  business_id uuid,
  usage_day date,
  status public.ai_execution_status,
  reserved_request_count integer,
  reserved_input_tokens bigint,
  reserved_output_tokens bigint,
  reserved_cost_microusd bigint,
  reserved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.business_ai_settings%rowtype;
  existing public.ai_execution_runs%rowtype;
  utc_day date := (statement_timestamp() at time zone 'UTC')::date;
  requested_cost bigint;
  used_requests bigint;
  used_input_tokens bigint;
  used_output_tokens bigint;
  used_cost_microusd bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'ai_accounting_service_role_required'
      using errcode = '42501';
  end if;

  perform 1
  from public.business_memberships as membership
  where membership.business_id = expected_business_id
    and membership.user_id = expected_actor_id
    and membership.role in (
      'owner'::public.business_role,
      'admin'::public.business_role
    )
  for key share;
  if not found then
    raise exception 'ai_owner_or_admin_required' using errcode = '42501';
  end if;

  select *
  into settings
  from public.business_ai_settings as candidate
  where candidate.business_id = expected_business_id
  for update;
  if not found then
    raise exception 'ai_settings_not_found' using errcode = 'P0002';
  end if;

  select *
  into existing
  from public.ai_execution_runs as run
  where run.id = requested_execution_id;
  if found then
    if existing.business_id is distinct from expected_business_id
      or existing.actor_id is distinct from expected_actor_id
      or existing.task_key is distinct from requested_task_key
      or existing.task_version is distinct from requested_task_version
      or existing.purpose_label is distinct from requested_purpose_label
      or existing.policy_key is distinct from requested_policy_key
      or existing.provider_key is distinct from requested_provider_key
      or existing.model_key is distinct from requested_model_key
      or existing.reserved_input_tokens
        is distinct from requested_reserved_input_tokens
      or existing.reserved_output_tokens
        is distinct from requested_reserved_output_tokens
      or existing.input_microusd_per_million
        is distinct from requested_input_microusd_per_million
      or existing.output_microusd_per_million
        is distinct from requested_output_microusd_per_million then
      raise exception 'ai_reservation_idempotency_conflict'
        using errcode = '22023';
    end if;

    return query
    select
      existing.id,
      existing.business_id,
      existing.usage_day,
      existing.status,
      existing.reserved_request_count,
      existing.reserved_input_tokens,
      existing.reserved_output_tokens,
      existing.reserved_cost_microusd,
      existing.reserved_at;
    return;
  end if;

  if not settings.is_enabled then
    raise exception 'ai_disabled' using errcode = 'P0001';
  end if;

  requested_cost := private.calculate_ai_cost_microusd(
    requested_reserved_input_tokens,
    requested_reserved_output_tokens,
    requested_input_microusd_per_million,
    requested_output_microusd_per_million
  );

  select
    coalesce(sum(run.reserved_request_count), 0)::bigint,
    coalesce(sum(
      case
        when run.status = 'reserved'::public.ai_execution_status
          then run.reserved_input_tokens
        else run.charged_input_tokens
      end
    ), 0)::bigint,
    coalesce(sum(
      case
        when run.status = 'reserved'::public.ai_execution_status
          then run.reserved_output_tokens
        else run.charged_output_tokens
      end
    ), 0)::bigint,
    coalesce(sum(
      case
        when run.status = 'reserved'::public.ai_execution_status
          then run.reserved_cost_microusd
        else run.charged_cost_microusd
      end
    ), 0)::bigint
  into
    used_requests,
    used_input_tokens,
    used_output_tokens,
    used_cost_microusd
  from public.ai_execution_runs as run
  where run.business_id = expected_business_id
    and run.usage_day = utc_day
    and run.status in (
      'reserved'::public.ai_execution_status,
      'succeeded'::public.ai_execution_status,
      'failed'::public.ai_execution_status
    );

  if used_requests + 1 > settings.daily_request_limit
    or used_input_tokens + requested_reserved_input_tokens
      > settings.daily_input_token_limit
    or used_output_tokens + requested_reserved_output_tokens
      > settings.daily_output_token_limit
    or used_cost_microusd + requested_cost
      > settings.daily_cost_limit_microusd then
    raise exception 'ai_budget_exceeded' using errcode = 'P0001';
  end if;

  insert into public.ai_execution_runs (
    id,
    business_id,
    actor_id,
    usage_day,
    task_key,
    task_version,
    purpose_label,
    policy_key,
    provider_key,
    model_key,
    input_microusd_per_million,
    output_microusd_per_million,
    reserved_input_tokens,
    reserved_output_tokens,
    reserved_cost_microusd
  )
  values (
    requested_execution_id,
    expected_business_id,
    expected_actor_id,
    utc_day,
    requested_task_key,
    requested_task_version,
    trim(requested_purpose_label),
    requested_policy_key,
    requested_provider_key,
    requested_model_key,
    requested_input_microusd_per_million,
    requested_output_microusd_per_million,
    requested_reserved_input_tokens,
    requested_reserved_output_tokens,
    requested_cost
  )
  returning
    ai_execution_runs.id,
    ai_execution_runs.business_id,
    ai_execution_runs.usage_day,
    ai_execution_runs.status,
    ai_execution_runs.reserved_request_count,
    ai_execution_runs.reserved_input_tokens,
    ai_execution_runs.reserved_output_tokens,
    ai_execution_runs.reserved_cost_microusd,
    ai_execution_runs.reserved_at
  into
    id,
    business_id,
    usage_day,
    status,
    reserved_request_count,
    reserved_input_tokens,
    reserved_output_tokens,
    reserved_cost_microusd,
    reserved_at;

  return next;
end;
$$;

create function public.settle_business_ai_execution(
  requested_execution_id uuid,
  expected_business_id uuid,
  requested_status public.ai_execution_status,
  requested_outcome_code text,
  requested_actual_input_tokens bigint,
  requested_actual_output_tokens bigint,
  requested_provider_attempt_count integer,
  requested_provider_invocation_started boolean,
  requested_usage_complete boolean
)
returns table (
  id uuid,
  business_id uuid,
  status public.ai_execution_status,
  outcome_code text,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  actual_cost_microusd bigint,
  charged_input_tokens bigint,
  charged_output_tokens bigint,
  charged_cost_microusd bigint,
  provider_attempt_count integer,
  provider_invocation_started boolean,
  usage_complete boolean,
  usage_overrun boolean,
  settled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.ai_execution_runs%rowtype;
  calculated_actual_cost bigint;
  calculated_charged_input bigint;
  calculated_charged_output bigint;
  calculated_charged_cost bigint;
  calculated_overrun boolean;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'ai_accounting_service_role_required'
      using errcode = '42501';
  end if;

  if requested_status is null
    or requested_status not in (
    'succeeded'::public.ai_execution_status,
    'failed'::public.ai_execution_status,
    'cancelled'::public.ai_execution_status
  ) then
    raise exception 'ai_settlement_status_invalid' using errcode = '22023';
  end if;
  if requested_outcome_code is null
    or char_length(requested_outcome_code) not between 1 and 80
    or requested_outcome_code !~ '^ai_[a-z0-9_]+$' then
    raise exception 'ai_settlement_outcome_invalid' using errcode = '22023';
  end if;

  if requested_status = 'cancelled'::public.ai_execution_status then
    if requested_provider_invocation_started
      or requested_provider_attempt_count <> 0
      or not requested_usage_complete
      or requested_actual_input_tokens is distinct from 0
      or requested_actual_output_tokens is distinct from 0 then
      raise exception 'ai_cancelled_settlement_invalid' using errcode = '22023';
    end if;
  elsif not requested_provider_invocation_started
    or requested_provider_attempt_count not between 1 and 5 then
    raise exception 'ai_provider_settlement_invalid' using errcode = '22023';
  end if;

  if requested_usage_complete
    and (
      requested_actual_input_tokens is null
      or requested_actual_output_tokens is null
    ) then
    raise exception 'ai_complete_usage_missing' using errcode = '22023';
  end if;

  select *
  into run
  from public.ai_execution_runs as candidate
  where candidate.id = requested_execution_id
  for update;
  if not found or run.business_id is distinct from expected_business_id then
    raise exception 'ai_reservation_not_found' using errcode = 'P0002';
  end if;

  if run.status <> 'reserved'::public.ai_execution_status then
    if run.status is distinct from requested_status
      or run.outcome_code is distinct from requested_outcome_code
      or run.actual_input_tokens is distinct from requested_actual_input_tokens
      or run.actual_output_tokens
        is distinct from requested_actual_output_tokens
      or run.provider_attempt_count
        is distinct from requested_provider_attempt_count
      or run.provider_invocation_started
        is distinct from requested_provider_invocation_started
      or run.usage_complete is distinct from requested_usage_complete then
      raise exception 'ai_settlement_idempotency_conflict'
        using errcode = '22023';
    end if;

    return query
    select
      run.id,
      run.business_id,
      run.status,
      run.outcome_code,
      run.actual_input_tokens,
      run.actual_output_tokens,
      run.actual_cost_microusd,
      run.charged_input_tokens,
      run.charged_output_tokens,
      run.charged_cost_microusd,
      run.provider_attempt_count,
      run.provider_invocation_started,
      run.usage_complete,
      run.usage_overrun,
      run.settled_at;
    return;
  end if;

  if requested_actual_input_tokens is not null
    and requested_actual_output_tokens is not null then
    calculated_actual_cost := private.calculate_ai_cost_microusd(
      requested_actual_input_tokens,
      requested_actual_output_tokens,
      run.input_microusd_per_million,
      run.output_microusd_per_million
    );
  end if;

  if requested_status = 'cancelled'::public.ai_execution_status then
    calculated_charged_input := 0;
    calculated_charged_output := 0;
  elsif requested_usage_complete then
    calculated_charged_input := requested_actual_input_tokens;
    calculated_charged_output := requested_actual_output_tokens;
  else
    calculated_charged_input := greatest(
      run.reserved_input_tokens,
      coalesce(requested_actual_input_tokens, 0)
    );
    calculated_charged_output := greatest(
      run.reserved_output_tokens,
      coalesce(requested_actual_output_tokens, 0)
    );
  end if;

  calculated_charged_cost := private.calculate_ai_cost_microusd(
    calculated_charged_input,
    calculated_charged_output,
    run.input_microusd_per_million,
    run.output_microusd_per_million
  );
  calculated_overrun :=
    coalesce(requested_actual_input_tokens > run.reserved_input_tokens, false)
    or coalesce(
      requested_actual_output_tokens > run.reserved_output_tokens,
      false
    )
    or calculated_charged_cost > run.reserved_cost_microusd;

  update public.ai_execution_runs as target
  set
    status = requested_status,
    outcome_code = requested_outcome_code,
    actual_input_tokens = requested_actual_input_tokens,
    actual_output_tokens = requested_actual_output_tokens,
    actual_cost_microusd = calculated_actual_cost,
    charged_input_tokens = calculated_charged_input,
    charged_output_tokens = calculated_charged_output,
    charged_cost_microusd = calculated_charged_cost,
    provider_attempt_count = requested_provider_attempt_count,
    provider_invocation_started = requested_provider_invocation_started,
    usage_complete = requested_usage_complete,
    usage_overrun = calculated_overrun,
    settled_at = statement_timestamp()
  where target.id = requested_execution_id
  returning
    target.id,
    target.business_id,
    target.status,
    target.outcome_code,
    target.actual_input_tokens,
    target.actual_output_tokens,
    target.actual_cost_microusd,
    target.charged_input_tokens,
    target.charged_output_tokens,
    target.charged_cost_microusd,
    target.provider_attempt_count,
    target.provider_invocation_started,
    target.usage_complete,
    target.usage_overrun,
    target.settled_at
  into
    id,
    business_id,
    status,
    outcome_code,
    actual_input_tokens,
    actual_output_tokens,
    actual_cost_microusd,
    charged_input_tokens,
    charged_output_tokens,
    charged_cost_microusd,
    provider_attempt_count,
    provider_invocation_started,
    usage_complete,
    usage_overrun,
    settled_at;

  return next;
end;
$$;

alter table public.business_ai_settings enable row level security;
alter table public.ai_execution_runs enable row level security;

revoke all on table public.business_ai_settings from public;
revoke all on table public.business_ai_settings from anon;
revoke all on table public.business_ai_settings from authenticated;
revoke all on table public.business_ai_settings from service_role;
revoke all on table public.ai_execution_runs from public;
revoke all on table public.ai_execution_runs from anon;
revoke all on table public.ai_execution_runs from authenticated;
revoke all on table public.ai_execution_runs from service_role;

revoke all on function private.create_business_ai_settings() from public;
revoke all on function private.calculate_ai_cost_microusd(
  bigint,
  bigint,
  bigint,
  bigint
) from public;
revoke all on function private.assert_ai_manager(uuid, uuid) from public;

revoke all on function public.get_business_ai_settings(uuid, uuid) from public;
revoke all on function public.update_business_ai_settings(
  uuid,
  uuid,
  boolean,
  integer,
  bigint,
  bigint,
  bigint
) from public;
revoke all on function public.get_business_ai_usage_summary(uuid, uuid)
  from public;
revoke all on function public.list_business_ai_execution_runs(uuid, uuid)
  from public;
revoke all on function public.reserve_business_ai_execution(
  uuid,
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  bigint
) from public;
revoke all on function public.settle_business_ai_execution(
  uuid,
  uuid,
  public.ai_execution_status,
  text,
  bigint,
  bigint,
  integer,
  boolean,
  boolean
) from public;

grant execute on function public.get_business_ai_settings(uuid, uuid)
  to authenticated;
grant execute on function public.update_business_ai_settings(
  uuid,
  uuid,
  boolean,
  integer,
  bigint,
  bigint,
  bigint
) to authenticated;
grant execute on function public.get_business_ai_usage_summary(uuid, uuid)
  to authenticated;
grant execute on function public.list_business_ai_execution_runs(uuid, uuid)
  to authenticated;
grant execute on function public.reserve_business_ai_execution(
  uuid,
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  bigint,
  bigint
) to service_role;
grant execute on function public.settle_business_ai_execution(
  uuid,
  uuid,
  public.ai_execution_status,
  text,
  bigint,
  bigint,
  integer,
  boolean,
  boolean
) to service_role;
