-- Keep Customer review readable without changing the immutable receipt data.
-- Labels come from the released Form action addressed by the receipt.  The
-- receipt's frozen action is retained as a compatibility fallback for older
-- rows whose action index is no longer available.

create or replace function private.site_customer_review_submitted_detail_rows_v1(
  target_business_id uuid,
  receipt_release_id uuid,
  receipt_action_key text,
  receipt_action_json jsonb,
  receipt_answers jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  released_action jsonb;
  question jsonb;
  question_key text;
  question_label text;
  answer_key text;
  question_ordinal bigint;
  detail_rows jsonb := '[]'::jsonb;
  seen_keys text[] := array[]::text[];
  answers jsonb := coalesce(receipt_answers, '{}'::jsonb);
begin
  if jsonb_typeof(answers) is distinct from 'object' then
    return '[]'::jsonb;
  end if;

  -- The release action is immutable and tenant-scoped.  Never consult the
  -- mutable Form or Site draft when projecting a historical receipt.
  if receipt_release_id is not null and receipt_action_key is not null then
    select action.action_json
    into released_action
    from public.site_release_actions_v3 as action
    where action.business_id = target_business_id
      and action.release_id = receipt_release_id
      and action.action_key = receipt_action_key;
  end if;
  if jsonb_typeof(released_action) is distinct from 'object' then
    released_action := coalesce(receipt_action_json -> 'action', '{}'::jsonb);
  end if;

  -- Walk the frozen question order first.  Appending rows rather than
  -- building an object preserves two questions that share one label.
  for question, question_ordinal in
    select item.value, item.ordinality
    from jsonb_array_elements(
      coalesce(released_action -> 'questions', '[]'::jsonb)
    ) with ordinality as item(value, ordinality)
  loop
    question_key := nullif(btrim(question ->> 'key'), '');
    if question_key is null or not (answers ? question_key) then
      continue;
    end if;
    question_label := nullif(btrim(question ->> 'label'), '');
    if question_label is null then
      question_label := 'Question ' || question_ordinal::text;
    end if;
    detail_rows := detail_rows || jsonb_build_array(jsonb_build_object(
      'label', question_label,
      'value', answers -> question_key
    ));
    seen_keys := array_append(seen_keys, question_key);
  end loop;

  -- Historical rows may contain a submitted answer whose question was
  -- removed from the release action's public question list (for example a
  -- hidden or legacy Field).  Keep its value, with a plain fallback label
  -- that never exposes the internal answer key.
  for answer_key in select key from jsonb_object_keys(answers) as item(key)
  loop
    if answer_key = any(seen_keys) then
      continue;
    end if;
    detail_rows := detail_rows || jsonb_build_array(jsonb_build_object(
      'label', 'Submitted answer ' || (jsonb_array_length(detail_rows) + 1)::text,
      'value', answers -> answer_key
    ));
  end loop;

  return detail_rows;
end;
$$;

revoke all on function private.site_customer_review_submitted_detail_rows_v1(
  uuid, uuid, text, jsonb, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.list_site_customer_resolution_cases(
  expected_business_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if expected_business_id is null
    or not private.can_manage_tenant(expected_business_id)
  then
    raise exception 'site_customer_review_forbidden' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(item order by item ->> 'created_at'), '[]'::jsonb)
  into result
  from (
    select item
    from (
      select jsonb_build_object(
      'kind', 'form', 'receipt_id', submission.id,
      'public_reference', submission.public_reference,
      'created_at', submission.created_at,
      'match_identity', submission.customer_match_identity,
      'match_count', submission.customer_match_count,
      'candidate_ids', to_jsonb(submission.customer_candidate_ids),
      'candidate_profiles', private.site_customer_profile_context_v1(
        expected_business_id, submission.customer_candidate_ids
      ),
      'original_customer_record_id', submission.original_customer_record_id,
      'customer_record_id', submission.customer_record_id,
      'resolution_state', submission.customer_resolution_state,
      'resolution_revision', submission.customer_resolution_revision,
      -- Keep the raw receipt projection for trusted callers and provide a
      -- separate readable projection for the owner-facing review surface.
      'submitted_details', coalesce(submission.canonical_answers, '{}'::jsonb),
      'submitted_detail_rows', private.site_customer_review_submitted_detail_rows_v1(
        expected_business_id, submission.release_id, submission.action_key,
        submission.action_json, coalesce(submission.canonical_answers, '{}'::jsonb)
      )
      ) as item
      from public.public_form_submissions as submission
      where submission.business_id = expected_business_id
        and coalesce(submission.customer_match_count, 0) > 1
      union all
      select jsonb_build_object(
      'kind', 'booking', 'receipt_id', submission.id,
      'public_reference', submission.public_reference,
      'created_at', submission.created_at,
      'match_identity', submission.customer_match_identity,
      'match_count', submission.customer_match_count,
      'candidate_ids', to_jsonb(submission.customer_candidate_ids),
      'candidate_profiles', private.site_customer_profile_context_v1(
        expected_business_id, submission.customer_candidate_ids
      ),
      'original_customer_record_id', submission.original_customer_record_id,
      'customer_record_id', submission.customer_record_id,
      'resolution_state', submission.customer_resolution_state,
      'resolution_revision', submission.customer_resolution_revision,
      'submitted_details', coalesce(submission.canonical_submission, '{}'::jsonb)
      ) as item
      from public.booking_submissions as submission
      where submission.business_id = expected_business_id
        and coalesce(submission.customer_match_count, 0) > 1
      union all
      select jsonb_build_object(
      'kind', 'preorder', 'receipt_id', submission.id,
      'public_reference', submission.public_reference,
      'created_at', submission.created_at,
      'match_identity', submission.customer_match_identity,
      'match_count', submission.customer_match_count,
      'candidate_ids', to_jsonb(submission.customer_candidate_ids),
      'candidate_profiles', private.site_customer_profile_context_v1(
        expected_business_id, submission.customer_candidate_ids
      ),
      'original_customer_record_id', submission.original_customer_record_id,
      'customer_record_id', submission.customer_record_id,
      'resolution_state', submission.customer_resolution_state,
      'resolution_revision', submission.customer_resolution_revision,
      'submitted_details', coalesce(submission.canonical_submission, '{}'::jsonb)
      ) as item
      from public.preorder_submissions as submission
      where submission.business_id = expected_business_id
        and coalesce(submission.customer_match_count, 0) > 1
    ) as all_cases(item)
    order by item ->> 'created_at'
    limit 100
  ) as cases;
  return result;
end;
$$;

revoke all on function public.list_site_customer_resolution_cases(uuid)
  from public, anon;
grant execute on function public.list_site_customer_resolution_cases(uuid)
  to authenticated;
