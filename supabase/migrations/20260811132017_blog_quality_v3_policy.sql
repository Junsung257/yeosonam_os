-- Blog Quality Engine V3: additive publication metadata and one fail-closed public policy.
begin;

alter table public.content_creatives
  add column if not exists content_document jsonb null,
  add column if not exists content_modified_at timestamptz null,
  add column if not exists fact_checked_at timestamptz null,
  add column if not exists last_verified_at timestamptz null,
  add column if not exists material_update_reason text null,
  add column if not exists author_profile_id uuid null;

alter table public.content_reviews
  add column if not exists review_scope text null;

create table if not exists public.blog_publication_decisions (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.content_creatives(id) on delete cascade,
  queue_id uuid null references public.blog_topic_queue(id) on delete set null,
  policy_version text not null default 'blog-quality-v3',
  autopublish_mode text not null check (autopublish_mode in ('draft_only', 'reviewed_only', 'live')),
  decision text not null check (decision in ('draft', 'pending_review', 'published', 'blocked')),
  gate_evidence jsonb not null default '{}'::jsonb,
  reasons text[] not null default '{}'::text[],
  decided_at timestamptz not null default now(),
  unique (creative_id, policy_version, decided_at)
);

create index if not exists idx_blog_publication_decisions_queue
  on public.blog_publication_decisions(queue_id)
  where queue_id is not null;

create table if not exists public.blog_url_dispositions (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.content_creatives(id) on delete cascade,
  action text not null check (action in ('KEEP','REFRESH','MERGE','QUARANTINE','NOINDEX','REMOVE','REDIRECT')),
  canonical_target text null,
  http_status integer null check (http_status in (301, 308, 410)),
  reason text not null,
  approved_by uuid null,
  approved_at timestamptz null,
  applied_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint blog_url_disposition_approval_pair check (
    (approved_by is null and approved_at is null) or
    (approved_by is not null and approved_at is not null)
  )
);

create table if not exists public.blog_headline_experiments (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.content_creatives(id) on delete cascade,
  variant_key text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft','running','completed','cancelled')),
  assigned_weight numeric(5,4) not null default 0 check (assigned_weight between 0 and 1),
  performance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (creative_id, variant_key),
  constraint blog_headline_experiment_window check (ends_at > starts_at),
  constraint blog_headline_fact_guard check (title !~* '(ETIAS|ETA|ESTA|비자|입국).*[0-9]{4}|[0-9]+\s*(유로|달러|원)')
);

create or replace function public.evaluate_blog_public_eligibility_v3(
  p_id uuid,
  p_slug text,
  p_status text,
  p_channel text,
  p_product_id uuid,
  p_review_status text,
  p_title text,
  p_category text,
  p_content_type text,
  p_topic text,
  p_published_at timestamptz,
  p_generation_meta jsonb,
  p_quality_gate jsonb,
  p_representative_status text,
  p_canonical_creative_id uuid,
  p_canonical_slug text
) returns table (eligible boolean, lane text, reason text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_text text := concat_ws(' ', p_title, p_category, p_content_type, p_topic);
  v_high_risk boolean := v_text ~* '(비자|입국|출입국|이민국|여권|세관|면세|보험[[:space:]]*(보장|면책|청구)|여행[[:space:]]*보험|법률|규제|안전[[:space:]]*(경보|주의보)|건강|의료|질병|예방접종|visa|immigration|passport|customs|duty[ -]?free|(^|[^a-z])(eta|esta|etias)([^a-z]|$)|travel[[:space:]]*insurance|health[[:space:]]*advisory|safety[[:space:]]*alert)';
begin
  if p_status is distinct from 'published' then return query select false, null::text, 'not_published'; return; end if;
  if p_channel is distinct from 'naver_blog' then return query select false, null::text, 'wrong_channel'; return; end if;
  if nullif(btrim(p_slug), '') is null then return query select false, null::text, 'missing_slug'; return; end if;
  if coalesce(p_generation_meta ->> 'noindex', 'false') = 'true'
    or coalesce(p_generation_meta -> 'seo' ->> 'noindex', 'false') = 'true'
    then return query select false, null::text, 'noindex'; return;
  end if;
  if nullif(btrim(coalesce(p_generation_meta ->> 'redirect_to', '')), '') is not null
    or nullif(btrim(coalesce(p_generation_meta ->> 'redirectTo', '')), '') is not null
    or nullif(btrim(coalesce(p_generation_meta ->> 'canonical_redirect_to', '')), '') is not null
    then return query select false, null::text, 'redirected'; return;
  end if;
  if coalesce(p_review_status, 'none') in ('pending_review','in_review','rejected','changes_requested')
    then return query select false, case when p_product_id is not null then 'product' else null end, 'review_blocked'; return;
  end if;
  if v_high_risk and coalesce(p_review_status, 'none') <> 'approved'
    then return query select false, case when p_product_id is not null then 'product' else null end, 'review_blocked'; return;
  end if;
  if p_product_id is not null then return query select true, 'product', 'eligible_product'; return; end if;
  if p_published_at < timestamptz '2026-07-15 00:00:00+09'
    then
      if coalesce(p_quality_gate ->> 'passed', 'false') <> 'true'
        then return query select false, 'information_legacy', 'quality_gate_missing_or_failed'; return;
      end if;
      return query select true, 'information_legacy', 'eligible_information_legacy'; return;
  end if;
  if nullif(btrim(coalesce(p_generation_meta -> 'content_brief' ->> 'destination_id', '')), '') is null
    then return query select false, 'information_v2', 'information_contract_missing'; return;
  end if;
  if p_generation_meta -> 'content_brief' ->> 'destination_id' in ('unknown','undefined','null','top')
    then return query select false, 'information_v2', 'destination_entity_invalid'; return;
  end if;
  if coalesce(p_quality_gate ->> 'passed', 'false') <> 'true'
    then return query select false, 'information_v2', 'quality_gate_missing_or_failed'; return;
  end if;
  if coalesce(p_generation_meta -> 'information_claim_validation' ->> 'passed', 'false') <> 'true'
    then return query select false, 'information_v2', 'claim_gate_missing_or_failed'; return;
  end if;
  if p_representative_status is distinct from 'active'
    then return query select false, 'information_v2', 'representative_missing_or_inactive'; return;
  end if;
  if p_canonical_creative_id is distinct from p_id or p_canonical_slug is distinct from p_slug
    then return query select false, 'information_v2', 'representative_canonical_mismatch'; return;
  end if;
  return query select true, 'information_v2', 'eligible_information_v2';
end;
$$;

create or replace view public.public_blog_content_creatives
with (security_invoker = true)
as
select c.*, policy.lane as public_eligibility_lane, policy.reason as public_eligibility_reason
from public.content_creatives c
left join public.blog_information_representatives r on r.canonical_creative_id = c.id
cross join lateral public.evaluate_blog_public_eligibility_v3(
  c.id, c.slug, c.status, c.channel, c.product_id, c.review_status,
  c.seo_title, c.category, c.content_type, c.title, c.published_at,
  c.generation_meta, c.quality_gate, r.status, r.canonical_creative_id, r.canonical_slug
) policy
where policy.eligible;

alter table public.blog_publication_decisions enable row level security;
alter table public.blog_url_dispositions enable row level security;
alter table public.blog_headline_experiments enable row level security;
revoke all on public.blog_publication_decisions, public.blog_url_dispositions, public.blog_headline_experiments from public, anon, authenticated;
revoke all on function public.evaluate_blog_public_eligibility_v3(uuid,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text,uuid,text) from public, anon, authenticated;
revoke all on public.public_blog_content_creatives from public, anon, authenticated;
grant select, insert, update, delete on public.blog_publication_decisions, public.blog_url_dispositions, public.blog_headline_experiments to service_role;
grant execute on function public.evaluate_blog_public_eligibility_v3(uuid,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text,uuid,text) to service_role;
grant select on public.public_blog_content_creatives to service_role;

create policy blog_publication_decisions_service_role on public.blog_publication_decisions for all to service_role using (true) with check (true);
create policy blog_url_dispositions_service_role on public.blog_url_dispositions for all to service_role using (true) with check (true);
create policy blog_headline_experiments_service_role on public.blog_headline_experiments for all to service_role using (true) with check (true);

comment on function public.evaluate_blog_public_eligibility_v3 is 'Canonical SQL half of Blog Quality V3 public eligibility. Keep parity with src/lib/blog-public-eligibility.ts fixtures.';
comment on view public.public_blog_content_creatives is 'Server-only public blog source; every row passed evaluate_blog_public_eligibility_v3.';

commit;
