-- The configuration projector can expose the same Object active-state change
-- through its temporary parking/rebuild writes and through snapshot
-- reconciliation. Treat each existing availability row as a state machine so
-- that those duplicate observations cannot advance its epoch twice.
create or replace function private.site_reconcile_object_transition_v2(
  target_business_id uuid,
  target_object_definition_id uuid,
  target_is_active boolean,
  target_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  object_key text;
  site_value record;
  current_value public.site_public_object_availability;
begin
  select definition.key into object_key
  from public.object_definitions as definition
  where definition.business_id = target_business_id
    and definition.id = target_object_definition_id;
  if object_key is null then return; end if;
  for site_value in
    select state.id, state.active_release_revision, state.created_by,
      state.draft_json
    from public.site_states as state
    where state.business_id = target_business_id
      and (
        exists (
          select 1
          from public.site_release_collection_references as reference
          where reference.business_id = target_business_id
            and reference.object_definition_id = target_object_definition_id
        )
        or exists (
          select 1
          from private.site_draft_blocks_v1(state.draft_json) as block_value
          where block_value.block ->> 'type' = 'collection'
            and block_value.block ->> 'object_key' = object_key
        )
      )
    order by state.id
    for update
  loop
    select * into current_value
    from public.site_public_object_availability
    where business_id = target_business_id
      and site_id = site_value.id
      and object_definition_id = target_object_definition_id
    for update;
    if target_is_active then
      if not found then
        insert into public.site_public_object_availability (
          business_id, site_id, object_definition_id, status,
          available_from_release_revision, changed_by
        ) values (
          target_business_id, site_value.id, target_object_definition_id,
          'available', site_value.active_release_revision + 1,
          coalesce(target_actor_id, site_value.created_by)
        );
      elsif current_value.status = 'withdrawn'
        and current_value.available_from_release_revision = 0
      then
        -- The source was withdrawn before this configuration transition. A
        -- fresh source reactivation moves it into a new, still-withdrawn
        -- epoch; publication remains the explicit visibility boundary.
        update public.site_public_object_availability
        set status = 'withdrawn',
          availability_revision = current_value.availability_revision + 1,
          available_from_release_revision = greatest(
            current_value.available_from_release_revision,
            site_value.active_release_revision + 1
          ),
          changed_by = coalesce(target_actor_id, site_value.created_by),
          changed_at = timezone('utc', now())
        where business_id = target_business_id
          and site_id = site_value.id
          and object_definition_id = target_object_definition_id;
      end if;
      -- A withdrawn row with a non-zero next-release epoch already records
      -- this source reactivation. An available row is already current.
    else
      if not found then
        insert into public.site_public_object_availability (
          business_id, site_id, object_definition_id, status,
          available_from_release_revision, changed_by
        ) values (
          target_business_id, site_value.id, target_object_definition_id,
          'withdrawn', 0, coalesce(target_actor_id, site_value.created_by)
        );
      elsif current_value.status <> 'withdrawn' then
        update public.site_public_object_availability
        set status = 'withdrawn',
          availability_revision = current_value.availability_revision + 1,
          available_from_release_revision = 0,
          changed_by = coalesce(target_actor_id, site_value.created_by),
          changed_at = timezone('utc', now())
        where business_id = target_business_id
          and site_id = site_value.id
          and object_definition_id = target_object_definition_id;
      end if;
      -- A withdrawn row already represents this source withdrawal.
    end if;
  end loop;
end;
$$;

revoke all on function private.site_reconcile_object_transition_v2(
  uuid, uuid, boolean, uuid
) from public, anon, authenticated, service_role;
