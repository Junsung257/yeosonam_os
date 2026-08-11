-- Blog Quality Engine V3 reliability follow-up.
--
-- Backward compatibility:
-- - Existing lead writers may omit the two new nullable columns.
-- - Existing direct analytics writes remain valid and share the same
--   idempotency key with the outbox consumer.
-- - No existing rows are mutated by this migration.
--
-- Dry-run backfill inventory (read-only):
--   select count(*) as leads_without_generate_lead_event
--   from public.leads l
--   left join public.analytics_server_events e
--     on e.idempotency_key = 'lead:' || l.id::text
--   where e.id is null;
-- Historical lead events are deliberately not synthesized automatically.

create index concurrently if not exists idx_content_creatives_author_profile_id
  on public.content_creatives(author_profile_id)
  where author_profile_id is not null;

alter table public.content_creatives
  drop constraint if exists content_creatives_author_profile_id_fkey;
alter table public.content_creatives
  add constraint content_creatives_author_profile_id_fkey
  foreign key (author_profile_id) references public.blog_author_profiles(id) on delete set null
  not valid;

alter table public.leads
  add column if not exists assisting_content_creative_id uuid null,
  add column if not exists search_query_hash text null;

alter table public.leads
  drop constraint if exists leads_search_query_hash_format;

alter table public.leads
  add constraint leads_search_query_hash_format
  check (search_query_hash is null or search_query_hash ~ '^[0-9a-f]{64}$');

comment on column public.leads.assisting_content_creative_id is
  'Untrusted nullable blog assist hint. The outbox trigger only retains an ID that exists in content_creatives.';
comment on column public.leads.search_query_hash is
  'One-way SHA-256 query hash; raw search text is never stored in this column.';

create table if not exists public.analytics_server_event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    'generate_lead',
    'purchase',
    'refund',
    'ysn_booking_confirmed'
  )),
  idempotency_key text not null unique,
  source_type text not null check (source_type in (
    'lead',
    'booking',
    'checkout_transaction',
    'ledger'
  )),
  source_id text not null,
  lead_id uuid null,
  booking_id uuid null,
  product_id uuid null,
  transaction_id text null,
  assisting_content_creative_id uuid null,
  search_query_hash text null check (
    search_query_hash is null or search_query_hash ~ '^[0-9a-f]{64}$'
  ),
  value_krw integer null check (value_krw is null or value_krw >= 0),
  attribution_snapshot jsonb null,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  status text not null default 'pending' check (status in (
    'pending',
    'processing',
    'processed',
    'failed',
    'dead'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz null,
  last_attempt_at timestamptz null,
  processed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analytics_server_event_outbox_ready
  on public.analytics_server_event_outbox(status, next_attempt_at, created_at)
  where status in ('pending', 'failed', 'processing');

alter table public.analytics_server_event_outbox enable row level security;
drop policy if exists analytics_server_event_outbox_service_role
  on public.analytics_server_event_outbox;
create policy analytics_server_event_outbox_service_role
  on public.analytics_server_event_outbox
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.analytics_server_event_outbox
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.analytics_server_event_outbox
  to service_role;

create or replace function public.enqueue_generate_lead_analytics_event()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  verified_assist_id uuid;
  safe_attribution jsonb;
begin
  if new.assisting_content_creative_id is not null
    and exists (
      select 1
      from public.content_creatives c
      where c.id = new.assisting_content_creative_id
    )
  then
    verified_assist_id := new.assisting_content_creative_id;
  end if;

  safe_attribution := new.attribution_snapshot
    #- '{firstTouch,term}'
    #- '{lastTouch,term}';

  insert into public.analytics_server_event_outbox (
    event_name,
    idempotency_key,
    source_type,
    source_id,
    lead_id,
    product_id,
    assisting_content_creative_id,
    search_query_hash,
    attribution_snapshot,
    event_payload,
    occurred_at
  ) values (
    'generate_lead',
    'lead:' || new.id::text,
    'lead',
    new.id::text,
    new.id,
    new.product_id,
    verified_assist_id,
    new.search_query_hash,
    safe_attribution,
    jsonb_build_object(
      'lead_type', 'package_inquiry',
      'channel', left(coalesce(new.channel, 'website'), 100),
      'package_id', new.product_id,
      'assisted_by_blog', verified_assist_id is not null
    ),
    coalesce(new.submitted_at, now())
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_generate_lead_analytics_event()
  from public, anon, authenticated;
grant execute on function public.enqueue_generate_lead_analytics_event()
  to service_role;

drop trigger if exists trg_enqueue_generate_lead_analytics_event on public.leads;
create trigger trg_enqueue_generate_lead_analytics_event
after insert on public.leads
for each row
execute function public.enqueue_generate_lead_analytics_event();

-- Rollback (manual, intentionally not executed):
--   drop trigger if exists trg_enqueue_generate_lead_analytics_event on public.leads;
--   drop function if exists public.enqueue_generate_lead_analytics_event();
--   drop table if exists public.analytics_server_event_outbox;
--   alter table public.leads drop constraint if exists leads_search_query_hash_format;
--   alter table public.leads drop column if exists assisting_content_creative_id;
--   alter table public.leads drop column if exists search_query_hash;
--   alter table public.content_creatives drop constraint if exists content_creatives_author_profile_id_fkey;
--   drop index concurrently if exists public.idx_content_creatives_author_profile_id;
