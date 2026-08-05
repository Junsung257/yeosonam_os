-- Aggregate funnel only. No names, phones, or free-text inquiry bodies.
select 'lead_created' stage, count(*)::bigint total,
       count(*) filter (where created_at >= now() - interval '30 days')::bigint recent_30d
from public.leads
union all
select 'booking_created', count(*),
       count(*) filter (where created_at >= now() - interval '30 days')
from public.bookings
union all
select 'payment_recorded', count(*),
       count(*) filter (where created_at >= now() - interval '30 days')
from public.bookings
where coalesce(is_deleted, false) is false and coalesce(paid_amount, 0) > 0
union all
select 'booking_confirmed', count(*),
       count(*) filter (where created_at >= now() - interval '30 days')
from public.bookings
where coalesce(is_deleted, false) is false and status = 'confirmed';

select
  channel,
  coalesce(utm_source, '(none)') as utm_source,
  coalesce(utm_medium, '(none)') as utm_medium,
  count(*) as leads
from public.leads
group by channel, utm_source, utm_medium
order by leads desc, channel;
