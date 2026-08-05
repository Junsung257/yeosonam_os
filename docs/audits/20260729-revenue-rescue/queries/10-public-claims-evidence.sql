-- Evidence for customer-facing counts. Aggregates only; no fabricated fallback values.
select
  (select count(*) from public.public_package_snapshots
    where published_at is not null and superseded_at is null) as active_public_offers,
  (select count(*) from public.package_reviews
    where is_public is true) as published_reviews,
  (select count(*) from public.bookings
    where coalesce(is_deleted, false) is false and status = 'confirmed') as confirmed_bookings,
  (select count(*) from public.bookings
    where coalesce(is_deleted, false) is false and status = 'completed') as completed_trips,
  now() as observed_at;

select
  package_id,
  source_count,
  avg_rating,
  generated_at
from public.package_review_digests
where source_count > 0
order by generated_at desc;
