-- Sites C2 publication safety for authored links.
--
-- The canonical href remains durable and is projected unchanged. A relative
-- Site Page path is only a valid internal destination when its target Page is
-- included in this same draft. External, mailto/tel, and other safe relative
-- URLs retain the existing Page grammar.

create or replace function private.site_rich_text_link_hrefs_v1(node jsonb)
returns setof text
language sql
immutable
set search_path = ''
as $$
  with spans(value) as (
    select span.value
    from jsonb_array_elements(
      case when jsonb_typeof(node -> 'content') = 'array'
        then node -> 'content' else '[]'::jsonb end
    ) as span(value)
    where node ->> 'type' in ('paragraph', 'heading')
    union all
    select span.value
    from jsonb_array_elements(
      case when jsonb_typeof(node -> 'items') = 'array'
        then node -> 'items' else '[]'::jsonb end
    ) as item(value)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(item.value -> 'content') = 'array'
        then item.value -> 'content' else '[]'::jsonb end
    ) as span(value)
    where node ->> 'type' in ('bullet_list', 'numbered_list')
  )
  select mark.value ->> 'href'
  from spans
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(spans.value -> 'marks') = 'array'
      then spans.value -> 'marks' else '[]'::jsonb end
  ) as mark(value)
  where mark.value ->> 'type' = 'link'
    and jsonb_typeof(mark.value -> 'href') = 'string';
$$;

create or replace function private.site_assert_internal_page_href_targets_v1(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  business_slug text;
  site_block record;
  href_value text;
  href_parts text[];
begin
  select business.slug into business_slug
  from public.businesses as business
  where business.id = target_business_id;
  if business_slug is null then
    raise exception 'site_publication_not_ready' using
      errcode = '22023',
      detail = 'The Site Business could not be resolved for authored links.';
  end if;

  for site_block in
    select block_value.*
    from private.site_draft_blocks_v1(draft) as block_value
    join jsonb_array_elements(draft -> 'pages') as page_value(value)
      on (page_value.value ->> 'id')::uuid = block_value.page_id
    where coalesce((page_value.value ->> 'is_included')::boolean, false)
      and block_value.block ->> 'type' in ('button', 'rich_text')
  loop
    if site_block.block ->> 'type' = 'button' then
      for href_value in
        select site_block.block ->> 'href'
      loop
        href_parts := regexp_match(
          href_value,
          '^/p/([^/?#]+)/([^/?#]+)([?#].*)?$'
        );
        if href_parts is not null
          and href_parts[1] = business_slug
          and not exists (
            select 1
            from jsonb_array_elements(draft -> 'pages') as page_value(value)
            where page_value.value ->> 'slug' = href_parts[2]
              and coalesce((page_value.value ->> 'is_included')::boolean, false)
          )
        then
          raise exception 'site_page_link_not_ready' using
            errcode = '22023',
            detail = format(
              'The included Page links to a missing or excluded Site Page: %s.',
              href_value
            );
        end if;
      end loop;
    else
      for href_value in
        select link_href
        from private.site_rich_text_link_hrefs_v1(site_block.block -> 'node')
          as link_value(link_href)
      loop
        href_parts := regexp_match(
          href_value,
          '^/p/([^/?#]+)/([^/?#]+)([?#].*)?$'
        );
        if href_parts is not null
          and href_parts[1] = business_slug
          and not exists (
            select 1
            from jsonb_array_elements(draft -> 'pages') as page_value(value)
            where page_value.value ->> 'slug' = href_parts[2]
              and coalesce((page_value.value ->> 'is_included')::boolean, false)
          )
        then
          raise exception 'site_page_link_not_ready' using
            errcode = '22023',
            detail = format(
              'The included Page links to a missing or excluded Site Page: %s.',
              href_value
            );
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

revoke all on function private.site_rich_text_link_hrefs_v1(jsonb),
  private.site_assert_internal_page_href_targets_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Keep draft persistence permissive for recoverable authoring. The release
-- boundary is where an internal Site Page destination must be included.
create or replace function private.site_assert_publication_draft_c2(
  target_business_id uuid,
  draft jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  site_block record;
begin
  perform private.site_assert_site_draft_c2(target_business_id, draft);
  for site_block in
    select block_value.*
    from private.site_draft_blocks_v1(draft) as block_value
    join jsonb_array_elements(draft -> 'pages') as page_value(value)
      on (page_value.value ->> 'id')::uuid = block_value.page_id
    where coalesce((page_value.value ->> 'is_included')::boolean, false)
  loop
    if site_block.block ->> 'type' in (
      'form', 'public_form', 'booking', 'preorder', 'view'
    ) then
      raise exception 'site_unsupported_content' using
        errcode = '23514',
        detail = format(
          'The %s block needs a supported C2 representation before publication.',
          site_block.block ->> 'type'
        );
    end if;
  end loop;
  perform private.site_assert_internal_page_href_targets_v1(
    target_business_id, draft
  );
end;
$$;
