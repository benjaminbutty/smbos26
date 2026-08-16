-- Journey 1 public runtime resolution.
--
-- Configuration tables are deliberately hidden from the anonymous and
-- service roles by the configuration boundary. Public Pages therefore use
-- narrow security-definer resolvers for their safe presentation metadata.
-- This resolver returns only an active public create Form referenced by the
-- requested published Page and the explicitly configured public Fields.

create or replace function public.resolve_public_form(
  requested_business_slug text,
  requested_page_slug text,
  requested_form_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'definition', jsonb_build_object(
      'id', form.id,
      'business_id', form.business_id,
      'key', form.key,
      'name', form.name,
      'object_definition_id', form.object_definition_id,
      'mode', form.mode,
      'config_json', form.config_json,
      'audience', form.audience,
      'is_active', form.is_active,
      'created_at', form.created_at,
      'updated_at', form.updated_at
    ),
    'object', jsonb_build_object(
      'id', object_definition.id,
      'business_id', object_definition.business_id,
      'key', object_definition.key,
      'singular_label', object_definition.singular_label,
      'plural_label', object_definition.plural_label,
      'description', object_definition.description,
      'kind', object_definition.kind,
      'semantic_type', object_definition.semantic_type,
      'icon', object_definition.icon,
      'is_active', object_definition.is_active,
      'created_at', object_definition.created_at,
      'updated_at', object_definition.updated_at
    ),
    'fields', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', field.id,
            'business_id', field.business_id,
            'object_definition_id', field.object_definition_id,
            'key', field.key,
            'label', field.label,
            'field_type', field.field_type,
            'required', field.required,
            'default_value', field.default_value,
            'settings_json', field.settings_json,
            'position', field.position,
            'is_active', field.is_active,
            'created_at', field.created_at,
            'updated_at', field.updated_at
          )
          order by field.position, field.key
        )
        from public.field_definitions as field
        where field.business_id = form.business_id
          and field.object_definition_id = form.object_definition_id
          and field.is_active
          and exists (
            select 1
            from jsonb_array_elements(form.config_json -> 'fields') as configured
            where configured ->> 'field' = field.key
          )
      ),
      '[]'::jsonb
    )
  )
  from public.businesses as business
  join public.pages as page
    on page.business_id = business.id
  join public.forms as form
    on form.business_id = business.id
  join public.object_definitions as object_definition
    on object_definition.business_id = form.business_id
    and object_definition.id = form.object_definition_id
  where business.slug = requested_business_slug
    and page.slug = requested_page_slug
    and page.audience = 'public'
    and page.status = 'published'
    and page.is_active
    and form.key = requested_form_key
    and form.mode = 'create'
    and form.audience = 'public'
    and form.is_active
    and object_definition.is_active
    and exists (
      select 1
      from jsonb_array_elements(page.layout_json -> 'blocks') as block
      where block ->> 'type' = 'public_form'
        and block ->> 'form_key' = form.key
    )
  limit 1;
$$;

revoke all on function public.resolve_public_form(text, text, text) from public;
grant execute on function public.resolve_public_form(text, text, text)
  to anon, authenticated, service_role;

comment on function public.resolve_public_form(text, text, text) is
  'Narrow anonymous resolver for an active public create Form and its configured Fields on a published public Page.';
