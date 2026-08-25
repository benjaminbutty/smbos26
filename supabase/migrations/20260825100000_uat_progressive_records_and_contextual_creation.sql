-- UAT correction: generic Records are progressively completable and related
-- Records are created with their initiating Connection in one transaction.
--
-- `field_definitions.required` remains a contextual completeness setting for
-- configured Forms and specialised trusted capabilities. It is deliberately
-- no longer a precondition for the existence of an ordinary graph Record.

create or replace function private.assert_valid_graph_record_data(
  target_business_id uuid,
  target_object_definition_id uuid,
  proposed_data jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  supplied_field record;
  defined_field public.field_definitions;
begin
  if jsonb_typeof(proposed_data) <> 'object' then
    raise exception 'Record data must be a JSON object'
      using errcode = '22023';
  end if;

  for supplied_field in
    select entry.key, entry.value
    from jsonb_each(proposed_data) as entry
  loop
    select field_definition.*
    into defined_field
    from public.field_definitions as field_definition
    where field_definition.business_id = target_business_id
      and field_definition.object_definition_id = target_object_definition_id
      and field_definition.key = supplied_field.key;

    if not found then
      raise exception 'Unknown record field key: %', supplied_field.key
        using errcode = '22023';
    end if;

    -- On updates the complete historical JSON is validated again. The record
    -- trigger separately rejects introducing or changing an archived Field,
    -- while this function must allow its unchanged historical value to remain
    -- as ordinary active Fields are completed progressively.
    if defined_field.is_active and not private.graph_field_value_is_valid(
      supplied_field.value,
      defined_field.field_type,
      defined_field.settings_json
    ) then
      raise exception 'Invalid value for field: %', supplied_field.key
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function private.graph_record_creation_eligibility_v1(
  target_business_id uuid,
  target_object_definition_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with reasons(reason_code) as (
    select 'inactive_object'::text
    from public.object_definitions as object_definition
    where object_definition.business_id = $1
      and object_definition.id = $2
      and not object_definition.is_active

    union all

    select 'preorder_order_object'::text
    where exists (
      select 1
      from public.preorder_experiences as preorder
      where preorder.business_id = $1
        and preorder.order_object_definition_id = $2
        and preorder.is_active
    )

    union all

    select 'preorder_order_item_object'::text
    where exists (
      select 1
      from public.preorder_experiences as preorder
      where preorder.business_id = $1
        and preorder.order_item_object_definition_id = $2
        and preorder.is_active
    )

    union all

    select 'no_writable_fields'::text
    where not exists (
      select 1
      from public.field_definitions as field_definition
      where field_definition.business_id = $1
        and field_definition.object_definition_id = $2
        and field_definition.is_active
        and field_definition.field_type <> 'file'::public.graph_field_type
    )
  )
  select jsonb_build_object(
    'eligible', not exists (select 1 from reasons),
    'reason_codes', coalesce(
      (select jsonb_agg(reason_code order by reason_code) from reasons),
      '[]'::jsonb
    )
  );
$$;

create function public.create_contextual_graph_record(
  expected_business_id uuid,
  initiating_relationship_key text,
  initiating_direction text,
  parent_record_id uuid,
  requested_data jsonb default '{}'::jsonb,
  requested_connections jsonb default '[]'::jsonb
)
returns public.records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  relationship_definition public.relationship_definitions;
  parent_record public.records;
  created_record public.records;
  connection_value jsonb;
  additional_relationship public.relationship_definitions;
  target_id uuid;
  source_id uuid;
  target_id_for_edge uuid;
begin
  if initiating_direction not in ('source', 'target')
    or jsonb_typeof(requested_data) <> 'object'
    or jsonb_typeof(requested_connections) <> 'array'
    or jsonb_array_length(requested_connections) > 20 then
    raise exception 'contextual_record_request_invalid' using errcode = '22023';
  end if;

  select relationship.* into relationship_definition
  from public.relationship_definitions as relationship
  where relationship.business_id = expected_business_id
    and relationship.key = initiating_relationship_key
    and relationship.is_active
  ;
  if not found then
    raise exception 'contextual_record_connection_unavailable' using errcode = 'P0002';
  end if;

  select record_value.* into parent_record
  from public.records as record_value
  where record_value.business_id = expected_business_id
    and record_value.id = parent_record_id
    and record_value.record_status = 'active'::public.graph_record_status
  ;
  if not found then
    raise exception 'contextual_record_parent_unavailable' using errcode = 'P0002';
  end if;

  if (
    initiating_direction = 'source'
    and parent_record.object_definition_id <> relationship_definition.source_object_definition_id
  ) or (
    initiating_direction = 'target'
    and parent_record.object_definition_id <> relationship_definition.target_object_definition_id
  ) then
    raise exception 'contextual_record_connection_unavailable' using errcode = '23514';
  end if;

  insert into public.records (business_id, object_definition_id, data_json)
  values (
    expected_business_id,
    case when initiating_direction = 'source'
      then relationship_definition.target_object_definition_id
      else relationship_definition.source_object_definition_id
    end,
    requested_data
  )
  returning * into created_record;

  if initiating_direction = 'source' then
    source_id := parent_record.id;
    target_id_for_edge := created_record.id;
  else
    source_id := created_record.id;
    target_id_for_edge := parent_record.id;
  end if;

  insert into public.record_relationships (
    business_id, relationship_definition_id, source_record_id, target_record_id
  ) values (
    expected_business_id, relationship_definition.id, source_id, target_id_for_edge
  );

  for connection_value in
    select value from jsonb_array_elements(requested_connections)
  loop
    if not private.experience_json_has_only_keys(
      connection_value,
      array['relationship_key', 'direction', 'target_record_ids']
    )
      or jsonb_typeof(connection_value -> 'relationship_key') <> 'string'
      or connection_value ->> 'relationship_key' !~ '^[a-z][a-z0-9_]*$'
      or connection_value ->> 'direction' not in ('source', 'target')
      or jsonb_typeof(connection_value -> 'target_record_ids') <> 'array'
      or jsonb_array_length(connection_value -> 'target_record_ids') > 100
    then
      raise exception 'contextual_record_request_invalid' using errcode = '22023';
    end if;

    select relationship.* into additional_relationship
    from public.relationship_definitions as relationship
    where relationship.business_id = expected_business_id
      and relationship.key = connection_value ->> 'relationship_key'
      and relationship.is_active
    ;
    if not found then
      raise exception 'contextual_record_connection_unavailable' using errcode = 'P0002';
    end if;

    if (
      connection_value ->> 'direction' = 'source'
      and additional_relationship.source_object_definition_id <> created_record.object_definition_id
    ) or (
      connection_value ->> 'direction' = 'target'
      and additional_relationship.target_object_definition_id <> created_record.object_definition_id
    ) then
      raise exception 'contextual_record_connection_unavailable' using errcode = '23514';
    end if;

    for target_id in
      select value::text::uuid
      from jsonb_array_elements_text(connection_value -> 'target_record_ids') as item(value)
    loop
      if not exists (
        select 1 from public.records as target_record
        where target_record.business_id = expected_business_id
          and target_record.id = target_id
          and target_record.record_status = 'active'::public.graph_record_status
          and target_record.object_definition_id = case
            when connection_value ->> 'direction' = 'source'
              then additional_relationship.target_object_definition_id
            else additional_relationship.source_object_definition_id
          end
      ) then
        raise exception 'contextual_record_target_unavailable' using errcode = 'P0002';
      end if;

      insert into public.record_relationships (
        business_id, relationship_definition_id, source_record_id, target_record_id
      ) values (
        expected_business_id,
        additional_relationship.id,
        case when connection_value ->> 'direction' = 'source'
          then created_record.id else target_id end,
        case when connection_value ->> 'direction' = 'source'
          then target_id else created_record.id end
      );
    end loop;
  end loop;

  return created_record;
end;
$$;

revoke all on function public.create_contextual_graph_record(
  uuid, text, text, uuid, jsonb, jsonb
) from public, anon, service_role;
grant execute on function public.create_contextual_graph_record(
  uuid, text, text, uuid, jsonb, jsonb
) to authenticated;

comment on function private.assert_valid_graph_record_data(uuid, uuid, jsonb) is
  'Validates supplied generic Record data. Field requiredness is contextual to Forms and trusted capabilities; ordinary Records may be progressively completed.';

comment on function public.create_contextual_graph_record(uuid, text, text, uuid, jsonb, jsonb) is
  'Atomically creates one ordinary generic Record, the initiating parent Connection, and selected additional active Connections. It deliberately cannot create Records recursively.';
