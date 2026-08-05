-- Public offer readiness. Returns only aggregate status and non-PII package identifiers.
with latest_decisions as (
  select distinct on (package_id)
    package_id,
    publishable,
    hard_blockers,
    required_actions,
    created_at
  from public.package_publish_decisions
  order by package_id, created_at desc
),
active_snapshots as (
  select package_id, id as snapshot_id, published_at, snapshot_json
  from public.public_package_snapshots
  where published_at is not null and superseded_at is null
)
select
  now() as observed_at,
  (select count(*) from latest_decisions where publishable) as latest_publishable_decisions,
  (select count(*) from active_snapshots) as active_public_snapshots,
  (select count(*) from latest_decisions d
    join active_snapshots s using (package_id)
    where d.publishable) as publishable_with_active_snapshot;

select
  d.package_id,
  d.publishable,
  d.hard_blockers,
  d.required_actions,
  d.created_at as decision_at,
  s.snapshot_id,
  s.published_at
from (
  select distinct on (package_id) *
  from public.package_publish_decisions
  order by package_id, created_at desc
) d
left join public.public_package_snapshots s
  on s.package_id = d.package_id
 and s.published_at is not null
 and s.superseded_at is null
where d.publishable or s.id is not null
order by greatest(d.created_at, s.published_at) desc nulls last;
