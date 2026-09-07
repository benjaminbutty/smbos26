-- The Page editor persists a title and body through one atomic
-- `save_page_layout` action. A title-only edit is a valid change even when
-- its layout is byte-for-byte identical to the base snapshot.
do $$
declare
  definition text;
  old_metadata_fragment text :=
    'or (candidate_page - ''layout_json'') <> (base_page - ''layout_json'')';
  new_metadata_fragment text :=
    'or (candidate_page - ''title'' - ''layout_json'') <> (base_page - ''title'' - ''layout_json'')';
  old_fragment text :=
    'or private.direct_page_layouts_equal_v1(base_page -> ''layout_json'', operation -> ''layout_json'')';
  new_fragment text :=
    'or (candidate_page ->> ''title'' = base_page ->> ''title'' and private.direct_page_layouts_equal_v1(base_page -> ''layout_json'', operation -> ''layout_json''))';
begin
  select pg_get_functiondef(
    'private.assert_direct_page_action_shape_v1(text,jsonb,jsonb,jsonb)'::regprocedure
  )
  into definition;

  if definition is null
    or (
      position(old_metadata_fragment in definition) = 0
      and position(new_metadata_fragment in definition) = 0
    )
    or (
      position(old_fragment in definition) = 0
      and position(new_fragment in definition) = 0
    )
  then
    raise exception 'internal_pages_atomic_title_save_patch_not_applied';
  end if;

  if position(old_metadata_fragment in definition) > 0 then
    definition := replace(definition, old_metadata_fragment, new_metadata_fragment);
  end if;
  if position(old_fragment in definition) > 0 then
    definition := replace(definition, old_fragment, new_fragment);
  end if;
  execute definition;
end;
$$;
