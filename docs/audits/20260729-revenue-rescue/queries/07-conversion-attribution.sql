select
  'content_attribution_events' source,
  count(*) as total,
  count(*) filter (where occurred_at >= now() - interval '30 days') as recent_30d
from public.content_attribution_events
union all
select
  'meta_conversion_events',
  count(*),
  count(*) filter (where created_at >= now() - interval '30 days')
from public.meta_conversion_events;

select
  count(*) as leads,
  count(*) filter (where utm_source is not null) as with_utm_source,
  count(*) filter (where utm_medium is not null) as with_utm_medium,
  count(*) filter (where utm_campaign is not null) as with_utm_campaign,
  count(*) filter (where referrer is not null) as with_referrer,
  count(*) filter (where session_id is not null) as with_session
from public.leads;

select
  event_type,
  session_id,
  content_id,
  occurred_at,
  count(*) as copies
from public.content_attribution_events
where session_id is not null
group by event_type, session_id, content_id, occurred_at
having count(*) > 1
order by copies desc;

select event_id, event_name, count(*) as copies
from public.meta_conversion_events
group by event_id, event_name
having count(*) > 1
order by copies desc;
