-- Milestone 5 Phase 3B
-- Make the versioned change-set engine the mandatory normal production
-- mutation boundary for graph, experience and preorder configuration.

-- Runtime members still need the normalized projection for generated
-- workspaces. Public callers continue to use the narrow security-definer
-- resolvers and receive no direct table access.
revoke all on table public.object_definitions
  from anon, authenticated, service_role;
revoke all on table public.field_definitions
  from anon, authenticated, service_role;
revoke all on table public.relationship_definitions
  from anon, authenticated, service_role;
revoke all on table public.views
  from anon, authenticated, service_role;
revoke all on table public.forms
  from anon, authenticated, service_role;
revoke all on table public.pages
  from anon, authenticated, service_role;
revoke all on table public.preorder_experiences
  from anon, authenticated, service_role;
revoke all on table public.preorder_experience_locations
  from anon, authenticated, service_role;

grant select on table public.object_definitions to authenticated;
grant select on table public.field_definitions to authenticated;
grant select on table public.relationship_definitions to authenticated;
grant select on table public.views to authenticated;
grant select on table public.forms to authenticated;
grant select on table public.pages to authenticated;
grant select on table public.preorder_experiences to authenticated;
grant select on table public.preorder_experience_locations to authenticated;

-- RLS remains the tenant read boundary. Configuration writes are not an RLS
-- capability after this migration: the engine's security-definer lifecycle
-- functions own the only normal production write path.
drop policy if exists "Owners and admins can create object definitions"
  on public.object_definitions;
drop policy if exists "Owners and admins can update object definitions"
  on public.object_definitions;
drop policy if exists "Owners and admins can create field definitions"
  on public.field_definitions;
drop policy if exists "Owners and admins can update field definitions"
  on public.field_definitions;
drop policy if exists "Owners and admins can create relationship definitions"
  on public.relationship_definitions;
drop policy if exists "Owners and admins can update relationship definitions"
  on public.relationship_definitions;
drop policy if exists "Owners and admins can create Views"
  on public.views;
drop policy if exists "Owners and admins can update Views"
  on public.views;
drop policy if exists "Owners and admins can create Forms"
  on public.forms;
drop policy if exists "Owners and admins can update Forms"
  on public.forms;
drop policy if exists "Owners and admins can create Pages"
  on public.pages;
drop policy if exists "Owners and admins can update Pages"
  on public.pages;
drop policy if exists "Owners and admins can create preorder configuration"
  on public.preorder_experiences;
drop policy if exists "Owners and admins can update preorder configuration"
  on public.preorder_experiences;
drop policy if exists "Owners and admins can add preorder allowed Locations"
  on public.preorder_experience_locations;
drop policy if exists "Owners and admins can remove preorder allowed Locations"
  on public.preorder_experience_locations;
drop policy if exists "Owners and admins can update allowed preorder Locations"
  on public.preorder_experience_locations;

-- The two Milestone 4 preorder configuration helpers are retained only to
-- avoid rewriting historical migrations. No application role can execute
-- them, directly or through another public wrapper.
revoke all on function public.create_preorder_experience(
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb,
  uuid[],
  boolean
) from public, anon, authenticated, service_role;
revoke all on function public.set_preorder_experience_locations(
  uuid,
  uuid,
  uuid[]
) from public, anon, authenticated, service_role;

-- Private materialisation, diff, projection, sandbox, assertion and lifecycle
-- helpers are implementation details. Revoke every overload explicitly by
-- catalogue identity so an application role cannot bypass the lifecycle RPCs.
do $$
declare
  engine_function regprocedure;
begin
  for engine_function in
    select procedure_value.oid::regprocedure
    from pg_catalog.pg_proc as procedure_value
    join pg_catalog.pg_namespace as namespace_value
      on namespace_value.oid = procedure_value.pronamespace
    where namespace_value.nspname = 'private'
      and procedure_value.proname in (
        'assert_configuration_application_state_v1',
        'assert_configuration_candidate_field_v1',
        'assert_configuration_candidate_locations_active_v1',
        'assert_configuration_candidate_preorder_v1',
        'assert_configuration_candidate_v1',
        'assert_configuration_display_context_v1',
        'assert_configuration_operations_v1',
        'assert_configuration_projection_matches_v1',
        'build_configuration_display_context_v1',
        'configuration_candidate_field_v1',
        'configuration_diff_properties_v1',
        'configuration_display_context_v1_is_valid',
        'configuration_json_has_exact_keys',
        'configuration_json_has_only_keys',
        'configuration_materialize_candidate_v1',
        'configuration_operation_target_v1',
        'configuration_preorder_diff_properties_v1',
        'configuration_semantic_diff_v1',
        'configuration_snapshot_checksum_v1',
        'configuration_snapshot_v1',
        'configuration_uuid_is_valid',
        'configuration_validation_issue_v1',
        'configuration_validation_result_v1_is_valid',
        'initialize_business_configuration_baseline',
        'initialize_new_business_configuration_baseline',
        'project_configuration_candidate_v1',
        'protect_business_configuration_head',
        'protect_configuration_change_set',
        'reject_configuration_change_set_delete',
        'reject_configuration_version_delete',
        'reject_configuration_version_update',
        'validate_configuration_candidate_in_sandbox_v1'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      engine_function
    );
  end loop;
end;
$$;

alter default privileges for role postgres in schema private
  revoke execute on functions from public;

comment on table public.configuration_change_sets is
  'Owner/Admin structured configuration proposals. The propose, validate, apply and abandon lifecycle is the mandatory normal production configuration mutation boundary.';
