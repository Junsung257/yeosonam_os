create table if not exists public.serp_rank_snapshots (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  engine text not null check (engine in ('google', 'naver')),
  url text not null,
  position integer,
  checked_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create index if not exists idx_serp_rank_keyword on public.serp_rank_snapshots(keyword);
create index if not exists idx_serp_rank_checked on public.serp_rank_snapshots(checked_at desc);

alter table public.serp_rank_snapshots enable row level security;

drop policy if exists "allow_all_serp_rank" on public.serp_rank_snapshots;
drop policy if exists "service_role_serp_rank_snapshots" on public.serp_rank_snapshots;

create policy "service_role_serp_rank_snapshots"
  on public.serp_rank_snapshots
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
