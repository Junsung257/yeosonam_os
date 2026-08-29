-- Future blog generation deduplication only.
-- Existing content_creatives are intentionally not rewritten, deleted, or
-- backfilled here. The application performs a read-only legacy lookup before
-- claiming a new key; this table is the concurrency-safe claim ledger for new
-- generation attempts.

begin;

create table if not exists public.blog_generation_dedup_claims (
  dedup_key text primary key,
  normalized_title text not null,
  claim_owner text not null,
  claim_status text not null default 'reserved'
    check (claim_status in ('reserved', 'bound', 'review')),
  content_kind text not null default 'unknown'
    check (content_kind in ('information', 'product', 'general', 'unknown')),
  destination text null,
  content_creative_id uuid null references public.content_creatives(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_generation_dedup_claims_key_not_blank check (btrim(dedup_key) <> ''),
  constraint blog_generation_dedup_claims_title_not_blank check (btrim(normalized_title) <> ''),
  constraint blog_generation_dedup_claims_owner_not_blank check (btrim(claim_owner) <> ''),
  constraint blog_generation_dedup_claims_bound_target check (
    claim_status = 'reserved'
    or content_creative_id is not null
  )
);

create index if not exists idx_blog_generation_dedup_claims_title
  on public.blog_generation_dedup_claims(normalized_title);

create index if not exists idx_blog_generation_dedup_claims_expiry
  on public.blog_generation_dedup_claims(expires_at);

alter table public.blog_generation_dedup_claims enable row level security;

revoke all on table public.blog_generation_dedup_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.blog_generation_dedup_claims to service_role;

drop policy if exists blog_generation_dedup_claims_service_role_all
  on public.blog_generation_dedup_claims;
create policy blog_generation_dedup_claims_service_role_all
  on public.blog_generation_dedup_claims
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.claim_blog_generation_dedup(
  p_dedup_key text,
  p_normalized_title text,
  p_claim_owner text,
  p_content_kind text default 'unknown',
  p_destination text default null,
  p_ttl_seconds integer default 3600,
  p_allow_existing_creative_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_claim public.blog_generation_dedup_claims%rowtype;
  v_expires_at timestamptz := now() + make_interval(secs => p_ttl_seconds);
begin
  if nullif(btrim(p_dedup_key), '') is null
     or nullif(btrim(p_normalized_title), '') is null
     or nullif(btrim(p_claim_owner), '') is null then
    raise exception 'blog_generation_dedup_claim_input_blank';
  end if;

  if p_ttl_seconds < 60 or p_ttl_seconds > 86400 then
    raise exception 'blog_generation_dedup_claim_ttl_invalid';
  end if;

  if p_content_kind not in ('information', 'product', 'general', 'unknown') then
    raise exception 'blog_generation_dedup_claim_content_kind_invalid';
  end if;

  insert into public.blog_generation_dedup_claims (
    dedup_key,
    normalized_title,
    claim_owner,
    claim_status,
    content_kind,
    destination,
    expires_at,
    updated_at
  ) values (
    btrim(p_dedup_key),
    btrim(p_normalized_title),
    btrim(p_claim_owner),
    'reserved',
    p_content_kind,
    nullif(btrim(p_destination), ''),
    v_expires_at,
    now()
  )
  on conflict (dedup_key) do nothing;

  select *
    into v_claim
    from public.blog_generation_dedup_claims
   where dedup_key = btrim(p_dedup_key)
   for update;

  if (
       v_claim.claim_status = 'reserved'
       and (
         v_claim.claim_owner = btrim(p_claim_owner)
         or v_claim.expires_at <= now()
       )
     )
     or (
       p_allow_existing_creative_id is not null
       and v_claim.content_creative_id = p_allow_existing_creative_id
     ) then
    update public.blog_generation_dedup_claims
       set normalized_title = btrim(p_normalized_title),
           claim_owner = btrim(p_claim_owner),
           claim_status = 'reserved',
           content_kind = p_content_kind,
           destination = nullif(btrim(p_destination), ''),
           content_creative_id = null,
           expires_at = v_expires_at,
           updated_at = now()
     where dedup_key = btrim(p_dedup_key);

    return jsonb_build_object(
      'claimed', true,
      'dedup_key', btrim(p_dedup_key),
      'claim_status', 'reserved'
    );
  end if;

  return jsonb_build_object(
    'claimed', false,
    'dedup_key', v_claim.dedup_key,
    'claim_status', v_claim.claim_status,
    'existing_creative_id', v_claim.content_creative_id,
    'reason', 'active_claim'
  );
end;
$$;

revoke all on function public.claim_blog_generation_dedup(text, text, text, text, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_blog_generation_dedup(text, text, text, text, text, integer, uuid)
  to service_role;

comment on table public.blog_generation_dedup_claims is
  'Concurrency-safe ledger for future blog title generation. Existing duplicate content is never auto-mutated.';

comment on function public.claim_blog_generation_dedup(text, text, text, text, text, integer, uuid) is
  'Atomically claims a new normalized blog title key. Expired claims may be reclaimed; callers bind or release after content persistence.';

commit;
