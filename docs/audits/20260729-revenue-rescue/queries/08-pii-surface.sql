-- Schema-only PII surface. Does not select customer values.
select
  table_schema,
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and (
    column_name ~* '(passport|resident|birth|phone|email|name|contact|address)'
    or column_name in ('ocr_result', 'raw_payload', 'payload')
  )
order by table_name, ordinal_position;

select
  p.tablename,
  p.policyname,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in (
    'booking_companions',
    'booking_travelers',
    'bookings',
    'leads',
    'passport_ocr_logs'
  )
order by p.tablename, p.policyname;
